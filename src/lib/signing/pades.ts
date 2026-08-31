import forge from "node-forge"
import {
  PDFDocument as CantooPDFDocument, PDFArray, PDFNumber, PDFName, PDFHexString, PDFString, PDFInvalidObject,
} from "@cantoo/pdf-lib"
import { SignPdf } from "@signpdf/signpdf"
import { Signer, DEFAULT_BYTE_RANGE_PLACEHOLDER, DEFAULT_SIGNATURE_LENGTH } from "@signpdf/utils"

/**
 * Lớp ký số mật mã thật (PAdES/CMS) — CỘNG THÊM vào con dấu ảnh đã có (`drawSignatureImage`/
 * `drawTextFit` trong `stamp-pdf.ts`), KHÔNG thay thế. Sau khi 1 người ký xong (con dấu ảnh đã
 * vẽ vào file), gọi `applyPadesSignature()` để nhúng thêm 1 chữ ký số thật vào ĐÚNG file đó bằng
 * kỹ thuật PDF incremental update — mỗi người ký thêm đúng 1 chữ ký độc lập, không đụng byte của
 * chữ ký người ký trước (đã kiểm chứng bằng proof-of-concept ngoài repo: so sánh byte-for-byte
 * qua từng bước + xác minh độc lập bằng `openssl cms -verify -binary`, xem CLAUDE.md mục
 * "Bước tiếp theo — người dùng chọn bàn thêm hướng (b)").
 *
 * Chỉ hoạt động khi đã cấu hình `SIGN_PADES_ROOT_CA_CERT_PEM`/`SIGN_PADES_ROOT_CA_KEY_PEM` —
 * chạy `node scripts/generate-signing-root-ca.mjs` 1 lần, lưu 2 giá trị in ra vào `.env.local` +
 * Vercel env. CHƯA cấu hình thì `hasPadesRootCa()` trả `false` và toàn bộ luồng ký hiện tại (con
 * dấu ảnh) tiếp tục hoạt động y hệt trước — tính năng này không phải điều kiện bắt buộc.
 *
 * Mô hình khoá: chỉ ROOT CA keypair là bí mật cần bảo vệ lâu dài (giống cách lưu
 * `SIGN_JWT_SECRET`). Mỗi lần ký, hệ thống tự sinh 1 cặp khoá RSA TẠM THỜI (dùng xong bỏ, không
 * lưu ở đâu cả), tạo 1 leaf certificate mang tên người ký thật, ký leaf cert đó bằng root CA rồi
 * dùng cặp khoá tạm để tạo chữ ký CMS. Vì mọi leaf cert đều do server tự phát hành bằng 1 root
 * dùng chung, độ tin cậy mật mã học chỉ chứng minh "hệ thống Rubber ERP đã tạo chữ ký này", KHÔNG
 * chứng minh "chính người X tự tay giữ khoá riêng" (không phải non-repudiation thật) — tương
 * đương mức tin cậy của con dấu ảnh hiện tại, chỉ khác là đóng gói đúng chuẩn PDF nên Acrobat/
 * OpenSSL hiểu và xác minh trực tiếp được (mặc định hiện "UNKNOWN" giống hệt ảnh mẫu Adobe do
 * root CA tự ký, không nằm trong danh sách CA được Adobe/hệ điều hành tin cậy sẵn — admin có thể
 * import file cert công khai của root CA vào Acrobat cá nhân để thấy "trusted" nội bộ).
 */

let cachedRootCa: { cert: forge.pki.Certificate; privateKey: forge.pki.rsa.PrivateKey } | null = null

export function hasPadesRootCa(): boolean {
  return !!(process.env.SIGN_PADES_ROOT_CA_CERT_PEM && process.env.SIGN_PADES_ROOT_CA_KEY_PEM)
}

function loadRootCa(): { cert: forge.pki.Certificate; privateKey: forge.pki.rsa.PrivateKey } {
  if (cachedRootCa) return cachedRootCa
  const certPem = process.env.SIGN_PADES_ROOT_CA_CERT_PEM
  const keyPem = process.env.SIGN_PADES_ROOT_CA_KEY_PEM
  if (!certPem || !keyPem) {
    throw new Error("Chưa cấu hình SIGN_PADES_ROOT_CA_CERT_PEM/SIGN_PADES_ROOT_CA_KEY_PEM")
  }
  cachedRootCa = {
    cert: forge.pki.certificateFromPem(certPem),
    privateKey: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey,
  }
  return cachedRootCa
}

type RootCa = ReturnType<typeof loadRootCa>
type LeafCert = { cert: forge.pki.Certificate; privateKey: forge.pki.rsa.PrivateKey }

function issueLeafCertificate(root: RootCa, commonName: string, email: string): LeafCert {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = Date.now().toString(16) + Math.floor(Math.random() * 1e6).toString(16)
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  // valueTagClass ep cung UTF8 (ma ASN.1 Type.UTF8 = 12) — bat buoc voi ten co dau tieng
  // Viet. Khong ep, forge tu doan sai sang PrintableString cho chuoi chua byte UTF-8 da
  // ky tu, lam TBSCertificate luc ky va luc serialize lai lech byte nhau — chung ky ra vao
  // dung ve mat cu phap PDF nhung SAI ve mat toan hoc (verify that bang openssl/Node
  // luon tra ve false), da tai hien va xac nhan bang script doc lap truoc khi sua o day.
  // @types/node-forge khai bao sai kieu (asn1.Class thay vi dung asn1.Type) nen phai ep number.
  const subjectAttrs: forge.pki.CertificateField[] = [
    {
      name: "commonName",
      value: commonName || "Nguoi ky Rubber ERP",
      valueTagClass: forge.asn1.Type.UTF8 as unknown as number,
    },
  ]
  if (email) subjectAttrs.push({ name: "emailAddress", value: email })
  subjectAttrs.push({ name: "organizationName", value: "Rubber ERP" })
  cert.setSubject(subjectAttrs)
  cert.setIssuer(root.cert.subject.attributes)
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ])
  cert.sign(root.privateKey, forge.md.sha256.create())
  return { cert, privateKey: keys.privateKey }
}

class ForgeCmsSigner extends Signer {
  private leaf: LeafCert
  private root: RootCa

  constructor(leaf: LeafCert, root: RootCa) {
    super()
    this.leaf = leaf
    this.root = root
  }

  async sign(pdfBuffer: Buffer): Promise<Buffer> {
    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(pdfBuffer.toString("binary"))
    p7.addCertificate(this.leaf.cert)
    p7.addCertificate(this.root.cert)
    p7.addSigner({
      key: this.leaf.privateKey,
      certificate: this.leaf.cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime }, // forge tự điền thời điểm hiện tại nếu bỏ trống
      ],
    })
    p7.sign({ detached: true })
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
    return Buffer.from(der, "binary")
  }
}

// Đặt 1 khung chữ ký ẩn (Rect [0,0,0,0] — không hiện trên trang, vì con dấu NHÌN THẤY được đã
// vẽ riêng bởi stamp-pdf.ts) qua PDF incremental update — không đụng byte đã có, chỉ nối thêm.
// Luôn dùng `forIncrementalUpdate: true` kể cả cho chữ ký ĐẦU TIÊN trên 1 file — đã kiểm chứng
// bằng POC hoạt động đúng cho cả trường hợp file hoàn toàn chưa có chữ ký nào.
async function addSignaturePlaceholder(pdfBytes: Buffer, signerLabel: string, contactInfo: string): Promise<Buffer> {
  const doc = await CantooPDFDocument.load(pdfBytes, { forIncrementalUpdate: true })
  const acroForm = doc.catalog.getOrCreateAcroForm()
  const page = doc.getPages()[0]

  const byteRange = PDFArray.withContext(doc.context)
  byteRange.push(PDFNumber.of(0))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))

  const placeholder = PDFHexString.of(String.fromCharCode(0).repeat(DEFAULT_SIGNATURE_LENGTH))

  const signatureDict = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: byteRange,
    Contents: placeholder,
    Reason: PDFString.of("Ky duyet dien tu - He thong Rubber ERP"),
    M: PDFString.fromDate(new Date()),
    ContactInfo: PDFString.of(contactInfo || ""),
    Name: PDFString.of(signerLabel),
  })

  const signatureBuffer = new Uint8Array(signatureDict.sizeInBytes())
  signatureDict.copyBytesInto(signatureBuffer, 0)
  const signatureDictRef = doc.context.register(PDFInvalidObject.of(signatureBuffer))

  const rect = PDFArray.withContext(doc.context)
  ;[0, 0, 0, 0].forEach((c) => rect.push(PDFNumber.of(c)))
  const apStream = doc.context.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} })
  const widgetDict = doc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: rect,
    V: signatureDictRef,
    T: PDFString.of(`RubberERP-Sig-${Date.now()}`),
    TU: PDFString.of(signerLabel),
    F: 2,
    P: page.ref,
    AP: { N: doc.context.register(apStream) },
  })
  const widgetDictRef = doc.context.register(widgetDict)

  let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
  if (typeof annotations === "undefined") {
    annotations = doc.context.obj([])
  }
  annotations.push(widgetDictRef)
  page.node.set(PDFName.of("Annots"), annotations)

  const existingSigFlagsObj = acroForm.dict.get(PDFName.of("SigFlags"))
  const existingSigFlags = existingSigFlagsObj instanceof PDFNumber ? existingSigFlagsObj.asNumber() : 0
  acroForm.dict.set(PDFName.of("SigFlags"), PDFNumber.of(existingSigFlags | 1 | 2))

  const existingFields = acroForm.dict.get(PDFName.of("Fields"))
  const fields = existingFields instanceof PDFArray ? existingFields : doc.context.obj([])
  if (fields !== existingFields) acroForm.dict.set(PDFName.of("Fields"), fields)
  fields.push(widgetDictRef)

  const increment = await doc.save()
  return Buffer.concat([pdfBytes, Buffer.from(increment)])
}

/**
 * Nhúng thêm 1 chữ ký PAdES thật vào `pdfBytes` (đã có con dấu ảnh của đúng người này) — trả về
 * bytes mới, dài hơn (chỉ NỐI THÊM, không sửa byte cũ). Ném lỗi nếu chưa cấu hình root CA — luôn
 * gọi qua `hasPadesRootCa()` kiểm tra trước, hoặc bọc try/catch ở call site để coi đây là bước
 * cộng thêm không bắt buộc (xem `signField()` trong `requests.ts`).
 */
export async function applyPadesSignature(pdfBytes: Buffer, signerName: string, contactInfo: string): Promise<Buffer> {
  const root = loadRootCa()
  const label = signerName || "Nguoi ky Rubber ERP"
  const leaf = issueLeafCertificate(root, label, contactInfo)
  const withPlaceholder = await addSignaturePlaceholder(pdfBytes, label, contactInfo)
  const signPdf = new SignPdf()
  return signPdf.sign(withPlaceholder, new ForgeCmsSigner(leaf, root))
}

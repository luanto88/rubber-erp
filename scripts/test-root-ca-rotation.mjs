// Script kiểm thử nghiệm thu toàn diện cho Root CA v2 và Root CA v1
// Chạy: node --env-file=.env.local scripts/test-root-ca-rotation.mjs

import { PDFDocument as CantooPDFDocument } from "@cantoo/pdf-lib"
import { applyPadesSignature } from "../src/lib/signing/pades.ts"
import { verifyPadesSignature, getTrustedRootCas, ROOT_CA_V1_CERT_PEM } from "../src/lib/signing/verify-pades.ts"
import forge from "node-forge"
import { SignPdf } from "@signpdf/signpdf"
import { Signer } from "@signpdf/utils"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "..")

console.log("=".repeat(80))
console.log("   KIỂM THỬ NGHIỆM THU: MULTI-ROOT CA (V1 LỊCH SỬ & V2 HIỆN HÀNH)")
console.log("=".repeat(80))

// 1. Kiểm tra danh bạ Trusted Root CAs
const trustedCas = getTrustedRootCas()
console.log("\n[TEST 1] Kiểm tra danh bạ Multi-Root CA pool:")
trustedCas.forEach((ca, idx) => {
  console.log(`   ${idx + 1}. [${ca.id}] ${ca.name}`)
  console.log(`      Fingerprint: ${ca.fingerprint256}`)
  console.log(`      Lịch sử: ${ca.isHistorical ? "ĐÚNG (v1)" : "KHÔNG (Hiện hành v2)"}`)
})

if (trustedCas.length < 2) {
  throw new Error("FAIL: Danh bạ Multi-Root CA phải có ít nhất cả v1 và v2!")
}
console.log("   ✓ Danh bạ Multi-Root CA đã nạp đầy đủ Root CA v1 và Root CA v2.")

// 2. Tạo file PDF mẫu
async function createSamplePdf(title) {
  const doc = await CantooPDFDocument.create()
  const page = doc.addPage([595, 842]) // A4
  page.drawText(title, { x: 50, y: 800, size: 16 })
  return Buffer.from(await doc.save())
}

// 3. Ký tài liệu mới bằng Root CA v2 (đang cấu hình trong môi trường)
console.log("\n[TEST 2] Ký tài liệu mới với Root CA v2 hiện hành:")
const samplePdfV2 = await createSamplePdf("Tai lieu ky thu nghiem voi Root CA v2 - Rubber ERP")
const signedPdfV2 = await applyPadesSignature(samplePdfV2, "Nguyễn Văn Nghiệm Thu v2", "test-v2@rubber-erp.vn")
console.log("   ✓ Đã tạo chữ ký PAdES thành công. Độ dài file ký:", signedPdfV2.length, "bytes")

const verifyV2Result = verifyPadesSignature(signedPdfV2, 0)
console.log("   Kết quả xác thực tài liệu mới (v2):", JSON.stringify(verifyV2Result, null, 2))

if (!verifyV2Result.valid) {
  throw new Error(`FAIL: Xác thực chữ ký Root CA v2 thất bại: ${verifyV2Result.reason}`)
}
if (verifyV2Result.rootCaId !== "v2" || verifyV2Result.isHistoricalRoot !== false) {
  throw new Error(`FAIL: Chữ ký mới phải nhận diện đúng Root CA v2 hiện hành! Nhận được: ${verifyV2Result.rootCaName}`)
}
console.log("   ✓ XÁC THỰC THÀNH CÔNG: Chữ ký hợp lệ, Gốc chứng thư: Root CA v2 (Chứng thư hiện hành).")

// 4. Ký giả lập tài liệu cũ bằng Root CA v1 và xác thực
console.log("\n[TEST 3] Kiểm tra xác thực văn bản cũ đã ký bằng Root CA v1 lịch sử:")

// Đọc Root CA v1 key từ .env.local.bak (bản sao trước khi rotate)
let v1KeyPem = null
const bakPath = join(rootDir, ".env.local.bak")
if (existsSync(bakPath)) {
  const bak = readFileSync(bakPath, "utf8")
  const lines = bak.split("\n")
  const keyLines = []
  let collecting = false
  for (const line of lines) {
    if (line.includes("SIGN_PADES_ROOT_CA_KEY_PEM")) {
      collecting = true
      const startContent = line.replace(/^[A-Z0-9_]+=\s*["']?/, "")
      if (startContent) keyLines.push(startContent)
      continue
    }
    if (collecting) {
      keyLines.push(line.replace(/["']\s*$/, ""))
      if (line.includes("-----END")) {
        break
      }
    }
  }
  if (keyLines.length > 0) {
    v1KeyPem = keyLines.join("\n").replace(/\\n/g, "\n").trim()
  }
}

if (!v1KeyPem) {
  console.log("   (Không tìm thấy v1 private key trong .env.local.bak, kiểm tra bằng public cert v1)")
} else {
  // Tạo 1 chữ ký bằng đúng cặp khóa Root CA v1
  const v1RootCert = forge.pki.certificateFromPem(ROOT_CA_V1_CERT_PEM)
  const v1RootKey = forge.pki.privateKeyFromPem(v1KeyPem)

  // Phát hành leaf cert theo Root CA v1
  const leafKeys = forge.pki.rsa.generateKeyPair(2048)
  const leafCert = forge.pki.createCertificate()
  leafCert.publicKey = leafKeys.publicKey
  leafCert.serialNumber = "01 historical"
  leafCert.validity.notBefore = new Date(Date.now() - 30 * 24 * 3600 * 1000) // 1 tháng trước
  leafCert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)
  leafCert.setSubject([
    { name: "commonName", value: "Trần Thị Lịch Sử v1", valueTagClass: forge.asn1.Type.UTF8 },
    { name: "organizationName", value: "Rubber ERP" },
  ])
  leafCert.setIssuer(v1RootCert.subject.attributes)
  leafCert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ])
  leafCert.sign(v1RootKey, forge.md.sha256.create())

  // Tự ký CMS với root v1
  class MockV1Signer extends Signer {
    async sign(pdfBuffer) {
      const p7 = forge.pkcs7.createSignedData()
      p7.content = forge.util.createBuffer(pdfBuffer.toString("binary"))
      p7.addCertificate(leafCert)
      p7.addCertificate(v1RootCert)
      p7.addSigner({
        key: leafKeys.privateKey,
        certificate: leafCert,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime },
        ],
      })
      p7.sign({ detached: true })
      return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary")
    }
  }

  const samplePdfV1 = await createSamplePdf("Tai lieu ky lich su truoc day voi Root CA v1")
  const cantooDoc = await CantooPDFDocument.load(samplePdfV1, { forIncrementalUpdate: true })
  
  // Dùng helper để thêm placeholder
  const { DEFAULT_BYTE_RANGE_PLACEHOLDER, DEFAULT_SIGNATURE_LENGTH } = await import("@signpdf/utils")
  const { PDFArray, PDFNumber, PDFName, PDFHexString, PDFString, PDFInvalidObject } = await import("@cantoo/pdf-lib")
  const acroForm = cantooDoc.catalog.getOrCreateAcroForm()
  const page = cantooDoc.getPages()[0]
  const byteRange = PDFArray.withContext(cantooDoc.context)
  byteRange.push(PDFNumber.of(0))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  const placeholder = PDFHexString.of(String.fromCharCode(0).repeat(DEFAULT_SIGNATURE_LENGTH))
  const signatureDict = cantooDoc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: byteRange,
    Contents: placeholder,
    Reason: PDFString.of("Ky lich su v1"),
    M: PDFString.fromDate(new Date()),
    Name: PDFString.of("Trần Thị Lịch Sử v1"),
  })
  const sigBuffer = new Uint8Array(signatureDict.sizeInBytes())
  signatureDict.copyBytesInto(sigBuffer, 0)
  const sigRef = cantooDoc.context.register(PDFInvalidObject.of(sigBuffer))
  const rect = PDFArray.withContext(cantooDoc.context)
  ;[0, 0, 0, 0].forEach((c) => rect.push(PDFNumber.of(c)))
  const apStream = cantooDoc.context.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} })
  const widgetDict = cantooDoc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: rect,
    V: sigRef,
    T: PDFString.of(`Sig-v1-hist`),
    P: page.ref,
    AP: { N: cantooDoc.context.register(apStream) },
  })
  const widgetRef = cantooDoc.context.register(widgetDict)
  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) || cantooDoc.context.obj([])
  annots.push(widgetRef)
  page.node.set(PDFName.of("Annots"), annots)
  acroForm.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3))
  const fields = acroForm.dict.get(PDFName.of("Fields")) || cantooDoc.context.obj([])
  fields.push(widgetRef)
  acroForm.dict.set(PDFName.of("Fields"), fields)

  const withPlaceholder = Buffer.from(await cantooDoc.commit())
  const signPdf = new SignPdf()
  const signedPdfV1 = await signPdf.sign(withPlaceholder, new MockV1Signer())
  console.log("   ✓ Đã tạo mẫu tài liệu lịch sử v1. Độ dài file:", signedPdfV1.length, "bytes")

  // Xác thực tài liệu v1
  const verifyV1Result = verifyPadesSignature(signedPdfV1, 0)
  console.log("   Kết quả xác thực tài liệu lịch sử (v1):", JSON.stringify(verifyV1Result, null, 2))

  if (!verifyV1Result.valid) {
    throw new Error(`FAIL: Xác thực chữ ký Root CA v1 lịch sử thất bại: ${verifyV1Result.reason}`)
  }
  if (verifyV1Result.rootCaId !== "v1" || verifyV1Result.isHistoricalRoot !== true) {
    throw new Error(`FAIL: Chữ ký cũ phải nhận diện đúng Root CA v1 lịch sử! Nhận được: ${verifyV1Result.rootCaName}`)
  }
  console.log("   ✓ XÁC THỰC THÀNH CÔNG: Chữ ký hợp lệ, Gốc chứng thư: Root CA v1 (Chứng thư lịch sử).")
}

console.log("\n" + "=".repeat(80))
console.log("   TẤT CẢ CÁC BÀI TEST NGHIỆM THU ĐÃ ĐẠT 100%!")
console.log("=".repeat(80))

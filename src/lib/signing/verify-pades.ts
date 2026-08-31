import forge from "node-forge"
import crypto from "node:crypto"

// Verify lại 1 chữ ký PAdES/CMS đã nhúng trong file PDF — "mirror ngược" đúng những gì
// `applyPadesSignature()`/`ForgeCmsSigner.sign()` (`./pades.ts`) đã làm lúc ký, dùng cùng thư
// viện `node-forge` (đã xác nhận qua đọc trực tiếp `node_modules/node-forge/lib/pkcs7.js`:
// forge KHÔNG có `verify()` cấp cao cho PKCS7 — `throw new Error('PKCS#7 signature
// verification not yet implemented.')` — nhưng export đủ API cấp thấp (validator ASN.1,
// `asn1.toDer`, `pki.certificateFromAsn1`, `md.sha256`, `publicKey.verify()`) để tự viết).
//
// Không dùng `openssl` binary (Vercel serverless không đảm bảo có sẵn) — thuần JS.
//
// `@types/node-forge` KHÔNG khai type cho `forge.asn1.validate()` và toàn bộ namespace
// `forge.pkcs7.asn1.*` (validator ASN.1 cấp thấp — đã xác nhận đọc trực tiếp index.d.ts, chỉ
// có type cho phần SIGN, không có phần đọc/validate CMS có sẵn). Khai 1 interface tối thiểu
// cho đúng phần dùng ở đây, ép kiểu 1 lần duy nhất — cùng tinh thần `as unknown as number` đã
// dùng cho `valueTagClass` ở `pades.ts`.
type Asn1Node = { value: string | Asn1Node[] }
type ValidateCapture = Record<string, unknown>
interface ForgeLowLevel {
  asn1: {
    validate: (obj: unknown, validator: unknown, capture: ValidateCapture, errors: string[]) => boolean
  }
  pkcs7: {
    asn1: {
      contentInfoValidator: unknown
      signedDataValidator: unknown
    }
  }
}
const forgeLL = forge as unknown as ForgeLowLevel

export type VerifyPadesResult =
  | {
      valid: true
      signerName: string
      // Thông tin kỹ thuật chữ ký số — phục vụ hiển thị "cấp độ bảo mật"/tăng giá trị pháp lý
      // trên trang xác thực công khai (2026-08-31), không ảnh hưởng logic verify ở trên.
      serialNumber: string
      validFrom: string
      validTo: string
      keyAlgorithm: string
      digestAlgorithm: string
    }
  | { valid: false; reason: string }

type ByteRange = [number, number, number, number]

/**
 * Quét toàn bộ raw bytes tìm mọi khai báo `/ByteRange [...]`, dedupe theo GIÁ TRỊ (giữ thứ tự
 * xuất hiện đầu tiên) — mirror đúng kỹ thuật đã kiểm chứng bằng OpenSSL nhiều lần trong quá
 * trình phát triển tính năng PAdES (findByteRange của `@signpdf/utils` trả về CẢ occurrence
 * trùng lặp qua các lần incremental save kế tiếp — hiện tượng vô hại nhưng phải dedupe trước
 * khi dùng làm chỉ mục theo thứ tự ký).
 */
function findUniqueByteRanges(pdf: Buffer): ByteRange[] {
  const seen = new Set<string>()
  const result: ByteRange[] = []
  let offset = 0
  for (;;) {
    const pos = pdf.indexOf("/ByteRange", offset)
    if (pos === -1) break
    const rangeStart = pdf.indexOf("[", pos)
    const rangeEnd = pdf.indexOf("]", rangeStart)
    if (rangeStart === -1 || rangeEnd === -1) break
    const raw = pdf.subarray(rangeStart + 1, rangeEnd).toString("latin1")
    const nums = raw.split(/\s+/).filter(Boolean).map(Number)
    offset = rangeEnd
    if (nums.length !== 4 || nums.some((n) => Number.isNaN(n))) continue
    const key = nums.join(",")
    if (!seen.has(key)) {
      seen.add(key)
      result.push(nums as ByteRange)
    }
  }
  return result
}

/**
 * Đọc độ dài DER thật của 1 TLV (Tag-Length-Value) ở đầu buffer — trả về tổng số byte
 * (header + nội dung), dùng để cắt ĐÚNG phần chữ ký thật ra khỏi vùng `/Contents` đã reserve
 * dư (padding `00` cuối). KHÔNG dùng cách cắt `00` cuối chuỗi hex (naive trailing-zero strip,
 * giống `@signpdf/utils`'s `extractSignature()`) — cách đó SAI khi byte cuối cùng thật của
 * chữ ký DER tình cờ là `0x00` (xác suất ~1/256 với 1 chữ ký RSA-2048, đã tái hiện và xác nhận
 * bằng `openssl asn1parse` báo "too long" — độ dài SEQUENCE khai báo lệch đúng 1 byte so với
 * số byte còn lại sau khi bị cắt nhầm).
 */
function derTotalLength(buf: Buffer): number {
  if (buf.length < 2) throw new Error("DER quá ngắn")
  const lenByte = buf[1]
  if (lenByte < 0x80) return 2 + lenByte
  const numLenBytes = lenByte & 0x7f
  if (numLenBytes === 0 || buf.length < 2 + numLenBytes) throw new Error("Header độ dài DER không hợp lệ")
  let len = 0
  for (let i = 0; i < numLenBytes; i++) len = len * 256 + buf[2 + i]
  return 2 + numLenBytes + len
}

/** Trích `signedData` (nội dung đã ký, theo ByteRange) + `sigDer` (CMS DER, đã bỏ padding dư). */
function extractByRange(pdf: Buffer, [s1, l1, s2, l2]: ByteRange): { signedData: Buffer; sigDer: Buffer } {
  const part1 = pdf.subarray(s1, s1 + l1)
  const part2 = pdf.subarray(s2, s2 + l2)
  const signedData = Buffer.concat([part1, part2])
  const gap = pdf.subarray(s1 + l1, s2).toString("latin1")
  const m = gap.match(/<([0-9a-fA-F]+)>/)
  if (!m) throw new Error("Không tìm thấy /Contents trong ByteRange")
  const fullDer = Buffer.from(m[1], "hex")
  const realLen = derTotalLength(fullDer)
  if (realLen > fullDer.length) throw new Error("Độ dài chữ ký vượt quá khung đã reserve")
  return { signedData, sigDer: fullDer.subarray(0, realLen) }
}

/**
 * Verify 1 chữ ký PAdES tại vị trí `padesSigIndex` (0-based, theo thứ tự ByteRange duy nhất
 * xuất hiện trong file — khớp đúng thứ tự chèn incremental lúc ký, xem `signField()` trong
 * `requests.ts`).
 */
export function verifyPadesSignature(pdfBytes: Buffer, padesSigIndex: number): VerifyPadesResult {
  try {
    const ranges = findUniqueByteRanges(pdfBytes)
    const range = ranges[padesSigIndex]
    if (!range) return { valid: false, reason: "Không tìm thấy chữ ký này trong file" }

    const { signedData, sigDer } = extractByRange(pdfBytes, range)

    // 1. Parse CMS DER (ContentInfo -> SignedData) bằng validator cấp thấp của forge.
    const topAsn1 = forge.asn1.fromDer(forge.util.createBuffer(sigDer.toString("binary")))
    const ci: ValidateCapture = {}
    const ciErrors: string[] = []
    if (!forgeLL.asn1.validate(topAsn1, forgeLL.pkcs7.asn1.contentInfoValidator, ci, ciErrors)) {
      return { valid: false, reason: "Không đọc được cấu trúc chữ ký (không phải CMS hợp lệ)" }
    }
    const signedDataAsn1 = ((ci.content as Asn1Node).value as Asn1Node[])[0]

    const sd: ValidateCapture = {}
    const sdErrors: string[] = []
    if (!forgeLL.asn1.validate(signedDataAsn1, forgeLL.pkcs7.asn1.signedDataValidator, sd, sdErrors)) {
      return { valid: false, reason: "Không đọc được nội dung SignedData" }
    }

    // 2. Thuật toán băm phải là sha256 (đúng những gì pades.ts luôn dùng — digestAlgorithm:
    // forge.pki.oids.sha256, xem ForgeCmsSigner.sign()).
    const digestOid = forge.asn1.derToOid(sd.digestAlgorithm as string)
    if (digestOid !== forge.pki.oids.sha256) {
      return { valid: false, reason: "Thuật toán băm không được hỗ trợ" }
    }

    const authAttrs = sd.authenticatedAttributes as Asn1Node[] | undefined
    if (!authAttrs?.length) {
      return { valid: false, reason: "Chữ ký thiếu authenticatedAttributes" }
    }

    // 3. So sánh content digest: SHA-256(signedData) phải khớp attribute messageDigest.
    const contentDigest = forge.md.sha256.create().update(signedData.toString("binary")).digest().getBytes()
    let messageDigestBytes: string | null = null
    for (const attr of authAttrs) {
      const attrValue = attr.value as Asn1Node[]
      const attrOid = forge.asn1.derToOid(attrValue[0].value as string)
      if (attrOid === forge.pki.oids.messageDigest) {
        const valueSet = (attrValue[1].value as Asn1Node[])[0]
        messageDigestBytes = valueSet.value as string
        break
      }
    }
    if (messageDigestBytes === null) {
      return { valid: false, reason: "Chữ ký thiếu messageDigest" }
    }
    if (messageDigestBytes !== contentDigest) {
      return { valid: false, reason: "Nội dung file không khớp chữ ký (đã bị sửa sau khi ký)" }
    }

    // 4. Re-tag authenticatedAttributes thành UNIVERSAL SET (mirror đúng cách pkcs7.js's
    // addSignerInfos() DER-hoá TRƯỚC khi ký — chữ ký thật sự ký lên bản SET-tag này, không
    // phải bản [0]-tag đã nhúng trong file), rồi verify RSA bằng public key của leaf cert.
    const certsNode = sd.certificates as { value: unknown[] }
    const certsAsn1 = certsNode.value as forge.asn1.Asn1[]
    if (!certsAsn1?.length) return { valid: false, reason: "Chữ ký thiếu chứng thư" }
    const leafCert = forge.pki.certificateFromAsn1(certsAsn1[0])
    const rootCertAsn1 = certsAsn1[1]
    if (!rootCertAsn1) return { valid: false, reason: "Chữ ký thiếu chứng thư root CA" }
    const rootCert = forge.pki.certificateFromAsn1(rootCertAsn1)

    const attrsSetAsn1 = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      authAttrs as unknown as forge.asn1.Asn1[],
    )
    const attrsDigest = forge.md.sha256.create().update(forge.asn1.toDer(attrsSetAsn1).getBytes()).digest().getBytes()
    const signatureBytes = sd.signature as string
    // leafCert.publicKey khai kiểu union (rsa.PublicKey | ed25519.Key) — hệ thống chỉ bao giờ
    // sinh khoá RSA (xem issueLeafCertificate() trong pades.ts), ép kiểu đúng nhánh RSA.
    const leafPublicKey = leafCert.publicKey as forge.pki.rsa.PublicKey
    let sigValid: boolean
    try {
      sigValid = leafPublicKey.verify(attrsDigest, signatureBytes)
    } catch {
      sigValid = false
    }
    if (!sigValid) {
      return { valid: false, reason: "Chữ ký số không hợp lệ về mặt toán học" }
    }

    // 5. Chứng thư root nhúng trong CMS phải khớp đúng root CA hệ thống đang cấu hình hiện tại.
    const configuredRootPem = process.env.SIGN_PADES_ROOT_CA_CERT_PEM
    if (!configuredRootPem) {
      return { valid: false, reason: "Hệ thống chưa cấu hình chứng thư gốc để đối chiếu" }
    }
    const rootDer = forge.asn1.toDer(forge.pki.certificateToAsn1(rootCert)).getBytes()
    const embeddedFingerprint = new crypto.X509Certificate(Buffer.from(rootDer, "binary")).fingerprint256
    const configuredFingerprint = new crypto.X509Certificate(configuredRootPem).fingerprint256
    if (embeddedFingerprint !== configuredFingerprint) {
      return { valid: false, reason: "Chứng thư không do hệ thống Rubber ERP phát hành" }
    }

    // `.value` của 1 field ASN.1 UTF8String KHÔNG được forge tự decode UTF-8 (`asn1.js`'s
    // `_fromDer()` chỉ decode đặc biệt cho BMPSTRING — UTF8String rơi vào nhánh trả "binary
    // string" thô, mỗi ký tự = 1 byte gốc) — phải tự gọi `forge.util.decodeUtf8()` thêm 1 lần,
    // nếu không tên có dấu tiếng Việt sẽ hiển thị mojibake kiểu byte-UTF-8-bị-đọc-nhầm-Latin1.
    const cnField = leafCert.subject.getField("CN")
    const signerName = cnField?.value ? forge.util.decodeUtf8(cnField.value as string) : "Không rõ"

    return {
      valid: true,
      signerName,
      serialNumber: leafCert.serialNumber,
      validFrom: leafCert.validity.notBefore.toISOString(),
      validTo: leafCert.validity.notAfter.toISOString(),
      keyAlgorithm: `RSA-${leafPublicKey.n.bitLength()}`,
      digestAlgorithm: "SHA-256",
    }
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "Lỗi không xác định khi xác thực" }
  }
}

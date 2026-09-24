// Script xoay vòng Root CA v2 cho hệ thống ký số PAdES Rubber ERP
// Chạy: node scripts/rotate-root-ca-v2.mjs
//
// QUY TẮC BẢO MẬT BẮT BUỘC:
// Script này TUYỆT ĐỐI KHÔNG in Private Key ra terminal (stdout/stderr) để tránh
// lộ khóa bí mật trong log hay transcript phiên làm việc.
// Script tự động ghi các file cục bộ an toàn:
// 1. public/rubber-erp-signing-root-ca-v2.pem (Chứng thư công khai, dùng commit git hoặc import Acrobat)
// 2. .env.root-ca-v2.local (File chứa cặp biến môi trường riêng biệt cho v2)
// 3. Tự động cập nhật .env.local (sau khi sao lưu .env.local.bak)

import forge from "node-forge"
import crypto from "node:crypto"
import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "..")

const skipUpdateEnv = process.argv.includes("--no-update-env")

function makeRootCaV2() {
  // 1. Sinh cặp khóa RSA 2048-bit mới độc lập
  const keys = forge.pki.rsa.generateKeyPair(2048)

  // 2. Tạo Self-signed X.509 Certificate cho Root CA v2
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = "02"
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  // Thời hạn hiệu lực: 20 năm (2026 - 2046)
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20)

  const attrs = [
    { name: "commonName", value: "Rubber ERP Internal Root CA v2" },
    { name: "organizationName", value: "Rubber ERP" },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, cRLSign: true },
  ])

  // Tự ký bằng khóa bí mật Root CA v2 với SHA-256
  cert.sign(keys.privateKey, forge.md.sha256.create())

  return { cert, privateKey: keys.privateKey }
}

console.log("=".repeat(80))
console.log("   RUBBER ERP - KHỞI TẠO CẶP KHÓA & CHỨNG THƯ ROOT CA V2 (BẢO MẬT CAO)")
console.log("=".repeat(80))
console.log("\n[1/4] Đang sinh cặp khóa RSA 2048-bit và chứng thư X.509 (hiệu lực 20 năm)...")

const root = makeRootCaV2()
const certPem = forge.pki.certificateToPem(root.cert).trim()
const keyPem = forge.pki.privateKeyToPem(root.privateKey).trim()

// Tính SHA-256 Fingerprint chuẩn qua crypto.X509Certificate
const x509 = new crypto.X509Certificate(certPem)
const fingerprint256 = x509.fingerprint256
const validFrom = root.cert.validity.notBefore.toISOString()
const validTo = root.cert.validity.notAfter.toISOString()

console.log("      ✓ Sinh khóa thành công.")
console.log(`      - Subject:             CN=Rubber ERP Internal Root CA v2, O=Rubber ERP`)
console.log(`      - Serial Number:       02`)
console.log(`      - Hiệu lực:            ${validFrom} -> ${validTo} (20 năm)`)
console.log(`      - SHA-256 Fingerprint: ${fingerprint256}`)

// 1. Ghi file chứng thư công khai vào public/
console.log("\n[2/4] Đang ghi chứng thư công khai vào thư mục public/...")
const publicCertPath = join(rootDir, "public", "rubber-erp-signing-root-ca-v2.pem")
writeFileSync(publicCertPath, certPem + "\n", "utf8")
console.log(`      ✓ Đã ghi: public/rubber-erp-signing-root-ca-v2.pem`)

// 2. Ghi file .env.root-ca-v2.local
console.log("\n[3/4] Đang lưu cấu hình biến môi trường vào .env.root-ca-v2.local...")
const envV2Content =
  `# =====================================================================\n` +
  `# Rubber ERP Internal Root CA v2\n` +
  `# Ngày tạo: ${new Date().toISOString()}\n` +
  `# Subject: CN=Rubber ERP Internal Root CA v2, O=Rubber ERP\n` +
  `# Serial: 02 | Hiệu lực: 20 năm (${validFrom} -> ${validTo})\n` +
  `# SHA-256 Fingerprint: ${fingerprint256}\n` +
  `# TUYỆT ĐỐI BẢO MẬT: KHÔNG commit file này hoặc chia sẻ khóa bí mật lên Git / Chat!\n` +
  `# =====================================================================\n\n` +
  `SIGN_PADES_ROOT_CA_CERT_PEM="${certPem}"\n\n` +
  `SIGN_PADES_ROOT_CA_KEY_PEM="${keyPem}"\n`

const envV2Path = join(rootDir, ".env.root-ca-v2.local")
writeFileSync(envV2Path, envV2Content, "utf8")
console.log(`      ✓ Đã ghi: .env.root-ca-v2.local`)

// 3. Tự động cập nhật .env.local nếu tồn tại
console.log("\n[4/4] Cập nhật .env.local...")
if (skipUpdateEnv) {
  console.log("      (Bỏ qua bước cập nhật .env.local do có cờ --no-update-env)")
} else {
  const envLocalPath = join(rootDir, ".env.local")
  if (existsSync(envLocalPath)) {
    // Sao lưu .env.local trước khi chỉnh sửa
    const backupPath = join(rootDir, ".env.local.bak")
    copyFileSync(envLocalPath, backupPath)
    console.log(`      ✓ Đã sao lưu dự phòng: .env.local -> .env.local.bak`)

    const existingEnv = readFileSync(envLocalPath, "utf8")

    // Dọn sạch khối biến root CA cũ (cả comment nếu có)
    let cleanedEnv = existingEnv
      .replace(/(?:^|\n)(?:#[^\n]*\n)*SIGN_PADES_ROOT_CA_CERT_PEM="[\s\S]*?-----END CERTIFICATE-----\"?/g, "")
      .replace(/(?:^|\n)(?:#[^\n]*\n)*SIGN_PADES_ROOT_CA_KEY_PEM="[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----\"?/g, "")
      .trim()

    // Thêm khối Root CA v2 mới vào cuối file .env.local
    const updatedEnv =
      cleanedEnv +
      "\n\n# ---------------------------------------------------------------------\n" +
      "# Root CA nội bộ v2 cho chữ ký số PAdES (src/lib/signing/pades.ts)\n" +
      `# Khởi tạo: ${new Date().toISOString()} | Fingerprint: ${fingerprint256}\n` +
      "# ---------------------------------------------------------------------\n" +
      `SIGN_PADES_ROOT_CA_CERT_PEM="${certPem}"\n\n` +
      `SIGN_PADES_ROOT_CA_KEY_PEM="${keyPem}"\n`

    writeFileSync(envLocalPath, updatedEnv, "utf8")
    console.log(`      ✓ Đã cập nhật thành công .env.local sang Root CA v2.`)
  } else {
    // Nếu .env.local chưa có, tạo mới từ envV2Content
    writeFileSync(envLocalPath, envV2Content, "utf8")
    console.log(`      ✓ Đã khởi tạo mới .env.local chứa Root CA v2.`)
  }
}

console.log("\n" + "=".repeat(80))
console.log("   HOÀN TẤT XOAY VÒNG ROOT CA V2 AN TOÀN!")
console.log("=".repeat(80))
console.log("1. Chứng thư công khai đã sẵn sàng tại:")
console.log(`   - public/rubber-erp-signing-root-ca-v2.pem`)
console.log("2. Cặp biến môi trường v2 đã được lưu an toàn tại:")
console.log(`   - .env.root-ca-v2.local`)
console.log(`   - .env.local (đã kích hoạt v2 cho môi trường dev cục bộ)`)
console.log("\n3. Để cập nhật lên Vercel Production/Preview, bạn có thể thực hiện:")
console.log("   Cách A (Vercel Web Dashboard - Khuyến nghị):")
console.log("   - Vào Settings -> Environment Variables trên Vercel.")
console.log("   - Mở file .env.root-ca-v2.local trên máy bạn.")
console.log("   - Copy nội dung SIGN_PADES_ROOT_CA_CERT_PEM và dán vào biến tương ứng.")
console.log("   - Copy nội dung SIGN_PADES_ROOT_CA_KEY_PEM và dán vào biến tương ứng.")
console.log("   - Bấm Save và Redeploy.")
console.log("\n   Cách B (Vercel CLI):")
console.log("   - npx vercel env add SIGN_PADES_ROOT_CA_CERT_PEM production < .env.root-ca-v2.local")
console.log("   - (Lưu ý: Không dùng 'echo <private_key>' trong terminal để tránh lộ key)")
console.log("=".repeat(80) + "\n")

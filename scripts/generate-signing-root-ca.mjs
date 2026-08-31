// Tạo 1 lần "Rubber ERP Internal Root CA" (self-signed) dùng cho chữ ký số PAdES thật
// (src/lib/signing/pades.ts). Chạy: node scripts/generate-signing-root-ca.mjs
//
// Script này KHÔNG ghi private key ra file — chỉ in ra màn hình để bạn tự copy vào
// .env.local và Vercel Environment Variables (mirror đúng cách đang lưu SIGN_JWT_SECRET).
// File CHỨNG THỰC CÔNG KHAI (không phải khoá riêng) được ghi ra public/rubber-erp-signing-root-ca.pem
// để phục vụ tải về cho admin/kiểm toán viên import vào Acrobat cá nhân (xem "Signature
// Properties" sẽ hiện "trusted" thay vì "Unknown" sau khi import).
//
// CHỈ chạy lại script này nếu muốn xoay vòng (rotate) root CA — mọi chữ ký PAdES cũ vẫn xác
// minh được bằng root CA CŨ đã lưu trước đó (không cần chạy lại cho mỗi lần deploy).

import forge from "node-forge"
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const writeEnv = process.argv.includes("--write-env")

function makeRootCa() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = "01"
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20)
  const attrs = [
    { name: "commonName", value: "Rubber ERP Internal Root CA" },
    { name: "organizationName", value: "Rubber ERP" },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, cRLSign: true },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { cert, privateKey: keys.privateKey }
}

const root = makeRootCa()
const certPem = forge.pki.certificateToPem(root.cert)
const keyPem = forge.pki.privateKeyToPem(root.privateKey)

const publicCertPath = join(__dirname, "..", "public", "rubber-erp-signing-root-ca.pem")
writeFileSync(publicCertPath, certPem)

console.log("=".repeat(78))
console.log("Da tao xong Rubber ERP Internal Root CA (tu ky, hop le 20 nam).")
console.log("=".repeat(78))
console.log("\n1) Da ghi CHUNG THUC CONG KHAI (khong phai bi mat) vao:")
console.log(`   ${publicCertPath}`)
console.log("   -> co the commit file nay vao git, va/hoac cho admin tai ve tu")
console.log("      /rubber-erp-signing-root-ca.pem de import vao Acrobat ca nhan.")
console.log("\n2) COPY 2 khoi sau vao .env.local VA Vercel Environment Variables")
console.log("   (KHONG commit private key vao git, KHONG dan vao chat/log cong khai).")
console.log("   pades.ts doc process.env.SIGN_PADES_ROOT_CA_*_PEM TRUC TIEP, khong tu")
console.log("   unescape \\n - phai giu NGUYEN xuong dong that trong file .env.local va")
console.log("   trong o nhap gia tri cua Vercel (Vercel Dashboard cho dan nhieu dong binh")
console.log("   thuong, khong can escape):")
console.log("\n--- .env.local ---")
console.log(`SIGN_PADES_ROOT_CA_CERT_PEM="${certPem}"`)
console.log(`SIGN_PADES_ROOT_CA_KEY_PEM="${keyPem}"`)
console.log("------------------\n")

if (writeEnv) {
  const envPath = join(__dirname, "..", ".env.local")
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
  if (existing.includes("SIGN_PADES_ROOT_CA_CERT_PEM")) {
    console.log("[--write-env] .env.local da co SIGN_PADES_ROOT_CA_CERT_PEM tu truoc - BO QUA")
    console.log("             de tranh ghi de root CA dang dung. Xoa dong cu thu cong neu that")
    console.log("             su muon xoay vong (rotate) sang root CA moi nay.")
  } else {
    const block =
      "\n# Root CA noi bo cho chu ky so PAdES thuc (src/lib/signing/pades.ts) - tao boi\n" +
      "# scripts/generate-signing-root-ca.mjs. KHONG commit gia tri KEY vao git.\n" +
      `SIGN_PADES_ROOT_CA_CERT_PEM="${certPem}"\n` +
      `SIGN_PADES_ROOT_CA_KEY_PEM="${keyPem}"\n`
    appendFileSync(envPath, block)
    console.log(`[--write-env] Da them 2 bien vao ${envPath}`)
  }
}

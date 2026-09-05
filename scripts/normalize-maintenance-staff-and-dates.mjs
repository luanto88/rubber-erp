/**
 * Script chuẩn hóa Người tạo, Nhân viên phụ trách và Thời gian tạo cho module Bảo trì
 *
 * Yêu cầu:
 *   - "Trong các text ghi chú của appsheet có nội dung 🙎Chau Nho🕜Lúc 21:03:01 01/05/25
 *      thì người tạo là Chau Nho thời gian tạo là 21:03:01 01/05/25 bạn tách nội dung này
 *      và đặt vào các trường cần thiết hiển thị đồng bộ nội dung người tạo của dự án web
 *      ví dụ: Người tạo=Chau Nho (cũng chính là nhân viên phụ trách)"
 *   - Chuẩn hóa tên Tiếng Việt không lỗi: "Chau Nho", "Nguyễn Hữu Thọ", "Tô Thành Luân", "Chau Kim Sêne", "Danh Thật", v.v.
 *
 * Chạy: node --env-file=.env.local scripts/normalize-maintenance-staff-and-dates.mjs
 */

import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")
const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu biến môi trường SUPABASE")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Chuẩn hóa tên Tiếng Việt
function cleanVietnameseName(raw) {
  if (!raw) return null
  let s = String(raw).trim()

  // Bỏ emoji và các từ thừa
  s = s.replace(/^[🙎🕵👨‍🔧\s]+/, "").trim()
  s = s.replace(/[\r\n\s]*🕜.*$/s, "").trim()
  s = s.replace(/^Tạo bởi:\s*/i, "").trim()
  s = s.replace(/\s+lúc:.*$/i, "").trim()
  s = s.replace(/[,;].*$/, "").trim() // lấy tên đầu tiên nếu danh sách cách nhau dấu phẩy

  if (!s || s.toLowerCase() === "null" || s === "." || s === "-") return null

  const lower = s.toLowerCase()
  if (lower.includes("chau nho") || lower.includes("châu nho")) return "Chau Nho"
  if (lower.includes("nguyen huu tho") || lower.includes("nguyễn hữu thọ")) return "Nguyễn Hữu Thọ"
  if (lower.includes("to thanh luan") || lower.includes("tô thành luân")) return "Tô Thành Luân"
  if (lower.includes("chau kim sene") || lower.includes("châu kim sene") || lower.includes("chau kim sêne") || lower.includes("châu kim sêne") || lower.includes("kim sêne") || lower.includes("kim sene")) return "Chau Kim Sêne"
  if (lower.includes("danh that") || lower.includes("danh thật")) return "Danh Thật"
  if (lower.includes("tran ngoc minh") || lower.includes("trần ngọc minh")) return "Trần Ngọc Minh"
  if (lower.includes("prak sophorn") || lower.includes("pak sorphoun") || lower.includes("park sorphoun")) return "Prak Sophorn"
  if (lower.includes("chau chok") || lower.includes("chau chók") || lower.includes("châu chók")) return "Chau Chók"
  if (lower.includes("sun seng ly")) return "Sun Seng Ly"
  if (lower.includes("chau thanh khai") || lower.includes("chau thanh khải")) return "Chau Thanh Khải"

  return s
}

// Bóc tách tên và thời gian tạo từ chuỗi
// Dạng: 🙎Chau Nho\n🕜Lúc 21:03:01 01/05/25 hoặc Tạo bởi: Chau Nho lúc: 25/05/25 23:12:07
function parseCreatorAndTimestamp(text) {
  if (!text) return { name: null, createdAt: null }
  const s = String(text).trim()

  let name = cleanVietnameseName(s)
  let createdAt = null

  // Tìm thời gian dạng 1: Lúc 21:03:01 01/05/25 hoặc 21:03:01 01/05/2025
  const m1 = s.match(/(?:Lúc\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](\d{2,4}))/i)
  if (m1) {
    const timePart = m1[1]
    const datePart = m1[2]
    const yearPart = m1[3]
    const [d, m] = datePart.split(/[\/\-]/)
    const fullYear = yearPart.length === 2 ? `20${yearPart}` : yearPart
    const [hh, mm, ss] = timePart.split(":")
    createdAt = `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${(ss || "00").padStart(2, "0")}+07:00`
  }

  // Tìm thời gian dạng 2: 25/05/25 23:12:07
  if (!createdAt) {
    const m2 = s.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-](\d{2,4}))\s+(\d{1,2}:\d{2}(?::\d{2})?)/i)
    if (m2) {
      const datePart = m2[1]
      const yearPart = m2[2]
      const timePart = m2[3]
      const [d, m] = datePart.split(/[\/\-]/)
      const fullYear = yearPart.length === 2 ? `20${yearPart}` : yearPart
      const [hh, mm, ss] = timePart.split(":")
      createdAt = `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${(ss || "00").padStart(2, "0")}+07:00`
    }
  }

  return { name, createdAt }
}

console.log("=================================================================")
console.log("🔧 CHUẨN HÓA NGƯỜI TẠO, NHÂN VIÊN PHỤ TRÁCH & THỜI GIAN TẠO")
console.log("=================================================================\n")

// 1. Đọc dữ liệu gốc từ 2 file Excel để lấy thông tin nguyên bản đầy đủ
console.log("📖 Đang đọc lại dữ liệu gốc từ Excel để bảo toàn thời gian tạo nguyên bản...")
const parentFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet bao duong.xlsx")
const childFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet.xlsx")

const wbParent = XLSX.readFile(parentFile)
const parentRows = XLSX.utils.sheet_to_json(wbParent.Sheets["Bao_duong"], { defval: null })

const wbChild = XLSX.readFile(childFile)
const childRows = XLSX.utils.sheet_to_json(wbChild.Sheets["Hu_hong"], { defval: null })

// Bảng tra cứu legacyId -> thông tin creator & time
const legacyCreatorMap = new Map()

for (const r of parentRows) {
  if (!r.ID_BD) continue
  const idBd = String(r.ID_BD).trim()
  const rawCreator = r.Nguoi_tao || r.nv_phu_trach || ""
  const { name, createdAt } = parseCreatorAndTimestamp(rawCreator)
  legacyCreatorMap.set(idBd, {
    name: name || cleanVietnameseName(r.nv_phu_trach) || cleanVietnameseName(r.phu_trach_bao_tri),
    createdAt,
  })
}

for (const r of childRows) {
  const legacyKey = r.ID_BD ? String(r.ID_BD).trim() : (r.ID ? String(r.ID).trim() : `SC-ROW-${r.Key}`)
  if (!legacyCreatorMap.has(legacyKey)) {
    const rawCreator = r.lap_bb || r.nguoi_tao || r.nv_phu_trach || ""
    const { name, createdAt } = parseCreatorAndTimestamp(rawCreator)
    legacyCreatorMap.set(legacyKey, {
      name: name || cleanVietnameseName(r.lap_bb) || cleanVietnameseName(r.nv_phu_trach),
      createdAt,
    })
  }
}

console.log(`  ✅ Đã lập bản đồ người tạo gốc cho ${legacyCreatorMap.size} biên bản.\n`)

// 2. Tải toàn bộ bản ghi từ DB (phân trang không giới hạn 1000)
console.log("📥 Đang tải các biên bản từ cơ sở dữ liệu Supabase...")
let allRecords = []
let page = 0
const PAGE_SIZE = 1000
while (true) {
  const { data, error } = await sb
    .from("maintenance_records")
    .select("id, ma_bb, nguoi_tao, nv_phu_trach, phu_trach_bao_tri, ghi_chu, created_at")
    .eq("factory_id", FACTORY_ID)
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
  if (error) throw error
  if (!data || data.length === 0) break
  allRecords.push(...data)
  if (data.length < PAGE_SIZE) break
  page++
}
console.log(`  ✅ Đã tải ${allRecords.length} biên bản trong DB.\n`)

// 3. Tiến hành cập nhật chuẩn hóa
console.log("🚀 Bắt đầu cập nhật chuẩn hóa: Người tạo = Nhân viên phụ trách...")
let updatedCount = 0

for (let i = 0; i < allRecords.length; i++) {
  const rec = allRecords[i]

  // Trích xuất mã AppSheet cũ từ ghi chú nếu có
  let legacyId = null
  if (rec.ghi_chu) {
    const m = rec.ghi_chu.match(/\[Mã AppSheet:\s*([^\]]+)\]/)
    if (m && m[1]) legacyId = m[1].trim()
  }

  const origExcel = legacyId ? legacyCreatorMap.get(legacyId) : null

  // Xác định tên chuẩn:
  // "Nhân viên phụ trách chính là người tạo" -> nguoi_tao = nv_phu_trach
  let targetName =
    cleanVietnameseName(rec.nguoi_tao) ||
    cleanVietnameseName(rec.nv_phu_trach) ||
    origExcel?.name ||
    cleanVietnameseName(rec.phu_trach_bao_tri) ||
    "Chau Nho" // Mặc định phổ biến nhất nếu hoàn toàn không có

  // Xác định thời gian tạo chuẩn:
  let targetCreatedAt = rec.created_at
  if (origExcel?.createdAt) {
    targetCreatedAt = origExcel.createdAt
  } else if (rec.nguoi_tao && rec.nguoi_tao.includes("🕜")) {
    const { createdAt } = parseCreatorAndTimestamp(rec.nguoi_tao)
    if (createdAt) targetCreatedAt = createdAt
  }

  const patch = {}
  if (rec.nguoi_tao !== targetName) patch.nguoi_tao = targetName
  if (rec.nv_phu_trach !== targetName) patch.nv_phu_trach = targetName
  if (targetCreatedAt && targetCreatedAt !== rec.created_at) patch.created_at = targetCreatedAt

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await sb
      .from("maintenance_records")
      .update(patch)
      .eq("id", rec.id)

    if (upErr) {
      console.error(`  ❌ Lỗi cập nhật ${rec.ma_bb}:`, upErr.message)
    } else {
      updatedCount++
    }
  }

  if ((i + 1) % 100 === 0 || i + 1 === allRecords.length) {
    console.log(`  ⏳ Đã kiểm tra và xử lý ${i + 1} / ${allRecords.length} biên bản (${updatedCount} biên bản được cập nhật)...`)
  }
}

console.log("\n=================================================================")
console.log(`🎉 HOÀN TẤT CHUẨN HÓA: Đã cập nhật ${updatedCount} / ${allRecords.length} biên bản`)
console.log("  ✅ Người tạo (nguoi_tao) đã đồng nhất với Nhân viên phụ trách (nv_phu_trach)")
console.log("  ✅ Chuẩn Tiếng Việt không còn emoji hay định dạng thô")
console.log("  ✅ Thời gian tạo (created_at) được trích xuất chính xác theo mốc gốc")
console.log("=================================================================\n")

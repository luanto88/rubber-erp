// Xuất file Excel song ngữ Việt – Khmer của module Chấm công để chuyên gia duyệt:
//   cung_cap_dl/dich_khmer_cham_cong.xlsx
// Nguồn: src/lib/attendance/khmer-catalog.json (+ src/lib/attendance/khmer-ui.json khi có màn điểm danh — GĐ C2).
// Chuyên gia điền cột "Khmer đề xuất" + "Nhận xét"; gửi lại thì sửa JSON, chạy seed --update.
//   node scripts/export-attendance-khmer.mjs
import { existsSync, readFileSync } from "node:fs"
import XLSX from "xlsx"

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"))
const catalog = read("../src/lib/attendance/khmer-catalog.json")
const uiPath = new URL("../src/lib/attendance/khmer-ui.json", import.meta.url)
const ui = existsSync(uiPath) ? JSON.parse(readFileSync(uiPath, "utf8")) : null

const NGUON = { excel: "File danh sách công nhân", mau_F01: "Mẫu giấy F01", mau_F02: "Mẫu giấy F02", mau_F01_new: "Mẫu F01 cải tiến", mau_F02_new: "Mẫu F02 cải tiến", may_dich: "Máy dịch — cần duyệt" }
const TO = Object.fromEntries(catalog.to_nhom_labels.map((t) => [t.ma, t.ten]))
const header = ["STT", "Nhóm", "Tiếng Việt", "Tiếng Khmer (hiện tại)", "Nguồn", "Ghi chú", "Khmer đề xuất (chuyên gia)", "Nhận xét"]

const sheet = (rows) => {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows.map((r, i) => [i + 1, ...r, "", ""])])
  ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 32 }, { wch: 34 }, { wch: 24 }, { wch: 40 }, { wch: 34 }, { wch: 30 }]
  return ws
}

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  wb,
  sheet(catalog.jobs.map((j) => [`${j.day_chuyen} · ${TO[j.to_nhom] || j.to_nhom}`, j.ten, j.ten_khmer || "", NGUON[j.nguon] || j.nguon, j.ghi_chu || ""])),
  "Công việc",
)
XLSX.utils.book_append_sheet(
  wb,
  sheet(catalog.reasons.map((r) => ["Lý do vắng", r.ten, r.ten_khmer || "", NGUON[r.nguon] || r.nguon, r.ghi_chu || ""])),
  "Lý do vắng",
)
XLSX.utils.book_append_sheet(
  wb,
  sheet(catalog.to_nhom_labels.map((t) => ["Tên tổ", t.ten, t.ten_khmer || "", NGUON[t.nguon] || t.nguon, t.ghi_chu || ""])),
  "Tên tổ",
)
if (ui) {
  XLSX.utils.book_append_sheet(
    wb,
    sheet(ui.items.map((u) => [u.nhom || "Màn điểm danh", u.vi, u.km || "", NGUON[u.nguon] || u.nguon || "", u.ghi_chu || ""])),
    "Màn điểm danh",
  )
}
const out = "cung_cap_dl/dich_khmer_cham_cong.xlsx"
XLSX.writeFile(wb, out)
console.log(`Đã xuất ${out}: ${catalog.jobs.length} công việc, ${catalog.reasons.length} lý do, ${catalog.to_nhom_labels.length} tên tổ${ui ? `, ${ui.items.length} chữ màn điểm danh` : ""}.`)

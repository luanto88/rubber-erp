/**
 * Nhập chỉ số đồng hồ điện / nước (Định mức KTKT — Mẫu 09) từ file tổng hợp M9 vào tech_norm_meter_readings.
 *
 * Nguồn: sheet "Chỉ số chốt ngày 27" — mỗi dòng 1 đồng hồ (cột A = ký hiệu, E = hệ số), mỗi cột F.. = 1 mốc ngày 27
 * (hàng 4 = ngày dd/mm/yyyy). Ghi ĐÈ lần ghi đã có cùng (đồng hồ, ngày) — người dùng cho phép 2026-11-16.
 * Thay / reset đồng hồ: khai trong REPLACEMENTS — số trên sheet tại mốc đó là chỉ số CHỐT đồng hồ cũ
 * (chi_so_chot_cu), chi_so = chỉ số đầu của đồng hồ mới.
 * Tự kiểm: tiêu thụ tính lại (theo đúng quy tắc meters.ts) phải khớp sheet "Tổng hợp tiêu thụ 2026".
 * Ngày nằm trong báo cáo định mức Chờ ký / Đã ký (khoá ngày) ⇒ trigger chặn ⇒ báo "BỊ KHOÁ", chạy lại sau khi trả về / huỷ.
 *
 * Chạy:  node --env-file=.env.local scripts/import-norm-meter-readings-m9.mjs            (chạy thử, không ghi)
 *        node --env-file=.env.local scripts/import-norm-meter-readings-m9.mjs --apply    (ghi)
 *        --file "<đường dẫn .xlsx>"  (mặc định file T01–T10/2026 trong cung_cap_dl/du_lieu_cu)
 * Rule 30.
 */
import ExcelJS from "exceljs"
import { createClient } from "@supabase/supabase-js"

const argVal = (name, def) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const APPLY = process.argv.includes("--apply")
const FILE = argVal("--file", "cung_cap_dl/du_lieu_cu/Tổng hợp Điện - Nước M9 (T01 - T10-2026).xlsx")
const SHEET_INDEX = "Chỉ số chốt ngày 27"
const SHEET_TOTAL = "Tổng hợp tiêu thụ 2026"
const GHI_CHU = "Nhập từ file Tổng hợp Điện - Nước M9 (T01–T10/2026)"
/** `${ký hiệu}|${ngày}` ⇒ chỉ số đầu của đồng hồ mới (số trên sheet = chỉ số chốt đồng hồ cũ). */
const REPLACEMENTS = { "ĐHN-01|2026-09-27": { chiSoMoi: 0, ghiChu: "Thay / reset đồng hồ: chốt đồng hồ cũ, đồng hồ mới bắt đầu từ 0" } }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu biến môi trường Supabase — chạy với: node --env-file=.env.local scripts/import-norm-meter-readings-m9.mjs")
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cellVal = (c) => {
  const v = c?.value
  if (v && typeof v === "object" && !(v instanceof Date)) return v.result ?? v.text ?? v.richText?.map((t) => t.text).join("") ?? null
  return v
}
const toIso = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null
}
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v))
const same = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 1e-6

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(FILE)
const ws = wb.getWorksheet(SHEET_INDEX)
if (!ws) throw new Error(`Không thấy sheet "${SHEET_INDEX}"`)

// Hàng 4: tiêu đề cột ngày (F..), dừng ở cột không phải ngày (Ghi chú).
const dateCols = []
for (let col = 6; col <= ws.columnCount; col++) {
  const iso = toIso(cellVal(ws.getRow(4).getCell(col)))
  if (!iso) break
  dateCols.push({ col, iso })
}
const sheetRows = []
for (let r = 5; r <= ws.rowCount; r++) {
  const code = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim()
  if (!code) continue
  const heSo = num(cellVal(ws.getRow(r).getCell(5)))
  const values = dateCols.map(({ col, iso }) => ({ iso, v: num(cellVal(ws.getRow(r).getCell(col))) }))
  sheetRows.push({ code, heSo, values })
}
console.log(`File: ${FILE}`)
console.log(`Sheet "${SHEET_INDEX}": ${sheetRows.length} đồng hồ × ${dateCols.length} mốc (${dateCols[0]?.iso} → ${dateCols.at(-1)?.iso})`)

const { data: meters, error: mErr } = await sb.from("tech_norm_meters").select("id,factory_id,code,he_so")
if (mErr) throw mErr
const meterByCode = new Map(meters.map((m) => [m.code.trim(), m]))
const missing = sheetRows.filter((r) => !meterByCode.has(r.code)).map((r) => r.code)
if (missing.length) throw new Error(`Đồng hồ trên file chưa có trong danh mục: ${missing.join(", ")}`)

// Dòng cần ghi
const planned = []
for (const r of sheetRows) {
  const m = meterByCode.get(r.code)
  if (r.heSo !== null && !same(r.heSo, m.he_so)) console.warn(`⚠️  ${r.code}: hệ số file ${r.heSo} ≠ danh mục ${m.he_so} — dùng hệ số file.`)
  for (const { iso, v } of r.values) {
    if (v === null || !Number.isFinite(v)) continue
    const rep = REPLACEMENTS[`${r.code}|${iso}`]
    planned.push({
      factory_id: m.factory_id,
      meter_id: m.id,
      ngay: iso,
      chi_so: rep ? rep.chiSoMoi : v,
      he_so: r.heSo ?? Number(m.he_so),
      thay_dong_ho: !!rep,
      chi_so_chot_cu: rep ? v : null,
      ghi_chu: rep ? `${GHI_CHU}. ${rep.ghiChu}` : GHI_CHU,
      nhap_qua: "tay",
      _code: r.code,
    })
  }
}

// Tự kiểm tiêu thụ từng kỳ (quy tắc meters.ts: kế tiếp thay ĐH ⇒ dùng chi_so_chot_cu) với sheet tổng hợp.
const wsT = wb.getWorksheet(SHEET_TOTAL)
let checkFail = 0
if (wsT) {
  const totalByCode = new Map()
  for (let r = 7; r <= wsT.rowCount; r++) {
    const code = String(cellVal(wsT.getRow(r).getCell(1)) ?? "").trim()
    if (!code || !meterByCode.has(code)) continue
    totalByCode.set(code, Array.from({ length: dateCols.length - 1 }, (_, i) => num(cellVal(wsT.getRow(r).getCell(5 + i)))))
  }
  for (const code of totalByCode.keys()) {
    const rows = planned.filter((p) => p._code === code).sort((a, b) => a.ngay.localeCompare(b.ngay))
    rows.forEach((cur, i) => {
      if (!i) return
      const prev = rows[i - 1]
      const end = cur.thay_dong_ho ? cur.chi_so_chot_cu : cur.chi_so
      const calc = Math.round((end - prev.chi_so) * cur.he_so * 1000) / 1000
      const want = totalByCode.get(code)[i - 1] ?? 0
      if (!same(calc, want)) {
        checkFail++
        console.error(`❌ ${code} kỳ ${prev.ngay}→${cur.ngay}: tính ${calc} ≠ tổng hợp ${want}`)
      }
    })
  }
  console.log(checkFail ? `❌ Tự kiểm: ${checkFail} kỳ lệch — DỪNG.` : `✅ Tự kiểm: tiêu thụ ${totalByCode.size} đồng hồ × ${dateCols.length - 1} kỳ khớp sheet "${SHEET_TOTAL}".`)
  if (checkFail) process.exit(1)
}

// So với DB
const meterIds = [...new Set(planned.map((p) => p.meter_id))]
const { data: existing, error: eErr } = await sb
  .from("tech_norm_meter_readings")
  .select("id,meter_id,ngay,chi_so,he_so,thay_dong_ho,chi_so_chot_cu")
  .in("meter_id", meterIds)
  .gte("ngay", dateCols[0].iso)
  .lte("ngay", dateCols.at(-1).iso)
if (eErr) throw eErr
const exByKey = new Map(existing.map((e) => [`${e.meter_id}|${e.ngay}`, e]))
let nNew = 0, nOverwrite = 0, nSame = 0
const todo = []
for (const p of planned) {
  const e = exByKey.get(`${p.meter_id}|${p.ngay}`)
  if (e && same(e.chi_so, p.chi_so) && same(e.he_so, p.he_so) && e.thay_dong_ho === p.thay_dong_ho && same(e.chi_so_chot_cu, p.chi_so_chot_cu)) {
    nSame++
    continue
  }
  if (e) {
    nOverwrite++
    console.log(`↺ ĐÈ ${p._code} ${p.ngay}: ${e.chi_so}${e.thay_dong_ho ? ` (thay, chốt ${e.chi_so_chot_cu})` : ""} → ${p.chi_so}${p.thay_dong_ho ? ` (thay, chốt ${p.chi_so_chot_cu})` : ""}`)
  } else nNew++
  todo.push(p)
}
console.log(`Kế hoạch: ${planned.length} lần ghi — mới ${nNew}, ghi đè ${nOverwrite}, giữ nguyên (đã đúng) ${nSame}.`)

if (!APPLY) {
  console.log("Chạy thử — chưa ghi. Thêm --apply để ghi.")
  process.exit(0)
}

let ok = 0
const locked = [], failed = []
for (const p of todo) {
  const { _code, ...row } = p
  const { error } = await sb.from("tech_norm_meter_readings").upsert(row, { onConflict: "meter_id,ngay" })
  if (!error) ok++
  else if (/NORM_DAY_LOCKED/.test(error.message)) locked.push(`${_code} ${p.ngay}`)
  else failed.push(`${_code} ${p.ngay}: ${error.message}`)
}
console.log(`✅ Đã ghi ${ok}/${todo.length}.`)
if (locked.length) console.log(`🔒 BỊ KHOÁ (báo cáo định mức Chờ ký / Đã ký) ${locked.length}: ${locked.join(", ")}`)
if (failed.length) {
  console.error(`❌ Lỗi ${failed.length}:\n  ${failed.join("\n  ")}`)
  process.exit(1)
}

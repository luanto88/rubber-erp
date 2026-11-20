// Seed danh mục Chấm công (công việc + lý do vắng) từ src/lib/attendance/khmer-catalog.json.
// Mặc định CHỈ XEM; --apply mới ghi. Chỉ THÊM mục chưa có (khoá: dây chuyền + tổ + tên, không phân biệt hoa thường);
// mục đã có mà khác tên Khmer / số người / loại xe thì in ra, chỉ cập nhật khi thêm --update.
//   node --env-file=.env.local scripts/seed-attendance-catalog.mjs [--factory=phuochoa_kt] [--apply] [--update]
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const UPDATE = args.includes("--update")
const factoryCode = (args.find((a) => a.startsWith("--factory=")) || "--factory=phuochoa_kt").split("=")[1]

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const catalog = JSON.parse(readFileSync(new URL("../src/lib/attendance/khmer-catalog.json", import.meta.url), "utf8"))
const norm = (v) => String(v || "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ")

const { data: factory, error: fErr } = await sb.from("factories").select("id, code, name").eq("code", factoryCode).single()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${factoryCode}: ${fErr?.message}`)
console.log(`Nhà máy: ${factory.name} (${factory.code}) — ${APPLY ? "GHI THẬT" : "CHỈ XEM"}${UPDATE ? " + cập nhật mục đã có" : ""}\n`)

// ── Công việc ──
const { data: jobs, error: jErr } = await sb.from("attendance_job_types").select("*").eq("factory_id", factory.id)
if (jErr) throw new Error(`Đọc attendance_job_types lỗi (đã chạy migration 20261201?): ${jErr.message}`)
const jobKey = (j) => `${j.day_chuyen}|${j.to_nhom}|${norm(j.ten)}`
const existingJobs = new Map(jobs.map((j) => [jobKey(j), j]))
const orderByLine = {}
const jobInserts = []
const jobUpdates = []
for (const j of catalog.jobs) {
  orderByLine[j.day_chuyen] = (orderByLine[j.day_chuyen] || 0) + 10
  const row = {
    factory_id: factory.id,
    day_chuyen: j.day_chuyen,
    to_nhom: j.to_nhom,
    ten: j.ten,
    ten_khmer: j.ten_khmer || null,
    so_nguoi_goi_y: j.so_nguoi_goi_y ?? 1,
    loai_xe: j.loai_xe || null,
    sort_order: orderByLine[j.day_chuyen],
  }
  const cur = existingJobs.get(jobKey(row))
  if (!cur) { jobInserts.push(row); continue }
  const diff = ["ten_khmer", "so_nguoi_goi_y", "loai_xe"].filter((k) => (cur[k] ?? null) !== (row[k] ?? null))
  if (diff.length) jobUpdates.push({ id: cur.id, ten: row.ten, day_chuyen: row.day_chuyen, diff, patch: Object.fromEntries(diff.map((k) => [k, row[k]])) })
}
console.log(`Công việc: có sẵn ${jobs.length}, thêm mới ${jobInserts.length}, khác danh mục ${jobUpdates.length}`)
for (const r of jobInserts) console.log(`  + ${r.day_chuyen} · ${r.to_nhom} · ${r.ten} · ${r.ten_khmer || "(chưa có Khmer)"} · ${r.so_nguoi_goi_y} người${r.loai_xe ? ` · xe ${r.loai_xe}` : ""}`)
for (const u of jobUpdates) console.log(`  ~ ${u.day_chuyen} · ${u.ten}: ${u.diff.join(", ")}`)

// ── Lý do vắng ──
const { data: reasons, error: rErr } = await sb.from("attendance_absence_reasons").select("*").eq("factory_id", factory.id)
if (rErr) throw new Error(`Đọc attendance_absence_reasons lỗi: ${rErr.message}`)
const existingReasons = new Map(reasons.map((r) => [norm(r.ten), r]))
const reasonInserts = []
const reasonUpdates = []
catalog.reasons.forEach((r, i) => {
  const row = { factory_id: factory.id, ten: r.ten, ten_khmer: r.ten_khmer || null, sort_order: (i + 1) * 10 }
  const cur = existingReasons.get(norm(r.ten))
  if (!cur) reasonInserts.push(row)
  else if ((cur.ten_khmer || null) !== row.ten_khmer) reasonUpdates.push({ id: cur.id, ten: r.ten, patch: { ten_khmer: row.ten_khmer } })
})
console.log(`\nLý do vắng: có sẵn ${reasons.length}, thêm mới ${reasonInserts.length}, khác tên Khmer ${reasonUpdates.length}`)
for (const r of reasonInserts) console.log(`  + ${r.ten} · ${r.ten_khmer || "(chưa có Khmer)"}`)
for (const u of reasonUpdates) console.log(`  ~ ${u.ten}: tên Khmer`)

if (!APPLY) {
  console.log("\nCHỈ XEM — chạy lại với --apply để ghi.")
  process.exit(0)
}
if (jobInserts.length) {
  const { error } = await sb.from("attendance_job_types").insert(jobInserts)
  if (error) throw new Error(`Thêm công việc lỗi: ${error.message}`)
}
if (reasonInserts.length) {
  const { error } = await sb.from("attendance_absence_reasons").insert(reasonInserts)
  if (error) throw new Error(`Thêm lý do lỗi: ${error.message}`)
}
if (UPDATE) {
  for (const u of jobUpdates) {
    const { error } = await sb.from("attendance_job_types").update(u.patch).eq("id", u.id)
    if (error) throw new Error(`Cập nhật ${u.ten} lỗi: ${error.message}`)
  }
  for (const u of reasonUpdates) {
    const { error } = await sb.from("attendance_absence_reasons").update(u.patch).eq("id", u.id)
    if (error) throw new Error(`Cập nhật ${u.ten} lỗi: ${error.message}`)
  }
}
console.log(`\nĐÃ GHI: +${jobInserts.length} công việc, +${reasonInserts.length} lý do${UPDATE ? `, cập nhật ${jobUpdates.length + reasonUpdates.length}` : ""}.`)

// Kiểm C4 "Sổ phép thưởng" (CHỈ ĐỌC, service role). Chạy SAU migration 20261215.
//   node --env-file=.env.local scripts/check-attendance-leave.mjs [--factory=phuochoa_kt] [--nam=2026]
// 1. Tính lại bằng JS cờ từng tháng + chuỗi kỳ vọng (mirror attendance_leave_recompute) cho nhân viên quốc tịch VN.
// 2. So với sổ (net theo chuỗi) — sổ CHƯA được xét lại thì lệch là bình thường; mở tab Sổ phép (tự xét lại) rồi chạy lại ⇒ lệch = 0.
// 3. Số dư: Σ sổ − ngày dùng phép; liệt kê số dư âm và ngày dùng phép trước ngày hiệu lực.
import { createClient } from "@supabase/supabase-js"

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d
const FACTORY_CODE = arg("factory", "phuochoa_kt")
const vnToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const NAM = Number(arg("nam", vnToday.slice(0, 4)))
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(build) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build().range(off, off + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const pad = (n) => String(n).padStart(2, "0")
const lastDay = (m) => new Date(Date.UTC(NAM, m, 0)).getUTCDate()

const { data: fac, error: fErr } = await sb.from("factories").select("id, name").eq("code", FACTORY_CODE).single()
if (fErr) throw fErr
console.log(`Nhà máy ${fac.name} · năm ${NAM} · hôm nay ${vnToday}\n`)

const staff = await fetchAll(() =>
  sb.from("maintenance_staff").select("*").eq("factory_id", fac.id).order("id"),
)
if (staff.length && !("quoc_tich" in staff[0])) throw new Error("Chưa có cột quoc_tich — chạy migration 20261215 trước.")
const eligible = staff.filter((s) => (s.loai_nhan_su || "nhan_vien") === "nhan_vien" && s.quoc_tich === "VN")
const nvNoNat = staff.filter((s) => s.active && (s.loai_nhan_su || "nhan_vien") === "nhan_vien" && !s.quoc_tich).length
console.log(`Nhân viên quốc tịch VN: ${eligible.length} · nhân viên đang làm chưa khai quốc tịch: ${nvNoNat}\n`)

const recs = await fetchAll(() =>
  sb.from("attendance_records").select("id, staff_id, ngay, trang_thai, dung_phep_thuong")
    .eq("factory_id", fac.id).gte("ngay", `${NAM}-01-01`).lte("ngay", `${NAM}-12-31`).order("id"),
)
const ledger = await fetchAll(() =>
  sb.from("attendance_leave_ledger").select("*").eq("factory_id", fac.id).eq("nam", NAM).order("id"),
)

let mismatch = 0
let negative = 0
let early = 0
const ids = new Set([...eligible.map((s) => s.id), ...ledger.map((l) => l.staff_id)])
for (const id of ids) {
  const s = staff.find((x) => x.id === id)
  const isElig = eligible.some((x) => x.id === id)
  const coMat = new Map()
  for (const r of recs) if (r.staff_id === id && r.trang_thai === "co_mat") {
    const m = Number(r.ngay.slice(5, 7))
    coMat.set(m, (coMat.get(m) || 0) + 1)
  }
  const flags = []
  for (let m = 1; m <= 12; m++) {
    const m0 = `${NAM}-${pad(m)}-01`
    const m1 = `${NAM}-${pad(m)}-${pad(lastDay(m))}`
    let f
    if (vnToday <= m1) f = "chua_het"
    else if ((s.ngay_vao_lam && s.ngay_vao_lam > m0) || (s.ngay_nghi_viec && s.ngay_nghi_viec < m1)) f = "khong_tron"
    else f = (coMat.get(m) || 0) >= lastDay(m) ? "du" : "thieu"
    flags.push(f)
  }
  const expected = []
  if (isElig) {
    let run = 0
    let start = 0
    flags.forEach((f, i) => {
      if (f === "du") {
        if (run === 0) start = i + 1
        run++
        if (run === 3) {
          expected.push(`${NAM}-${pad(start)}..${NAM}-${pad(i + 1)}`)
          run = 0
        }
      } else run = 0
    })
  }
  const mine = ledger.filter((l) => l.staff_id === id)
  const net = new Map()
  for (const l of mine) if (l.chuoi_key) net.set(l.chuoi_key, (net.get(l.chuoi_key) || 0) + l.so_ngay)
  const issues = []
  for (const k of expected) if ((net.get(k) || 0) !== 1) issues.push(`thiếu cộng ${k} (net ${net.get(k) || 0})`)
  for (const [k, v] of net) if (!expected.includes(k) && v !== 0) issues.push(`chưa thu hồi ${k} (net ${v})`)
  const usedRows = recs.filter((r) => r.staff_id === id && r.dung_phep_thuong).sort((a, b) => a.ngay.localeCompare(b.ngay))
  const total = mine.reduce((a, l) => a + l.so_ngay, 0)
  const soDu = total - usedRows.length
  for (const u of usedRows) {
    const avail = mine.filter((l) => l.hieu_luc_tu <= u.ngay).reduce((a, l) => a + l.so_ngay, 0)
    const usedBefore = usedRows.filter((x) => x.ngay <= u.ngay).length
    if (usedBefore > avail) {
      early++
      issues.push(`dùng phép ${u.ngay} vượt số phép có hiệu lực tới ngày đó`)
    }
  }
  if (soDu < 0) negative++
  if (issues.some((x) => x.startsWith("thiếu") || x.startsWith("chưa"))) mismatch++
  const flagStr = flags.map((f) => ({ du: "■", thieu: "x", khong_tron: "~", chua_het: "." })[f]).join("")
  console.log(`${(s?.ten || id).padEnd(28)} ${isElig ? "VN " : "-- "} ${flagStr}  sổ ${String(total).padStart(2)} · dùng ${usedRows.length} · dư ${soDu}${issues.length ? "  ⚠ " + issues.join("; ") : ""}`)
}
console.log(`\nChú thích tháng: ■ đủ · x không đủ · ~ không trọn · . chưa hết`)
console.log(`Người lệch chuỗi ↔ sổ: ${mismatch} · số dư âm: ${negative} · ngày dùng trước hiệu lực: ${early}`)

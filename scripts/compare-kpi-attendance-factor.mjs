// So hệ số chuyên cần KPI cũ (đang lưu) với hệ số MỚI từ module Chấm công (C5) — CHỈ ĐỌC, service role.
// Chạy SAU migration 20261216_kpi_c5_attendance_factor.sql.
//   node --env-file=.env.local scripts/compare-kpi-attendance-factor.mjs [--factory=phuochoa_kt] [--months=2026-10,2026-11]
//
// Hệ số mới lấy từ CHÍNH hàm SQL kpi_attendance_summary_internal mà RPC tính điểm dùng (không tính lại bằng JS).
// Script tự kiểm thêm: công thức JS trên các con số của hàm SQL phải ra đúng hệ số SQL (lệch ⇒ báo lỗi).
// Lưu ý: "Có mặt tự động" chỉ có sau khi đã đồng bộ tháng đó (mở Lịch công tháng đó, hoặc bấm "Tính điểm tháng").
// Sau khi bấm "Tính điểm tháng", chạy lại: dòng đã tính bằng công thức v2 phải có "đang lưu" = "mới".
import { createClient } from "@supabase/supabase-js"

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d
const FACTORY_CODE = arg("factory", "phuochoa_kt")
const MONTHS = arg("months", "2026-10,2026-11").split(",").map((s) => s.trim()).filter(Boolean)
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: fac, error: fErr } = await sb.from("factories").select("id, name").eq("code", FACTORY_CODE).single()
if (fErr) throw fErr

const { data: profiles, error: pErr } = await sb
  .from("profiles").select("id, full_name, username").eq("factory_id", fac.id)
if (pErr) throw pErr
const nameOf = (id) => {
  const p = profiles.find((x) => x.id === id)
  return p?.full_name || p?.username || id.slice(0, 8)
}

const fmt = (v, d = 3) => (v == null ? "—" : Number(v).toFixed(d))
const pad = (s, n) => String(s).padEnd(n).slice(0, n)
const padL = (s, n) => String(s).padStart(n).slice(-n)

let formulaErrors = 0
let storedMismatch = 0

for (const ym of MONTHS) {
  const [nam, thang] = ym.split("-").map(Number)
  const { data: summ, error: sErr } = await sb.rpc("kpi_attendance_summary_internal", {
    p_factory_id: fac.id, p_nam: nam, p_thang: thang,
  })
  if (sErr) throw new Error(`Gọi kpi_attendance_summary_internal lỗi (đã chạy migration 20261216 chưa?): ${sErr.message}`)
  const { data: scores, error: kErr } = await sb
    .from("kpi_monthly_scores")
    .select("user_id, he_so_chuyen_can, diem_tong, trang_thai, chi_tiet")
    .eq("factory_id", fac.id).eq("nam", nam).eq("thang", thang)
  if (kErr) throw kErr

  const byProfile = new Map(summ.map((r) => [r.profile_id, r]))
  console.log(`\n══ Tháng ${ym} · ${fac.name} ══`)
  const s0 = summ[0]
  if (s0) console.log(`Ngày lịch ${s0.so_ngay_lich} · đã qua ${s0.so_ngay_da_qua}${s0.tam_tinh ? " (TẠM TÍNH — tháng chưa hết)" : ""}`)
  console.log(
    `${pad("Người", 26)} ${pad("Loại", 11)} ${padL("CóMặt", 5)} ${padL("Bù", 3)} ${padL("KP", 3)} ${padL("CC", 3)} ` +
      `${padL("HS cũ", 6)} ${padL("HS mới", 6)} ${padL("Điểm cũ", 7)} ${padL("Dự kiến", 7)}  Ghi chú`,
  )

  const rows = []
  for (const sc of scores) rows.push({ sc, att: byProfile.get(sc.user_id) || null })
  // Người chưa có dòng điểm nhưng có số liệu chấm công (chỉ in nhân viên có ngày công)
  for (const a of summ) {
    if (!scores.some((s) => s.user_id === a.profile_id) && a.loai === "nhan_vien" && a.co_mat + a.khong_phep + a.co_phep > 0) {
      rows.push({ sc: null, att: a })
    }
  }
  rows.sort((x, y) => nameOf((x.sc?.user_id) || x.att.profile_id).localeCompare(nameOf((y.sc?.user_id) || y.att.profile_id)))

  for (const { sc, att } of rows) {
    const uid = sc?.user_id || att.profile_id
    const notes = []
    // Tự kiểm công thức trên số liệu của hàm SQL.
    if (att && att.loai === "nhan_vien" && !att.khong_tron) {
      const raw = (att.co_mat + att.phep_thuong_bu) / att.cong_chuan - att.khong_phep * Number(att.muc_phat)
      const js = Math.round(Math.min(Number(att.he_so_max), Math.max(Number(att.he_so_min), raw)) * 1000) / 1000
      if (Math.abs(js - Number(att.he_so)) > 0.0005) {
        formulaErrors++
        notes.push(`LỖI công thức: JS ${js} ≠ SQL ${att.he_so}`)
      }
    }
    if (!att) notes.push("không có trong tổng hợp (tài khoản không còn active?)")
    else if (att.khong_tron) notes.push(sc?.trang_thai === "da_khoa" ? "làm không trọn — ĐÃ KHOÁ, giữ nguyên" : "làm không trọn ⇒ dòng điểm sẽ bị xoá")
    else if (att.khong_xet) notes.push(`${att.khong_xet} ⇒ 1,00`)
    if (sc?.trang_thai === "da_khoa") notes.push("đã khoá — không tính lại")
    if (!sc) notes.push("chưa có dòng điểm KPI")
    if (att?.chua_ghi_nhan) notes.push(`${att.chua_ghi_nhan} ngày chưa ghi nhận`)
    const isV2 = sc?.chi_tiet?.cong_thuc_version === 2
    if (isV2 && att && att.he_so != null && Math.abs(Number(sc.he_so_chuyen_can) - Number(att.he_so)) > 0.0005) {
      storedMismatch++
      notes.push("đang lưu (v2) ≠ hệ số mới — dữ liệu chấm công đổi sau lần tính, bấm Tính điểm tháng lại")
    }
    if (isV2) notes.push("đang lưu = công thức v2")

    const oldHs = sc?.he_so_chuyen_can
    const newHs = att?.he_so
    let projected = null
    if (sc && sc.trang_thai !== "da_khoa" && oldHs && newHs != null && sc.diem_tong != null) {
      projected = Math.round((Number(sc.diem_tong) / Number(oldHs)) * Number(newHs) * 10) / 10
    } else if (sc?.trang_thai === "da_khoa") projected = sc.diem_tong

    console.log(
      `${pad(nameOf(uid), 26)} ${pad(att?.loai || "?", 11)} ${padL(att?.co_mat ?? "—", 5)} ${padL(att?.phep_thuong_bu ?? "—", 3)} ` +
        `${padL(att?.khong_phep ?? "—", 3)} ${padL(att?.cong_chuan ?? "—", 3)} ${padL(fmt(oldHs), 6)} ${padL(fmt(newHs), 6)} ` +
        `${padL(fmt(sc?.diem_tong, 1), 7)} ${padL(fmt(projected, 1), 7)}  ${notes.join("; ")}`,
    )
  }
}

console.log(`\nLỗi công thức JS ↔ SQL: ${formulaErrors} · Dòng v2 lệch hệ số mới: ${storedMismatch}`)
if (formulaErrors) process.exitCode = 1

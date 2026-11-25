// Sổ phép thưởng + chuỗi 3 tháng (GĐ C4, 2026-11-25). Hàm thuần — dùng chung Lịch công, tab Sổ phép, script kiểm.
// Quy tắc nguồn: migration 20261215_attendance_c4_bonus_leave.sql (SQL là nơi quyết định cộng / thu hồi).

export const QUOC_TICH_OPTIONS = [
  { value: "VN", label: "Việt Nam" },
  { value: "KH", label: "Campuchia" },
  { value: "KHAC", label: "Khác" },
] as const

export type QuocTich = (typeof QUOC_TICH_OPTIONS)[number]["value"]

export const QUOC_TICH_LABEL: Record<string, string> = Object.fromEntries(QUOC_TICH_OPTIONS.map((o) => [o.value, o.label]))

export type LeaveMonthFlag = "du" | "thieu" | "khong_tron" | "chua_het"

export const LEAVE_MONTH_FLAG_LABEL: Record<LeaveMonthFlag, string> = {
  du: "Đủ ngày công",
  thieu: "Không đủ",
  khong_tron: "Làm không trọn tháng",
  chua_het: "Chưa hết tháng",
}

export type LeaveLedgerKind = "tich_luy" | "thu_hoi" | "dieu_chinh"

export const LEAVE_LEDGER_LABEL: Record<LeaveLedgerKind, string> = {
  tich_luy: "Tích lũy (đủ 3 tháng)",
  thu_hoi: "Thu hồi",
  dieu_chinh: "Điều chỉnh tay",
}

export type LeaveLedgerRow = {
  id: string
  staff_id: string
  nam: number
  loai: LeaveLedgerKind
  so_ngay: number
  chuoi_key: string | null
  hieu_luc_tu: string
  ly_do: string | null
  created_by: string | null
  created_at: string
}

/** Chỉ nhân viên quốc tịch Việt Nam có sổ phép thưởng (người dùng chốt 2026-11-25). */
export function isLeaveEligible(s: { loai_nhan_su?: string | null; quoc_tich?: string | null }): boolean {
  return (s.loai_nhan_su || "nhan_vien") === "nhan_vien" && s.quoc_tich === "VN"
}

/** Chuỗi chuyên cần sau tháng cuối cùng đã kết thúc: số tháng đủ liên tiếp (0–2) + các tháng đó. */
export function chainProgress(flags: Map<number, LeaveMonthFlag>): { count: number; months: number[] } {
  let run: number[] = []
  for (let m = 1; m <= 12; m++) {
    const f = flags.get(m)
    if (!f || f === "chua_het") break
    if (f === "du") {
      run.push(m)
      if (run.length === 3) run = []
    } else run = []
  }
  return { count: run.length, months: run }
}

/** Chuỗi đạt trong năm (mirror SQL attendance_leave_recompute) — dùng cho script kiểm. */
export function expectedChains(nam: number, flags: Map<number, LeaveMonthFlag>): string[] {
  const out: string[] = []
  let start = 0
  let run = 0
  for (let m = 1; m <= 12; m++) {
    if (flags.get(m) === "du") {
      if (run === 0) start = m
      run++
      if (run === 3) {
        out.push(`${nam}-${String(start).padStart(2, "0")}..${nam}-${String(m).padStart(2, "0")}`)
        run = 0
      }
    } else run = 0
  }
  return out
}

export type LeaveBalance = {
  tichLuy: number
  thuHoi: number
  dieuChinh: number
  daDung: number
  soDu: number
}

/** Số dư năm = Σ sổ − số ngày đã dùng (attendance_records.dung_phep_thuong trong năm). */
export function balanceOf(ledger: LeaveLedgerRow[], usedDays: number): LeaveBalance {
  let tichLuy = 0
  let thuHoi = 0
  let dieuChinh = 0
  for (const l of ledger) {
    if (l.loai === "tich_luy") tichLuy += l.so_ngay
    else if (l.loai === "thu_hoi") thuHoi += l.so_ngay
    else dieuChinh += l.so_ngay
  }
  return { tichLuy, thuHoi, dieuChinh, daDung: usedDays, soDu: tichLuy + thuHoi + dieuChinh - usedDays }
}

/** "2026-01..2026-03" ⇒ "T01–T03/2026". */
export function formatChainKey(key: string | null): string {
  if (!key) return ""
  const m = key.match(/^(\d{4})-(\d{2})\.\.(\d{4})-(\d{2})$/)
  return m ? `T${m[2]}–T${m[4]}/${m[1]}` : key
}

export function leaveMissing(message: string): boolean {
  return /attendance_leave|quoc_tich|p_dung_phep_thuong/.test(message) && /does not exist|schema cache|Could not find/i.test(message)
}

export const LEAVE_MIGRATION_HINT = "Chưa có sổ phép thưởng — chạy migration 20261215_attendance_c4_bonus_leave.sql."

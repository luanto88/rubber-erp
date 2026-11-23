"use client"

// Khối "Chấm công" trong form Nhân sự (GĐ C0, 2026-11-19): loại nhân sự, mã, dây chuyền + ca + công việc
// mặc định, thứ tự điểm danh, ngày vào làm / nghỉ việc. Công nhân không cần tài khoản — trực ca điểm danh.

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  ATTENDANCE_CA,
  ATTENDANCE_DAY_CHUYEN,
  ATTENDANCE_TO_NHOM,
  toNhomLabel,
  type AttendanceJobType,
  type LoaiNhanSu,
} from "@/lib/attendance/types"

export type StaffAttendanceValue = {
  loai_nhan_su: LoaiNhanSu
  ma_nhan_su: string
  day_chuyen_mac_dinh: string
  ca_mac_dinh: string
  cong_viec_mac_dinh_id: string
  thu_tu_diem_danh: string
  ngay_vao_lam: string
  ngay_nghi_viec: string
  cho_xac_nhan: boolean
  /** Vai trò in trên phiếu F01/F02 (migration 20261206). */
  to_vai_tro: "" | "to_truong" | "to_pho"
  to_pham_vi: "" | "tiep_nhan" | "co_dien" | "ca_san_xuat"
}

export const TO_VAI_TRO_LABEL = { to_truong: "Tổ trưởng", to_pho: "Tổ phó" } as const
export const TO_PHAM_VI_LABEL = {
  tiep_nhan: "Tổ tiếp nhận",
  co_dien: "Tổ cơ điện – nâng hàng",
  ca_san_xuat: "Ca sản xuất (theo ca mặc định)",
} as const

export const emptyStaffAttendanceValue = (): StaffAttendanceValue => ({
  loai_nhan_su: "nhan_vien",
  ma_nhan_su: "",
  day_chuyen_mac_dinh: "",
  ca_mac_dinh: "",
  cong_viec_mac_dinh_id: "",
  thu_tu_diem_danh: "",
  ngay_vao_lam: "",
  ngay_nghi_viec: "",
  cho_xac_nhan: false,
  to_vai_tro: "",
  to_pham_vi: "",
})

/** Lỗi nhập liệu (null = hợp lệ). */
export function validateStaffAttendance(v: StaffAttendanceValue): string | null {
  if (v.ngay_vao_lam && v.ngay_nghi_viec && v.ngay_nghi_viec < v.ngay_vao_lam) {
    return "Ngày nghỉ việc phải sau hoặc bằng ngày vào làm."
  }
  if (v.thu_tu_diem_danh && !/^\d{1,4}$/.test(v.thu_tu_diem_danh.trim())) {
    return "Thứ tự điểm danh phải là số nguyên dương."
  }
  if (!!v.to_vai_tro !== !!v.to_pham_vi) return "Chọn đủ cả vai trò lẫn tổ (hoặc để trống cả hai)."
  if (v.to_pham_vi === "ca_san_xuat" && !v.ca_mac_dinh) return "Tổ trưởng / tổ phó ca sản xuất phải có ca mặc định."
  return null
}

/** Cột ghi vào maintenance_staff. */
export function staffAttendancePayload(v: StaffAttendanceValue): Record<string, unknown> {
  return {
    loai_nhan_su: v.loai_nhan_su,
    ma_nhan_su: v.ma_nhan_su.trim().toUpperCase() || null,
    day_chuyen_mac_dinh: v.day_chuyen_mac_dinh || null,
    ca_mac_dinh: v.ca_mac_dinh || null,
    cong_viec_mac_dinh_id: v.cong_viec_mac_dinh_id || null,
    thu_tu_diem_danh: v.thu_tu_diem_danh.trim() ? Number(v.thu_tu_diem_danh.trim()) : null,
    ngay_vao_lam: v.ngay_vao_lam || null,
    ngay_nghi_viec: v.ngay_nghi_viec || null,
    cho_xac_nhan: v.cho_xac_nhan,
    to_vai_tro: v.to_vai_tro || null,
    to_pham_vi: v.to_pham_vi || null,
  }
}

export const STAFF_ATTENDANCE_COLUMNS = Object.keys(staffAttendancePayload(emptyStaffAttendanceValue()))

type StaffRowLike = {
  loai_nhan_su?: string | null
  ma_nhan_su?: string | null
  day_chuyen_mac_dinh?: string | null
  ca_mac_dinh?: string | null
  cong_viec_mac_dinh_id?: string | null
  thu_tu_diem_danh?: number | null
  ngay_vao_lam?: string | null
  ngay_nghi_viec?: string | null
  cho_xac_nhan?: boolean | null
  to_vai_tro?: string | null
  to_pham_vi?: string | null
}

export function staffAttendanceFromRow(row: StaffRowLike): StaffAttendanceValue {
  return {
    loai_nhan_su: row.loai_nhan_su === "cong_nhan" ? "cong_nhan" : "nhan_vien",
    ma_nhan_su: row.ma_nhan_su || "",
    day_chuyen_mac_dinh: row.day_chuyen_mac_dinh || "",
    ca_mac_dinh: row.ca_mac_dinh || "",
    cong_viec_mac_dinh_id: row.cong_viec_mac_dinh_id || "",
    thu_tu_diem_danh: row.thu_tu_diem_danh != null ? String(row.thu_tu_diem_danh) : "",
    ngay_vao_lam: row.ngay_vao_lam || "",
    ngay_nghi_viec: row.ngay_nghi_viec || "",
    cho_xac_nhan: !!row.cho_xac_nhan,
    to_vai_tro: row.to_vai_tro === "to_truong" || row.to_vai_tro === "to_pho" ? row.to_vai_tro : "",
    to_pham_vi: row.to_pham_vi === "tiep_nhan" || row.to_pham_vi === "co_dien" || row.to_pham_vi === "ca_san_xuat" ? row.to_pham_vi : "",
  }
}

const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
const labelCls = "text-xs font-bold text-slate-600 block mb-1.5"

export function StaffAttendanceFields({
  factoryId,
  value,
  onChange,
}: {
  factoryId: string | null
  value: StaffAttendanceValue
  onChange: (next: StaffAttendanceValue) => void
}) {
  const [jobs, setJobs] = useState<AttendanceJobType[]>([])
  const [jobsMissing, setJobsMissing] = useState(false)

  useEffect(() => {
    if (!factoryId) return
    let alive = true
    void supabase
      .from("attendance_job_types")
      .select("id, factory_id, day_chuyen, to_nhom, ten, ten_khmer, so_nguoi_goi_y, loai_xe, sort_order, is_active")
      .eq("factory_id", factoryId)
      .order("sort_order")
      .then(({ data, error }) => {
        if (!alive) return
        setJobsMissing(!!error)
        setJobs((data || []) as AttendanceJobType[])
      })
    return () => {
      alive = false
    }
  }, [factoryId])

  const jobGroups = useMemo(() => {
    const shown = jobs.filter(
      (j) => (j.is_active || j.id === value.cong_viec_mac_dinh_id) && (!value.day_chuyen_mac_dinh || j.day_chuyen === value.day_chuyen_mac_dinh),
    )
    const groups: { key: string; label: string; rows: AttendanceJobType[] }[] = []
    for (const dc of ATTENDANCE_DAY_CHUYEN) {
      for (const to of ATTENDANCE_TO_NHOM) {
        const rows = shown.filter((j) => j.day_chuyen === dc && j.to_nhom === to)
        if (rows.length) groups.push({ key: `${dc}-${to}`, label: `${dc} · ${toNhomLabel(to, dc)}`, rows })
      }
    }
    return groups
  }, [jobs, value.day_chuyen_mac_dinh, value.cong_viec_mac_dinh_id])

  const set = (patch: Partial<StaffAttendanceValue>) => onChange({ ...value, ...patch })
  const isWorker = value.loai_nhan_su === "cong_nhan"

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-3">
      <div className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">Chấm công</div>
      {value.cho_xac_nhan ? (
        <label className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <input type="checkbox" checked={!value.cho_xac_nhan} onChange={(e) => set({ cho_xac_nhan: !e.target.checked })} className="mt-0.5" />
          <span>
            <b>Tên do trực ca thêm nhanh</b> — tick để xác nhận đây là nhân sự thật (kiểm tra trùng tên trước khi xác nhận).
          </span>
        </label>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Loại nhân sự</label>
          <div className="flex gap-2">
            {(["nhan_vien", "cong_nhan"] as const).map((loai) => (
              <button
                key={loai}
                type="button"
                onClick={() => set({ loai_nhan_su: loai })}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${
                  value.loai_nhan_su === loai ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                {loai === "nhan_vien" ? "Nhân viên" : "Công nhân"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Mã nhân sự</label>
          <input value={value.ma_nhan_su} onChange={(e) => set({ ma_nhan_su: e.target.value.toUpperCase() })} className={inputCls} placeholder="Không bắt buộc, VD: CN001" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Dây chuyền mặc định</label>
          <select value={value.day_chuyen_mac_dinh} onChange={(e) => set({ day_chuyen_mac_dinh: e.target.value })} className={inputCls}>
            <option value="">Cả hai dây chuyền</option>
            {ATTENDANCE_DAY_CHUYEN.map((dc) => (
              <option key={dc} value={dc}>{dc}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Ca mặc định</label>
          <select value={value.ca_mac_dinh} onChange={(e) => set({ ca_mac_dinh: e.target.value })} className={inputCls}>
            <option value="">Chưa xếp ca</option>
            {ATTENDANCE_CA.map((ca) => (
              <option key={ca} value={ca}>Ca {ca}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Thứ tự điểm danh</label>
          <input
            inputMode="numeric"
            value={value.thu_tu_diem_danh}
            onChange={(e) => set({ thu_tu_diem_danh: e.target.value.replace(/[^\d]/g, "") })}
            className={inputCls}
            placeholder="VD: 1"
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Công việc mặc định</label>
        <select value={value.cong_viec_mac_dinh_id} onChange={(e) => set({ cong_viec_mac_dinh_id: e.target.value })} className={inputCls} disabled={jobsMissing}>
          <option value="">{jobsMissing ? "Chưa có danh mục công việc (chạy migration)" : "Chưa gán"}</option>
          {jobGroups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.rows.map((j) => (
                <option key={j.id} value={j.id}>{j.ten}{j.is_active ? "" : " (đã tắt)"}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {isWorker && !value.ca_mac_dinh ? (
          <p className="mt-1 text-xs text-amber-600">Công nhân chưa xếp ca sẽ không hiện sẵn trong danh sách điểm danh của trực ca.</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Vai trò trong tổ (phiếu F01/F02)</label>
          <select value={value.to_vai_tro} onChange={(e) => set({ to_vai_tro: e.target.value as StaffAttendanceValue["to_vai_tro"] })} className={inputCls}>
            <option value="">Không</option>
            {(Object.keys(TO_VAI_TRO_LABEL) as (keyof typeof TO_VAI_TRO_LABEL)[]).map((k) => (
              <option key={k} value={k}>{TO_VAI_TRO_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Của tổ</label>
          <select value={value.to_pham_vi} onChange={(e) => set({ to_pham_vi: e.target.value as StaffAttendanceValue["to_pham_vi"] })} className={inputCls}>
            <option value="">—</option>
            {(Object.keys(TO_PHAM_VI_LABEL) as (keyof typeof TO_PHAM_VI_LABEL)[]).map((k) => (
              <option key={k} value={k}>{TO_PHAM_VI_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Ngày vào làm</label>
          <input type="date" value={value.ngay_vao_lam} onChange={(e) => set({ ngay_vao_lam: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Ngày nghỉ việc</label>
          <input type="date" value={value.ngay_nghi_viec} onChange={(e) => set({ ngay_nghi_viec: e.target.value })} className={inputCls} />
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Tháng có ngày vào làm sau ngày 1 hoặc ngày nghỉ việc trước cuối tháng là <b>tháng làm không trọn</b>: không xếp
        loại, không tính KPI và chuỗi phép thưởng. Để trống = làm trọn tháng.
      </p>
    </div>
  )
}

"use client"

// Định mức KTKT GĐ4 — chọn "Thành phần nhà máy" của Mẫu 8A từ nhân sự thật (maintenance_staff). Mỗi dòng: danh xưng
// (Ông/Bà theo giới tính, đổi được) + người + chức vụ (dropdown các loại chức vụ có dữ liệu; mặc định CHỨC VỤ CHÍNH QUYỀN
// → kiêm nhiệm → chức vụ). Lưu snapshot tên + chức vụ vào config mẫu (đổi nhân sự sau không đổi báo cáo đã lập). Rule 30.

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { fetchNormStaffOptions, type NormStaffOption } from "@/lib/norms/report-client"
import type { ThanhPhanMember } from "@/lib/norms/report-types"
import { btnCls, errText, inputCls } from "./norms-ui"

const DANH_XUNG = ["Ông", "Bà"] as const
const norm = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ")

const danhXungOf = (s: NormStaffOption | undefined) => (s && /^n(ữ|u)$/i.test(s.gioiTinh.trim()) ? "Bà" : "Ông")
const chucVuOptions = (s: NormStaffOption | undefined) =>
  s ? [...new Set([s.chucVuChinhQuyen, s.chucVuKiemNhiem, s.chucVu].filter(Boolean))] : []
const defaultChucVu = (s: NormStaffOption | undefined) => chucVuOptions(s)[0] || ""

/** Bỏ dòng trống trước khi lưu. */
export function cleanThanhPhan(list: ThanhPhanMember[]): ThanhPhanMember[] {
  return list
    .map((m) => ({ staffId: m.staffId, danhXung: (m.danhXung || "Ông").trim(), ten: (m.ten || "").trim(), chucVu: (m.chucVu || "").trim() }))
    .filter((m) => m.ten)
}

export function ThanhPhanEditor({ value, onChange }: { value: ThanhPhanMember[]; onChange: (v: ThanhPhanMember[]) => void }) {
  const [staff, setStaff] = useState<NormStaffOption[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setStaff(await fetchNormStaffOptions())
      } catch (e) {
        setErr(errText(e, "Không tải được danh sách nhân sự."))
        setStaff([])
      }
    })()
  }, [])

  const byId = useMemo(() => new Map((staff || []).map((s) => [s.id, s])), [staff])

  // Mẫu cũ (text) chưa gắn nhân sự ⇒ tự khớp theo tên đúng 1 người (không đổi chức vụ đã nhập).
  useEffect(() => {
    if (!staff?.length || !value.some((m) => !m.staffId && m.ten)) return
    let changed = false
    const next = value.map((m) => {
      if (m.staffId || !m.ten) return m
      const hits = staff.filter((s) => norm(s.ten) === norm(m.ten))
      if (hits.length !== 1) return m
      changed = true
      return { ...m, staffId: hits[0].id, chucVu: m.chucVu || defaultChucVu(hits[0]) }
    })
    if (changed) onChange(next)
    // chỉ chạy khi danh sách nhân sự vừa tải
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff])

  const patch = (i: number, p: Partial<ThanhPhanMember>) => onChange(value.map((m, j) => (j === i ? { ...m, ...p } : m)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const pickStaff = (i: number, id: string) => {
    const s = byId.get(id)
    if (!s) return patch(i, { staffId: null })
    patch(i, { staffId: s.id, ten: s.ten, danhXung: danhXungOf(s), chucVu: defaultChucVu(s) })
  }

  const usedIds = new Set(value.map((m) => m.staffId).filter(Boolean) as string[])

  return (
    <div className="space-y-2">
      {err && <div className="text-xs font-semibold text-red-700">{err}</div>}
      {staff === null && <div className="text-xs text-slate-500">Đang tải nhân sự…</div>}
      {!value.length && staff !== null && <div className="text-xs text-slate-500">Chưa chọn ai — bấm “Thêm người”.</div>}
      {value.map((m, i) => {
        const s = m.staffId ? byId.get(m.staffId) : undefined
        const cvOpts = chucVuOptions(s)
        if (m.chucVu && !cvOpts.includes(m.chucVu)) cvOpts.push(m.chucVu)
        return (
          <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-[4.5rem_1fr_1fr_auto]">
            <select className={inputCls} aria-label="Danh xưng" value={m.danhXung} onChange={(e) => patch(i, { danhXung: e.target.value })}>
              {DANH_XUNG.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select className={inputCls} aria-label="Người" value={m.staffId || ""} onChange={(e) => pickStaff(i, e.target.value)}>
              <option value="">{m.staffId ? "— Chọn người —" : m.ten ? `${m.ten} (chưa gắn nhân sự)` : "— Chọn người —"}</option>
              {(staff || [])
                .filter((o) => o.id === m.staffId || !usedIds.has(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.ten}
                    {defaultChucVu(o) ? ` — ${defaultChucVu(o)}` : ""}
                  </option>
                ))}
            </select>
            <select
              className={`${inputCls} col-span-2 sm:col-span-1`}
              aria-label="Chức vụ"
              value={m.chucVu}
              onChange={(e) => patch(i, { chucVu: e.target.value })}
            >
              <option value="">— Không in chức vụ —</option>
              {cvOpts.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {s && c === s.chucVuChinhQuyen ? " (chính quyền)" : s && c === s.chucVuKiemNhiem ? " (kiêm nhiệm)" : ""}
                </option>
              ))}
            </select>
            <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
              <button type="button" className={btnCls} title="Lên" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className={btnCls} title="Xuống" aria-label="Xuống" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className={btnCls} title="Xoá dòng" aria-label="Xoá dòng" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )
      })}
      <button type="button" className={btnCls} onClick={() => onChange([...value, { staffId: null, danhXung: "Ông", ten: "", chucVu: "" }])}>
        <Plus size={14} /> Thêm người
      </button>
    </div>
  )
}

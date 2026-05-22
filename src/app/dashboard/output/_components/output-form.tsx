"use client"

import { useState, useEffect } from "react"
import { X, AlertTriangle, CheckCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { ProductionRecord, OutputFormState } from "./output-types"
import { emptyOutputForm, parseVehicleCode } from "./output-types"

interface Vehicle { id: string; code: string; name: string }

interface OutputFormProps {
  record: ProductionRecord | null   // null = thêm mới
  factoryId: string
  vehicles: Vehicle[]               // fallback khi không có điều xe
  onSave: (form: OutputFormState) => Promise<void>
  onClose: () => void
}

const LATEX_TYPES = [
  { key: "mn",  label: "Mủ nước" },
  { key: "ct",  label: "Mủ chén" },
  { key: "dct", label: "Mủ đông chén" },
  { key: "dkt", label: "Mủ đông khối" },
  { key: "dt",  label: "Mủ dây" },
] as const

type LatexKey = typeof LATEX_TYPES[number]["key"]

function fmtDate(iso: string) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

interface DispatchVehicle {
  so_xe: string
  chuyen: number
  tai_xe: string
}

export function OutputForm({ record, factoryId, vehicles, onSave, onClose }: OutputFormProps) {
  const [form, setForm] = useState<OutputFormState>(emptyOutputForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dispatch-aware state
  const [dispatchVehicles, setDispatchVehicles] = useState<DispatchVehicle[]>([])
  const [dispatchLoading, setDispatchLoading] = useState(false)
  const [enteredKeys, setEnteredKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (record) {
      setForm({
        ngay: record.ngay,
        doi: record.doi,
        so_xe: record.so_xe,
        chuyen: record.chuyen,
        tai_xe: record.tai_xe ?? "",
        mn_tuoi:  String(record.mn_tuoi  || ""), mn_drc:  String(record.mn_drc  || ""), mn_kho:  String(record.mn_kho  || ""),
        ct_tuoi:  String(record.ct_tuoi  || ""), ct_drc:  String(record.ct_drc  || ""), ct_kho:  String(record.ct_kho  || ""),
        dct_tuoi: String(record.dct_tuoi || ""), dct_drc: String(record.dct_drc || ""), dct_kho: String(record.dct_kho || ""),
        dkt_tuoi: String(record.dkt_tuoi || ""), dkt_drc: String(record.dkt_drc || ""), dkt_kho: String(record.dkt_kho || ""),
        dt_tuoi:  String(record.dt_tuoi  || ""), dt_drc:  String(record.dt_drc  || ""), dt_kho:  String(record.dt_kho  || ""),
        ghi_chu: record.ghi_chu ?? "",
      })
    }
  }, [record])

  // Fetch dispatch entries + existing records khi ngày thay đổi
  useEffect(() => {
    if (!form.ngay || !factoryId) {
      setDispatchVehicles([])
      setEnteredKeys(new Set())
      return
    }
    const fetchForDate = async () => {
      setDispatchLoading(true)
      try {
        // dispatch_entries.ngay có thể là "YYYY-MM-DD" hoặc "dd/mm/yyyy"
        const iso = form.ngay
        const ddmm = `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
        const { data: dxData } = await supabase
          .from("dispatch_entries")
          .select("rows")
          .eq("factory_id", factoryId)
          .or(`ngay.eq.${iso},ngay.eq.${ddmm}`)
        const rows: DispatchVehicle[] = (dxData ?? []).flatMap((e: { rows?: unknown[] }) =>
          (e.rows ?? []).map((r) => {
            const row = r as { so_xe?: string; chuyen?: number; tai_xe?: string }
            return {
              so_xe: parseVehicleCode(row.so_xe ?? "").base_xe,
              chuyen: Number(row.chuyen ?? 1),
              tai_xe: row.tai_xe ?? "",
            }
          })
        )
        setDispatchVehicles(rows)

        // Records đã nhập ngày đó
        const { data: recData } = await supabase
          .from("production_records")
          .select("so_xe, chuyen")
          .eq("factory_id", factoryId)
          .eq("ngay", form.ngay)
        const keys = new Set(
          (recData ?? []).map((r: { so_xe: string; chuyen: number }) => `${r.so_xe}:${r.chuyen}`)
        )
        setEnteredKeys(keys)
      } finally {
        setDispatchLoading(false)
      }
    }
    void fetchForDate()
  }, [form.ngay, factoryId])

  // Auto-fill tài xế khi chọn xe + chuyến từ dispatch
  useEffect(() => {
    if (!form.so_xe || !form.chuyen || dispatchVehicles.length === 0) return
    const match = dispatchVehicles.find(
      d => d.so_xe === form.so_xe && d.chuyen === Number(form.chuyen)
    )
    if (match?.tai_xe) {
      setForm(f => ({ ...f, tai_xe: match.tai_xe }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.so_xe, form.chuyen])

  const setField = (key: keyof OutputFormState, val: string | number) =>
    setForm(f => ({ ...f, [key]: val }))

  // Auto-calc KL khô khi blur
  const handleTuoiOrDrcBlur = (prefix: LatexKey) => {
    const tuoi = parseFloat(String(form[`${prefix}_tuoi` as keyof OutputFormState] ?? "0"))
    const drc  = parseFloat(String(form[`${prefix}_drc`  as keyof OutputFormState] ?? "0"))
    const khoKey = `${prefix}_kho` as keyof OutputFormState
    if (tuoi > 0 && drc > 0) {
      const kho = Math.round(tuoi * drc / 100 * 100) / 100
      setForm(f => ({ ...f, [khoKey]: String(kho) }))
    }
  }

  const handleSubmit = async () => {
    setError(null)
    if (!form.doi || !form.so_xe || !form.chuyen) {
      setError("Vui lòng điền đầy đủ Ngày, Đội, Số xe và Chuyến.")
      return
    }
    setSaving(true)
    try {
      await onSave(form)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi lưu dữ liệu")
    } finally {
      setSaving(false)
    }
  }

  // Danh sách xe: ưu tiên từ dispatch, fallback sang vehicles prop
  const uniqueXeFromDispatch = dispatchVehicles.length > 0
    ? [...new Map(dispatchVehicles.map(d => [d.so_xe, d])).values()]
    : []
  const vehicleOptions = uniqueXeFromDispatch.length > 0
    ? uniqueXeFromDispatch
    : vehicles.map(v => ({ so_xe: v.code, chuyen: 1, tai_xe: "" }))

  // Chuyến available cho xe đã chọn (từ dispatch)
  const chuyenOptions = dispatchVehicles
    .filter(d => d.so_xe === form.so_xe)
    .map(d => d.chuyen)

  // Tài xế từ dispatch (readonly nếu có)
  const taiXeFromDispatch = dispatchVehicles.find(
    d => d.so_xe === form.so_xe && d.chuyen === Number(form.chuyen)
  )?.tai_xe ?? ""

  // Banner tiến độ
  const daXuat = dispatchVehicles.filter(d => enteredKeys.has(`${d.so_xe}:${d.chuyen}`)).length
  const chuaNhap = dispatchVehicles.length - daXuat

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            {record ? "Sửa bản ghi sản lượng" : "Thêm sản lượng thủ công"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Thông tin cơ bản — Ngày + Đội */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày *</label>
              <input
                type="date"
                value={form.ngay}
                onChange={e => setField("ngay", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Đội *</label>
              <select
                value={form.doi}
                onChange={e => setField("doi", parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              >
                <option value="">-- Chọn đội --</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>Đội {d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Banner tiến độ nhập */}
          {form.ngay && (
            <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
              dispatchLoading
                ? "bg-slate-50"
                : dispatchVehicles.length === 0
                  ? "bg-slate-50"
                  : chuaNhap > 0
                    ? "bg-amber-50 border border-amber-200"
                    : "bg-emerald-50 border border-emerald-200"
            }`}>
              {dispatchLoading
                ? <span className="text-slate-400">Đang tải điều xe...</span>
                : dispatchVehicles.length === 0
                  ? <span className="text-slate-400">Không có bảng điều xe ngày {fmtDate(form.ngay)}</span>
                  : <>
                      {chuaNhap > 0
                        ? <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                        : <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                      }
                      <span className="text-slate-700">
                        <span className="font-bold">Điều xe {fmtDate(form.ngay)}: </span>
                        {dispatchVehicles.length} lượt xe —
                        <span className="font-bold text-emerald-700"> {daXuat} đã nhập</span>
                        {chuaNhap > 0 && (
                          <span className="font-bold text-amber-700"> · {chuaNhap} chưa nhập</span>
                        )}
                      </span>
                    </>
              }
            </div>
          )}

          {/* Số xe + Chuyến + Tài xế */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Số xe *</label>
              <select
                value={form.so_xe}
                onChange={e => {
                  setField("so_xe", e.target.value)
                  // Reset chuyến khi đổi xe nếu dùng dispatch
                  if (dispatchVehicles.length > 0) setField("chuyen", 1)
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              >
                <option value="">-- Chọn xe --</option>
                {vehicleOptions.map(v => (
                  <option key={v.so_xe} value={v.so_xe}>{v.so_xe}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Chuyến *</label>
              {chuyenOptions.length > 1 ? (
                <select
                  value={form.chuyen}
                  onChange={e => setField("chuyen", parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {chuyenOptions.map(c => (
                    <option key={c} value={c}>Chuyến {c}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={form.chuyen}
                  onChange={e => setField("chuyen", parseInt(e.target.value) || 1)}
                  readOnly={chuyenOptions.length === 1}
                  className={`w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 ${chuyenOptions.length === 1 ? "bg-slate-50 text-slate-500" : ""}`}
                />
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Tài xế
                {taiXeFromDispatch && <span className="ml-1 text-[10px] font-normal text-slate-400">(từ điều xe)</span>}
              </label>
              <input
                type="text"
                value={form.tai_xe}
                onChange={e => setField("tai_xe", e.target.value)}
                readOnly={!!taiXeFromDispatch && !record}
                placeholder="Tên tài xế"
                className={`w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 ${taiXeFromDispatch && !record ? "bg-slate-50 text-slate-600" : ""}`}
              />
            </div>
          </div>

          {/* KL theo loại mủ */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Khối lượng theo loại mủ</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-slate-500">Loại mủ</th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-slate-500">Tươi (kg)</th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-slate-500">DRC (%)</th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-slate-500">Khô (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {LATEX_TYPES.map(({ key, label }) => {
                    const tuoiKey = `${key}_tuoi` as keyof OutputFormState
                    const drcKey  = `${key}_drc`  as keyof OutputFormState
                    const khoKey  = `${key}_kho`  as keyof OutputFormState
                    return (
                      <tr key={key} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-bold text-slate-700">{label}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min={0} step={0.01}
                            value={String(form[tuoiKey])}
                            onChange={e => setField(tuoiKey, e.target.value)}
                            onBlur={() => handleTuoiOrDrcBlur(key)}
                            className="w-full px-2 py-1 border border-slate-200 rounded-lg text-right text-sm outline-none focus:border-emerald-500"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min={0} max={100} step={0.01}
                            value={String(form[drcKey])}
                            onChange={e => setField(drcKey, e.target.value)}
                            onBlur={() => handleTuoiOrDrcBlur(key)}
                            className="w-full px-2 py-1 border border-slate-200 rounded-lg text-right text-sm outline-none focus:border-emerald-500"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min={0} step={0.01}
                            value={String(form[khoKey])}
                            onChange={e => setField(khoKey, e.target.value)}
                            className="w-full px-2 py-1 border border-slate-200 rounded-lg text-right text-sm outline-none focus:border-emerald-500 bg-emerald-50"
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">* KL khô tự tính khi nhập Tươi và DRC%, hoặc nhập tay.</p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
            <textarea
              value={form.ghi_chu}
              onChange={e => setField("ghi_chu", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 resize-none"
              placeholder="Ghi chú (tùy chọn)"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
              <AlertTriangle size={16} className="shrink-0" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all"
          >
            {saving ? "Đang lưu..." : record ? "Cập nhật" : "Thêm mới"}
          </button>
        </div>
      </div>
    </div>
  )
}

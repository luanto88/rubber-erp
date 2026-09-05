"use client"

import { useState, useEffect } from "react"
import { AlertTriangle, CheckCircle } from "lucide-react"
import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import { supabase } from "@/lib/supabase"
import type { ProductionRecord, OutputFormState } from "./output-types"
import { emptyOutputForm, parseVehicleCode } from "./output-types"
import { formatDateDisplay, getTodayISODate, normalizeDateInput } from "@/lib/date-utils"
import { DateTextInput } from "@/app/dashboard/_components/date-text-input"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { RequiredNoteSelect } from "@/app/dashboard/_components/required-note-select"
import { DEFAULT_SUFFIXES, type SuffixOption } from "@/lib/suffixes"

interface OutputFormProps {
  record: ProductionRecord | null   // null = thêm mới
  factoryId: string
  initialDate?: string | null
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
  return formatDateDisplay(iso)
}

interface DispatchVehicle {
  so_xe: string
  chuyen: number
  tai_xe: string
  doi: number[]
  ghi_chu: string
}

export function OutputForm({ record, factoryId, initialDate, onSave, onClose }: OutputFormProps) {
  const [form, setForm] = useState<OutputFormState>(emptyOutputForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suffixes, setSuffixes] = useState<SuffixOption[]>(DEFAULT_SUFFIXES)

  // Dispatch-aware state
  const [dispatchVehicles, setDispatchVehicles] = useState<DispatchVehicle[]>([])
  const [dispatchLoading, setDispatchLoading] = useState(false)
  const [enteredKeys, setEnteredKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fetchSuffixes = async () => {
      try {
        const { data } = await supabase
          .from("suffixes")
          .select("code, name, nguon, chung_nhan")
        if (data && data.length > 0) {
          const valid = (data as SuffixOption[]).filter((s) => s.code)
          if (valid.length > 0) setSuffixes(valid)
        }
      } catch {
        // ignore
      }
    }
    void fetchSuffixes()
  }, [])

  useEffect(() => {
    if (record) {
      setForm({
        ngay: record.ngay,
        doi: record.doi ?? "",
        ma_nguon: record.ma_nguon || (record.doi ? "cs" : "m"),
        so_xe: record.so_xe,
        chuyen: record.chuyen,
        tai_xe: record.tai_xe ?? "",
        mn_tuoi:  String(record.mn_tuoi  || ""), mn_drc:  String(record.mn_drc  || ""), mn_kho:  String(record.mn_kho  || ""),
        ct_tuoi:  String(record.ct_tuoi  || ""), ct_drc:  String(record.ct_drc  || ""), ct_kho:  String(record.ct_kho  || ""),
        dct_tuoi: String(record.dct_tuoi || ""), dct_drc: String(record.dct_drc || ""), dct_kho: String(record.dct_kho || ""),
        dkt_tuoi: String(record.dkt_tuoi || ""), dkt_drc: String(record.dkt_drc || ""), dkt_kho: String(record.dkt_kho || ""),
        dt_tuoi:  String(record.dt_tuoi  || ""), dt_drc:  String(record.dt_drc  || ""), dt_kho:  String(record.dt_kho  || ""),
        ghi_chu: record.ghi_chu ?? "",
        ghi_chu_tu_do: record.ghi_chu_tu_do ?? "",
      })
    }
  }, [record])

  useEffect(() => {
    if (record) return
    setForm({
      ...emptyOutputForm(),
      ngay: initialDate || getTodayISODate(),
    })
  }, [initialDate, record])

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
        const dxData = await loadDispatchEntriesWithResolvedRows(supabase, {
          factoryId,
          select: "id,ngay,rows",
          ascending: true,
        })
        const rows: DispatchVehicle[] = dxData
          .filter((entry) => normalizeDateInput(entry.ngay) === form.ngay)
          .flatMap((e) =>
          (e.rows ?? []).map((r) => {
            const row = r as {
              so_xe?: string
              chuyen?: number
              tai_xe?: string
              doi?: number[]
              ghi_chu?: string
            }
            return {
              so_xe: String(row.so_xe ?? "").trim(),
              chuyen: Number(row.chuyen ?? 1),
              tai_xe: row.tai_xe ?? "",
              doi: Array.isArray(row.doi) ? row.doi : [],
              ghi_chu: row.ghi_chu ?? "",
            }
          })
        )
        setDispatchVehicles(rows)

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

  // Auto-fill tài xế, nguồn mủ, đội và ký hiệu kỹ thuật khi chọn xe + chuyến từ dispatch
  useEffect(() => {
    if (!form.so_xe || dispatchVehicles.length === 0) return
    const match =
      dispatchVehicles.find(d => d.so_xe === form.so_xe && d.chuyen === Number(form.chuyen)) ||
      dispatchVehicles.find(d => d.so_xe === form.so_xe)
    if (match) {
      setForm(f => {
        const updates: Partial<OutputFormState> = {}
        if (match.tai_xe && (!f.tai_xe || f.so_xe !== match.so_xe)) {
          updates.tai_xe = match.tai_xe
        }
        // Auto-fill Nguồn mủ & Đội:
        const noteUpper = (match.ghi_chu || "").toUpperCase()
        if (noteUpper === "TM" || match.so_xe.toUpperCase().includes("3A1064")) {
          updates.ma_nguon = "m"
          updates.doi = ""
        } else if (noteUpper === "GCTBK" || noteUpper.includes("TAN BIEN")) {
          updates.ma_nguon = "gctpk"
          updates.doi = ""
        } else if (noteUpper === "GCCOK" || noteUpper.includes("CHU PA") || noteUpper.includes("CHU PAH")) {
          updates.ma_nguon = "gccpk"
          updates.doi = ""
        } else if (noteUpper === "TL") {
          updates.ma_nguon = "tl"
          updates.doi = ""
        } else if (match.doi.length === 1) {
          updates.ma_nguon = "cs"
          updates.doi = match.doi[0]
        }
        // Auto-fill Ký hiệu kỹ thuật:
        if (!f.ghi_chu && match.ghi_chu) {
          updates.ghi_chu = match.ghi_chu
        }
        return Object.keys(updates).length > 0 ? { ...f, ...updates } : f
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.so_xe, form.chuyen])

  const setField = (key: keyof OutputFormState, val: string | number) =>
    setForm(f => ({ ...f, [key]: val }))

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
    const isInternal = form.ma_nguon === "cs"
    if (isInternal && (form.doi === "" || form.doi === undefined)) {
      setError("Vui lòng chọn Đội nông trường cho mủ nội bộ (Đội 1-12).")
      return
    }
    if (!form.so_xe || !form.chuyen) {
      setError("Vui lòng điền đầy đủ Ngày, Số xe và Chuyến.")
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

  const uniqueXeFromDispatch = [...new Map(dispatchVehicles.map(d => [d.so_xe, d])).values()]
  const noDispatch = !dispatchLoading && dispatchVehicles.length === 0
  const vehicleOptions = uniqueXeFromDispatch.length > 0
    ? uniqueXeFromDispatch
    : record
      ? [{ so_xe: record.so_xe, chuyen: record.chuyen, tai_xe: record.tai_xe ?? "" }]
      : []

  const chuyenOptions = [...new Set(
    dispatchVehicles
      .filter(d => d.so_xe === form.so_xe)
      .map(d => d.chuyen),
  )]

  const taiXeFromDispatch = dispatchVehicles.find(
    d => d.so_xe === form.so_xe && d.chuyen === Number(form.chuyen)
  )?.tai_xe ?? ""

  const daXuat = dispatchVehicles.filter(d => enteredKeys.has(`${d.so_xe}:${d.chuyen}`)).length
  const chuaNhap = dispatchVehicles.length - daXuat
  const isInternal = form.ma_nguon === "cs"

  return (
    <ModalShell
      title={record ? "Sửa bản ghi sản lượng" : "Thêm sản lượng thủ công"}
      onClose={onClose}
      maxWidth="2xl"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
          <button
            onClick={handleSubmit}
            disabled={saving || (!record && noDispatch)}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all"
          >
            {saving ? "Đang lưu..." : record ? "Cập nhật" : "Thêm mới"}
          </button>
        </>
      }
    >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày *</label>
              <DateTextInput
                value={form.ngay}
                onChange={(value) => setField("ngay", value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn mủ *</label>
              <select
                value={form.ma_nguon}
                onChange={e => {
                  const val = e.target.value
                  setForm(f => ({
                    ...f,
                    ma_nguon: val,
                    doi: val === "cs" ? (f.doi || 1) : "",
                  }))
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-medium"
              >
                <optgroup label="🏢 Nội bộ nông trường">
                  <option value="cs">Nội tuyển PEFC (Đội 1-12)</option>
                </optgroup>
                <optgroup label="🏭 Nguồn mủ ngoài">
                  {suffixes.filter(s => s.code !== "cs").map(s => (
                    <option key={s.code} value={s.code}>{s.name} ({s.nguon})</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                {isInternal ? "Đội (1-12) *" : "Đội"}
              </label>
              {isInternal ? (
                <select
                  value={form.doi}
                  onChange={e => setField("doi", e.target.value === "" ? "" : parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">-- Chọn đội --</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>Đội {d}</option>
                  ))}
                </select>
              ) : (
                <div className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-400 italic">
                  Không áp dụng (mủ ngoài)
                </div>
              )}
            </div>
          </div>

          {/* Banner tiến độ nhập */}
          {form.ngay && (
            <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
              dispatchLoading
                ? "bg-slate-50"
                : noDispatch
                  ? !record ? "bg-red-50 border border-red-200" : "bg-slate-50"
                  : chuaNhap > 0
                    ? "bg-amber-50 border border-amber-200"
                    : "bg-emerald-50 border border-emerald-200"
            }`}>
              {dispatchLoading
                ? <span className="text-slate-400">Đang tải điều xe...</span>
                : noDispatch
                  ? !record
                    ? <><AlertTriangle size={14} className="text-red-600 shrink-0" /><span className="font-bold text-red-700">Ngày {fmtDate(form.ngay)} chưa có bảng điều xe — không thể thêm sản lượng</span></>
                    : <span className="text-slate-400">Không có bảng điều xe ngày {fmtDate(form.ngay)}</span>
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
                  disabled={dispatchLoading || (noDispatch && !record)}
                  onChange={e => {
                    const nextXe = e.target.value
                    const nextChuyen = dispatchVehicles.find(d => d.so_xe === nextXe)?.chuyen ?? 1
                    setForm(f => ({ ...f, so_xe: nextXe, chuyen: nextChuyen }))
                  }}
                  className={`w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 ${dispatchLoading || (noDispatch && !record) ? "bg-slate-100 text-slate-400 cursor-not-allowed" : ""}`}
                >
                <option value="">{noDispatch && !record ? "-- Chưa có điều xe --" : "-- Chọn xe --"}</option>
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
            <ResponsiveTableWrapper className="rounded-xl">
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
            </ResponsiveTableWrapper>
            <p className="text-[11px] text-slate-400 mt-1">* KL khô tự tính khi nhập Tươi và DRC%, hoặc nhập tay.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ký hiệu kỹ thuật</label>
              <RequiredNoteSelect
                factoryId={factoryId}
                value={form.ghi_chu}
                onChange={(v) => setField("ghi_chu", v)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                onError={setError}
              />
              <p className="text-[11px] text-slate-400 mt-1">Mã kỹ thuật (T, Tr, TM, GCTBK...) dùng phân loại và nhóm thống kê.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú sự cố / Vận hành</label>
              <input
                value={form.ghi_chu_tu_do}
                onChange={(e) => setField("ghi_chu_tu_do", e.target.value)}
                placeholder="VD: Cúp điện, xe nâng hư, mủ có tạp chất..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 placeholder:text-slate-300"
              />
              <p className="text-[11px] text-slate-400 mt-1">Ghi chú tự do ghi nhận hiện trường, không làm vỡ nhóm thống kê.</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
              <AlertTriangle size={16} className="shrink-0" />{error}
            </div>
          )}
        </div>
    </ModalShell>
  )
}

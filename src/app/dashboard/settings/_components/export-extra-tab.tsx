"use client"

// Cài đặt → Cấu hình nhà máy → Thành phẩm → "Xuất bù kho" (2026-11-16, chuyển từ Định mức → Nhập liệu).
// Thành phẩm xuất của LÔ NGOÀI HỆ THỐNG (vd lô sản xuất 2025, không có nhập TP nên không gán được vào đơn ở module
// Xuất hàng). Nhập theo ngày, nhiều dòng một lần, đủ trường như Tồn đầu kỳ. CHỈ cộng vào Mẫu 8A mục 3 — KHÔNG trừ
// tồn F12, đơn xuất, EUDR (người dùng chốt). Bảng tech_norm_export_extra (migration 20261127 + 20261128). Rule 30.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Plus, Save, Trash2, X } from "lucide-react"
import { getFreshAuthSession } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { loadNormExportExtra, saveNormExportExtraDay, type NormExportExtra, type NormExportExtraInput } from "@/lib/norms/client"
import { nguonCodeFromLabel } from "@/lib/norms/types"
import { TP_NGUON_LABEL } from "@/lib/norms/report-types"
import { loadOpeningStockOptions } from "@/app/dashboard/product/confirm/daily-report-actions"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { banhKey, cascade, optionsFor, type Combo } from "./opening-stock-tab"

type Nguon = NormExportExtra["nguon"]
const NGUON_CODES: Nguon[] = ["cong_ty", "gia_cong", "thu_mua"]
const DEFAULT_NOTE = "Lô sản xuất 2025 — không có trong module Xuất hàng"

type GridRow = {
  key: string
  id: string | null
  loai_csr: string
  /** Nhãn nguồn như Tồn đầu kỳ ("Công ty" / "Gia công" / "Thu mua"); lưu xuống DB bằng mã. */
  nguon_goc: string
  boc: string
  loai_banh: string
  kg: string
  ghi_chu: string
}

let seq = 0
const newKey = () => `x${Date.now()}_${seq++}`

const fromDb = (r: NormExportExtra): GridRow => ({
  key: newKey(),
  id: r.id,
  loai_csr: r.loai_csr,
  nguon_goc: TP_NGUON_LABEL[r.nguon],
  boc: r.boc || "",
  loai_banh: r.loai_banh ? String(r.loai_banh) : "",
  kg: String(r.kg),
  ghi_chu: r.ghi_chu || "",
})

const fmtDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
const fmtKg = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 3 })

/** Mã nguồn tính được vào Mẫu 8A mục 3 (Công ty / Gia công / Thu mua). */
const nguonCode = (label: string): Nguon | null => {
  const c = nguonCodeFromLabel(label)
  return c && (NGUON_CODES as string[]).includes(c) ? (c as Nguon) : null
}

const errMsg = (err: unknown, fallback: string) => {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? "")
  if (/NORM_DAY_LOCKED/.test(msg)) return msg.replace(/^.*NORM_DAY_LOCKED:\s*/, "") + " (báo cáo định mức kỳ này đang Chờ ký / Đã ký)."
  return msg || fallback
}

export function ExportExtraTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [allRows, setAllRows] = useState<NormExportExtra[]>([])
  const [hasFieldCols, setHasFieldCols] = useState(true)
  const [loading, setLoading] = useState(true)
  const [ngay, setNgay] = useState("")
  const [grid, setGrid] = useState<GridRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [delConfirm, setDelConfirm] = useState(false)
  const [combos, setCombos] = useState<Combo[]>([])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const res = await loadNormExportExtra(fid)
      setAllRows(res.rows)
      setHasFieldCols(res.hasFieldCols)
    } catch (err) {
      setError(errMsg(err, "Không tải được xuất bù kho."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  // Tổ hợp thật (lô + tồn đã chốt) — chỉ giữ nguồn tính được vào 8A.
  useEffect(() => {
    if (!factoryId || !canManage) return
    let alive = true
    void (async () => {
      try {
        const session = await getFreshAuthSession()
        const list = await loadOpeningStockOptions(factoryId, session?.access_token ?? null)
        if (alive) setCombos(list.filter((c) => nguonCode(c.nguonGoc)))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Không tải được danh sách lựa chọn.")
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, canManage])

  const dates = useMemo(() => {
    const sum = new Map<string, number>()
    for (const r of allRows) sum.set(r.ngay, (sum.get(r.ngay) ?? 0) + r.kg)
    return [...sum.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [allRows])

  useEffect(() => {
    if (!ngay && dates.length > 0) setNgay(dates[0][0])
  }, [dates, ngay])

  useEffect(() => {
    setGrid(allRows.filter((r) => r.ngay === ngay).map(fromDb))
    setDirty(false)
  }, [allRows, ngay])

  const isExistingDate = dates.some(([d]) => d === ngay)
  const totalKg = grid.reduce((s, r) => s + (Number(r.kg) || 0), 0)
  const grandKg = useMemo(() => allRows.reduce((s, r) => s + r.kg, 0), [allRows])
  const editable = canManage && hasFieldCols

  const updateRow = (key: string, patch: Partial<GridRow>) => {
    const isGroupField = "loai_csr" in patch || "nguon_goc" in patch || "boc" in patch
    setGrid((g) => g.map((r) => (r.key === key ? (isGroupField ? cascade(combos, { ...r, ...patch }) : { ...r, ...patch }) : r)))
    setDirty(true)
  }

  const addRow = () => {
    const csrs = [...new Set(combos.map((c) => c.loaiCsr))]
    setGrid((g) => [
      ...g,
      cascade(combos, { key: newKey(), id: null, loai_csr: csrs.length === 1 ? csrs[0] : "", nguon_goc: "", boc: "", loai_banh: "", kg: "", ghi_chu: DEFAULT_NOTE }),
    ])
    setDirty(true)
  }

  const changeDate = (d: string) => {
    if (dirty && !window.confirm("Bỏ các thay đổi chưa lưu?")) return
    setNgay(d)
  }

  const handleSave = async () => {
    if (!factoryId || !ngay) return
    setError("")
    setInfo("")
    const rows: NormExportExtraInput[] = []
    const seen = new Set<string>()
    for (const [i, r] of grid.entries()) {
      const n = `Dòng ${i + 1}`
      if (!r.loai_csr.trim()) return setError(`${n}: thiếu Loại CSR.`)
      const code = nguonCode(r.nguon_goc)
      if (!code) return setError(`${n}: Nguồn gốc phải là Công ty, Gia công hoặc Thu mua.`)
      if (!(Number(r.loai_banh) > 0)) return setError(`${n}: chọn Loại bành.`)
      const kg = Number(r.kg)
      if (!Number.isFinite(kg) || kg <= 0) return setError(`${n}: Số lượng (kg) phải lớn hơn 0.`)
      const k = `${r.loai_csr.trim()}||${code}||${r.boc.trim()}||${banhKey(r.loai_banh)}`
      if (seen.has(k)) return setError(`${n}: trùng nhóm với dòng khác (CSR + nguồn + bọc + loại bành).`)
      seen.add(k)
      rows.push({
        id: r.id,
        loai_csr: r.loai_csr.trim(),
        nguon: code,
        boc: r.boc.trim(),
        loai_banh: Number(banhKey(r.loai_banh)),
        kg: Math.round(kg * 1000) / 1000,
        ghi_chu: r.ghi_chu.trim() || null,
      })
    }
    const keep = new Set(grid.map((r) => r.id).filter(Boolean))
    const removeIds = allRows.filter((r) => r.ngay === ngay && !keep.has(r.id)).map((r) => r.id)
    setSaving(true)
    try {
      await saveNormExportExtraDay(factoryId, ngay, rows, removeIds)
      setInfo(`Đã lưu xuất bù ngày ${fmtDay(ngay)} (${rows.length} dòng).`)
      await loadData(factoryId)
    } catch (err) {
      setError(errMsg(err, "Không lưu được."))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDate = async () => {
    if (!factoryId || !ngay) return
    setSaving(true)
    setError("")
    try {
      await saveNormExportExtraDay(factoryId, ngay, [], allRows.filter((r) => r.ngay === ngay).map((r) => r.id))
      setDelConfirm(false)
      setInfo(`Đã xoá xuất bù ngày ${fmtDay(ngay)}.`)
      setNgay("")
      await loadData(factoryId)
    } catch (err) {
      setDelConfirm(false)
      setError(errMsg(err, "Không xoá được."))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        Thành phẩm xuất kho của <b>lô ngoài hệ thống</b> (vd lô sản xuất năm 2025, không có nhập thành phẩm nên không có trong đơn ở module
        Xuất hàng). Số ở đây được <b>cộng vào mục 3 &quot;Thành phẩm xuất kho&quot; của Mẫu 8A</b> tháng chứa ngày xuất, có ghi chú dưới bảng.
        <b> Không trừ tồn</b> trên Báo cáo sản xuất hằng ngày (F12), không ảnh hưởng đơn xuất hay EUDR.
      </div>

      {!hasFieldCols && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Chưa chạy migration 20261128 (cột Bọc / Loại bành) — đang chỉ xem, chưa lưu được.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày xuất</label>
          <input
            type="date"
            value={ngay}
            max={getFactoryTodayISO()}
            onChange={(e) => changeDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
          />
        </div>
        {dates.length > 0 && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày đã nhập</label>
            <select
              value={isExistingDate ? ngay : ""}
              onChange={(e) => e.target.value && changeDate(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
            >
              <option value="">— Chọn —</option>
              {dates.map(([d, kg]) => (
                <option key={d} value={d}>
                  {fmtDay(d)} · {fmtKg(kg)} kg
                </option>
              ))}
            </select>
          </div>
        )}
        {editable && ngay && (
          <div className="flex flex-wrap gap-2">
            <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl">
              <Plus size={14} /> Thêm dòng
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
            >
              <Save size={14} /> {saving ? "Đang lưu..." : "Lưu ngày này"}
            </button>
            {isExistingDate && (
              <button onClick={() => setDelConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl">
                <Trash2 size={14} /> Xoá ngày này
              </button>
            )}
          </div>
        )}
        {dates.length > 0 && (
          <div className="ml-auto text-xs text-slate-500">
            Tất cả các ngày: <b className="text-slate-700">{fmtKg(grandKg)} kg</b> ({fmtKg(grandKg / 1000)} tấn)
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {info && !error && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{info}</div>}

      {loading ? (
        <div className="p-8 text-center text-slate-400">Đang tải...</div>
      ) : !ngay ? (
        <div className="p-8 text-center text-slate-400">Chọn ngày xuất để nhập xuất bù kho.</div>
      ) : grid.length === 0 ? (
        <div className="p-8 text-center text-slate-400">Chưa có dòng xuất bù nào ngày {fmtDay(ngay)}. Bấm &quot;Thêm dòng&quot; để nhập.</div>
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left w-10">#</th>
                <th className="px-2 py-2 text-left">Loại CSR</th>
                <th className="px-2 py-2 text-left">Nguồn gốc</th>
                <th className="px-2 py-2 text-left">Bọc</th>
                <th className="px-2 py-2 text-left w-24">Loại bành</th>
                <th className="px-2 py-2 text-right w-36">Số lượng (kg)</th>
                <th className="px-2 py-2 text-left">Ghi chú (in dưới mục 3 Mẫu 8A)</th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {grid.map((r, i) => {
                const opts = optionsFor(combos, r)
                const pick = (field: "loai_csr" | "nguon_goc" | "boc" | "loai_banh", list: string[], label: (v: string) => string = (v) => v || "(không bọc)") => {
                  const cur = field === "loai_banh" ? (r.loai_banh ? banhKey(r.loai_banh) : "") : r[field]
                  const legacy = cur !== "" && !list.includes(cur)
                  const missing = field === "loai_banh" && !cur
                  return (
                    <select
                      disabled={!editable}
                      value={cur}
                      onChange={(e) => updateRow(r.key, { [field]: e.target.value } as Partial<GridRow>)}
                      className={inputCls + (legacy || missing ? " border-amber-400 bg-amber-50" : "")}
                    >
                      <option value="">— Chọn —</option>
                      {legacy && (
                        <option value={cur}>
                          {label(cur)} (giá trị cũ)
                        </option>
                      )}
                      {list.map((v) => (
                        <option key={v} value={v}>
                          {label(v)}
                        </option>
                      ))}
                    </select>
                  )
                }
                return (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1.5">{pick("loai_csr", opts.csr, (v) => v)}</td>
                    <td className="px-2 py-1.5">{pick("nguon_goc", opts.nguon, (v) => v)}</td>
                    <td className="px-2 py-1.5">{pick("boc", opts.boc)}</td>
                    <td className="px-2 py-1.5">{pick("loai_banh", opts.banh, (v) => `${v} kg`)}</td>
                    <td className="px-2 py-1.5">
                      <input
                        disabled={!editable}
                        type="number"
                        step="0.001"
                        min="0"
                        value={r.kg}
                        onChange={(e) => updateRow(r.key, { kg: e.target.value })}
                        className={inputCls + " text-right tabular-nums"}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input disabled={!editable} value={r.ghi_chu} onChange={(e) => updateRow(r.key, { ghi_chu: e.target.value })} className={inputCls} />
                    </td>
                    {editable && (
                      <td className="px-2 py-1.5">
                        <button
                          title="Bỏ dòng"
                          onClick={() => {
                            setGrid((g) => g.filter((x) => x.key !== r.key))
                            setDirty(true)
                          }}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td colSpan={5} className="px-2 py-2">
                  Tổng cộng
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtKg(totalKg)}</td>
                <td colSpan={editable ? 2 : 1} className="px-2 py-2 text-xs font-normal text-slate-500">
                  = {fmtKg(totalKg / 1000)} tấn
                </td>
              </tr>
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {delConfirm && (
        <ModalShell
          title="Xoá xuất bù kho"
          onClose={() => setDelConfirm(false)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huỷ
              </button>
              <button
                onClick={() => void handleDeleteDate()}
                disabled={saving}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl disabled:opacity-50"
              >
                Xoá
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá toàn bộ xuất bù ngày <b>{fmtDay(ngay)}</b>? Mẫu 8A tháng đó sẽ không còn cộng số này vào mục 3 (báo cáo đã ký giữ nguyên số cũ).
          </p>
        </ModalShell>
      )}
    </div>
  )
}

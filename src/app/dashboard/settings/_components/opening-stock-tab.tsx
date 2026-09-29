"use client"

// Cài đặt → Cấu hình nhà máy → Tồn đầu kỳ thành phẩm (GĐ6, 2026-09-28).
// Chốt số tồn kiểm kê thực tế tại 1 ngày theo nhóm (Loại CSR + Nguồn gốc + Bọc + Loại bành) — mốc
// tồn cho Báo cáo sản xuất hằng ngày (F12): tồn = tồn chốt + nhập − xuất SAU ngày chốt.
// "Gợi ý từ hệ thống" điền sẵn số hệ thống tự tính tại hết ngày chốt để người dùng sửa theo kiểm kê.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Plus, Save, Trash2, Wand2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { getFreshAuthSession } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import {
  loadOpeningStockOptions,
  loadOpeningStockSuggestion,
  type OpeningStockSuggestion,
} from "@/app/dashboard/product/confirm/daily-report-actions"

type DbRow = {
  id: string
  ngay_chot: string
  loai_csr: string
  nguon_goc: string
  boc: string | null
  loai_banh: number | string
  ton_kg: number | string
  ghi_chu: string | null
}

type GridRow = {
  key: string
  id: string | null
  loai_csr: string
  nguon_goc: string
  boc: string
  loai_banh: string
  ton_kg: string
  ghi_chu: string
}

// Dropdown lọc xếp tầng CSR → Nguồn gốc → Bọc → Loại bành, chỉ gồm tổ hợp có thật trong dữ liệu
// (loadOpeningStockOptions). Giá trị cũ không còn trong danh sách vẫn hiện để không mất dữ liệu.
type Combo = OpeningStockSuggestion
const banhKey = (v: string | number) => String(Math.round((Number(v) || 0) * 100) / 100)
const uniq = (arr: string[]) => [...new Set(arr)]

function optionsFor(combos: Combo[], r: { loai_csr: string; nguon_goc: string; boc: string }) {
  const byCsr = combos.filter((c) => c.loaiCsr === r.loai_csr)
  const byNguon = byCsr.filter((c) => c.nguonGoc === r.nguon_goc)
  const byBoc = byNguon.filter((c) => c.boc === r.boc)
  return {
    csr: uniq(combos.map((c) => c.loaiCsr)),
    nguon: uniq(byCsr.map((c) => c.nguonGoc)),
    boc: uniq(byNguon.map((c) => c.boc)),
    banh: uniq(byBoc.map((c) => banhKey(c.loaiBanh))),
  }
}

// Sau khi đổi 1 cột: cột sau không còn hợp lệ → tự chọn nếu chỉ còn 1 lựa chọn, ngược lại để trống.
function cascade(combos: Combo[], r: GridRow): GridRow {
  const next = { ...r }
  const fix = (field: "nguon_goc" | "boc" | "loai_banh", opts: string[]) => {
    const cur = field === "loai_banh" ? (next.loai_banh ? banhKey(next.loai_banh) : "") : next[field]
    if (opts.includes(cur)) return
    next[field] = opts.length === 1 ? opts[0] : ""
  }
  fix("nguon_goc", optionsFor(combos, next).nguon)
  fix("boc", optionsFor(combos, next).boc)
  fix("loai_banh", optionsFor(combos, next).banh)
  return next
}
let seq = 0
const newKey = () => `r${Date.now()}_${seq++}`

function fromDb(r: DbRow): GridRow {
  return {
    key: newKey(),
    id: r.id,
    loai_csr: r.loai_csr,
    nguon_goc: r.nguon_goc,
    boc: r.boc || "",
    loai_banh: String(Number(r.loai_banh) || ""),
    ton_kg: String(Number(r.ton_kg) || 0),
    ghi_chu: r.ghi_chu || "",
  }
}

const groupKeyOf = (r: { loai_csr: string; nguon_goc: string; boc: string; loai_banh: string | number }) =>
  `${r.loai_csr.trim()}||${r.nguon_goc.trim()}||${r.boc.trim()}||${Math.round((Number(r.loai_banh) || 0) * 100) / 100}`

const fmtDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function OpeningStockTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [allRows, setAllRows] = useState<DbRow[]>([])
  const [loading, setLoading] = useState(true)
  const [ngayChot, setNgayChot] = useState<string>("")
  const [grid, setGrid] = useState<GridRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [delConfirm, setDelConfirm] = useState(false)
  const [combos, setCombos] = useState<Combo[]>([])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      // Phân trang thật: PostgREST cắt 1000 dòng dù xin range lớn hơn.
      let data: DbRow[]
      try {
        data = await fetchAllPaginated<DbRow>((from, to) =>
          supabase
            .from("product_opening_stock")
            .select("id,ngay_chot,loai_csr,nguon_goc,boc,loai_banh,ton_kg,ghi_chu")
            .eq("factory_id", fid)
            .order("ngay_chot", { ascending: false })
            .order("loai_csr", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err))
        return
      }
      setAllRows(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  // Tổ hợp thật cho dropdown — lỗi (vd thiếu quyền) chỉ báo, không chặn xem bảng.
  useEffect(() => {
    if (!factoryId || !canManage) return
    let alive = true
    void (async () => {
      try {
        const session = await getFreshAuthSession()
        const list = await loadOpeningStockOptions(factoryId, session?.access_token ?? null)
        if (alive) setCombos(list)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Không tải được danh sách lựa chọn.")
      }
    })()
    return () => { alive = false }
  }, [factoryId, canManage])

  const dates = useMemo(() => [...new Set(allRows.map((r) => r.ngay_chot))].sort((a, b) => b.localeCompare(a)), [allRows])

  // Mở mốc chốt mới nhất khi có dữ liệu lần đầu.
  useEffect(() => {
    if (!ngayChot && dates.length > 0) setNgayChot(dates[0])
  }, [dates, ngayChot])

  // Nạp lưới theo mốc đang chọn (bỏ thay đổi chưa lưu).
  useEffect(() => {
    setGrid(allRows.filter((r) => r.ngay_chot === ngayChot).map(fromDb))
    setDirty(false)
  }, [allRows, ngayChot])

  const isExistingDate = dates.includes(ngayChot)
  const totalKg = grid.reduce((s, r) => s + (Number(r.ton_kg) || 0), 0)

  const updateRow = (key: string, patch: Partial<GridRow>) => {
    const isGroupField = "loai_csr" in patch || "nguon_goc" in patch || "boc" in patch
    setGrid((g) => g.map((r) => (r.key === key ? (isGroupField ? cascade(combos, { ...r, ...patch }) : { ...r, ...patch }) : r)))
    setDirty(true)
  }

  const addRow = () => {
    const first = combos.length === 1 ? combos[0] : null
    setGrid((g) => [
      ...g,
      cascade(combos, {
        key: newKey(),
        id: null,
        loai_csr: first?.loaiCsr ?? (uniq(combos.map((c) => c.loaiCsr)).length === 1 ? combos[0].loaiCsr : ""),
        nguon_goc: "",
        boc: "",
        loai_banh: "",
        ton_kg: "0",
        ghi_chu: "",
      }),
    ])
    setDirty(true)
  }

  const handleSuggest = async () => {
    if (!factoryId || !ngayChot) return
    setSuggesting(true)
    setError("")
    setInfo("")
    try {
      const session = await getFreshAuthSession()
      const suggestions = await loadOpeningStockSuggestion(factoryId, ngayChot, session?.access_token ?? null)
      // Giữ id + ghi chú của dòng đã có cùng nhóm; nhóm không còn trong gợi ý vẫn giữ lại để người
      // dùng tự quyết (có thể là hàng kiểm kê thấy nhưng hệ thống không có).
      setGrid((prev) => {
        const byKey = new Map(prev.map((r) => [groupKeyOf(r), r]))
        const next: GridRow[] = []
        for (const s of suggestions) {
          const k = groupKeyOf({ loai_csr: s.loaiCsr, nguon_goc: s.nguonGoc, boc: s.boc, loai_banh: s.loaiBanh })
          const old = byKey.get(k)
          byKey.delete(k)
          next.push({
            key: old?.key || newKey(),
            id: old?.id ?? null,
            loai_csr: s.loaiCsr,
            nguon_goc: s.nguonGoc,
            boc: s.boc,
            loai_banh: String(s.loaiBanh),
            ton_kg: String(s.tonKg),
            ghi_chu: old?.ghi_chu || "",
          })
        }
        return [...next, ...byKey.values()]
      })
      setDirty(true)
      setInfo(`Đã điền ${suggestions.length} nhóm theo số hệ thống tự tính tới hết ngày ${fmtDay(ngayChot)}. Sửa lại theo số kiểm kê rồi bấm Lưu.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lấy được gợi ý.")
    } finally {
      setSuggesting(false)
    }
  }

  const handleSave = async () => {
    if (!factoryId || !ngayChot) return
    setError("")
    setInfo("")
    // Kiểm tra dữ liệu lưới.
    const seen = new Set<string>()
    for (const [i, r] of grid.entries()) {
      if (!r.loai_csr.trim()) { setError(`Dòng ${i + 1}: thiếu Loại CSR.`); return }
      if (!r.nguon_goc.trim()) { setError(`Dòng ${i + 1}: thiếu Nguồn gốc.`); return }
      if (!(Number(r.loai_banh) > 0)) { setError(`Dòng ${i + 1}: Loại bành phải > 0.`); return }
      if (!Number.isFinite(Number(r.ton_kg))) { setError(`Dòng ${i + 1}: Tồn kg không hợp lệ.`); return }
      const k = groupKeyOf(r)
      if (seen.has(k)) { setError(`Dòng ${i + 1}: trùng nhóm với dòng khác (CSR + nguồn + bọc + loại bành).`); return }
      seen.add(k)
    }
    setSaving(true)
    try {
      const session = await getFreshAuthSession()
      const payload = grid.map((r) => ({
        factory_id: factoryId,
        ngay_chot: ngayChot,
        loai_csr: r.loai_csr.trim(),
        nguon_goc: r.nguon_goc.trim(),
        boc: r.boc.trim(),
        loai_banh: Number(r.loai_banh),
        ton_kg: Math.round(Number(r.ton_kg) * 100) / 100,
        ghi_chu: r.ghi_chu.trim() || null,
        created_by: session?.user?.id ?? null,
      }))
      // Upsert trước, xóa dòng thừa sau — lỗi giữa chừng không làm mất số chốt cũ.
      if (payload.length > 0) {
        const { error: upErr } = await supabase
          .from("product_opening_stock")
          .upsert(payload, { onConflict: "factory_id,ngay_chot,loai_csr,nguon_goc,boc,loai_banh" })
        if (upErr) { setError(upErr.message); return }
      }
      const keep = new Set(grid.map(groupKeyOf))
      const stale = allRows
        .filter((r) => r.ngay_chot === ngayChot)
        .filter((r) => !keep.has(groupKeyOf({ loai_csr: r.loai_csr, nguon_goc: r.nguon_goc, boc: r.boc || "", loai_banh: r.loai_banh })))
        .map((r) => r.id)
      if (stale.length > 0) {
        const { error: delErr } = await supabase.from("product_opening_stock").delete().in("id", stale)
        if (delErr) { setError(delErr.message); return }
      }
      setInfo(`Đã lưu mốc chốt ${fmtDay(ngayChot)} (${payload.length} nhóm).`)
      void loadData(factoryId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDate = async () => {
    if (!factoryId || !ngayChot) return
    setSaving(true)
    setError("")
    try {
      const { error: delErr } = await supabase
        .from("product_opening_stock")
        .delete()
        .eq("factory_id", factoryId)
        .eq("ngay_chot", ngayChot)
      if (delErr) { setError(delErr.message); return }
      setDelConfirm(false)
      setNgayChot("")
      setInfo(`Đã xóa mốc chốt ${fmtDay(ngayChot)}.`)
      void loadData(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        Số tồn kiểm kê thực tế tại <b>hết ngày chốt</b>. Báo cáo sản xuất hằng ngày (F12) dùng mốc chốt gần nhất
        trước ngày báo cáo: <b>tồn = tồn chốt + nhập − xuất sau ngày chốt</b>. Chưa có mốc chốt thì F12 tự tính từ
        toàn bộ dữ liệu.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày chốt</label>
          <input
            type="date"
            value={ngayChot}
            max={getFactoryTodayISO()}
            onChange={(e) => {
              if (dirty && !window.confirm("Bỏ các thay đổi chưa lưu?")) return
              setNgayChot(e.target.value)
            }}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
          />
        </div>
        {dates.length > 0 && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Mốc đã chốt</label>
            <select
              value={isExistingDate ? ngayChot : ""}
              onChange={(e) => {
                if (!e.target.value) return
                if (dirty && !window.confirm("Bỏ các thay đổi chưa lưu?")) return
                setNgayChot(e.target.value)
              }}
              className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
            >
              <option value="">— Chọn —</option>
              {dates.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
            </select>
          </div>
        )}
        {canManage && ngayChot && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleSuggest()}
              disabled={suggesting || saving}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-xl disabled:opacity-50"
            >
              <Wand2 size={14} /> {suggesting ? "Đang tính..." : "Gợi ý từ hệ thống"}
            </button>
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl"
            >
              <Plus size={14} /> Thêm dòng
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
            >
              <Save size={14} /> {saving ? "Đang lưu..." : "Lưu mốc chốt"}
            </button>
            {isExistingDate && (
              <button
                onClick={() => setDelConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl"
              >
                <Trash2 size={14} /> Xóa mốc này
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}><X size={14} /></button>
        </div>
      )}
      {info && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{info}</div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-400">Đang tải...</div>
      ) : !ngayChot ? (
        <div className="p-8 text-center text-slate-400">Chọn ngày chốt để nhập tồn đầu kỳ.</div>
      ) : grid.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          Chưa có dòng tồn nào cho ngày {fmtDay(ngayChot)}. Bấm &quot;Gợi ý từ hệ thống&quot; để điền sẵn.
        </div>
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
                <th className="px-2 py-2 text-right w-32">Tồn (kg)</th>
                <th className="px-2 py-2 text-left">Ghi chú</th>
                {canManage && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {grid.map((r, i) => {
                const opts = optionsFor(combos, r)
                const pick = (
                  field: "loai_csr" | "nguon_goc" | "boc" | "loai_banh",
                  list: string[],
                  label: (v: string) => string = (v) => v || "(không bọc)",
                ) => {
                  const cur = field === "loai_banh" ? (r.loai_banh ? banhKey(r.loai_banh) : "") : r[field]
                  const legacy = cur !== "" && !list.includes(cur)
                  return (
                    <select
                      disabled={!canManage}
                      value={cur}
                      onChange={(e) => updateRow(r.key, { [field]: e.target.value } as Partial<GridRow>)}
                      className={inputCls + (legacy ? " border-amber-400 bg-amber-50" : "")}
                    >
                      <option value="">— Chọn —</option>
                      {legacy && <option value={cur}>{label(cur)} (giá trị cũ)</option>}
                      {list.map((v) => <option key={v} value={v}>{label(v)}</option>)}
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
                      disabled={!canManage}
                      type="number"
                      step="0.01"
                      value={r.ton_kg}
                      onChange={(e) => updateRow(r.key, { ton_kg: e.target.value })}
                      className={inputCls + " text-right" + (Number(r.ton_kg) < 0 ? " text-red-600" : "")}
                    />
                  </td>
                  <td className="px-2 py-1.5"><input disabled={!canManage} value={r.ghi_chu} onChange={(e) => updateRow(r.key, { ghi_chu: e.target.value })} className={inputCls} /></td>
                  {canManage && (
                    <td className="px-2 py-1.5">
                      <button
                        title="Bỏ dòng"
                        onClick={() => { setGrid((g) => g.filter((x) => x.key !== r.key)); setDirty(true) }}
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
                <td colSpan={5} className="px-2 py-2">Tổng cộng</td>
                <td className={"px-2 py-2 text-right" + (totalKg < 0 ? " text-red-600" : "")}>
                  {totalKg.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                </td>
                <td colSpan={canManage ? 2 : 1} />
              </tr>
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {delConfirm && (
        <ModalShell
          title="Xóa mốc chốt tồn"
          onClose={() => setDelConfirm(false)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button
                onClick={() => void handleDeleteDate()}
                disabled={saving}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl disabled:opacity-50"
              >
                Xóa
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa toàn bộ số tồn chốt ngày <b>{fmtDay(ngayChot)}</b>? Báo cáo F12 từ ngày này trở đi sẽ dùng mốc chốt
            trước đó (hoặc tự tính nếu không còn mốc nào).
          </p>
        </ModalShell>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle, ChevronLeft, ClipboardCheck, Eye, Plus,
  Printer, Trash2, X, ImageIcon, Upload,
} from "lucide-react"
import { getActiveFactoryId } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { isProductSelectableStorageStatus } from "@/lib/storage-status"
import { ProcessShell } from "../_components/process-shell"
import {
  type QuickMeasurementSheet, type QuickMeasurementRow, type MeasurementRowDraft,
  CHI_TIEU_BY_CSR, ALL_CSR_TYPES, CSR_BY_DAY_CHUYEN, CA_SX_OPTIONS,
  getMaPhieuPrefix, formatDdMmYy, calcSoNgayLuu, emptyMeasurementRow,
} from "../_components/process-types"

type NganItem = {
  id: string
  ten_ngan: string
  ma_ngan: string
  tong_kho: number
  trang_thai: string
  ngay_bd: string
  loai_nl: string
}

type SheetWithRows = QuickMeasurementSheet & { rows: QuickMeasurementRow[] }

type ViewMode = "list" | "create" | "view"

function formatDate(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function getMaPhieuPreview(day_chuyen: string, ngay: string, count: number) {
  if (!ngay) return ""
  const prefix = getMaPhieuPrefix(day_chuyen)
  return `${prefix}-${formatDdMmYy(ngay)}/${String(count).padStart(3, "0")}`
}

function fmtCheDo(t1: number | null, t2: number | null, tg: number | null): string {
  const parts = [t1, t2, tg].map(n => n != null ? String(n).replace(".", ",") : "")
  if (parts.every(p => p === "")) return ""
  return parts.join("-")
}

export default function MeasurementsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetWithRows[]>([])
  const [loading, setLoading] = useState(true)
  const [ngans, setNgans] = useState<NganItem[]>([])
  const [currentUserName, setCurrentUserName] = useState("")

  // filters
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterDayChuyen, setFilterDayChuyen] = useState("")

  // view
  const [view, setView] = useState<ViewMode>("list")
  const [selected, setSelected] = useState<SheetWithRows | null>(null)

  // create form
  const [formNgay, setFormNgay] = useState(new Date().toISOString().slice(0, 10))
  const [formDayChuyen, setFormDayChuyen] = useState("")
  const [formLoaiCsr, setFormLoaiCsr] = useState("")
  const [defaultCheDo, setDefaultCheDo] = useState("")
  const [rows, setRows] = useState<MeasurementRowDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nextCount, setNextCount] = useState(1)

  const [uploadingRowId, setUploadingRowId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<string | null>(null)

  // Load sheets
  const loadSheets = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let q = supabase
        .from("quick_measurements")
        .select("*, rows:quick_measurement_rows(*)")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
        .order("created_at", { ascending: false })

      if (filterFrom) q = q.gte("ngay", filterFrom)
      if (filterTo) q = q.lte("ngay", filterTo)
      if (filterDayChuyen) q = q.eq("day_chuyen", filterDayChuyen)

      const { data } = await q
      setSheets((data as SheetWithRows[]) || [])
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo, filterDayChuyen])

  const loadNgans = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("ngans")
      .select("id,ten_ngan,ma_ngan,tong_kho,trang_thai,ngay_bd,loai_nl")
      .eq("factory_id", fid)
    setNgans((data as NganItem[]) || [])
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      try {
        const stored = JSON.parse(localStorage.getItem("erp_user") || "{}")
        if (stored.full_name) setCurrentUserName(stored.full_name)
        else if (stored.username) setCurrentUserName(stored.username)
      } catch { /* ignore */ }
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) {
      void loadSheets(factoryId)
      void loadNgans(factoryId)
    }
  }, [factoryId, loadSheets, loadNgans])

  // Load next phiếu count
  useEffect(() => {
    if (!factoryId || !formNgay || !formDayChuyen) { setNextCount(1); return }
    const prefix = getMaPhieuPrefix(formDayChuyen)
    const loadCount = async () => {
      const { data } = await supabase
        .from("quick_measurements")
        .select("ma_phieu")
        .eq("factory_id", factoryId)
        .eq("ngay", formNgay)
        .like("ma_phieu", `${prefix}-${formatDdMmYy(formNgay)}/%`)
      setNextCount((data?.length || 0) + 1)
    }
    void loadCount()
  }, [factoryId, formNgay, formDayChuyen])

  // Lấy chế độ sấy mặc định từ process_params gần nhất
  useEffect(() => {
    if (!factoryId || !formDayChuyen || !formLoaiCsr) { setDefaultCheDo(""); return }
    const fetchCheDo = async () => {
      const { data } = await supabase
        .from("process_params")
        .select("nhiet_do_dau_1, nhiet_do_dau_2, thoi_gian_say")
        .eq("factory_id", factoryId)
        .eq("day_chuyen", formDayChuyen)
        .eq("loai_csr", formLoaiCsr)
        .order("ngay", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        const p = data[0] as { nhiet_do_dau_1: number | null; nhiet_do_dau_2: number | null; thoi_gian_say: number | null }
        setDefaultCheDo(fmtCheDo(p.nhiet_do_dau_1, p.nhiet_do_dau_2, p.thoi_gian_say))
      } else {
        setDefaultCheDo("")
      }
    }
    void fetchCheDo()
  }, [factoryId, formDayChuyen, formLoaiCsr])

  // Auto-fill chế độ sấy vào dòng còn trống
  useEffect(() => {
    if (!defaultCheDo) return
    setRows(prev => prev.map(row =>
      row.che_do_say === "" ? { ...row, che_do_say: defaultCheDo } : row
    ))
  }, [defaultCheDo])

  const selectableNgans = ngans.filter(n =>
    isProductSelectableStorageStatus(n.trang_thai) && Number(n.tong_kho || 0) > 0
  )

  const openCreate = () => {
    setFormNgay(new Date().toISOString().slice(0, 10))
    setFormDayChuyen("")
    setFormLoaiCsr("")
    setDefaultCheDo("")
    setRows([emptyMeasurementRow(currentUserName)])
    setSaveError(null)
    setView("create")
  }

  const openView = async (sheet: SheetWithRows) => {
    // reload rows
    const { data } = await supabase
      .from("quick_measurement_rows")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("sort_order")
    setSelected({ ...sheet, rows: (data as QuickMeasurementRow[]) || [] })
    setView("view")
  }

  const addRow = () => {
    setRows(r => [...r, emptyMeasurementRow(currentUserName, defaultCheDo)])
  }

  const removeRow = (id: string) => {
    setRows(r => r.filter(row => row.id !== id))
  }

  const updateRow = (id: string, patch: Partial<MeasurementRowDraft>) => {
    setRows(prev => prev.map(row => {
      if (row.id !== id) return row
      const next = { ...row, ...patch }
      // auto-calc so_ngay_luu if ngan changes
      if (patch.ngan_id !== undefined) {
        const ngan = ngans.find(n => n.id === patch.ngan_id)
        next.so_ngay_luu = ngan?.ngay_bd ? calcSoNgayLuu(formNgay, ngan.ngay_bd) : null
      }
      // clear ket_qua keys not in chi_tieu
      if (patch.chi_tieu !== undefined) {
        const newKQ: Record<string, string> = {}
        patch.chi_tieu.forEach(ct => {
          newKQ[ct] = next.ket_qua[ct] || ""
        })
        next.ket_qua = newKQ
      }
      return next
    }))
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!formNgay) { setSaveError("Vui lòng chọn ngày."); return }
    if (rows.length === 0) { setSaveError("Cần ít nhất 1 dòng đo."); return }

    setSaving(true)
    setSaveError(null)
    try {
      const maPhieu = getMaPhieuPreview(formDayChuyen, formNgay, nextCount)

      const { data: sheetData, error: sheetErr } = await supabase
        .from("quick_measurements")
        .insert({
          factory_id: factoryId,
          ma_phieu: maPhieu,
          ngay: formNgay,
          day_chuyen: formDayChuyen || null,
          chung_loai: formDayChuyen || null,
          loai_csr: formLoaiCsr || null,
        })
        .select("id")
        .single()

      if (sheetErr || !sheetData) {
        setSaveError(sheetErr?.message || "Lỗi tạo phiếu")
        return
      }

      const sheetId = sheetData.id
      const rowPayloads = rows.map((row, i) => ({
        sheet_id: sheetId,
        factory_id: factoryId,
        so_mau: i + 1,
        chi_tieu: row.chi_tieu,
        thung: row.thung || null,
        lo: row.lo || null,
        mau: row.mau || null,
        che_do_say: row.che_do_say || null,
        ca_sx: row.ca_sx || null,
        ngan_id: row.ngan_id || null,
        so_ngay_luu: row.so_ngay_luu,
        ket_qua: Object.fromEntries(
          Object.entries(row.ket_qua).map(([k, v]) => [k, v === "" ? null : Number(v)])
        ),
        image_urls: row.image_urls,
        nguoi_do: row.nguoi_do || null,
        ghi_chu: row.ghi_chu || null,
        sort_order: i,
      }))

      const { error: rowsErr } = await supabase.from("quick_measurement_rows").insert(rowPayloads)
      if (rowsErr) { setSaveError(rowsErr.message); return }

      setView("list")
      void loadSheets(factoryId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSheet = async (id: string) => {
    if (!factoryId) return
    await supabase.from("quick_measurements").delete().eq("id", id)
    void loadSheets(factoryId)
  }

  const handleImageUpload = async (files: FileList, rowId: string) => {
    if (!factoryId || !files.length) return
    setUploadingRowId(rowId)
    try {
      const newUrls: string[] = []
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()
        const path = `${factoryId}/process/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
        if (!error) {
          const { data: urlData } = supabase.storage.from("order-files").getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }
      }
      if (newUrls.length) {
        updateRow(rowId, {
          image_urls: [...(rows.find(r => r.id === rowId)?.image_urls || []), ...newUrls].slice(0, 6)
        })
      }
    } finally {
      setUploadingRowId(null)
    }
  }

  const chiTieuForCsr = formLoaiCsr ? (CHI_TIEU_BY_CSR[formLoaiCsr] || []) : []

  // ── RENDER ──────────────────────────────────────────────────────────────────

  if (view === "view" && selected) {
    return (
      <ProcessShell>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setView("list")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
            <ChevronLeft size={16} /> Quay lại
          </button>
          <h2 className="text-xl font-extrabold text-slate-800">{selected.ma_phieu}</h2>
          <a
            href={`/dashboard/process/print?sheetId=${selected.id}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition-all text-sm"
          >
            <Printer size={14} /> Xuất phiếu PDF
          </a>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Ngày đo</span>
              <span className="font-bold text-slate-800">{formatDate(selected.ngay)}</span>
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Dây chuyền</span>
              <span className="font-bold text-slate-800">{selected.day_chuyen || "—"}</span>
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Loại CSR</span>
              <span className="font-bold text-slate-800">{selected.loai_csr || "—"}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-center px-3 py-3 font-bold text-slate-600 w-10">STT</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Chỉ tiêu / Thùng-Lô-Mẫu</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Chế độ sấy</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Kết quả</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Ca SX</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Ngăn / Ngày lưu</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Người đo</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Hình ảnh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.rows.map((row, i) => {
                  const ngan = ngans.find(n => n.id === row.ngan_id)
                  const kq = row.ket_qua as Record<string, number | null>
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 text-center text-slate-500">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800">
                          {row.chi_tieu?.join(", ") || "—"}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[row.thung, row.lo, row.mau].filter(Boolean).join(" / ") || ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.che_do_say || "—"}</td>
                      <td className="px-3 py-3">
                        {Object.entries(kq).filter(([, v]) => v != null).map(([k, v]) => (
                          <div key={k} className="text-sm">
                            <span className="text-slate-500">{k}:</span>{" "}
                            <span className="font-mono font-bold text-slate-800">{v}</span>
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.ca_sx || "—"}</td>
                      <td className="px-3 py-3 text-sm">
                        {ngan ? (
                          <div>
                            <div className="font-semibold text-slate-700">{ngan.ma_ngan} – {ngan.ten_ngan}</div>
                            {row.so_ngay_luu != null && (
                              <div className="text-xs text-slate-500">{row.so_ngay_luu} ngày lưu</div>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.nguoi_do || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(row.image_urls || []).map((url, j) => (
                            <a key={j} href={url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Ảnh ${j + 1}`} className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </ProcessShell>
    )
  }

  if (view === "create") {
    return (
      <ProcessShell>
        {saveError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm font-bold">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setView("list")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            <ChevronLeft size={16} /> Quay lại
          </button>
          <h2 className="text-xl font-extrabold text-slate-800">Tạo phiếu đo nhanh</h2>
          {formNgay && formDayChuyen && (
            <span className="ml-2 px-3 py-1 bg-teal-50 border border-teal-200 text-teal-700 font-mono text-sm font-bold rounded-xl">
              {getMaPhieuPreview(formDayChuyen, formNgay, nextCount)}
            </span>
          )}
        </div>

        {/* Header form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-4">Thông tin phiếu</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày <span className="text-red-500">*</span></label>
              <input type="date" value={formNgay} onChange={e => setFormNgay(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Dây chuyền</label>
              <select value={formDayChuyen}
                onChange={e => { setFormDayChuyen(e.target.value); setFormLoaiCsr("") }}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                <option value="">— Chọn —</option>
                <option value="Mủ tạp">Mủ tạp</option>
                <option value="Mủ nước">Mủ nước</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR</label>
              <select value={formLoaiCsr} onChange={e => setFormLoaiCsr(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                <option value="">— Chọn —</option>
                {(CSR_BY_DAY_CHUYEN[formDayChuyen] ?? ALL_CSR_TYPES).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Row form */}
        <div className="space-y-4 mb-4">
          {rows.map((row, i) => (
            <MeasurementRowForm
              key={row.id}
              row={row}
              index={i}
              chiTieuOptions={chiTieuForCsr}
              selectableNgans={selectableNgans}
              isMatTap={formDayChuyen === "Mủ tạp"}
              ngay={formNgay}
              uploadingRowId={uploadingRowId}
              fileInputRef={fileInputRef}
              activeRowRef={activeRowRef}
              onChange={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
              onPickImage={() => {
                activeRowRef.current = row.id
                fileInputRef.current?.click()
              }}
            />
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files && activeRowRef.current) {
              void handleImageUpload(e.target.files, activeRowRef.current)
              e.target.value = ""
            }
          }}
        />

        <div className="flex items-center gap-3">
          <button onClick={addRow}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all text-sm">
            <Plus size={14} /> Thêm dòng
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all">
            {saving ? "Đang lưu..." : "Lưu phiếu"}
          </button>
        </div>
      </ProcessShell>
    )
  }

  // LIST VIEW
  return (
    <ProcessShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Đo nhanh chỉ tiêu</h1>
          <p className="text-sm text-slate-500 mt-0.5">Phiếu đo Po, Mooney tại dây chuyền</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-md transition-all">
          <Plus size={16} /> Tạo phiếu mới
        </button>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Từ ngày</label>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Đến ngày</label>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Dây chuyền</label>
          <select value={filterDayChuyen} onChange={e => setFilterDayChuyen(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
            <option value="">Tất cả</option>
            <option value="Mủ tạp">Mủ tạp</option>
            <option value="Mủ nước">Mủ nước</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : sheets.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p>Chưa có phiếu đo nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Mã phiếu</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Ngày</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Dây chuyền</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Dây chuyền / CSR</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-600">Số dòng</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map(sheet => (
                  <tr key={sheet.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-teal-700">{sheet.ma_phieu || "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{formatDate(sheet.ngay)}</td>
                    <td className="px-4 py-3 text-slate-600">{sheet.day_chuyen || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {sheet.day_chuyen || "—"}
                      {sheet.loai_csr && <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">{sheet.loai_csr}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                        {sheet.rows?.length || 0} mẫu
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openView(sheet)}
                          className="p-1.5 hover:bg-teal-50 text-slate-400 hover:text-teal-600 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        <a
                          href={`/dashboard/process/print?sheetId=${sheet.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                        >
                          <Printer size={14} />
                        </a>
                        <button onClick={() => handleDeleteSheet(sheet.id)}
                          className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessShell>
  )
}

// ── Sub-component: dòng đo ────────────────────────────────────────────────────

type MeasurementRowFormProps = {
  row: MeasurementRowDraft
  index: number
  chiTieuOptions: string[]
  selectableNgans: NganItem[]
  isMatTap: boolean
  ngay: string
  uploadingRowId: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  activeRowRef: React.MutableRefObject<string | null>
  onChange: (patch: Partial<MeasurementRowDraft>) => void
  onRemove: () => void
  onPickImage: () => void
}

function MeasurementRowForm({
  row, index, chiTieuOptions, selectableNgans, isMatTap,
  uploadingRowId, onChange, onRemove, onPickImage
}: MeasurementRowFormProps) {
  const toggleCT = (ct: string) => {
    const current = row.chi_tieu || []
    const next = current.includes(ct)
      ? current.filter(c => c !== ct)
      : [...current, ct]
    onChange({ chi_tieu: next })
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-teal-50 border-b border-teal-100">
        <span className="text-sm font-extrabold text-teal-700">Mẫu #{index + 1}</span>
        <button onClick={onRemove} className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="p-5 space-y-4">
        {/* Row 1: chi_tieu + thung/lo/mau */}
        <div className="flex flex-wrap gap-4 items-start">
          <div className="min-w-[160px]">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chỉ tiêu</label>
            {chiTieuOptions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {chiTieuOptions.map(ct => (
                  <button key={ct} type="button"
                    onClick={() => toggleCT(ct)}
                    className={
                      "px-3 py-1 rounded-lg text-sm font-bold border transition-all " +
                      (row.chi_tieu.includes(ct)
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-teal-400")
                    }
                  >
                    {ct}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-slate-400">Chọn loại CSR ở trên</span>
            )}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Thùng</label>
            <input value={row.thung} onChange={e => onChange({ thung: e.target.value })}
              placeholder="Số thùng" className="w-24 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Lô</label>
            <input value={row.lo} onChange={e => onChange({ lo: e.target.value })}
              placeholder="Số lô" className="w-24 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Mẫu</label>
            <input value={row.mau} onChange={e => onChange({ mau: e.target.value })}
              placeholder="Số mẫu" className="w-24 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chế độ sấy</label>
            <input value={row.che_do_say} onChange={e => onChange({ che_do_say: e.target.value })}
              placeholder="122-119-9.5" className="w-36 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ca SX</label>
            <select value={row.ca_sx} onChange={e => onChange({ ca_sx: e.target.value })}
              className="px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
              <option value="">—</option>
              {CA_SX_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: ket_qua + ngan (if mat tap) */}
        <div className="flex flex-wrap gap-4 items-start">
          {row.chi_tieu.map(ct => (
            <div key={ct}>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Kết quả {ct}</label>
              <input type="number" step="0.1"
                value={row.ket_qua[ct] || ""}
                onChange={e => onChange({ ket_qua: { ...row.ket_qua, [ct]: e.target.value } })}
                placeholder={`${ct}...`}
                className="w-24 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
            </div>
          ))}
          {isMatTap && (
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngăn lưu (Mủ tạp)</label>
              <select value={row.ngan_id} onChange={e => onChange({ ngan_id: e.target.value })}
                className="px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                <option value="">— Chọn ngăn —</option>
                {selectableNgans.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.ma_ngan} – {n.ten_ngan}
                  </option>
                ))}
              </select>
              {row.ngan_id && row.so_ngay_luu != null && (
                <span className="text-xs text-teal-600 font-bold mt-1 block">{row.so_ngay_luu} ngày lưu</span>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Người đo</label>
            <input value={row.nguoi_do} onChange={e => onChange({ nguoi_do: e.target.value })}
              placeholder="Tên người đo" className="w-36 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
            <input value={row.ghi_chu} onChange={e => onChange({ ghi_chu: e.target.value })}
              placeholder="Ghi chú..." className="w-48 px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
        </div>

        {/* Row 3: images */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Hình ảnh (tối đa 6)</label>
          <div className="flex flex-wrap gap-2 items-center">
            {row.image_urls.map((url, j) => (
              <div key={j} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Ảnh ${j + 1}`} className="w-14 h-14 object-cover rounded-xl border border-slate-200" />
                <button
                  onClick={() => onChange({ image_urls: row.image_urls.filter((_, k) => k !== j) })}
                  className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {row.image_urls.length < 6 && (
              <button
                onClick={onPickImage}
                disabled={uploadingRowId === row.id}
                className="w-14 h-14 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-teal-400 rounded-xl text-slate-400 hover:text-teal-500 transition-all disabled:opacity-50"
              >
                {uploadingRowId === row.id ? (
                  <Upload size={14} className="animate-pulse" />
                ) : (
                  <ImageIcon size={14} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

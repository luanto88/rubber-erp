"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Plus, Thermometer, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { ProcessShell } from "../_components/process-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import {
  type ProcessParam,
  type CheDoRow,
  emptyProcessParamForm,
  type EmptyProcessParamForm,
  ALL_CSR_TYPES,
  CSR_BY_DAY_CHUYEN,
  resolveCheDoSuggestion,
} from "../_components/process-types"

const DAY_CHUYEN_OPTIONS = ["Mủ tạp", "Mủ nước"]

function formatDate(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function formatDateTime(d: string) {
  const dt = new Date(d)
  return dt.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
}

export default function ProcessParamsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [items, setItems] = useState<ProcessParam[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // filters
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterDayChuyen, setFilterDayChuyen] = useState("")

  // modal
  const [modal, setModal] = useState<"add" | "edit" | null>(null)
  const [form, setForm] = useState<EmptyProcessParamForm>(emptyProcessParamForm())
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [cheDoWarning, setCheDoWarning] = useState<string | null>(null)
  // Chỉ tự điền nhiệt độ/thời gian khi thêm mới hoặc khi người dùng TỰ đổi Dây chuyền/CSR trong form.
  // Mở "Sửa" không được ghi đè số liệu của chính bản ghi đang sửa bằng bản ghi khác.
  const autoFillArmed = useRef(false)

  // admin luôn qua (hasPermission tự return true cho role admin)
  const canCreate = hasPermission(currentUser, "process.create")
  const canEdit = hasPermission(currentUser, "process.edit")
  const canDelete = hasPermission(currentUser, "process.delete")

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchAllPaginated<ProcessParam>((from, to) => {
        let q = supabase
          .from("process_params")
          .select("*")
          .eq("factory_id", fid)
          .order("ngay", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
        if (filterFrom) q = q.gte("ngay", filterFrom)
        if (filterTo) q = q.lte("ngay", filterTo)
        if (filterDayChuyen) q = q.eq("day_chuyen", filterDayChuyen)
        return q.range(from, to)
      })
      setItems(data)
    } catch (err) {
      setItems([])
      setLoadError((err as { message?: string } | null)?.message || "Không tải được dữ liệu thông số")
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo, filterDayChuyen])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) { setLoading(false); return }
      if (!hasPermission(sessionUser, "process.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setCurrentUser(sessionUser)
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  // Auto-fill thông số từ lần nhập gần nhất khi chọn dây chuyền + loại CSR.
  // Chạy song song 2 query (khớp đúng CSR + mới nhất bất kể CSR) vì loai_csr là cột optional,
  // bản ghi mới nhất có thể bị bỏ sót nếu chỉ lọc cứng theo CSR đang chọn.
  useEffect(() => {
    if (!modal || !factoryId || !form.day_chuyen) { setCheDoWarning(null); return }
    const fetchLast = async () => {
      const selectCols = "nhiet_do_dau_1, nhiet_do_dau_2, thoi_gian_say, ngay, created_at, loai_csr"

      let csrQuery = form.loai_csr
        ? supabase.from("process_params").select(selectCols)
            .eq("factory_id", factoryId).eq("day_chuyen", form.day_chuyen).eq("loai_csr", form.loai_csr)
            .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1)
        : null
      if (csrQuery && editId) csrQuery = csrQuery.neq("id", editId)

      let anyQuery = supabase.from("process_params").select(selectCols)
        .eq("factory_id", factoryId).eq("day_chuyen", form.day_chuyen)
        .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1)
      if (editId) anyQuery = anyQuery.neq("id", editId)

      const [csrRes, anyRes] = await Promise.all([
        csrQuery ?? Promise.resolve({ data: null as CheDoRow[] | null }),
        anyQuery,
      ])
      const csrMatch = (csrRes.data?.[0] as CheDoRow | undefined) ?? null
      const latestAny = (anyRes.data?.[0] as CheDoRow | undefined) ?? null

      const applyRow = (row: CheDoRow | null) => {
        if (!row) return
        setForm(f => ({
          ...f,
          nhiet_do_dau_1: row.nhiet_do_dau_1 != null ? String(row.nhiet_do_dau_1) : f.nhiet_do_dau_1,
          nhiet_do_dau_2: row.nhiet_do_dau_2 != null ? String(row.nhiet_do_dau_2) : f.nhiet_do_dau_2,
          thoi_gian_say: row.thoi_gian_say != null ? String(row.thoi_gian_say) : f.thoi_gian_say,
        }))
      }

      if (!autoFillArmed.current) {
        // Đang sửa và người dùng chưa đổi Dây chuyền/CSR: chỉ hiện cảnh báo, không ghi đè số liệu.
        setCheDoWarning(form.loai_csr ? resolveCheDoSuggestion(csrMatch, latestAny, form.loai_csr, formatDate).warning : null)
        return
      }
      if (!form.loai_csr) {
        applyRow(latestAny)
        setCheDoWarning(null)
        return
      }
      const { row, warning } = resolveCheDoSuggestion(csrMatch, latestAny, form.loai_csr, formatDate)
      applyRow(row)
      setCheDoWarning(warning)
    }
    void fetchLast()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.day_chuyen, form.loai_csr, modal])

  const openAdd = () => {
    autoFillArmed.current = true
    setForm(emptyProcessParamForm())
    setEditId(null)
    setSaveError(null)
    setModal("add")
  }

  const openEdit = (item: ProcessParam) => {
    autoFillArmed.current = false
    setForm({
      ngay: item.ngay,
      day_chuyen: item.day_chuyen,
      loai_csr: item.loai_csr || "",
      nhiet_do_dau_1: item.nhiet_do_dau_1 != null ? String(item.nhiet_do_dau_1) : "",
      nhiet_do_dau_2: item.nhiet_do_dau_2 != null ? String(item.nhiet_do_dau_2) : "",
      thoi_gian_say: item.thoi_gian_say != null ? String(item.thoi_gian_say) : "",
      ghi_chu: item.ghi_chu || "",
    })
    setEditId(item.id)
    setSaveError(null)
    setModal("edit")
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (editId ? !canEdit : !canCreate) { setSaveError("Bạn không có quyền thực hiện thao tác này."); return }
    if (!form.day_chuyen) { setSaveError("Vui lòng chọn dây chuyền."); return }
    if (!form.loai_csr) { setSaveError("Vui lòng chọn Loại CSR."); return }
    setSaving(true)
    setSaveError(null)
    const payload = {
      factory_id: factoryId,
      ngay: form.ngay,
      day_chuyen: form.day_chuyen,
      loai_csr: form.loai_csr || null,
      nhiet_do_dau_1: form.nhiet_do_dau_1 ? Number(form.nhiet_do_dau_1) : null,
      nhiet_do_dau_2: form.nhiet_do_dau_2 ? Number(form.nhiet_do_dau_2) : null,
      thoi_gian_say: form.thoi_gian_say ? Number(form.thoi_gian_say) : null,
      ghi_chu: form.ghi_chu || null,
    }
    try {
      if (editId) {
        const { error } = await supabase.from("process_params").update(payload).eq("id", editId)
        if (error) { setSaveError(error.message); return }
      } else {
        const { error } = await supabase.from("process_params").insert(payload)
        if (error) { setSaveError(error.message); return }
      }
      setModal(null)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!factoryId || deleting) return
    if (!canDelete) { setSaveError("Bạn không có quyền xóa thông số."); return }
    setDeleting(true)
    try {
      const { error } = await supabase.from("process_params").delete().eq("id", id).eq("factory_id", factoryId)
      if (error) { setSaveError(error.message); return }
      setDelConfirm(null)
      void loadData(factoryId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setDeleting(false)
    }
  }

  const fieldCls = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600"
  const filterCount = [filterFrom, filterTo, filterDayChuyen].filter(Boolean).length

  return (
    <ProcessShell
      banner={
        <PageHeaderBanner
          title="Thông số kỹ thuật"
          subtitle="Nhiệt độ và thời gian sấy theo dây chuyền"
          theme="teal"
          icon={Thermometer}
          action={canCreate ? (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-teal-700 shadow-sm transition-colors hover:bg-teal-50"
            >
              <Plus size={16} /> Thêm mới
            </button>
          ) : undefined}
        />
      }
    >
      {/* Save error toast */}
      {saveError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      <FilterBar layout="grid" activeCount={filterCount}>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Từ ngày</span>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Đến ngày</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Dây chuyền</span>
          <select value={filterDayChuyen} onChange={e => setFilterDayChuyen(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            {DAY_CHUYEN_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button
          onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterDayChuyen("") }}
          disabled={filterCount === 0}
          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
        >
          Xóa lọc
        </button>
      </FilterBar>

      <ResponsiveTableWrapper>
        {loading ? (
          <ListState kind="loading" />
        ) : loadError ? (
          <ListState kind="error" message={`Không tải được dữ liệu: ${loadError}`} onRetry={() => factoryId && void loadData(factoryId)} />
        ) : items.length === 0 ? (
          <ListState kind="empty" message="Chưa có thông số nào" />
        ) : (
          <table className="enterprise-table dense min-w-[900px]">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Dây chuyền</th>
                <th>Loại CSR</th>
                <th className="text-right">Đầu ướt (°C)</th>
                <th className="text-right">Đầu khô (°C)</th>
                <th className="text-right">T.gian sấy (ph)</th>
                <th>Ghi chú / Lý do</th>
                <th>Thời điểm</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap font-semibold text-slate-700">{formatDate(item.ngay)}</td>
                  <td className="whitespace-nowrap">{item.day_chuyen}</td>
                  <td className="whitespace-nowrap">{item.loai_csr ? `CSR ${item.loai_csr}` : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right font-code">{item.nhiet_do_dau_1 != null ? item.nhiet_do_dau_1 : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right font-code">{item.nhiet_do_dau_2 != null ? item.nhiet_do_dau_2 : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right font-code">{item.thoi_gian_say != null ? item.thoi_gian_say : <span className="text-slate-300">—</span>}</td>
                  <td className="max-w-xs truncate text-slate-600" title={item.ghi_chu || ""}>{item.ghi_chu || ""}</td>
                  <td className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(item.created_at)}</td>
                  <td>
                    <IconActionGroup className="justify-end">
                      {canEdit && <RowAction kind="edit" label="Sửa thông số" onClick={() => openEdit(item)} />}
                      {canDelete && <RowAction kind="delete" label="Xóa thông số" onClick={() => setDelConfirm(item.id)} />}
                    </IconActionGroup>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ResponsiveTableWrapper>

      {/* Add/Edit Modal */}
      {modal && (
        <ModalShell
          title={modal === "add" ? "Thêm thông số kỹ thuật" : "Sửa thông số kỹ thuật"}
          onClose={() => setModal(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày <span className="text-red-500">*</span></label>
                  <input type="date" value={form.ngay} onChange={e => setForm(f => ({ ...f, ngay: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Dây chuyền <span className="text-red-500">*</span></label>
                  <select value={form.day_chuyen} onChange={e => { autoFillArmed.current = true; setForm(f => ({ ...f, day_chuyen: e.target.value, loai_csr: "" })) }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                    <option value="">— Chọn —</option>
                    {DAY_CHUYEN_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {(CSR_BY_DAY_CHUYEN[form.day_chuyen] ?? ALL_CSR_TYPES).map(csr => (
                    <button
                      key={csr}
                      type="button"
                      onClick={() => { autoFillArmed.current = true; setForm(f => ({ ...f, loai_csr: f.loai_csr === csr ? "" : csr })) }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                        form.loai_csr === csr
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-300 hover:border-blue-400"
                      }`}
                    >
                      CSR {csr}
                    </button>
                  ))}
                </div>
                {form.day_chuyen && form.loai_csr && (
                  <p className="text-xs text-teal-600 mt-1.5">
                    ✓ Thông số sẽ tự điền từ lần nhập gần nhất của {form.day_chuyen} / CSR {form.loai_csr}
                  </p>
                )}
                {cheDoWarning && (
                  <p className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-1.5">
                    ⚠ {cheDoWarning}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Đầu ướt (°C)</label>
                  <input type="number" step="0.1" placeholder="VD: 122" value={form.nhiet_do_dau_1}
                    onChange={e => setForm(f => ({ ...f, nhiet_do_dau_1: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Đầu khô (°C)</label>
                  <input type="number" step="0.1" placeholder="VD: 119" value={form.nhiet_do_dau_2}
                    onChange={e => setForm(f => ({ ...f, nhiet_do_dau_2: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">T.gian sấy (phút)</label>
                  <input type="number" step="0.1" placeholder="VD: 9.5" value={form.thoi_gian_say}
                    onChange={e => setForm(f => ({ ...f, thoi_gian_say: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú / Lý do thay đổi</label>
                <textarea rows={2} placeholder="Nhập lý do thay đổi thông số..." value={form.ghi_chu}
                  onChange={e => setForm(f => ({ ...f, ghi_chu: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500 resize-none" />
              </div>
            </div>
        </ModalShell>
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => { if (!deleting) setDelConfirm(null) }}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(null)} disabled={deleting}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-60">Hủy</button>
              <button onClick={() => void handleDelete(delConfirm)} disabled={deleting}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all">
                {deleting ? "Đang xóa..." : "Xóa"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Bạn có chắc muốn xóa bản ghi thông số này không?</p>
        </ModalShell>
      )}
    </ProcessShell>
  )
}

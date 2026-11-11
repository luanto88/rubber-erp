"use client"

// Định mức KTKT — "Cấu hình định mức" (rule 30). Dùng ở /dashboard/norms và Cài đặt → Cấu hình nhà máy.
// 2 thẻ con: Khung định mức (ma trận Dây chuyền × CSR × Nguồn × chỉ tiêu, sửa ô tại chỗ, gộp/tách ô,
// dòng, cột, áp dụng / sao chép) | Danh mục chỉ tiêu (ánh xạ vật tư kho theo id).
// Mọi ràng buộc chặt (trùng dòng, chồng hiệu lực, khung không Nháp) do trigger DB kiểm; UI kiểm trước để báo sớm.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  Copy,
  Merge,
  Pencil,
  Plus,
  Rows3,
  Split,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { GRADE_DAY_CHUYEN, NGOAI_LE_CSR, gradeLoaiCSRByDayChuyen, type GradeConfig } from "@/lib/product-grade"
import { loadGradeConfig } from "@/lib/product-grade-client"
import {
  NGUON_CODES,
  NGUON_LABEL,
  NORM_ACTUAL_SOURCE_LABEL,
  NORM_BASIS_LABEL,
  NORM_GROUPS,
  NORM_GROUP_LABEL,
  NORM_UNIT_LABEL,
  fmtNormValue,
  nguonListText,
  normDbErrorText,
  normUnitText,
  parseNormInput,
  shortCsr,
  type NguonCode,
  type NormActualSource,
  type NormBasis,
  type NormGroup,
  type NormItem,
  type NormRow,
  type NormUnit,
  type NormValue,
  type NormVersion,
} from "@/lib/norms/types"
import {
  buildColumnGroups,
  buildKmColumns,
  cellKey,
  computeCellSpans,
  computeLineSpans,
  defaultRowLabel,
  findRowOverlap,
  findUncoveredCombos,
  findVersionOverlap,
  indexValues,
  planMergeSelection,
  planSplitSelection,
  sortRows,
  type SelectedCell,
} from "@/lib/norms/matrix"
import {
  loadInventoryItemOptions,
  loadNormItems,
  loadNormVersionDetail,
  loadNormVersions,
  type InventoryItemOption,
  type NormVersionDetail,
} from "@/lib/norms/client"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"

type SubTab = "versions" | "items"

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

const errText = (e: unknown, fallback: string) => normDbErrorText(getErrorMessage(e, fallback))

const inputCls =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600 focus:ring-2 focus:ring-mod-200"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
const btnDangerCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function NormsConfig({ factoryId, user }: { factoryId: string | null; user: SessionUser | null }) {
  const canManage = hasPermission(user, "norms.manage_config")
  const canApprove = hasPermission(user, "norms.approve")

  const [subTab, setSubTab] = useState<SubTab>("versions")
  const [items, setItems] = useState<NormItem[]>([])
  const [versions, setVersions] = useState<NormVersion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NormVersionDetail | null>(null)
  const [grade, setGrade] = useState<GradeConfig | null>(null)
  const [invOptions, setInvOptions] = useState<InventoryItemOption[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "ok" ? 3500 : 8000)
  }, [])

  const loadBase = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const [its, vers, g, inv] = await Promise.all([
        loadNormItems(fid),
        loadNormVersions(fid),
        loadGradeConfig(fid),
        loadInventoryItemOptions(fid),
      ])
      setItems(its)
      setVersions(vers)
      setGrade(g)
      setInvOptions(inv)
      setSelectedId((cur) => {
        if (cur && vers.some((v) => v.id === cur)) return cur
        const today = getFactoryTodayISO()
        const current = vers.find(
          (v) => v.status !== "draft" && v.effective_from <= today && (!v.effective_to || v.effective_to >= today),
        )
        return current?.id ?? vers[0]?.id ?? null
      })
    } catch (e) {
      setLoadError(errText(e, "Không tải được định mức. Kiểm tra đã chạy migration 20261121 chưa."))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (fid: string, vid: string) => {
    setDetailLoading(true)
    try {
      setDetail(await loadNormVersionDetail(fid, vid))
    } catch (e) {
      setDetail(null)
      showToast("err", errText(e, "Không tải được khung định mức."))
    } finally {
      setDetailLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (factoryId) void loadBase(factoryId)
  }, [factoryId, loadBase])

  useEffect(() => {
    if (factoryId && selectedId) void loadDetail(factoryId, selectedId)
    else setDetail(null)
  }, [factoryId, selectedId, loadDetail])

  const reloadAll = useCallback(async () => {
    if (!factoryId) return
    await loadBase(factoryId)
    if (selectedId) await loadDetail(factoryId, selectedId)
  }, [factoryId, selectedId, loadBase, loadDetail])

  if (!factoryId) return <ListState kind="loading" />

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed left-1/2 top-4 z-[70] flex max-w-xl -translate-x-1/2 items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl ${
            toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{toast.text}</span>
          <button type="button" className="ml-2 opacity-80 hover:opacity-100" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}

      <SegmentedTabs
        size="sm"
        ariaLabel="Cấu hình định mức"
        value={subTab}
        onChange={setSubTab}
        items={[
          { key: "versions", label: "Khung định mức", icon: Rows3, count: versions.length },
          { key: "items", label: "Danh mục chỉ tiêu", icon: Columns3, count: items.length },
        ]}
      />

      {loading ? (
        <ListState kind="loading" />
      ) : loadError ? (
        <ListState kind="error" message={loadError} onRetry={() => void loadBase(factoryId)} />
      ) : subTab === "versions" ? (
        <VersionsPanel
          factoryId={factoryId}
          userId={user?.id ?? null}
          canManage={canManage}
          canApprove={canApprove}
          items={items}
          versions={versions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          detail={detail}
          detailLoading={detailLoading}
          grade={grade}
          onChanged={reloadAll}
          onReloadDetail={() => (selectedId ? loadDetail(factoryId, selectedId) : Promise.resolve())}
          showToast={showToast}
        />
      ) : (
        <ItemsPanel
          factoryId={factoryId}
          canManage={canManage}
          items={items}
          invOptions={invOptions}
          onChanged={reloadAll}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── Khung định mức ─────────────────────────────────────────────────────────

type VersionForm = {
  mode: "create" | "edit" | "copy"
  id: string | null
  code: string
  name: string
  nam: string
  decision_no: string
  decision_date: string
  effective_from: string
  effective_to: string
  ghi_chu: string
}

function VersionsPanel(props: {
  factoryId: string
  userId: string | null
  canManage: boolean
  canApprove: boolean
  items: NormItem[]
  versions: NormVersion[]
  selectedId: string | null
  onSelect: (id: string) => void
  detail: NormVersionDetail | null
  detailLoading: boolean
  grade: GradeConfig | null
  onChanged: () => Promise<void>
  onReloadDetail: () => Promise<void>
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const { factoryId, canManage, canApprove, items, versions, selectedId, detail, grade, showToast } = props
  const version = versions.find((v) => v.id === selectedId) ?? null
  const editable = canManage && version?.status === "draft"

  const [vForm, setVForm] = useState<VersionForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | "apply" | "unapply" | "delete">(null)
  const [rowForm, setRowForm] = useState<RowFormState | null>(null)
  const [colOpen, setColOpen] = useState(false)

  const openCreate = () => {
    const y = Number(getFactoryTodayISO().slice(0, 4))
    setVForm({
      mode: "create", id: null, code: `DM${y}`, name: `Định mức KTKT ${y}`, nam: String(y),
      decision_no: "", decision_date: "", effective_from: `${y}-01-01`, effective_to: "", ghi_chu: "",
    })
  }
  const openEdit = () => {
    if (!version) return
    setVForm({
      mode: "edit", id: version.id, code: version.code, name: version.name, nam: String(version.nam),
      decision_no: version.decision_no || "", decision_date: version.decision_date || "",
      effective_from: version.effective_from, effective_to: version.effective_to || "", ghi_chu: version.ghi_chu || "",
    })
  }
  const openCopy = () => {
    if (!version) return
    const y = version.nam + 1
    setVForm({
      mode: "copy", id: version.id, code: `DM${y}`, name: `Định mức KTKT ${y}`, nam: String(y),
      decision_no: "", decision_date: "", effective_from: `${y}-01-01`, effective_to: "", ghi_chu: "",
    })
  }

  const saveVersion = async () => {
    if (!vForm) return
    const code = vForm.code.trim().toUpperCase()
    const name = vForm.name.trim()
    const nam = Number(vForm.nam)
    if (!code || !name || !Number.isInteger(nam) || !vForm.effective_from) {
      showToast("err", "Cần đủ Mã khung, Tên khung, Năm và Ngày bắt đầu hiệu lực.")
      return
    }
    if (vForm.effective_to && vForm.effective_to < vForm.effective_from) {
      showToast("err", "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.")
      return
    }
    setBusy(true)
    try {
      if (vForm.mode === "copy") {
        const { data, error } = await supabase.rpc("tech_norm_copy_version", {
          p_source_id: vForm.id,
          p_code: code,
          p_name: name,
          p_nam: nam,
          p_effective_from: vForm.effective_from,
          p_effective_to: vForm.effective_to || null,
        })
        if (error) throw error
        setVForm(null)
        await props.onChanged()
        if (typeof data === "string") props.onSelect(data)
        showToast("ok", `Đã sao chép thành khung Nháp "${name}".`)
        return
      }
      const payload = {
        code, name, nam,
        decision_no: vForm.decision_no.trim() || null,
        decision_date: vForm.decision_date || null,
        effective_from: vForm.effective_from,
        effective_to: vForm.effective_to || null,
        ghi_chu: vForm.ghi_chu.trim() || null,
      }
      if (vForm.mode === "create") {
        const { data, error } = await supabase
          .from("tech_norm_versions")
          .insert({ ...payload, factory_id: factoryId, status: "draft", created_by: props.userId })
          .select("id")
          .single()
        if (error) throw error
        setVForm(null)
        await props.onChanged()
        props.onSelect(data.id)
        showToast("ok", "Đã tạo khung Nháp. Thêm cột chỉ tiêu và dòng rồi nhập số.")
      } else {
        const { error } = await supabase.from("tech_norm_versions").update(payload).eq("id", vForm.id!).eq("factory_id", factoryId)
        if (error) throw error
        setVForm(null)
        await props.onChanged()
        showToast("ok", "Đã lưu thông tin khung.")
      }
    } catch (e) {
      showToast("err", errText(e, "Không lưu được khung định mức."))
    } finally {
      setBusy(false)
    }
  }

  const doConfirm = async () => {
    if (!version || !confirm) return
    setBusy(true)
    try {
      if (confirm === "delete") {
        const { error } = await supabase.from("tech_norm_versions").delete().eq("id", version.id).eq("factory_id", factoryId)
        if (error) throw error
        setConfirm(null)
        await props.onChanged()
        showToast("ok", "Đã xoá khung Nháp.")
        return
      }
      const status = confirm === "apply" ? "active" : "draft"
      const { error } = await supabase.from("tech_norm_versions").update({ status }).eq("id", version.id).eq("factory_id", factoryId)
      if (error) throw error
      setConfirm(null)
      await props.onChanged()
      showToast("ok", confirm === "apply" ? "Khung đã được áp dụng." : "Đã hủy áp dụng — khung về Nháp.")
    } catch (e) {
      showToast("err", errText(e, "Thao tác không thành công."))
    } finally {
      setBusy(false)
    }
  }

  const applyOverlap = version && confirm === "apply" ? findVersionOverlap(version, versions) : null

  const csrByLine = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const dc of GRADE_DAY_CHUYEN) out[dc] = gradeLoaiCSRByDayChuyen(grade, dc).filter((c) => c !== NGOAI_LE_CSR)
    return out
  }, [grade])

  const uncovered = useMemo(
    () => (detail ? findUncoveredCombos(detail.rows, csrByLine) : []),
    [detail, csrByLine],
  )

  return (
    <div className="space-y-4">
      {/* Thanh chọn khung + thao tác */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full lg:max-w-md">
            <Field label="Khung định mức">
              <select
                className={inputCls}
                value={selectedId ?? ""}
                onChange={(e) => props.onSelect(e.target.value)}
                disabled={!versions.length}
              >
                {!versions.length && <option value="">— Chưa có khung —</option>}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · từ {fmtDate(v.effective_from)}
                    {v.effective_to ? ` đến ${fmtDate(v.effective_to)}` : ""} ·{" "}
                    {v.status === "draft" ? "Nháp" : v.status === "active" ? "Đang áp dụng" : "Đã khoá"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <button type="button" className={btnCls} onClick={openCreate}>
                <Plus size={15} /> Khung mới
              </button>
            )}
            {canManage && version && (
              <button type="button" className={btnCls} onClick={openCopy}>
                <Copy size={15} /> Sao chép sang khung mới
              </button>
            )}
            {editable && (
              <button type="button" className={btnCls} onClick={openEdit}>
                <Pencil size={15} /> Sửa thông tin
              </button>
            )}
            {canApprove && version?.status === "draft" && (
              <button type="button" className={btnPrimaryCls} onClick={() => setConfirm("apply")}>
                <CheckCircle2 size={15} /> Áp dụng
              </button>
            )}
            {canApprove && version?.status === "active" && (
              <button type="button" className={btnCls} onClick={() => setConfirm("unapply")}>
                <Undo2 size={15} /> Hủy áp dụng
              </button>
            )}
            {editable && (
              <button type="button" className={btnDangerCls} onClick={() => setConfirm("delete")}>
                <Trash2 size={15} /> Xoá khung
              </button>
            )}
          </div>
        </div>

        {version && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">Trạng thái</div>
              <StatusBadge domain="norms" status={version.status} />
            </div>
            <div>
              <div className="text-xs text-slate-500">Hiệu lực</div>
              <div className="font-semibold text-slate-800">
                {fmtDate(version.effective_from)} → {version.effective_to ? fmtDate(version.effective_to) : "không thời hạn"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Quyết định</div>
              <div className="font-semibold text-slate-800">
                {version.decision_no || "—"}
                {version.decision_date ? ` (${fmtDate(version.decision_date)})` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Mã khung · Năm</div>
              <div className="font-code font-semibold text-slate-800">
                {version.code} · {version.nam}
              </div>
            </div>
            {version.ghi_chu && <div className="col-span-full text-xs text-slate-600">{version.ghi_chu}</div>}
          </div>
        )}
      </div>

      {!version ? (
        <ListState kind="empty" message={canManage ? "Chưa có khung định mức — bấm “Khung mới”." : "Chưa có khung định mức."} />
      ) : props.detailLoading && !detail ? (
        <ListState kind="loading" />
      ) : detail ? (
        <>
          {version.status === "draft" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              Khung đang <b>Nháp</b> — chưa dùng cho đối soát. Kiểm tra số liệu rồi bấm <b>Áp dụng</b>.
            </div>
          )}
          {version.status !== "draft" && canManage && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
              Khung đang áp dụng nên chỉ xem. Muốn sửa: <b>Hủy áp dụng</b> (về Nháp) hoặc <b>Sao chép sang khung mới</b>.
            </div>
          )}
          {uncovered.length > 0 && <UncoveredBanner list={uncovered} />}

          <MatrixTable
            factoryId={factoryId}
            versionId={version.id}
            items={items}
            detail={detail}
            editable={!!editable}
            onChanged={props.onReloadDetail}
            onEditRow={(r) => setRowForm(rowToForm(r))}
            showToast={showToast}
          />

          {editable && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnCls} onClick={() => setRowForm(emptyRowForm(detail.rows))}>
                <Plus size={15} /> Thêm dòng
              </button>
              <button type="button" className={btnCls} onClick={() => setColOpen(true)}>
                <Columns3 size={15} /> Cột chỉ tiêu
              </button>
            </div>
          )}

          <KmTable
            factoryId={factoryId}
            versionId={version.id}
            items={items}
            detail={detail}
            editable={!!editable}
            onChanged={props.onReloadDetail}
            showToast={showToast}
          />
        </>
      ) : null}

      {vForm && (
        <ModalShell
          title={vForm.mode === "create" ? "Khung định mức mới" : vForm.mode === "copy" ? "Sao chép sang khung mới" : "Sửa thông tin khung"}
          onClose={() => !busy && setVForm(null)}
          maxWidth="lg"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setVForm(null)} disabled={busy}>
                Hủy
              </button>
              <button type="button" className={btnPrimaryCls} onClick={() => void saveVersion()} disabled={busy}>
                {busy ? "Đang lưu..." : vForm.mode === "copy" ? "Sao chép" : "Lưu"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {vForm.mode === "copy" && (
              <div className="col-span-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Sao chép toàn bộ cột, dòng và số liệu của khung “{version?.name}” thành khung Nháp mới. Khung cũ giữ nguyên.
              </div>
            )}
            <Field label="Mã khung *">
              <input className={inputCls} value={vForm.code} onChange={(e) => setVForm({ ...vForm, code: e.target.value })} />
            </Field>
            <Field label="Năm *">
              <input className={inputCls} inputMode="numeric" value={vForm.nam} onChange={(e) => setVForm({ ...vForm, nam: e.target.value })} />
            </Field>
            <div className="col-span-full">
              <Field label="Tên khung *">
                <input className={inputCls} value={vForm.name} onChange={(e) => setVForm({ ...vForm, name: e.target.value })} />
              </Field>
            </div>
            <Field label="Hiệu lực từ ngày *">
              <input type="date" className={inputCls} value={vForm.effective_from} onChange={(e) => setVForm({ ...vForm, effective_from: e.target.value })} />
            </Field>
            <Field label="Đến ngày" hint="Để trống = không thời hạn (tới khi có khung mới).">
              <input type="date" className={inputCls} value={vForm.effective_to} onChange={(e) => setVForm({ ...vForm, effective_to: e.target.value })} />
            </Field>
            {vForm.mode !== "copy" && (
              <>
                <Field label="Số quyết định">
                  <input className={inputCls} value={vForm.decision_no} onChange={(e) => setVForm({ ...vForm, decision_no: e.target.value })} />
                </Field>
                <Field label="Ngày quyết định">
                  <input type="date" className={inputCls} value={vForm.decision_date} onChange={(e) => setVForm({ ...vForm, decision_date: e.target.value })} />
                </Field>
                <div className="col-span-full">
                  <Field label="Ghi chú">
                    <textarea className={`${inputCls} h-20 py-2`} value={vForm.ghi_chu} onChange={(e) => setVForm({ ...vForm, ghi_chu: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </div>
        </ModalShell>
      )}

      {confirm && version && (
        <ModalShell
          title={confirm === "apply" ? "Áp dụng khung định mức" : confirm === "unapply" ? "Hủy áp dụng khung" : "Xoá khung Nháp"}
          onClose={() => !busy && setConfirm(null)}
          maxWidth="md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setConfirm(null)} disabled={busy}>
                Để sau
              </button>
              <button
                type="button"
                className={confirm === "delete" ? btnDangerCls : btnPrimaryCls}
                onClick={() => void doConfirm()}
                disabled={busy || !!applyOverlap}
              >
                {busy ? "Đang xử lý..." : "Xác nhận"}
              </button>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-slate-700">
            {confirm === "apply" && (
              <>
                <p>
                  Khung <b>{version.name}</b> sẽ được dùng cho đối soát từ <b>{fmtDate(version.effective_from)}</b> đến{" "}
                  <b>{version.effective_to ? fmtDate(version.effective_to) : "khi có khung mới"}</b>. Sau khi áp dụng, dòng / cột /
                  số liệu bị khoá sửa.
                </p>
                {applyOverlap && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                    Chồng hiệu lực với khung “{applyOverlap.name}” ({fmtDate(applyOverlap.effective_from)} →{" "}
                    {applyOverlap.effective_to ? fmtDate(applyOverlap.effective_to) : "không thời hạn"}). Hãy đặt ngày kết thúc cho
                    khung đó (hủy áp dụng → sửa → áp dụng lại) hoặc đổi ngày của khung này.
                  </p>
                )}
              </>
            )}
            {confirm === "unapply" && (
              <p>Khung về Nháp và không còn dùng cho đối soát cho tới khi áp dụng lại.</p>
            )}
            {confirm === "delete" && <p>Xoá hẳn khung Nháp “{version.name}” cùng mọi dòng / cột / số liệu của nó.</p>}
          </div>
        </ModalShell>
      )}

      {rowForm && detail && version && (
        <RowModal
          factoryId={factoryId}
          versionId={version.id}
          rows={detail.rows}
          csrByLine={csrByLine}
          form={rowForm}
          setForm={setRowForm}
          onDone={async () => {
            setRowForm(null)
            await props.onReloadDetail()
          }}
          showToast={showToast}
        />
      )}

      {colOpen && detail && version && (
        <ColumnsModal
          factoryId={factoryId}
          versionId={version.id}
          items={items}
          detail={detail}
          onClose={() => setColOpen(false)}
          onChanged={props.onReloadDetail}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function UncoveredBanner({ list }: { list: { day_chuyen: string; csr: string; nguon: NguonCode }[] }) {
  const grouped = new Map<string, string[]>()
  for (const u of list) {
    const k = `${u.day_chuyen} · ${shortCsr(u.csr)}`
    grouped.set(k, [...(grouped.get(k) || []), NGUON_LABEL[u.nguon]])
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={15} /> Chủng loại đang dùng chưa có dòng định mức (sẽ báo “không có định mức” khi đối soát):
      </div>
      <ul className="mt-1 list-disc pl-6 text-xs">
        {[...grouped.entries()].map(([k, ns]) => (
          <li key={k}>
            {k}: {ns.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Ma trận ────────────────────────────────────────────────────────────────

function MatrixTable(props: {
  factoryId: string
  versionId: string
  items: NormItem[]
  detail: NormVersionDetail
  editable: boolean
  onChanged: () => Promise<void>
  onEditRow: (r: NormRow) => void
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const { detail, items, editable, factoryId, versionId, showToast } = props
  const groups = useMemo(() => buildColumnGroups(detail.versionItems, items), [detail.versionItems, items])
  const columns = useMemo(() => groups.flatMap((g) => g.columns), [groups])
  const rows = useMemo(() => sortRows(detail.rows), [detail.rows])
  const valueIndex = useMemo(() => indexValues(detail.values), [detail.values])
  const spans = useMemo(
    () => computeCellSpans(rows, columns.map((c) => c.item.id), valueIndex),
    [rows, columns, valueIndex],
  )
  const lineSpans = useMemo(() => computeLineSpans(rows), [rows])

  const [editing, setEditing] = useState<{ rowId: string; itemId: string } | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // Chọn nhiều ô: Ctrl/Cmd + bấm = thêm/bớt 1 ô; Shift + bấm = chọn cả vùng từ ô neo tới ô bấm.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null)
  const itemOrder = useMemo(() => columns.map((c) => c.item.id), [columns])

  useEffect(() => {
    if (!selected.size) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(new Set())
        setAnchor(null)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selected.size])

  const clearSelection = () => {
    setSelected(new Set())
    setAnchor(null)
  }

  const handleCellClick = (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    if (!editable || saving) return
    const rowId = rows[rowIdx].id
    const itemId = itemOrder[colIdx]
    const k = cellKey(rowId, itemId)
    if (e.ctrlKey || e.metaKey) {
      setEditing(null)
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(k)) next.delete(k)
        else next.add(k)
        return next
      })
      setAnchor({ r: rowIdx, c: colIdx })
      return
    }
    if (e.shiftKey && anchor) {
      setEditing(null)
      const span = spans.get(k) ?? 1
      const r0 = Math.min(anchor.r, rowIdx)
      const r1 = Math.max(anchor.r, rowIdx + Math.max(span, 1) - 1)
      const c0 = Math.min(anchor.c, colIdx)
      const c1 = Math.max(anchor.c, colIdx)
      const next = new Set<string>()
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) next.add(cellKey(rows[r].id, itemOrder[c]))
      setSelected(next)
      return
    }
    clearSelection()
    setAnchor({ r: rowIdx, c: colIdx })
    startEdit(rowId, itemId)
  }

  const selectedCells = (): SelectedCell[] =>
    [...selected].map((k) => {
      const [rowId, itemId] = k.split("|")
      return { rowId, itemId }
    })

  const itemName = (id: string) => columns.find((c) => c.item.id === id)?.item.name || "?"

  const mergeSelected = () => {
    const { plans, issues } = planMergeSelection(rows, detail.values, selectedCells(), () => crypto.randomUUID())
    if (issues.length) {
      showToast(
        "err",
        issues
          .map((i) => `${itemName(i.itemId)}: ${i.reason === "not_contiguous" ? "các ô chọn không liền nhau" : "chưa có số để gộp"}`)
          .join(" · "),
      )
      return
    }
    if (!plans.length) {
      showToast("err", "Chọn ít nhất 2 ô liền nhau trong cùng 1 cột để gộp.")
      return
    }
    void run(async () => {
      for (const p of plans) {
        if (p.updateIds.length) {
          const { error } = await supabase
            .from("tech_norm_matrix_values")
            .update({ merge_key: p.key, value: p.value })
            .in("id", p.updateIds)
          if (error) throw error
        }
        if (p.insertRowIds.length) {
          const { error } = await supabase.from("tech_norm_matrix_values").insert(
            p.insertRowIds.map((rowId) => ({
              factory_id: factoryId, version_id: versionId, item_id: p.itemId, row_id: rowId, value: p.value, merge_key: p.key,
            })),
          )
          if (error) throw error
        }
      }
      clearSelection()
    }, `Đã gộp ô ở ${plans.length} cột (lấy số của ô trên cùng).`)
  }

  const splitSelected = () => {
    const ids = planSplitSelection(detail.values, selectedCells())
    if (!ids.length) {
      showToast("err", "Không có ô gộp nào trong vùng đã chọn.")
      return
    }
    void run(async () => {
      const { error } = await supabase.from("tech_norm_matrix_values").update({ merge_key: null }).in("id", ids)
      if (error) throw error
      clearSelection()
    }, "Đã tách ô — mỗi dòng giữ số cũ, sửa riêng được.")
  }

  /** Các ô cùng nhóm gộp với ô (rowId,itemId) — chính nó nếu không gộp. */
  const groupCells = (rowId: string, itemId: string): NormValue[] => {
    const v = valueIndex.get(cellKey(rowId, itemId))
    if (!v) return []
    if (!v.merge_key) return [v]
    return detail.values.filter((x) => x.item_id === itemId && x.merge_key === v.merge_key)
  }

  const startEdit = (rowId: string, itemId: string) => {
    if (!editable || saving) return
    setEditing({ rowId, itemId })
    setDraft(fmtNormValue(valueIndex.get(cellKey(rowId, itemId))?.value))
  }

  const run = async (fn: () => Promise<void>, okText?: string) => {
    setSaving(true)
    try {
      await fn()
      setEditing(null)
      await props.onChanged()
      if (okText) showToast("ok", okText)
    } catch (e) {
      showToast("err", errText(e, "Không lưu được ô định mức."))
    } finally {
      setSaving(false)
    }
  }

  const saveCell = () => {
    if (!editing) return
    const parsed = parseNormInput(draft)
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      showToast("err", "Số định mức không hợp lệ (phải là số ≥ 0, dùng dấu phẩy thập phân).")
      return
    }
    const { rowId, itemId } = editing
    const cells = groupCells(rowId, itemId)
    void run(async () => {
      if (parsed === null) {
        if (!cells.length) return
        const { error } = await supabase.from("tech_norm_matrix_values").delete().in("id", cells.map((c) => c.id))
        if (error) throw error
        return
      }
      if (cells.length) {
        const { error } = await supabase.from("tech_norm_matrix_values").update({ value: parsed }).in("id", cells.map((c) => c.id))
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("tech_norm_matrix_values")
          .insert({ factory_id: factoryId, version_id: versionId, item_id: itemId, row_id: rowId, value: parsed })
        if (error) throw error
      }
    })
  }

  /** Gộp ô đang sửa với ô ngay dưới (dòng kế tiếp sau dải gộp hiện tại), lấy số của ô trên. */
  const mergeDown = () => {
    if (!editing) return
    const { rowId, itemId } = editing
    const cells = groupCells(rowId, itemId)
    if (!cells.length) {
      showToast("err", "Nhập số cho ô trước khi gộp.")
      return
    }
    const idx = rows.findIndex((r) => r.id === rowId)
    const span = spans.get(cellKey(rowId, itemId)) || 1
    const below = rows[idx + span]
    if (!below) {
      showToast("err", "Không còn dòng bên dưới để gộp.")
      return
    }
    const key = cells[0].merge_key || crypto.randomUUID()
    const value = cells[0].value
    const belowCells = groupCells(below.id, itemId)
    void run(async () => {
      if (!cells[0].merge_key) {
        const { error } = await supabase.from("tech_norm_matrix_values").update({ merge_key: key }).eq("id", cells[0].id)
        if (error) throw error
      }
      if (belowCells.length) {
        const { error } = await supabase
          .from("tech_norm_matrix_values")
          .update({ merge_key: key, value })
          .in("id", belowCells.map((c) => c.id))
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("tech_norm_matrix_values")
          .insert({ factory_id: factoryId, version_id: versionId, item_id: itemId, row_id: below.id, value, merge_key: key })
        if (error) throw error
      }
    }, "Đã gộp ô.")
  }

  const splitCell = () => {
    if (!editing) return
    const cells = groupCells(editing.rowId, editing.itemId)
    if (cells.length < 2) return
    void run(async () => {
      const { error } = await supabase.from("tech_norm_matrix_values").update({ merge_key: null }).in("id", cells.map((c) => c.id))
      if (error) throw error
    }, "Đã tách ô — mỗi dòng giữ số cũ, sửa riêng được.")
  }

  if (!columns.length || !rows.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white">
        <ListState
          kind="empty"
          message={
            !columns.length
              ? "Khung chưa có cột chỉ tiêu theo tấn — bấm “Cột chỉ tiêu”."
              : "Khung chưa có dòng (Dây chuyền × CSR × Nguồn) — bấm “Thêm dòng”."
          }
        />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-800">Định mức theo tấn (dây chuyền × loại CSR × nguồn gốc)</h3>
        {editable && (
          <span className="text-xs text-slate-500">
            Bấm ô để sửa (Enter lưu · Esc huỷ · để trống = không áp) · <b>Ctrl</b> + bấm chọn nhiều ô · <b>Shift</b> + bấm chọn cả vùng
          </span>
        )}
      </div>
      {editable && selected.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm">
          <span className="font-semibold text-sky-900">Đã chọn {selected.size} ô</span>
          <button type="button" className={btnPrimaryCls} onClick={mergeSelected} disabled={saving}>
            <Merge size={15} /> Gộp ô đã chọn
          </button>
          <button type="button" className={btnCls} onClick={splitSelected} disabled={saving}>
            <Split size={15} /> Tách ô đã chọn
          </button>
          <button type="button" className={btnCls} onClick={clearSelection} disabled={saving}>
            <X size={15} /> Bỏ chọn (Esc)
          </button>
          <span className="text-xs text-sky-800">Gộp theo từng cột: các ô liền nhau trong 1 cột thành 1 ô, lấy số của ô trên cùng.</span>
        </div>
      )}
      <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
        <table className="enterprise-table dense norm-matrix min-w-[1100px]">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 bg-slate-50">Dây chuyền</th>
              <th rowSpan={2}>Loại CSR</th>
              <th rowSpan={2}>Nguồn</th>
              {groups.map((g) => (
                <th key={g.group} colSpan={g.columns.length} className="text-center">
                  {NORM_GROUP_LABEL[g.group]}
                </th>
              ))}
              {editable && <th rowSpan={2} className="text-right">Thao tác</th>}
            </tr>
            <tr>
              {columns.map((c) => (
                <th key={c.item.id} className="text-center">
                  <div>{c.item.name}</div>
                  <div className="text-[10px] font-normal normal-case text-slate-500">{normUnitText(c.vi.unit, c.vi.basis)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIdx) => (
              <tr key={r.id} className={rowIdx > 0 && (lineSpans.get(r.id) ?? 1) > 0 ? "line-start" : undefined}>
                {(lineSpans.get(r.id) ?? 1) > 0 && (
                  <td rowSpan={lineSpans.get(r.id)} className="line-cell sticky left-0 z-[1] bg-white align-middle font-semibold text-slate-800">
                    {r.day_chuyen}
                  </td>
                )}
                <td className="whitespace-nowrap font-semibold">
                  {r.csr_codes.map(shortCsr).join(", ")}
                  {r.label && <div className="text-[10px] font-normal text-slate-500">{r.label}</div>}
                </td>
                <td className="whitespace-nowrap text-xs">{nguonListText(r.nguon_codes)}</td>
                {columns.map((c, colIdx) => {
                  const k = cellKey(r.id, c.item.id)
                  const span = spans.get(k) ?? 1
                  if (span === 0) return null
                  const v = valueIndex.get(k)
                  const isEditing = editing?.rowId === r.id && editing.itemId === c.item.id
                  let isSelected = false
                  for (let i = rowIdx; i < rowIdx + span && !isSelected; i++) isSelected = selected.has(cellKey(rows[i].id, c.item.id))
                  return (
                    <td
                      key={c.item.id}
                      rowSpan={span}
                      className={`relative select-none text-right align-middle tabular-nums ${span > 1 ? "bg-mod-50/60" : ""} ${
                        editable ? "cursor-pointer hover:bg-mod-50" : ""
                      } ${isSelected ? "cell-selected" : ""}`}
                      onMouseDown={(e) => {
                        if (editable && (e.shiftKey || e.ctrlKey || e.metaKey)) e.preventDefault()
                      }}
                      onClick={(e) => !isEditing && handleCellClick(e, rowIdx, colIdx)}
                      title={span > 1 ? `Ô gộp ${span} dòng` : undefined}
                    >
                      {isEditing ? (
                        <div className="min-w-[96px] space-y-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            ref={inputRef}
                            value={draft}
                            disabled={saving}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCell()
                              if (e.key === "Escape") setEditing(null)
                            }}
                            className="h-8 w-full rounded border border-mod-600 px-2 text-right text-sm outline-none"
                          />
                          <div className="flex justify-end gap-1">
                            <button type="button" title="Lưu (Enter)" className="rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white" onClick={saveCell} disabled={saving}>
                              Lưu
                            </button>
                            <button type="button" title="Gộp với ô dưới" className="rounded border border-slate-300 p-0.5 text-slate-600 hover:bg-slate-50" onClick={mergeDown} disabled={saving}>
                              <Merge size={13} />
                            </button>
                            {span > 1 && (
                              <button type="button" title="Tách ô gộp" className="rounded border border-slate-300 p-0.5 text-slate-600 hover:bg-slate-50" onClick={splitCell} disabled={saving}>
                                <Split size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className={v ? "font-semibold text-slate-800" : "text-slate-300"}>{v ? fmtNormValue(v.value) : "·"}</span>
                      )}
                    </td>
                  )
                })}
                {editable && (
                  <td className="text-right">
                    <button type="button" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" title="Sửa dòng" onClick={() => props.onEditRow(r)}>
                      <Pencil size={15} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </div>
  )
}

function KmTable(props: {
  factoryId: string
  versionId: string
  items: NormItem[]
  detail: NormVersionDetail
  editable: boolean
  onChanged: () => Promise<void>
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const cols = useMemo(() => buildKmColumns(props.detail.versionItems, props.items), [props.detail.versionItems, props.items])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  if (!cols.length) return null

  const valueOf = (itemId: string) => props.detail.values.find((v) => v.item_id === itemId && v.row_id === null)

  const save = async (itemId: string) => {
    const raw = drafts[itemId]
    if (raw === undefined) return
    const parsed = parseNormInput(raw)
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      props.showToast("err", "Số định mức không hợp lệ.")
      return
    }
    const cur = valueOf(itemId)
    setSavingId(itemId)
    try {
      if (parsed === null) {
        if (cur) {
          const { error } = await supabase.from("tech_norm_matrix_values").delete().eq("id", cur.id)
          if (error) throw error
        }
      } else if (cur) {
        const { error } = await supabase.from("tech_norm_matrix_values").update({ value: parsed }).eq("id", cur.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("tech_norm_matrix_values").insert({
          factory_id: props.factoryId, version_id: props.versionId, item_id: itemId, row_id: null, value: parsed,
        })
        if (error) throw error
      }
      setDrafts((d) => {
        const n = { ...d }
        delete n[itemId]
        return n
      })
      await props.onChanged()
    } catch (e) {
      props.showToast("err", errText(e, "Không lưu được định mức vận chuyển."))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-800">Định mức theo 100 km vận chuyển</h3>
      </div>
      <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
        <table className="enterprise-table dense min-w-[640px]">
          <thead>
            <tr>
              <th>Chỉ tiêu</th>
              <th>Loại xe áp dụng</th>
              <th className="text-right">Định mức</th>
              <th>Đơn vị</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => {
              const cur = valueOf(c.item.id)
              return (
                <tr key={c.item.id}>
                  <td className="font-semibold">{c.item.name}</td>
                  <td className="text-xs">{c.item.vehicle_types.join(", ") || <span className="text-red-600">Chưa chọn loại xe</span>}</td>
                  <td className="text-right">
                    {props.editable ? (
                      <input
                        className="h-8 w-28 rounded border border-slate-300 px-2 text-right text-sm outline-none focus:border-mod-600"
                        value={drafts[c.item.id] ?? fmtNormValue(cur?.value)}
                        disabled={savingId === c.item.id}
                        onChange={(e) => setDrafts((d) => ({ ...d, [c.item.id]: e.target.value }))}
                        onBlur={() => void save(c.item.id)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <span className="font-semibold tabular-nums">{cur ? fmtNormValue(cur.value) : "—"}</span>
                    )}
                  </td>
                  <td className="text-xs">{normUnitText(c.vi.unit, c.vi.basis)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </div>
  )
}

// ─── Dòng ───────────────────────────────────────────────────────────────────

type RowFormState = {
  id: string | null
  day_chuyen: string
  csr_codes: string[]
  nguon_codes: NguonCode[]
  label: string
  sort_order: string
}

const emptyRowForm = (rows: NormRow[]): RowFormState => ({
  id: null,
  day_chuyen: GRADE_DAY_CHUYEN[1],
  csr_codes: [],
  nguon_codes: ["cong_ty", "gia_cong"],
  label: "",
  sort_order: String((rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 10),
})

const rowToForm = (r: NormRow): RowFormState => ({
  id: r.id,
  day_chuyen: r.day_chuyen,
  csr_codes: r.csr_codes,
  nguon_codes: r.nguon_codes,
  label: r.label || "",
  sort_order: String(r.sort_order),
})

function RowModal(props: {
  factoryId: string
  versionId: string
  rows: NormRow[]
  csrByLine: Record<string, string[]>
  form: RowFormState
  setForm: (f: RowFormState | null) => void
  onDone: () => Promise<void>
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const { form, setForm } = props
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const csrOptions = useMemo(() => {
    const base = props.csrByLine[form.day_chuyen] || []
    return [...new Set([...base, ...form.csr_codes])]
  }, [props.csrByLine, form.day_chuyen, form.csr_codes])

  const overlap = form.csr_codes.length
    ? findRowOverlap({ id: form.id || "", day_chuyen: form.day_chuyen, csr_codes: form.csr_codes, nguon_codes: form.nguon_codes }, props.rows)
    : null

  const save = async () => {
    if (!form.csr_codes.length) {
      props.showToast("err", "Chọn ít nhất 1 loại CSR.")
      return
    }
    if (overlap) {
      props.showToast("err", `Trùng CSR + nguồn với dòng “${overlap.label || overlap.csr_codes.map(shortCsr).join(", ")}”.`)
      return
    }
    const payload = {
      day_chuyen: form.day_chuyen,
      csr_codes: form.csr_codes,
      nguon_codes: form.nguon_codes,
      label: form.label.trim() || defaultRowLabel(form.csr_codes, form.nguon_codes),
      sort_order: Number(form.sort_order) || 100,
    }
    setBusy(true)
    try {
      if (form.id) {
        const { error } = await supabase.from("tech_norm_rows").update(payload).eq("id", form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("tech_norm_rows")
          .insert({ ...payload, factory_id: props.factoryId, version_id: props.versionId })
        if (error) throw error
      }
      await props.onDone()
    } catch (e) {
      props.showToast("err", errText(e, "Không lưu được dòng."))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!form.id) return
    setBusy(true)
    try {
      const { error } = await supabase.from("tech_norm_rows").delete().eq("id", form.id)
      if (error) throw error
      await props.onDone()
    } catch (e) {
      props.showToast("err", errText(e, "Không xoá được dòng."))
    } finally {
      setBusy(false)
    }
  }

  const toggleNguon = (n: NguonCode) =>
    setForm({ ...form, nguon_codes: form.nguon_codes.includes(n) ? form.nguon_codes.filter((x) => x !== n) : [...form.nguon_codes, n] })

  return (
    <ModalShell
      title={form.id ? "Sửa dòng định mức" : "Thêm dòng định mức"}
      onClose={() => !busy && setForm(null)}
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {form.id &&
              (confirmDelete ? (
                <span className="flex items-center gap-2 text-sm text-red-700">
                  Xoá dòng và mọi số của dòng?
                  <button type="button" className={btnDangerCls} onClick={() => void remove()} disabled={busy}>
                    Xoá
                  </button>
                </span>
              ) : (
                <button type="button" className={btnDangerCls} onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 size={15} /> Xoá dòng
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnCls} onClick={() => setForm(null)} disabled={busy}>
              Hủy
            </button>
            <button type="button" className={btnPrimaryCls} onClick={() => void save()} disabled={busy || !!overlap}>
              {busy ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Dây chuyền *">
          <select
            className={inputCls}
            value={form.day_chuyen}
            onChange={(e) => setForm({ ...form, day_chuyen: e.target.value, csr_codes: [] })}
          >
            {GRADE_DAY_CHUYEN.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Thứ tự">
          <input className={inputCls} inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
        </Field>
        <div className="col-span-full">
          <Field label="Loại CSR * (1 dòng có thể gồm nhiều CSR dùng chung định mức, vd L, 3L, 5)">
            <FilterMultiSelect
              fullWidth
              options={csrOptions}
              selected={form.csr_codes}
              onChange={(next) => setForm({ ...form, csr_codes: next })}
              placeholder="Chọn loại CSR"
              searchPlaceholder="Tìm CSR..."
            />
          </Field>
        </div>
        <div className="col-span-full space-y-1">
          <span className="text-xs font-semibold text-slate-600">Nguồn gốc (không chọn = áp cho mọi nguồn)</span>
          <div className="flex flex-wrap gap-2">
            {NGUON_CODES.map((n) => (
              <label
                key={n}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  form.nguon_codes.includes(n) ? "border-mod-600 bg-mod-50 font-semibold" : "border-slate-300"
                }`}
              >
                <input type="checkbox" checked={form.nguon_codes.includes(n)} onChange={() => toggleNguon(n)} />
                {NGUON_LABEL[n]}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Gia công thường gộp chung dòng Nông trường. Thanh lý thường không tính định mức (để ngoài mọi dòng).
          </p>
        </div>
        <div className="col-span-full">
          <Field label="Nhãn dòng" hint={`Để trống ⇒ “${defaultRowLabel(form.csr_codes, form.nguon_codes) || "…"}”`}>
            <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
        </div>
        {overlap && (
          <div className="col-span-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Trùng CSR + nguồn với dòng “{overlap.label || overlap.csr_codes.map(shortCsr).join(", ")}” ({nguonListText(overlap.nguon_codes)}).
            Mỗi CSR + nguồn chỉ được nằm ở 1 dòng trong khung.
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ─── Cột ────────────────────────────────────────────────────────────────────

const TON_BASES: NormBasis[] = ["tan_tp", "tan_nl_kho", "tan_nl_tuoi"]
const UNITS: NormUnit[] = ["kg", "lit", "kwh", "m3"]

function ColumnsModal(props: {
  factoryId: string
  versionId: string
  items: NormItem[]
  detail: NormVersionDetail
  onClose: () => void
  onChanged: () => Promise<void>
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [addItemId, setAddItemId] = useState("")
  const [addBasis, setAddBasis] = useState<NormBasis>("tan_tp")
  const [addUnit, setAddUnit] = useState<NormUnit>("kg")
  const [removeId, setRemoveId] = useState<string | null>(null)

  const byId = new Map(props.items.map((i) => [i.id, i]))
  const used = new Set(props.detail.versionItems.map((v) => v.item_id))
  const available = props.items.filter((i) => i.is_active && !used.has(i.id))
  const addItem = byId.get(addItemId)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await props.onChanged()
    } catch (e) {
      props.showToast("err", errText(e, "Không lưu được cột."))
    } finally {
      setBusy(false)
    }
  }

  const add = () => {
    if (!addItem) return
    const basis: NormBasis = addItem.norm_group === "van_chuyen" ? "km100" : addBasis
    void run(async () => {
      const { error } = await supabase.from("tech_norm_version_items").insert({
        factory_id: props.factoryId, version_id: props.versionId, item_id: addItem.id, basis, unit: addUnit,
        sort_order: addItem.sort_order,
      })
      if (error) throw error
      setAddItemId("")
    })
  }

  const update = (id: string, patch: { basis?: NormBasis; unit?: NormUnit; sort_order?: number }) =>
    void run(async () => {
      const { error } = await supabase.from("tech_norm_version_items").update(patch).eq("id", id)
      if (error) throw error
    })

  const remove = (id: string) =>
    void run(async () => {
      const { error } = await supabase.from("tech_norm_version_items").delete().eq("id", id)
      if (error) throw error
      setRemoveId(null)
    })

  const sorted = [...props.detail.versionItems].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <ModalShell title="Cột chỉ tiêu của khung" onClose={() => !busy && props.onClose()} maxWidth="3xl">
      <div className="space-y-4">
        <p className="text-xs text-slate-600">
          Mỗi cột = 1 chỉ tiêu + cơ sở tính + đơn vị riêng của khung này (đổi ở khung sau không ảnh hưởng khung cũ). Bỏ cột ⇒ mất
          mọi số của cột trong khung.
        </p>
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[640px]">
            <thead>
              <tr>
                <th>Chỉ tiêu</th>
                <th>Cơ sở tính</th>
                <th>Đơn vị</th>
                <th className="text-right">Thứ tự</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((vi) => {
                const it = byId.get(vi.item_id)
                return (
                  <tr key={vi.id}>
                    <td className="font-semibold">
                      {it?.name || "?"} <span className="text-[10px] text-slate-500">{it ? NORM_GROUP_LABEL[it.norm_group] : ""}</span>
                    </td>
                    <td>
                      {vi.basis === "km100" ? (
                        "100 km"
                      ) : (
                        <select className="h-8 rounded border border-slate-300 px-2 text-sm" value={vi.basis} disabled={busy}
                          onChange={(e) => update(vi.id, { basis: e.target.value as NormBasis })}>
                          {TON_BASES.map((b) => (
                            <option key={b} value={b}>
                              {NORM_BASIS_LABEL[b]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <select className="h-8 rounded border border-slate-300 px-2 text-sm" value={vi.unit} disabled={busy}
                        onChange={(e) => update(vi.id, { unit: e.target.value as NormUnit })}>
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {NORM_UNIT_LABEL[u]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <input
                        className="h-8 w-16 rounded border border-slate-300 px-2 text-right text-sm"
                        defaultValue={vi.sort_order}
                        disabled={busy}
                        onBlur={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n) && n !== vi.sort_order) update(vi.id, { sort_order: n })
                        }}
                      />
                    </td>
                    <td className="text-right">
                      {removeId === vi.id ? (
                        <button type="button" className={btnDangerCls} onClick={() => remove(vi.id)} disabled={busy}>
                          Xác nhận bỏ
                        </button>
                      ) : (
                        <button type="button" className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" title="Bỏ cột" onClick={() => setRemoveId(vi.id)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ResponsiveTableWrapper>

        <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
          <select className={inputCls} value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
            <option value="">— Thêm chỉ tiêu —</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({NORM_GROUP_LABEL[i.norm_group]})
              </option>
            ))}
          </select>
          {addItem?.norm_group === "van_chuyen" ? (
            <div className="flex items-center text-sm text-slate-600">Theo 100 km</div>
          ) : (
            <select className={inputCls} value={addBasis} onChange={(e) => setAddBasis(e.target.value as NormBasis)}>
              {TON_BASES.map((b) => (
                <option key={b} value={b}>
                  {NORM_BASIS_LABEL[b]}
                </option>
              ))}
            </select>
          )}
          <select className={inputCls} value={addUnit} onChange={(e) => setAddUnit(e.target.value as NormUnit)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {NORM_UNIT_LABEL[u]}
              </option>
            ))}
          </select>
          <button type="button" className={btnPrimaryCls} onClick={add} disabled={!addItem || busy}>
            <Plus size={15} /> Thêm cột
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Danh mục chỉ tiêu ──────────────────────────────────────────────────────

type ItemForm = {
  id: string | null
  code: string
  name: string
  norm_group: NormGroup
  actual_source: NormActualSource
  inventory_item_ids: string[]
  vehicle_types: string[]
  ghi_chu: string
  sort_order: string
  is_active: boolean
  kiem_ke_ton_xuong: boolean
}

function ItemsPanel(props: {
  factoryId: string
  canManage: boolean
  items: NormItem[]
  invOptions: InventoryItemOption[]
  onChanged: () => Promise<void>
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const [form, setForm] = useState<ItemForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("dispatch_vehicles").select("vehicle_type").eq("factory_id", props.factoryId)
      const set = new Set<string>()
      for (const r of (data || []) as { vehicle_type: string | null }[]) if (r.vehicle_type?.trim()) set.add(r.vehicle_type.trim())
      setVehicleTypes([...set].sort())
    })()
  }, [props.factoryId])

  const invById = useMemo(() => new Map(props.invOptions.map((o) => [o.id, o])), [props.invOptions])
  const invLabels = useMemo(
    () => Object.fromEntries(props.invOptions.map((o) => [o.id, `${o.code} — ${o.name}${o.unit ? ` (${o.unit})` : ""}`])),
    [props.invOptions],
  )
  /** Mã kho gắn cho >1 chỉ tiêu ⇒ đối soát tính 2 lần. */
  const dupInv = useMemo(() => {
    const count = new Map<string, number>()
    for (const it of props.items) for (const id of it.inventory_item_ids) count.set(id, (count.get(id) || 0) + 1)
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [props.items])

  const sorted = [...props.items].sort(
    (a, b) => NORM_GROUPS.indexOf(a.norm_group) - NORM_GROUPS.indexOf(b.norm_group) || a.sort_order - b.sort_order,
  )

  const open = (it: NormItem | null) =>
    setForm(
      it
        ? {
            id: it.id, code: it.code, name: it.name, norm_group: it.norm_group, actual_source: it.actual_source,
            inventory_item_ids: it.inventory_item_ids, vehicle_types: it.vehicle_types, ghi_chu: it.ghi_chu || "",
            sort_order: String(it.sort_order), is_active: it.is_active, kiem_ke_ton_xuong: !!it.kiem_ke_ton_xuong,
          }
        : {
            id: null, code: "", name: "", norm_group: "hoa_chat", actual_source: "kho", inventory_item_ids: [],
            vehicle_types: [], ghi_chu: "", sort_order: String((props.items.reduce((m, i) => Math.max(m, i.sort_order), 0) || 0) + 10),
            is_active: true, kiem_ke_ton_xuong: false,
          },
    )

  const save = async () => {
    if (!form) return
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "_")
    if (!code || !form.name.trim()) {
      props.showToast("err", "Cần Mã và Tên chỉ tiêu.")
      return
    }
    if (form.norm_group === "van_chuyen" && !form.vehicle_types.length) {
      props.showToast("err", "Chỉ tiêu vận chuyển phải chọn loại xe áp dụng.")
      return
    }
    const payload = {
      code,
      name: form.name.trim(),
      norm_group: form.norm_group,
      actual_source: form.actual_source,
      inventory_item_ids: form.actual_source === "kho" ? form.inventory_item_ids : [],
      vehicle_types: form.norm_group === "van_chuyen" ? form.vehicle_types : [],
      ghi_chu: form.ghi_chu.trim() || null,
      sort_order: Number(form.sort_order) || 100,
      is_active: form.is_active,
      kiem_ke_ton_xuong: form.actual_source === "kho" ? form.kiem_ke_ton_xuong : false,
    }
    setBusy(true)
    try {
      if (form.id) {
        const { error } = await supabase.from("tech_norm_items").update(payload).eq("id", form.id).eq("factory_id", props.factoryId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("tech_norm_items").insert({ ...payload, factory_id: props.factoryId })
        if (error) throw error
      }
      setForm(null)
      await props.onChanged()
      props.showToast("ok", "Đã lưu chỉ tiêu.")
    } catch (e) {
      props.showToast("err", errText(e, "Không lưu được chỉ tiêu."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          Danh mục dùng chung cho mọi khung. Ánh xạ vật tư kho theo <b>id</b> (đổi mã vật tư không mất liên kết); 1 chỉ tiêu gắn
          được nhiều mã (vd Bọc 0,04 gồm mọi mã bọc nhãn/trơn — đối soát cộng chung).
        </p>
        {props.canManage && (
          <button type="button" className={btnPrimaryCls} onClick={() => open(null)}>
            <Plus size={15} /> Thêm chỉ tiêu
          </button>
        )}
      </div>
      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[900px]">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên chỉ tiêu</th>
              <th>Nhóm</th>
              <th>Thực tế lấy từ</th>
              <th>Vật tư kho / loại xe</th>
              <th>Trạng thái</th>
              {props.canManage && <th className="text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <ListState asRow colSpan={7} kind="empty" message="Chưa có chỉ tiêu." />}
            {sorted.map((it) => (
              <tr key={it.id}>
                <td className="font-code text-xs">{it.code}</td>
                <td className="font-semibold">{it.name}</td>
                <td className="text-xs">{NORM_GROUP_LABEL[it.norm_group]}</td>
                <td className="text-xs">
                  {NORM_ACTUAL_SOURCE_LABEL[it.actual_source]}
                  {it.kiem_ke_ton_xuong && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">+ kiểm kê</span>}
                </td>
                <td className="text-xs">
                  {it.actual_source === "kho" &&
                    (it.inventory_item_ids.length ? (
                      <div className="flex flex-wrap gap-1">
                        {it.inventory_item_ids.map((id) => {
                          const o = invById.get(id)
                          return (
                            <span
                              key={id}
                              title={o?.name || "Mã kho đã bị xoá"}
                              className={`rounded border px-1.5 py-0.5 font-code ${
                                !o ? "border-red-200 bg-red-50 text-red-700" : dupInv.has(id) ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50"
                              }`}
                            >
                              {o?.code || "?"}
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <StatusBadge tone="danger" label="Chưa gắn mã kho" size="xs" />
                    ))}
                  {it.norm_group === "van_chuyen" && (
                    <div className="mt-1 text-slate-600">Xe: {it.vehicle_types.join(", ") || "—"}</div>
                  )}
                </td>
                <td>
                  <StatusBadge tone={it.is_active ? "valid" : "draft"} label={it.is_active ? "Đang dùng" : "Ngừng"} size="xs" />
                </td>
                {props.canManage && (
                  <td className="text-right">
                    <button type="button" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" title="Sửa" onClick={() => open(it)}>
                      <Pencil size={15} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
      {dupInv.size > 0 && (
        <p className="text-xs text-amber-800">
          Mã kho tô vàng đang gắn cho nhiều chỉ tiêu — khi đối soát lượng xuất sẽ bị tính vào cả các chỉ tiêu đó.
        </p>
      )}

      {form && (
        <ModalShell
          title={form.id ? "Sửa chỉ tiêu" : "Thêm chỉ tiêu"}
          onClose={() => !busy && setForm(null)}
          maxWidth="lg"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setForm(null)} disabled={busy}>
                Hủy
              </button>
              <button type="button" className={btnPrimaryCls} onClick={() => void save()} disabled={busy}>
                {busy ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mã *">
              <input className={`${inputCls} font-code uppercase`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label="Tên *">
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Nhóm">
              <select className={inputCls} value={form.norm_group} onChange={(e) => setForm({ ...form, norm_group: e.target.value as NormGroup })}>
                {NORM_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {NORM_GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số thực tế lấy từ">
              <select className={inputCls} value={form.actual_source} onChange={(e) => setForm({ ...form, actual_source: e.target.value as NormActualSource })}>
                <option value="kho">{NORM_ACTUAL_SOURCE_LABEL.kho}</option>
                <option value="dong_ho">{NORM_ACTUAL_SOURCE_LABEL.dong_ho}</option>
              </select>
            </Field>
            {form.actual_source === "kho" && (
              <label className="col-span-full flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.kiem_ke_ton_xuong}
                  onChange={(e) => setForm({ ...form, kiem_ke_ton_xuong: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Có kiểm kê tồn xưởng</span>
                  <span className="block text-xs text-slate-500">
                    Tick ⇒ Thực tế = Tồn xưởng đầu kỳ + Xuất kho − Tồn xưởng cuối kỳ (nhập ở tab Nhập liệu). Không tick ⇒ Thực tế = Xuất kho trong kỳ.
                  </span>
                </span>
              </label>
            )}
            {form.actual_source === "kho" && (
              <div className="col-span-full">
                <Field label="Mã vật tư kho (chọn nhiều)">
                  <FilterMultiSelect
                    fullWidth
                    options={props.invOptions.map((o) => o.id)}
                    labels={invLabels}
                    selected={form.inventory_item_ids}
                    onChange={(next) => setForm({ ...form, inventory_item_ids: next })}
                    placeholder="Chọn mã vật tư"
                    searchPlaceholder="Tìm mã / tên vật tư..."
                  />
                </Field>
              </div>
            )}
            {form.norm_group === "van_chuyen" && (
              <div className="col-span-full">
                <Field label="Loại xe áp dụng * (theo Cài đặt → Xe & Tài xế)">
                  <FilterMultiSelect
                    fullWidth
                    options={[...new Set([...vehicleTypes, ...form.vehicle_types])]}
                    selected={form.vehicle_types}
                    onChange={(next) => setForm({ ...form, vehicle_types: next })}
                    placeholder="Chọn loại xe"
                    searchPlaceholder="Tìm loại xe..."
                  />
                </Field>
              </div>
            )}
            <Field label="Thứ tự">
              <input className={inputCls} inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Đang dùng
            </label>
            <div className="col-span-full">
              <Field label="Ghi chú">
                <input className={inputCls} value={form.ghi_chu} onChange={(e) => setForm({ ...form, ghi_chu: e.target.value })} />
              </Field>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  )
}


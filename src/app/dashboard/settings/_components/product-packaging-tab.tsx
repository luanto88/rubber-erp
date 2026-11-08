"use client"

// Cài đặt → Cấu hình nhà máy → Quy cách đóng gói thành phẩm (2026-11-08, GĐ1).
// Bọc / Pallet sản xuất / Thảm theo nhà máy — bảng product_packaging_types. Thay các mảng hard-code ở
// Thành phẩm, màn quét QR, Dự đoán số lô, Xuất hàng. Chỉ quyết định LỰA CHỌN cho phiếu MỚI: lô cũ giữ
// nguyên chuỗi đã lưu ⇒ mục đã dùng không được đổi tên / xoá, chỉ tắt (đổi tên = thêm mục mới + tắt mục cũ).

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { getErrorMessage } from "@/lib/error-message"
import { matchesSearchQuery } from "@/lib/text-normalize"
import { findSimilarNames, normalizeName } from "@/lib/similar-name"
import { getLoaiCSRByDayChuyen } from "@/lib/product-lot-config"
import type { GradeConfig } from "@/lib/product-grade"
import { loadGradeConfig } from "@/lib/product-grade-client"
import { componentLabel, sortedComponents, type PalletComponentsConfig } from "@/lib/pallet-components"
import { loadPalletComponents } from "@/lib/pallet-components-client"
import {
  applyCsrToken,
  PACKAGING_CSR_TOKEN,
  PACKAGING_KIND_LABEL,
  PACKAGING_SELECT,
  parsePackagingRows,
  type PackagingKind,
  type PackagingType,
} from "@/lib/product-packaging"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { FilterMultiSelect } from "../../_components/filter-multi-select"
import { SegmentedTabs } from "../../_components/doc-ui/segmented-tabs"
import { ListSearch, noSearchMatchText } from "./list-search"

const DAY_CHUYEN_OPTIONS = ["Mủ tạp", "Mủ nước"]
const KINDS: PackagingKind[] = ["boc", "pallet_sx", "tham"]
const TABLE = "product_packaging_types"

type FormState = {
  id: string | null
  originalTen: string
  kind: PackagingKind
  ten: string
  day_chuyen: string[]
  loai_csr: string[]
  inventory_item_ids: string[]
  thanh_phan: string[]
  is_default: boolean
  sort_order: string
  is_active: boolean
}

type InvItem = { id: string; code: string | null; name: string | null }

const emptyForm = (kind: PackagingKind): FormState => ({
  id: null,
  originalTen: "",
  kind,
  ten: "",
  day_chuyen: [],
  loai_csr: [],
  inventory_item_ids: [],
  thanh_phan: [],
  is_default: false,
  sort_order: "100",
  is_active: true,
})

const PLACEHOLDER: Record<PackagingKind, string> = {
  boc: "VD: Bọc PE 0,04 VRG Green {CSR}",
  pallet_sx: "VD: Sắt đế gỗ",
  tham: "VD: Mới",
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function ProductPackagingTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<PackagingType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<PackagingKind>("boc")
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [delTarget, setDelTarget] = useState<PackagingType | null>(null)
  const [grade, setGrade] = useState<GradeConfig | null>(null)
  const prefix = grade?.prefix || "CSR"
  const [items, setItems] = useState<InvItem[]>([])
  const [components, setComponents] = useState<PalletComponentsConfig | null>(null)

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from(TABLE)
        .select(PACKAGING_SELECT)
        .eq("factory_id", fid)
        .order("sort_order")
        .order("ten")
      if (err) {
        setError(
          err.message.includes(TABLE)
            ? "Chưa có bảng product_packaging_types — chạy migration 20261108_product_packaging_types.sql. Các màn hình đang dùng danh sách mặc định."
            : err.message,
        )
        setRows([])
        return
      }
      setError(null)
      setRows(parsePackagingRows(data))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!factoryId) return
    void load(factoryId)
    void loadGradeConfig(factoryId).then(setGrade)
    void loadPalletComponents(factoryId).then(setComponents)
    void fetchAllPaginated<InvItem>((from, to) =>
      supabase
        .from("inventory_items")
        .select("id, code, name")
        .eq("factory_id", factoryId)
        .eq("is_active", true)
        .order("code")
        .order("id")
        .range(from, to),
    )
      .then(setItems)
      .catch(() => setItems([]))
  }, [factoryId, load])

  const csrOptions = useMemo(() => {
    const configured = DAY_CHUYEN_OPTIONS.flatMap((dc) => getLoaiCSRByDayChuyen(dc, prefix, grade)).filter(
      (c) => c !== "Ngoại lệ",
    )
    const used = rows.flatMap((r) => r.loai_csr)
    return [...new Set([...configured, ...used, ...(form?.loai_csr || [])])]
  }, [prefix, grade, rows, form?.loai_csr])

  const itemLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const it of items) m[it.id] = `${it.code || "—"} — ${it.name || ""}`
    return m
  }, [items])
  const itemOptions = useMemo(() => {
    const ids = items.map((i) => i.id)
    // Mã đã gắn nhưng vật tư đã ngừng dùng vẫn hiện để bỏ chọn được.
    for (const id of form?.inventory_item_ids || []) if (!ids.includes(id)) ids.push(id)
    return ids
  }, [items, form?.inventory_item_ids])

  const kindRows = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind])
  const shownRows = useMemo(
    () =>
      kindRows.filter((r) =>
        matchesSearchQuery(search, [r.ten, r.day_chuyen.join(" "), r.loai_csr.join(" ")]),
      ),
    [kindRows, search],
  )

  // Đếm số bản ghi (lô + giao dịch theo kiện) đang dùng 1 tên — token {CSR} ⇒ khớp mọi chủng loại.
  // Chỉ cần biết > 0. Lỗi ⇒ ném để chặn thao tác (thà chặn còn hơn đổi tên nhầm tên đang dùng).
  const countUsage = async (item: { kind: PackagingKind; ten: string }): Promise<number> => {
    if (!factoryId) return 0
    const bocPattern = item.ten.split(PACKAGING_CSR_TOKEN).map(escapeLike).join("%")
    let lotQ = supabase.from("lots").select("id", { count: "exact", head: true }).eq("factory_id", factoryId)
    if (item.kind === "boc") lotQ = lotQ.ilike("boc", bocPattern)
    else if (item.kind === "pallet_sx") lotQ = lotQ.contains("pallet", [item.ten])
    else lotQ = lotQ.ilike("tham", escapeLike(item.ten))
    const { count: lotCount, error: lotErr } = await lotQ
    if (lotErr) throw lotErr
    if ((lotCount || 0) > 0 || item.kind === "tham") return lotCount || 0
    // Bọc / pallet theo kiện nằm ở lot_transactions (lots.boc/pallet chỉ là bản chụp giao dịch cuối).
    let txQ = supabase
      .from("lot_transactions")
      .select("id, lots!inner(factory_id)", { count: "exact", head: true })
      .eq("lots.factory_id", factoryId)
    txQ = item.kind === "boc" ? txQ.ilike("boc", bocPattern) : txQ.contains("pallet", [item.ten])
    const { count: txCount, error: txErr } = await txQ
    if (txErr) throw txErr
    return txCount || 0
  }

  const similar = useMemo(() => {
    if (!form || !form.ten.trim()) return []
    const others = rows.filter((r) => r.kind === form.kind && r.id !== form.id)
    return findSimilarNames(form.ten, others, (r) => r.ten, { limit: 3 })
  }, [form, rows])
  const exactDup = useMemo(() => {
    if (!form) return null
    const k = normalizeName(form.ten)
    return rows.find((r) => r.kind === form.kind && r.id !== form.id && normalizeName(r.ten) === k) || null
  }, [form, rows])

  const save = async () => {
    if (!factoryId || !form) return
    const ten = form.ten.normalize("NFC").replace(/\s+/g, " ").trim()
    if (!ten) return setError("Nhập tên.")
    if (exactDup) return setError(`"${exactDup.ten}" đã có (khác chữ hoa / khoảng trắng). Không tạo trùng.`)
    if (form.kind === "pallet_sx" && form.thanh_phan.length === 0) {
      return setError("Pallet sản xuất: chọn ít nhất 1 thành phần (để tính tồn pallet ở Kho vật tư).")
    }
    setSaving(true)
    setError(null)
    try {
      // Mục đã dùng trên lô không được đổi tên — lô cũ giữ chuỗi cũ, đổi tên sẽ làm lệch báo cáo/bộ lọc.
      if (form.id && ten !== form.originalTen) {
        const used = await countUsage({ kind: form.kind, ten: form.originalTen })
        if (used > 0) {
          setError(
            `"${form.originalTen}" đã dùng ở ${used} lô — không đổi tên được. Hãy TẮT mục này rồi thêm mục mới với tên "${ten}".`,
          )
          return
        }
      }
      const payload = {
        factory_id: factoryId,
        kind: form.kind,
        ten,
        day_chuyen: form.kind === "tham" ? [] : form.day_chuyen,
        loai_csr: form.kind === "tham" ? [] : form.loai_csr.map((c) => c.replace(/\s+/g, "").toUpperCase()),
        inventory_item_ids: form.inventory_item_ids,
        thanh_phan: form.kind === "pallet_sx" ? form.thanh_phan : [],
        is_default: form.is_default,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      }
      const { data: saved, error: err } = form.id
        ? await supabase.from(TABLE).update(payload).eq("id", form.id).eq("factory_id", factoryId).select("id").single()
        : await supabase.from(TABLE).insert(payload).select("id").single()
      if (err) {
        setError(err.code === "23505" ? `"${ten}" đã tồn tại.` : err.message)
        return
      }
      // Mỗi loại chỉ 1 mục mặc định.
      if (form.is_default && saved?.id) {
        const { error: defErr } = await supabase
          .from(TABLE)
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("factory_id", factoryId)
          .eq("kind", form.kind)
          .neq("id", saved.id)
          .eq("is_default", true)
        if (defErr) setError(`Đã lưu, nhưng chưa bỏ mặc định ở mục khác: ${defErr.message}`)
      }
      setForm(null)
      void load(factoryId)
    } catch (e) {
      setError(getErrorMessage(e, "Không lưu được."))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!factoryId || !delTarget) return
    setSaving(true)
    try {
      const used = await countUsage(delTarget)
      if (used > 0) {
        setError(`"${delTarget.ten}" đã dùng ở ${used} lô — không xoá được, hãy tắt (bỏ "Đang dùng").`)
        setDelTarget(null)
        return
      }
      const { error: err } = await supabase.from(TABLE).delete().eq("id", delTarget.id).eq("factory_id", factoryId)
      if (err) {
        setError(err.message)
        return
      }
      setDelTarget(null)
      void load(factoryId)
    } catch (e) {
      setError(getErrorMessage(e, "Không xoá được."))
    } finally {
      setSaving(false)
    }
  }

  const scopeText = (r: PackagingType) => {
    const dc = r.day_chuyen.length ? r.day_chuyen.join(", ") : "Mọi dây chuyền"
    const csr = r.loai_csr.length ? r.loai_csr.join(", ") : "mọi chủng loại"
    return r.kind === "tham" ? "Mọi loại" : `${dc} · ${csr}`
  }
  const previewCsr = (f: FormState) => f.loai_csr[0] || `${prefix}10`

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Danh sách hiện ở các ô Bọc / Pallet / Thảm khi nhập thành phẩm, quét QR, dự đoán số lô, thay bọc và đơn xuất
          hàng. Áp dụng cho phiếu <b>MỚI</b> — lô cũ giữ nguyên tên đã lưu. Tên bọc có thể dùng{" "}
          <code className="rounded bg-slate-100 px-1">{PACKAGING_CSR_TOKEN}</code> để tự thay bằng chủng loại (vd
          &quot;Bọc nhãn 0,04 VRG {PACKAGING_CSR_TOKEN}&quot; → &quot;Bọc nhãn 0,04 VRG CSR10&quot;). Không dùng nữa thì{" "}
          <b>tắt</b>, không xoá.
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setForm(emptyForm(kind))
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Plus size={15} /> Thêm {PACKAGING_KIND_LABEL[kind].toLowerCase()}
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs
          items={KINDS.map((k) => ({ key: k, label: PACKAGING_KIND_LABEL[k], count: rows.filter((r) => r.kind === k).length }))}
          value={kind}
          onChange={(k) => {
            setKind(k)
            setSearch("")
          }}
          size="sm"
        />
        <ListSearch value={search} onChange={setSearch} shown={shownRows.length} total={kindRows.length} />
      </div>

      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[760px]">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Áp dụng cho</th>
              {kind === "pallet_sx" ? <th>Thành phần</th> : null}
              <th>Mã vật tư kho</th>
              <th className="text-right">Thứ tự</th>
              <th>Trạng thái</th>
              {canManage ? <th className="text-right">Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Đang tải...
                </td>
              </tr>
            ) : shownRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  {kindRows.length === 0 ? "Chưa có mục nào" : noSearchMatchText(search)}
                </td>
              </tr>
            ) : (
              shownRows.map((r) => (
                <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <td className="font-semibold text-slate-700">
                    {r.ten}
                    {r.is_default ? (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        Mặc định
                      </span>
                    ) : null}
                  </td>
                  <td className="text-slate-600">{scopeText(r)}</td>
                  {kind === "pallet_sx" ? (
                    <td className="text-slate-600">
                      {r.thanh_phan.length
                        ? r.thanh_phan.map((c) => componentLabel(components, c)).join(" + ")
                        : <span className="text-rose-600">Chưa khai báo</span>}
                    </td>
                  ) : null}
                  <td className="text-slate-600">
                    {r.inventory_item_ids.length
                      ? r.inventory_item_ids.map((id) => itemLabels[id]?.split(" — ")[0] || "?").join(", ")
                      : "—"}
                  </td>
                  <td className="text-right">{r.sort_order}</td>
                  <td>{r.is_active ? "Đang dùng" : "Đã tắt"}</td>
                  {canManage ? (
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          title="Sửa"
                          onClick={() => {
                            setError(null)
                            setForm({
                              id: r.id,
                              originalTen: r.ten,
                              kind: r.kind,
                              ten: r.ten,
                              day_chuyen: r.day_chuyen,
                              loai_csr: r.loai_csr,
                              inventory_item_ids: r.inventory_item_ids,
                              thanh_phan: r.thanh_phan,
                              is_default: r.is_default,
                              sort_order: String(r.sort_order ?? 0),
                              is_active: r.is_active,
                            })
                          }}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          title="Xoá"
                          onClick={() => setDelTarget(r)}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {form ? (
        <ModalShell
          title={`${form.id ? "Sửa" : "Thêm"} ${PACKAGING_KIND_LABEL[form.kind].toLowerCase()}`}
          onClose={() => setForm(null)}
          maxWidth="lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving || !!exactDup}
                onClick={() => void save()}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên *</label>
              <input
                value={form.ten}
                onChange={(e) => setForm({ ...form, ten: e.target.value })}
                placeholder={PLACEHOLDER[form.kind]}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              {form.kind === "boc" && form.ten.includes(PACKAGING_CSR_TOKEN) ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Hiển thị cho {previewCsr(form)}: <b>{applyCsrToken(form.ten, previewCsr(form))}</b>
                </p>
              ) : null}
              {form.id && form.ten.trim() !== form.originalTen ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  Đổi tên chỉ được khi chưa có lô nào dùng tên cũ. Đã dùng ⇒ tắt mục này và thêm mục mới.
                </p>
              ) : null}
              {exactDup ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                  <AlertTriangle size={12} /> Trùng với &quot;{exactDup.ten}&quot;.
                </p>
              ) : similar.length > 0 ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  Gần giống: {similar.map((c) => `"${c.item.ten}"`).join(", ")}. Kiểm tra lại — tên khác nhau sẽ tách thành
                  nhóm riêng trên báo cáo.
                </p>
              ) : null}
            </div>

            {form.kind !== "tham" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Dây chuyền</label>
                  <FilterMultiSelect
                    options={DAY_CHUYEN_OPTIONS}
                    selected={form.day_chuyen}
                    onChange={(next) => setForm({ ...form, day_chuyen: next })}
                    placeholder="Mọi dây chuyền"
                    searchPlaceholder="Tìm dây chuyền..."
                    fullWidth
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">Chủng loại</label>
                  <FilterMultiSelect
                    options={csrOptions}
                    selected={form.loai_csr}
                    onChange={(next) => setForm({ ...form, loai_csr: next })}
                    placeholder="Mọi chủng loại"
                    searchPlaceholder="Tìm chủng loại..."
                    fullWidth
                  />
                </div>
                <p className="text-[11px] text-slate-500 sm:col-span-2">Để trống = áp dụng cho tất cả.</p>
              </div>
            ) : null}

            {form.kind === "pallet_sx" ? (
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">
                  Thành phần (mỗi kiện dùng 1 bộ — tính tồn pallet Kho vật tư) *
                </label>
                <p className="mb-1.5 text-[11px] text-slate-500">
                  Thiếu thành phần (vd đế sắt)? Thêm ở tab &quot;Thành phần pallet&quot;.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    // Nắp chọn riêng theo kiện khi nhập thành phẩm, không phải thành phần cố định của pallet.
                    ...sortedComponents(components).filter((x) => !x.la_nap).map((x) => x.code),
                    ...form.thanh_phan.filter((c) => !sortedComponents(components).some((x) => x.code === c)),
                  ].map((c) => {
                    const on = form.thanh_phan.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            thanh_phan: on ? form.thanh_phan.filter((x) => x !== c) : [...form.thanh_phan, c],
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          on ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-500"
                        }`}
                      >
                        {componentLabel(components, c)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã vật tư kho (tuỳ chọn)</label>
              <FilterMultiSelect
                options={itemOptions}
                labels={itemLabels}
                selected={form.inventory_item_ids}
                onChange={(next) => setForm({ ...form, inventory_item_ids: next })}
                placeholder="Chưa gắn mã vật tư"
                searchPlaceholder="Tìm mã / tên vật tư..."
                fullWidth
              />
              <p className="mt-1 text-[11px] text-slate-500">Hiện chỉ lưu để tham chiếu, chưa tự trừ tồn kho.</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Thứ tự</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                />
                Mặc định
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Đang dùng
              </label>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {delTarget ? (
        <ModalShell
          title="Xoá mục quy cách đóng gói"
          onClose={() => setDelTarget(null)}
          maxWidth="sm"
          footer={
            <>
              <button
                type="button"
                onClick={() => setDelTarget(null)}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void remove()}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? "Đang kiểm tra..." : "Xoá"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá <b>{delTarget.ten}</b>? Hệ thống chỉ cho xoá khi chưa có lô nào dùng tên này; đã dùng thì hãy tắt.
          </p>
        </ModalShell>
      ) : null}
    </div>
  )
}

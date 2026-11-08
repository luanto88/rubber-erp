"use client"

// Cài đặt → Cấu hình nhà máy → Thành phần pallet (2026-11-08, GĐ3 phần A) — bảng pallet_components.
// Thành phần = vật tư pallet thật (sắt dày, đế gỗ, nắp sắt...). Dùng ở: Quy cách đóng gói TP (pallet SX gồm thành phần
// nào), Loại pallet xuất (bọc màng mất thành phần nào), Kho vật tư → Tồn (gộp mã vật tư kho thành 1 nhóm),
// Nắp pallet DPH (thành phần "Là nắp"). Mã nội bộ không đổi được; đang dùng thì không xoá, chỉ tắt.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { getErrorMessage } from "@/lib/error-message"
import { matchesSearchQuery, normalizeSearchText } from "@/lib/text-normalize"
import {
  isPalletComponentCode,
  PALLET_COMPONENTS_SELECT,
  parsePalletComponentRows,
  type PalletComponentDef,
} from "@/lib/pallet-components"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import { FilterMultiSelect } from "../../_components/filter-multi-select"
import { ListSearch, noSearchMatchText } from "./list-search"

const TABLE = "pallet_components"

type Kind = "pallet" | "nen_nap" | "nap"

type FormState = {
  id: string | null
  code: string
  codeTouched: boolean
  ten: string
  group_code: string
  inventory_item_ids: string[]
  kind: Kind
  sort_order: string
  is_active: boolean
}

type InvItem = { id: string; code: string | null; name: string | null }

const KIND_LABEL: Record<Kind, string> = {
  pallet: "Thành phần pallet",
  nen_nap: "Pallet nền cần chọn nắp (vd sắt dày DPH)",
  nap: "Nắp (chọn theo kiện khi nhập thành phẩm)",
}

const kindOf = (c: PalletComponentDef): Kind => (c.la_nap ? "nap" : c.co_nap ? "nen_nap" : "pallet")

/** "Đế sắt" ⇒ "de_sat". */
const slugify = (s: string) =>
  normalizeSearchText(s)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)

const emptyForm = (): FormState => ({
  id: null,
  code: "",
  codeTouched: false,
  ten: "",
  group_code: "",
  inventory_item_ids: [],
  kind: "pallet",
  sort_order: "100",
  is_active: true,
})

export function PalletComponentsTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<PalletComponentDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [delTarget, setDelTarget] = useState<PalletComponentDef | null>(null)
  const [items, setItems] = useState<InvItem[]>([])

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from(TABLE)
        .select(PALLET_COMPONENTS_SELECT)
        .eq("factory_id", fid)
        .order("sort_order")
        .order("ten")
      if (err) {
        setError(
          err.message.includes(TABLE)
            ? "Chưa có bảng pallet_components — chạy migration 20261117_pallet_components.sql. Các màn hình đang dùng danh sách mặc định."
            : err.message,
        )
        setRows([])
        return
      }
      setError(null)
      setRows(parsePalletComponentRows(data))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!factoryId) return
    void load(factoryId)
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

  const itemLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const it of items) m[it.id] = `${it.code || "—"} — ${it.name || ""}`
    return m
  }, [items])
  const itemOptions = useMemo(() => {
    const ids = items.map((i) => i.id)
    for (const id of form?.inventory_item_ids || []) if (!ids.includes(id)) ids.push(id)
    return ids
  }, [items, form?.inventory_item_ids])

  // 1 mã vật tư kho chỉ nên thuộc 1 thành phần (nếu không, tồn sổ sách bị đếm vào nhóm đầu tiên).
  const itemOwner = useMemo(() => {
    const m = new Map<string, PalletComponentDef>()
    for (const r of rows) for (const id of r.inventory_item_ids) if (!m.has(id)) m.set(id, r)
    return m
  }, [rows])

  const shownRows = useMemo(
    () =>
      rows.filter((r) =>
        matchesSearchQuery(search, [
          r.ten,
          r.code,
          r.group_code,
          ...r.inventory_item_ids.map((id) => itemLabels[id] || ""),
        ]),
      ),
    [rows, search, itemLabels],
  )

  const formIssues = useMemo(() => {
    if (!form) return { dupCode: null, dupGroup: null, sharedItems: [] as string[] }
    const dupCode = form.id ? null : rows.find((r) => r.code === form.code) || null
    const g = form.group_code.trim().toUpperCase()
    const dupGroup = g ? rows.find((r) => r.id !== form.id && r.group_code.trim().toUpperCase() === g) || null : null
    const sharedItems = form.inventory_item_ids
      .map((id) => {
        const owner = itemOwner.get(id)
        return owner && owner.id !== form.id ? `${itemLabels[id]?.split(" — ")[0] || "?"} (đang thuộc ${owner.ten})` : null
      })
      .filter((x): x is string => !!x)
    return { dupCode, dupGroup, sharedItems }
  }, [form, rows, itemOwner, itemLabels])

  const save = async () => {
    if (!factoryId || !form) return
    const ten = form.ten.normalize("NFC").replace(/\s+/g, " ").trim()
    const group = form.group_code.normalize("NFC").replace(/\s+/g, "").trim()
    if (!ten) return setError("Nhập tên thành phần.")
    if (!group) return setError("Nhập mã nhóm (hiển thị ở Kho vật tư → Tồn), vd DPH, NS.")
    if (!form.id && !isPalletComponentCode(form.code)) {
      return setError("Mã nội bộ chỉ gồm chữ thường không dấu, số, gạch dưới (2–40 ký tự), vd de_sat.")
    }
    if (formIssues.dupCode) return setError(`Mã nội bộ "${form.code}" đã có (${formIssues.dupCode.ten}).`)
    if (formIssues.dupGroup) return setError(`Mã nhóm "${group}" đã dùng cho ${formIssues.dupGroup.ten}.`)
    setSaving(true)
    setError(null)
    try {
      const payload = {
        factory_id: factoryId,
        ten,
        group_code: group,
        inventory_item_ids: form.inventory_item_ids,
        la_nap: form.kind === "nap",
        co_nap: form.kind === "nen_nap",
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      }
      const { error: err } = form.id
        ? await supabase.from(TABLE).update(payload).eq("id", form.id).eq("factory_id", factoryId)
        : await supabase.from(TABLE).insert({ ...payload, code: form.code })
      if (err) {
        setError(err.code === "23505" ? "Mã nội bộ hoặc mã nhóm đã tồn tại." : err.message)
        return
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
      const { error: err } = await supabase.from(TABLE).delete().eq("id", delTarget.id).eq("factory_id", factoryId)
      if (err) {
        setError(
          err.message.includes("PALLET_COMPONENT_IN_USE")
            ? `"${delTarget.ten}" đang được dùng (quy cách đóng gói / loại pallet xuất / nắp của kiện) — không xoá được, hãy tắt (bỏ "Đang dùng").`
            : err.message,
        )
        setDelTarget(null)
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

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Vật tư pallet thật của kho (sắt dày, sắt mỏng, đế gỗ, nắp sắt...). Mỗi thành phần gộp các <b>mã vật tư kho</b>{" "}
          thành 1 dòng ở <b>Kho vật tư → Tồn</b> (mã nhóm). Thêm thành phần mới (vd <i>Đế sắt</i>) rồi khai báo nó trong
          tab &quot;Quy cách đóng gói TP&quot; cho loại pallet sản xuất tương ứng. Không dùng nữa thì <b>tắt</b>.
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setForm(emptyForm())
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Plus size={15} /> Thêm thành phần
          </button>
        ) : null}
      </div>

      <div className="flex justify-end">
        <ListSearch value={search} onChange={setSearch} shown={shownRows.length} total={rows.length} />
      </div>

      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[760px]">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Mã nhóm</th>
              <th>Loại</th>
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
                  {rows.length === 0 ? "Chưa có thành phần nào" : noSearchMatchText(search)}
                </td>
              </tr>
            ) : (
              shownRows.map((r) => (
                <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <td className="font-semibold text-slate-700">
                    {r.ten}
                    <div className="font-code text-[11px] font-normal text-slate-400">{r.code}</div>
                  </td>
                  <td className="font-code font-bold text-slate-700">{r.group_code}</td>
                  <td className="text-slate-600">
                    {r.la_nap ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">Nắp</span>
                    ) : r.co_nap ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">Cần chọn nắp</span>
                    ) : (
                      "Pallet"
                    )}
                  </td>
                  <td className="text-slate-600">
                    {r.inventory_item_ids.length ? (
                      r.inventory_item_ids.map((id) => itemLabels[id]?.split(" — ")[0] || "?").join(", ")
                    ) : (
                      <span className="text-amber-600">Chưa gắn — không có tồn sổ sách</span>
                    )}
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
                              code: r.code,
                              codeTouched: true,
                              ten: r.ten,
                              group_code: r.group_code,
                              inventory_item_ids: r.inventory_item_ids,
                              kind: kindOf(r),
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
          title={form.id ? "Sửa thành phần pallet" : "Thêm thành phần pallet"}
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
                disabled={saving || !!formIssues.dupCode || !!formIssues.dupGroup}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên *</label>
                <input
                  value={form.ten}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      ten: e.target.value,
                      code: form.id || form.codeTouched ? form.code : slugify(e.target.value),
                    })
                  }
                  placeholder="VD: Đế sắt"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã nhóm (hiện ở Tồn) *</label>
                <input
                  value={form.group_code}
                  onChange={(e) => setForm({ ...form, group_code: e.target.value.toUpperCase() })}
                  placeholder="VD: ĐS"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-code text-sm outline-none focus:border-emerald-500"
                />
                {formIssues.dupGroup ? (
                  <p className="mt-1 text-[11px] font-semibold text-rose-700">Trùng mã nhóm của {formIssues.dupGroup.ten}.</p>
                ) : null}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã nội bộ</label>
              <input
                value={form.code}
                disabled={!!form.id}
                onChange={(e) => setForm({ ...form, code: e.target.value.trim().toLowerCase(), codeTouched: true })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 font-code text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {form.id
                  ? "Không đổi được sau khi tạo (các cấu hình khác tham chiếu mã này)."
                  : "Tự sinh từ tên. Không đổi được sau khi lưu."}
              </p>
              {formIssues.dupCode ? (
                <p className="mt-1 text-[11px] font-semibold text-rose-700">Đã có thành phần mã này: {formIssues.dupCode.ten}.</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Loại</label>
              <div className="space-y-1.5">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </div>
              {form.kind === "nen_nap" ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Kiện dùng pallet có thành phần này sẽ hiện ô chọn Nắp khi nhập thành phẩm / quét QR.
                </p>
              ) : form.kind === "nap" ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Hiện trong ô chọn Nắp. Xuất rời ⇒ nắp trả về kho; xuất khẩu có tick &quot;Xuất kèm nắp&quot; ⇒ trừ kho.
                </p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã vật tư kho</label>
              <FilterMultiSelect
                options={itemOptions}
                labels={itemLabels}
                selected={form.inventory_item_ids}
                onChange={(next) => setForm({ ...form, inventory_item_ids: next })}
                placeholder="Chưa gắn mã vật tư"
                searchPlaceholder="Tìm mã / tên vật tư..."
                fullWidth
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Nhiều mã cùng loại (vd sắt mỏng UBE + Chemie) gộp thành 1 dòng ở Tồn. Chưa có mã trong kho thì vẫn tính được
                số đang lưu dưới kiện, chỉ không có tồn sổ sách.
              </p>
              {formIssues.sharedItems.length > 0 ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {formIssues.sharedItems.join(", ")} — 1 mã vật tư chỉ nên thuộc 1 thành phần.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
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
          title="Xoá thành phần pallet"
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
                {saving ? "Đang xoá..." : "Xoá"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xoá <b>{delTarget.ten}</b>? Chỉ xoá được khi chưa dùng ở quy cách đóng gói, loại pallet xuất hay nắp của kiện; đã
            dùng thì hãy tắt.
          </p>
        </ModalShell>
      ) : null}
    </div>
  )
}

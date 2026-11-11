"use client"

// Định mức KTKT — "Nhóm vật tư báo cáo": nhóm vật tư kho thuộc báo cáo định mức. Mọi xuất kho của các nhóm này đều
// hiện trong báo cáo; mã chưa gắn chỉ tiêu ⇒ mục "Phát sinh ngoài định mức". Ghi cần norms.manage_config. Rule 30.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { btnPrimaryCls, errText } from "./norms-ui"

type Category = { id: string; code: string | null; name: string; is_active: boolean }

export function NormsReportCategories({
  factoryId,
  user,
  showToast,
}: {
  factoryId: string
  user: SessionUser | null
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const canManage = hasPermission(user, "norms.manage_config")
  const [cats, setCats] = useState<Category[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [c, r] = await Promise.all([
        supabase.from("inventory_item_categories").select("id,code,name,is_active").eq("factory_id", factoryId).order("sort_order").order("code"),
        supabase.from("tech_norm_report_categories").select("category_id").eq("factory_id", factoryId),
      ])
      if (c.error) throw c.error
      if (r.error) throw r.error
      setCats((c.data || []) as Category[])
      const s = new Set(((r.data || []) as { category_id: string }[]).map((x) => x.category_id))
      setSaved(s)
      setPicked(new Set(s))
    } catch (e) {
      setLoadError(errText(e, "Không tải được nhóm vật tư. Kiểm tra đã chạy migration 20261123 chưa."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => saved.size !== picked.size || [...picked].some((id) => !saved.has(id)), [saved, picked])

  const save = async () => {
    const add = [...picked].filter((id) => !saved.has(id))
    const remove = [...saved].filter((id) => !picked.has(id))
    setBusy(true)
    try {
      if (add.length) {
        const { error } = await supabase.from("tech_norm_report_categories").insert(add.map((category_id) => ({ factory_id: factoryId, category_id })))
        if (error) throw error
      }
      if (remove.length) {
        const { error } = await supabase.from("tech_norm_report_categories").delete().eq("factory_id", factoryId).in("category_id", remove)
        if (error) throw error
      }
      showToast("ok", "Đã lưu nhóm vật tư báo cáo.")
      void load()
    } catch (e) {
      showToast("err", errText(e, "Không lưu được nhóm vật tư báo cáo."))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <ListState kind="loading" />
  if (loadError) return <ListState kind="error" message={loadError} onRetry={() => void load()} />

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600">
          Tick các nhóm vật tư thuộc báo cáo định mức (vd Hóa chất, Dầu nhớt mỡ, Bao bì). Mọi xuất kho của nhóm đã tick đều hiện trong báo
          cáo; mã chưa gắn chỉ tiêu định mức hiện ở mục &quot;Phát sinh ngoài định mức&quot;. Phụ tùng bảo trì không tick thì không vào báo cáo.
        </p>
        {canManage && (
          <button type="button" className={btnPrimaryCls} disabled={busy || !dirty} onClick={() => void save()}>
            <Save size={15} /> {busy ? "Đang lưu…" : "Lưu"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <label
            key={c.id}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${picked.has(c.id) ? "border-mod-600 bg-mod-50" : "border-slate-200"} ${c.is_active ? "" : "opacity-60"}`}
          >
            <input
              type="checkbox"
              disabled={!canManage}
              checked={picked.has(c.id)}
              onChange={(e) =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (e.target.checked) next.add(c.id)
                  else next.delete(c.id)
                  return next
                })
              }
            />
            <span className="font-semibold text-slate-800">{c.name}</span>
            {c.code && <span className="font-code text-xs text-slate-500">{c.code}</span>}
          </label>
        ))}
      </div>
      {!canManage && <p className="text-xs text-slate-500">Chỉ xem — sửa cần quyền cấu hình định mức.</p>}
    </div>
  )
}

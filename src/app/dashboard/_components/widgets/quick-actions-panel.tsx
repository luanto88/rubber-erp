"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, FileOutput, Map, Package, QrCode, Tag, Truck, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission } from "@/lib/auth"
import { downloadStorageBulkQrPdf } from "@/lib/storage-pdf"
import { WidgetCard, type WidgetProps } from "./widget-shared"

type NganOption = { id: string; ma_ngan: string; ten_ngan: string }

function QuickQrPrint({ factoryId, canUse }: { factoryId: string | null; canUse: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ngans, setNgans] = useState<NganOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next && ngans.length === 0 && factoryId) {
      setLoading(true)
      const { data } = await supabase
        .from("ngans")
        .select("id,ma_ngan,ten_ngan")
        .eq("factory_id", factoryId)
        .neq("trang_thai", "Đã sản xuất")
        .order("ma_ngan", { ascending: true })
      setNgans((data as NganOption[]) || [])
      setLoading(false)
    }
  }

  const handlePrint = async () => {
    const chosen = ngans.filter((n) => selected.has(n.id))
    if (chosen.length === 0) return
    setPrinting(true)
    setError(null)
    try {
      await downloadStorageBulkQrPdf(chosen)
      setOpen(false)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không in được QR.")
    } finally {
      setPrinting(false)
    }
  }

  if (!canUse) return null

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={toggleOpen}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-50 transition-all group text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center flex-shrink-0">
          <QrCode size={15} className="text-cyan-600" />
        </div>
        <span className="text-sm font-semibold text-slate-700 flex-1">In QR ngăn nhanh</span>
        <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 sm:right-auto sm:w-80 mt-1 bg-white rounded-xl border border-slate-200 shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">Chọn ngăn cần in QR</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-slate-400 py-3 text-center">Đang tải...</p>
          ) : ngans.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">Không có ngăn đang hoạt động.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1 mb-2">
              {ngans.map((n) => (
                <label key={n.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(n.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(n.id)
                      else next.delete(n.id)
                      setSelected(next)
                    }}
                  />
                  <span className="font-semibold text-slate-700">{n.ma_ngan}</span>
                  <span className="text-slate-400 truncate">{n.ten_ngan}</span>
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <button
            onClick={handlePrint}
            disabled={selected.size === 0 || printing}
            className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold rounded-lg transition-all"
          >
            {printing ? "Đang tạo PDF..." : `In QR (${selected.size} ngăn)`}
          </button>
        </div>
      )}
    </div>
  )
}

export function QuickActionsPanel({ factoryId, user }: WidgetProps) {
  const router = useRouter()

  const actions = [
    { label: "Tạo lô thành phẩm", path: "/dashboard/product", icon: Package, color: "emerald", permission: "product.create" },
    { label: "Tạo đơn xuất hàng", path: "/dashboard/export", icon: FileOutput, color: "blue", permission: "export.create" },
    { label: "Xem bản đồ lô", path: "/dashboard/map", icon: Map, color: "purple" },
    { label: "Bảng phân xe", path: "/dashboard/dispatch", icon: Truck, color: "amber", permission: "dispatch.view" },
  ].filter((a) => !a.permission || hasPermission(user, a.permission))

  const canPrintLabel = hasPermission(user, "product.predict_view")

  return (
    <WidgetCard title="Thao tác nhanh">
      <div className="space-y-1">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => router.push(action.path)}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-50 transition-all group text-left"
          >
            <div className={`w-8 h-8 rounded-lg bg-${action.color}-100 flex items-center justify-center flex-shrink-0`}>
              <action.icon size={15} className={`text-${action.color}-600`} />
            </div>
            <span className="text-sm font-semibold text-slate-700 flex-1">{action.label}</span>
            <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}

        <QuickQrPrint factoryId={factoryId} canUse={hasPermission(user, "storage.view")} />

        {canPrintLabel && (
          <button
            onClick={() => router.push("/dashboard/product/predict")}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-50 transition-all group text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
              <Tag size={15} className="text-orange-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700 flex-1">In nhãn lô nhanh</span>
            <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
          </button>
        )}
      </div>
    </WidgetCard>
  )
}

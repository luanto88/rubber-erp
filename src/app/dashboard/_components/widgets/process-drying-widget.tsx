"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { hasPermission } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { CSR_BY_DAY_CHUYEN, resolveCheDoSuggestion, type CheDoRow } from "@/app/dashboard/process/_components/process-types"
import { WidgetCard, WidgetLoading, WidgetEmpty, type WidgetProps } from "./widget-shared"

type MeasurementRow = {
  id: string
  ngay: string
  chi_tieu: string[]
  ket_qua: Record<string, number | null>
  ca_sx: string | null
}

type ComboCard = {
  dc: string
  csr: string
  row: CheDoRow
  warning: string | null
  measurements: MeasurementRow[]
}

const formatVN = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("vi-VN")
}

async function loadCombo(factoryId: string, dc: string, csr: string): Promise<ComboCard | null> {
  const cols = "nhiet_do_dau_1,nhiet_do_dau_2,thoi_gian_say,ngay,created_at,loai_csr"
  const [csrMatchRes, latestAnyRes] = await Promise.all([
    supabase
      .from("process_params")
      .select(cols)
      .eq("factory_id", factoryId)
      .eq("day_chuyen", dc)
      .eq("loai_csr", csr)
      .order("ngay", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("process_params")
      .select(cols)
      .eq("factory_id", factoryId)
      .eq("day_chuyen", dc)
      .order("ngay", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const csrMatch = (csrMatchRes.data as CheDoRow | null) || null
  const latestAny = (latestAnyRes.data as CheDoRow | null) || null
  const { row, warning } = resolveCheDoSuggestion(csrMatch, latestAny, csr, formatVN)
  if (!row) return null

  const { data: sheets } = await supabase
    .from("quick_measurements")
    .select("id,ngay")
    .eq("factory_id", factoryId)
    .eq("day_chuyen", dc)
    .eq("loai_csr", csr)
    .order("ngay", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5)

  const sheetRows = (sheets || []) as { id: string; ngay: string }[]
  const sheetMap = new Map(sheetRows.map((s) => [s.id, s.ngay]))
  const sheetIds = sheetRows.map((s) => s.id)

  let measurements: MeasurementRow[] = []
  if (sheetIds.length > 0) {
    const { data: rowsRaw } = await supabase
      .from("quick_measurement_rows")
      .select("id,sheet_id,chi_tieu,ket_qua,ca_sx,created_at")
      .in("sheet_id", sheetIds)
      .order("created_at", { ascending: false })
      .limit(5)
    measurements = ((rowsRaw || []) as { id: string; sheet_id: string; chi_tieu: string[] | null; ket_qua: Record<string, number | null> | null; ca_sx: string | null }[]).map(
      (r) => ({
        id: r.id,
        ngay: sheetMap.get(r.sheet_id) || "",
        chi_tieu: r.chi_tieu || [],
        ket_qua: r.ket_qua || {},
        ca_sx: r.ca_sx,
      }),
    )
  }

  return { dc, csr, row, warning, measurements }
}

export function ProcessDryingWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "process.view")
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<ComboCard[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const combos = Object.entries(CSR_BY_DAY_CHUYEN).flatMap(([dc, csrList]) => csrList.map((csr) => ({ dc, csr })))
        const results = await Promise.all(combos.map((c) => loadCombo(factoryId, c.dc, c.csr)))
        if (alive) setCards(results.filter((c): c is ComboCard => c != null))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, canView])

  if (!canView) return null

  return (
    <WidgetCard
      title="Chế độ sấy & đo nhanh chỉ tiêu"
      subtitle="Chế độ sấy mới nhất theo từng loại CSR kèm 5 kết quả đo gần nhất"
      action={
        <Link href="/dashboard/process" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : cards.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {cards.map((c) => (
            <div key={`${c.dc}-${c.csr}`} className="min-w-[260px] max-w-[260px] flex-shrink-0 rounded-xl border border-slate-100 p-4">
              <div className="text-xs font-bold text-slate-500 mb-1">
                {c.dc} · CSR{c.csr}
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                <div>
                  <div className="text-[10px] text-slate-400">Đầu ướt</div>
                  <div className="text-sm font-extrabold text-slate-800">{c.row.nhiet_do_dau_1 ?? "—"}°C</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Đầu khô</div>
                  <div className="text-sm font-extrabold text-slate-800">{c.row.nhiet_do_dau_2 ?? "—"}°C</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Thời gian</div>
                  <div className="text-sm font-extrabold text-slate-800">{c.row.thoi_gian_say ?? "—"}p</div>
                </div>
              </div>
              {c.warning && <p className="text-[10px] text-amber-600 mb-2">{c.warning}</p>}
              <div className="border-t border-slate-100 pt-2 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase">5 kết quả đo gần nhất</div>
                {c.measurements.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Chưa có dữ liệu</p>
                ) : (
                  c.measurements.map((m) => (
                    <div key={m.id} className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span className="text-slate-400">
                        {formatVN(m.ngay)} {m.ca_sx ? `· ${m.ca_sx}` : ""}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {m.chi_tieu.map((ct) => `${ct}: ${m.ket_qua[ct] ?? "—"}`).join(" · ")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

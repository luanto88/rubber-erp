"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"

// GĐ2g — Banner cảnh báo biên bản bảo trì còn thiếu vật tư mua ngoài trong kho (chưa lập đề nghị
// mua hoặc đề nghị chưa nhập đủ). Dùng chung ở module Bảo trì và Đề nghị mua. Lỗi tải → ẩn im lặng.

export type ShortageRecord = {
  recordId: string
  maBb: string | null
  boPhan: string | null
  needsRequest: boolean
  items: {
    kind?: "vat_tu" | "dich_vu"; name: string; unit: string | null; shortage: number; pendingRequested: number
    pendingRequests?: { so: number; nam: number; qty: number }[]
  }[]
}

/** "thiếu 2 cái — chờ nhập kho theo phiếu 79/ĐNMVT" (nói rõ phiếu đang chờ, phần còn phải lập thêm). */
function itemText(it: ShortageRecord["items"][number]): string {
  const u = it.unit ? ` ${it.unit}` : ""
  const base = `${it.name}: ${it.kind === "dich_vu" ? "chưa hoàn thành" : "thiếu"} ${it.shortage}${u}`
  const reqs = it.pendingRequests || []
  if (!(it.pendingRequested > 0)) return base
  const so = reqs.length ? ` theo phiếu ${reqs.map((r) => `${String(r.so).padStart(2, "0")}/ĐNMVT`).join(", ")}` : ""
  const verb = it.kind === "dich_vu" ? "chờ xác nhận" : "chờ nhập kho"
  return it.pendingRequested >= it.shortage
    ? `${base} — ${verb}${so}`
    : `${base} — ${verb}${so} ${it.pendingRequested}${u}, cần lập thêm ${it.shortage - it.pendingRequested}${u}`
}

/** Nhãn ngắn trạng thái chờ của 1 biên bản thiếu (dùng ở banner + ô "Ký duyệt" trên danh sách). */
export function ktShortageLabel(r: ShortageRecord): string {
  if (r.needsRequest) return "Chưa lập đề nghị mua"
  return r.items.every((it) => it.kind === "dich_vu") ? "Chờ xác nhận gia công" : "Chờ nhập kho / gia công"
}

/** Lý do không gửi ký được (tooltip ở danh sách) — cùng câu chữ với banner. */
export function ktShortageReason(r: ShortageRecord): string {
  return `Chưa gửi ký được: ${r.items.map(itemText).join("; ")}`
}

/** recordId → { nhãn, lý do } cho ô "Ký duyệt" ở danh sách biên bản. */
export function buildKtBlockedMap(list: ShortageRecord[]): Record<string, { label: string; reason: string }> {
  const out: Record<string, { label: string; reason: string }> = {}
  for (const r of list) out[r.recordId] = { label: ktShortageLabel(r), reason: ktShortageReason(r) }
  return out
}

export function KtShortageBanner({ onRecords }: { onRecords?: (records: ShortageRecord[]) => void } = {}) {
  const [records, setRecords] = useState<ShortageRecord[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await authFetch("/api/maintenance/kt-shortages")
        const json = (await res.json()) as { records?: ShortageRecord[] }
        if (alive && res.ok) {
          setRecords(json.records || [])
          onRecords?.(json.records || [])
        }
      } catch {
        // Banner phụ — không chặn trang.
      }
    }
    void run()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tải 1 lần khi mở trang
  }, [])

  if (!records.length) return null
  const noRequest = records.filter((r) => r.needsRequest).length

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <AlertTriangle size={16} className="shrink-0 text-amber-600" />
        <span className="flex-1">
          <b>{records.length} biên bản bảo trì</b> thiếu vật tư mua ngoài trong kho hoặc dịch vụ gia công chưa hoàn thành
          {noRequest > 0 ? <> — <b>{noRequest}</b> biên bản chưa lập đề nghị mua</> : " — đang chờ đề nghị mua nhập kho"}.
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-t border-amber-200 pt-2">
          {records.map((r) => (
            <li key={r.recordId} className="text-xs">
              <Link href={`/dashboard/maintenance/records/${r.recordId}`} className="font-bold text-amber-900 underline">
                {r.maBb || "(chưa có mã)"}
              </Link>
              {r.boPhan ? <span className="text-amber-700"> · {r.boPhan}</span> : null}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full font-bold ${r.needsRequest ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700"}`}>
                {ktShortageLabel(r)}
              </span>
              <span className="text-amber-800">
                {" "}— {r.items.map(itemText).join("; ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

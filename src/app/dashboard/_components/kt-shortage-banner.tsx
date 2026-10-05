"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"

// GĐ2g — Banner cảnh báo biên bản bảo trì còn thiếu vật tư mua ngoài ở kho tạm KT (chưa lập đề nghị
// mua hoặc đề nghị chưa nhập đủ). Dùng chung ở module Bảo trì và Đề nghị mua. Lỗi tải → ẩn im lặng.

type ShortageRecord = {
  recordId: string
  maBb: string | null
  boPhan: string | null
  needsRequest: boolean
  items: { name: string; unit: string | null; shortage: number; pendingRequested: number }[]
}

export function KtShortageBanner() {
  const [records, setRecords] = useState<ShortageRecord[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await authFetch("/api/maintenance/kt-shortages")
        const json = (await res.json()) as { records?: ShortageRecord[] }
        if (alive && res.ok) setRecords(json.records || [])
      } catch {
        // Banner phụ — không chặn trang.
      }
    }
    void run()
    return () => { alive = false }
  }, [])

  if (!records.length) return null
  const noRequest = records.filter((r) => r.needsRequest).length

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <AlertTriangle size={16} className="shrink-0 text-amber-600" />
        <span className="flex-1">
          <b>{records.length} biên bản bảo trì</b> thiếu vật tư mua ngoài ở kho tạm KT
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
                {r.needsRequest ? "Chưa lập đề nghị" : "Chờ nhập kho"}
              </span>
              <span className="text-amber-800">
                {" "}— {r.items.map((it) => `${it.name}: thiếu ${it.shortage}${it.unit ? ` ${it.unit}` : ""}`).join("; ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

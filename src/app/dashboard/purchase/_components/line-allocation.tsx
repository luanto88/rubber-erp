"use client"

// Gắn dòng đề nghị mua ĐÃ DUYỆT (lập riêng, không thuộc biên bản) cho biên bản bảo trì theo SL.
// - LineAllocationBlock + AllocateToRecordModal: dùng ở trang chi tiết phiếu đề nghị.
// - RecordAllocateModal: dùng ở trang biên bản (khung "Vật tư mua ngoài").
// Cả 2 gọi chung POST /api/purchase/lines/[lineId]/allocations (RPC purchase_allocate_line kiểm hết).
import { useEffect, useState } from "react"
import Link from "next/link"
import { Link2, Loader2, X } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import {
  allocatePurchaseLine,
  fetchAllocationCandidates,
  type AllocationCandidate,
  type PurchaseLineAllocation,
} from "./allocation-client"

function fmt(n: number) {
  return Number(n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 })
}
function soPhieu(so: number, nam: number) {
  return `${String(so).padStart(2, "0")}/ĐNMVT (${nam})`
}

// ── Phía phiếu đề nghị ───────────────────────────────────────────────────────

export function LineAllocationBlock(props: {
  lineId: string
  itemId: string | null
  itemName: string
  unit: string | null
  /** Sức chứa: SL hiệu lực (phiếu Đóng: SL đã nhận). */
  capacity: number
  allocations: PurchaseLineAllocation[]
  canAllocate: boolean
  onChanged: () => void
}) {
  const { lineId, allocations, canAllocate, capacity, unit } = props
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const used = allocations.filter((a) => a.recordTrangThai !== "huy").reduce((s, a) => s + a.qty, 0)
  const free = Math.max(0, capacity - used)
  if (!allocations.length && !canAllocate) return null

  const remove = async (a: PurchaseLineAllocation) => {
    if (!window.confirm(`Gỡ ${fmt(a.qty)} ${unit || ""} khỏi biên bản ${a.maBb || ""}?`)) return
    setBusyId(a.id)
    setError(null)
    try {
      await allocatePurchaseLine(lineId, a.recordId, 0)
      props.onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gỡ được")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-1.5 rounded-lg border border-dashed border-brand-200 bg-brand-50/40 px-2 py-1.5">
      <p className="text-[11px] font-bold text-brand-800">Dùng cho biên bản</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {allocations.map((a) => {
          const locked = a.recordTrangThai !== "cho_duyet"
          return (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-white border border-brand-200 px-2 py-0.5 text-[11px]">
              <Link href={`/dashboard/maintenance/records/${a.recordId}`} className="font-semibold text-brand-700 hover:underline">
                {a.maBb || "(chưa có mã)"}
              </Link>
              <span className="text-slate-600">· {fmt(a.qty)}</span>
              {canAllocate && !locked && (
                <button
                  type="button"
                  onClick={() => void remove(a)}
                  disabled={busyId === a.id}
                  className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                  title="Gỡ khỏi biên bản"
                >
                  {busyId === a.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                </button>
              )}
            </span>
          )
        })}
        {!allocations.length && <span className="text-[11px] text-slate-500">Chưa gắn biên bản nào</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>Còn trống {fmt(free)} {unit || ""}</span>
        {canAllocate && free > 0 && props.itemId && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 font-bold text-white hover:bg-brand-700"
          >
            <Link2 size={11} /> Gắn biên bản
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] font-semibold text-red-600">{error}</p>}
      {open && props.itemId && (
        <AllocateToRecordModal
          lineId={lineId}
          itemId={props.itemId}
          itemName={props.itemName}
          unit={unit}
          free={free}
          excludeRecordIds={allocations.map((a) => a.recordId)}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            props.onChanged()
          }}
        />
      )}
    </div>
  )
}

type ShortRecord = {
  recordId: string
  maBb: string | null
  boPhan: string | null
  items: { itemId: string; kind: string; shortage: number; pendingRequested: number }[]
}

function AllocateToRecordModal(props: {
  lineId: string
  itemId: string
  itemName: string
  unit: string | null
  free: number
  excludeRecordIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<{ recordId: string; maBb: string | null; boPhan: string | null; shortage: number; open: number }[]>([])
  const [recordId, setRecordId] = useState("")
  const [qty, setQty] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const excludeKey = props.excludeRecordIds.join(",")
  useEffect(() => {
    const exclude = excludeKey ? excludeKey.split(",") : []
    let alive = true
    void (async () => {
      try {
        const res = await authFetch("/api/maintenance/kt-shortages")
        const json = (await res.json()) as { records?: ShortRecord[]; error?: string }
        if (!res.ok) throw new Error(json.error || "Không tải được danh sách biên bản")
        const list = (json.records || [])
          .filter((r) => !exclude.includes(r.recordId))
          .map((r) => {
            const it = r.items.find((x) => x.itemId === props.itemId)
            return it ? { recordId: r.recordId, maBb: r.maBb, boPhan: r.boPhan, shortage: it.shortage, open: Math.max(0, it.shortage - it.pendingRequested) } : null
          })
          .filter((v): v is NonNullable<typeof v> => !!v)
        if (alive) setRows(list)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [props.itemId, excludeKey])

  const pick = (r: (typeof rows)[number]) => {
    setRecordId(r.recordId)
    setQty(String(Math.min(props.free, r.open > 0 ? r.open : r.shortage)))
  }

  const save = async () => {
    const n = Number(qty)
    if (!recordId) return setError("Chọn biên bản")
    if (!(n > 0)) return setError("Số lượng phải > 0")
    if (n > props.free) return setError(`Dòng chỉ còn ${fmt(props.free)} chưa phân bổ`)
    setSaving(true)
    setError(null)
    try {
      await allocatePurchaseLine(props.lineId, recordId, n)
      props.onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gắn được")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Gắn cho biên bản bảo trì" onClose={props.onClose} maxWidth="lg" zIndexClassName="z-[60]">
      <div className="space-y-3">
        <div>
          <p className="text-xs text-slate-500">
            {props.itemName} · còn trống {fmt(props.free)} {props.unit || ""}
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-slate-400">Đang tải biên bản đang thiếu…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Không có biên bản nào (chưa gửi ký) đang thiếu vật tư / dịch vụ này. Biên bản phải có dòng cùng mã với nguồn
            &quot;Mua ngoài&quot; hoặc &quot;Gia công ngoài&quot; trước.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map((r) => (
              <label key={r.recordId} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${recordId === r.recordId ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                <input type="radio" checked={recordId === r.recordId} onChange={() => pick(r)} />
                <span className="font-semibold text-slate-800">{r.maBb || "(chưa có mã)"}</span>
                <span className="text-xs text-slate-500">{r.boPhan}</span>
                <span className="ml-auto text-xs text-slate-600">
                  Thiếu {fmt(r.shortage)}
                  {r.open !== r.shortage ? ` · chưa có nguồn ${fmt(r.open)}` : ""}
                </span>
              </label>
            ))}
          </div>
        )}
        <label className="block text-xs font-bold text-slate-600">
          Số lượng dùng cho biên bản
          <input
            type="number"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
        </label>
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-600">
            Đóng
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !recordId}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Gắn
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ── Phía biên bản ───────────────────────────────────────────────────────────

export function RecordAllocateModal(props: {
  recordId: string
  itemId: string
  itemName: string
  unit: string | null
  kind: "vat_tu" | "dich_vu"
  /** Phần biên bản còn thiếu chưa có nguồn — gợi ý SL. */
  suggest: number
  onClose: () => void
  onDone: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AllocationCandidate[]>([])
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [busyLine, setBusyLine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const { candidates } = await fetchAllocationCandidates(props.recordId, props.itemId)
      setRows(candidates)
      setQtyByLine(
        Object.fromEntries(
          candidates.map((c) => [c.lineId, String(c.mine > 0 ? c.mine : Math.min(c.free, Math.max(0, props.suggest)) || "")]),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được phiếu đề nghị")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.recordId, props.itemId])

  const apply = async (c: AllocationCandidate, qty: number) => {
    setBusyLine(c.lineId)
    setError(null)
    try {
      await allocatePurchaseLine(c.lineId, props.recordId, qty)
      props.onDone()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được")
    } finally {
      setBusyLine(null)
    }
  }

  const doneLabel = props.kind === "dich_vu" ? "Đã hoàn thành" : "Đã nhập kho"

  return (
    <ModalShell
      title={`Dùng đề nghị ${props.kind === "dich_vu" ? "gia công" : "mua"} có sẵn`}
      onClose={props.onClose}
      maxWidth="2xl"
      zIndexClassName="z-[60]"
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs text-slate-500">
            {props.itemName} — các phiếu đã duyệt, lập riêng (không thuộc biên bản nào), còn số lượng chưa dùng.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-slate-400">Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Không có phiếu đề nghị đã duyệt nào còn trống cho mã này. Dùng &quot;Lập đề nghị mua&quot; để lập phiếu mới.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="enterprise-table dense min-w-[620px]">
              <thead>
                <tr>
                  <th>Phiếu</th>
                  <th className="text-right">SL duyệt</th>
                  <th className="text-right">{doneLabel}</th>
                  <th className="text-right">Còn trống</th>
                  <th className="text-right">Biên bản này</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.lineId}>
                    <td>
                      <Link href={`/dashboard/purchase/${c.requestId}`} target="_blank" className="font-semibold text-brand-700 hover:underline">
                        {soPhieu(c.so, c.nam)}
                      </Link>
                      <p className="text-[11px] text-slate-500">{[c.boPhan, c.pendingAdjust ? "đang điều chỉnh" : null].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="text-right">{fmt(c.soLuong)} {c.unit || ""}</td>
                    <td className="text-right">{fmt(c.received)}</td>
                    <td className="text-right font-semibold">{fmt(c.free)}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={qtyByLine[c.lineId] ?? ""}
                        onChange={(e) => setQtyByLine((p) => ({ ...p, [c.lineId]: e.target.value }))}
                        className="h-8 w-20 rounded border border-slate-300 px-2 text-right text-sm"
                      />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        disabled={busyLine === c.lineId || c.pendingAdjust}
                        onClick={() => void apply(c, Number(qtyByLine[c.lineId]) || 0)}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-brand-600 px-2.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {busyLine === c.lineId && <Loader2 size={12} className="animate-spin" />}
                        {c.mine > 0 ? "Cập nhật" : "Gắn"}
                      </button>
                      {c.mine > 0 && (
                        <button
                          type="button"
                          disabled={busyLine === c.lineId}
                          onClick={() => void apply(c, 0)}
                          className="ml-1 inline-flex h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-semibold text-slate-600 hover:text-red-600"
                        >
                          Gỡ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={props.onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-600">
            Đóng
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

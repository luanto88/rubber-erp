"use client"

// GĐ2 — Ghi nhận mua thực tế / nhập kho, phiếu điều chỉnh, đóng phiếu.
// Mọi kiểm tra nghiệp vụ (vượt SL duyệt, lệch giá > 10%, số lô…) có ở cả đây (để báo sớm) lẫn
// ở RPC purchase_receive / route adjust (để chặn thật). Đổi ngưỡng thì đổi cả 2 nơi.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, Loader2, Lock, PackageCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import {
  formatMoney, formatQty, formatSoPhieuFull, priceDeviationPct, PURCHASE_STATUS_CLASS, PURCHASE_STATUS_LABEL,
  RECEIVE_PRICE_TOLERANCE_PCT, remainingQty, PURCHASE_MAX_IMAGES, type PurchaseEffectiveLine,
} from "@/lib/purchase/types"
import { ItemPicker, type ItemOpt } from "./purchase-form"
import { ImageLightbox, PurchaseImagePicker } from "./purchase-image-picker"
import { closePurchase, createAdjustment, receivePurchase, type PurchaseDetail } from "./purchase-client"


function fmtDate(iso: string | null | undefined) {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ""
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
const labelCls = "text-xs font-bold text-slate-600 block mb-1.5"

// ── Bảng tình hình mua + lịch sử ────────────────────────────────────────────

export function PurchaseFulfillmentPanel({ detail }: { detail: PurchaseDetail }) {
  const req = detail.request
  const [lightbox, setLightbox] = useState<string | null>(null)
  if (!detail.effectiveLines.length) return null
  const totalReceived = detail.receipts.filter((r) => !r.cancelled).reduce((s, r) => s + Number(r.tong_tien || 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-700">Tình hình mua / nhập kho</h3>
          <span className="text-xs text-slate-500">
            Đã nhập: <b className="text-slate-800">{formatMoney(totalReceived, req.loai_tien)} {req.loai_tien}</b>
          </span>
        </div>
        <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Vật tư (hiệu lực)</th>
                <th className="px-2 py-2 text-right">SL duyệt</th>
                <th className="px-2 py-2 text-right">Đã nhập</th>
                <th className="px-2 py-2 text-right">Còn lại</th>
                <th className="px-2 py-2 text-right">Giá duyệt</th>
              </tr>
            </thead>
            <tbody>
              {detail.effectiveLines.map((e) => {
                const rem = remainingQty(e)
                const pct = e.so_luong > 0 ? Math.min(100, (e.received / e.so_luong) * 100) : 0
                return (
                  <tr key={e.root_line_id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2">
                      <p className="font-semibold text-slate-800">{e.item_name}</p>
                      <p className="text-xs text-slate-500 font-mono">{e.item_code} · {e.unit}</p>
                      <div className="mt-1 h-1.5 w-full max-w-[180px] rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full ${rem === 0 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.adjusted && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Đã điều chỉnh</span>}
                        {e.pending_adjust && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Đang điều chỉnh — tạm khoá nhập</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatQty(e.so_luong)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap font-semibold text-blue-700">{formatQty(e.received)}</td>
                    <td className={`px-2 py-2 text-right whitespace-nowrap font-semibold ${rem === 0 ? "text-emerald-600" : "text-slate-700"}`}>{rem === 0 ? "Đủ" : formatQty(rem)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatMoney(e.don_gia, req.loai_tien)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
        {req.trang_thai === "dong" && (
          <p className="px-4 py-3 text-sm text-slate-600 border-t border-slate-100">
            <Lock size={13} className="inline mr-1" />Đã đóng {fmtDateTime(req.dong_luc)}. Lý do: {req.ly_do_dong}
          </p>
        )}
      </div>

      {detail.receipts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-3">Lịch sử ghi nhận mua ({detail.receipts.length})</h3>
          <ul className="space-y-3">
            {detail.receipts.map((r) => (
              <li key={r.id} className={`rounded-xl border p-3 ${r.cancelled ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <PackageCheck size={15} className="text-emerald-600" />
                  {r.inventory_document_id ? (
                    <Link href={`/dashboard/inventory/receipts?documentId=${r.inventory_document_id}`} className="font-mono font-bold text-teal-700 hover:underline inline-flex items-center gap-1">
                      {r.document_code} <ExternalLink size={12} />
                    </Link>
                  ) : <span className="font-mono font-bold">{r.document_code}</span>}
                  {r.cancelled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">Phiếu nhập đã huỷ — không tính</span>}
                  <span className="text-slate-500">· {fmtDate(r.ngay)} · {r.warehouse_label}</span>
                  <span className="ml-auto font-semibold text-slate-800">{formatMoney(r.tong_tien, r.loai_tien || req.loai_tien)} {r.loai_tien || req.loai_tien}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {r.created_by ? `${detail.names[r.created_by] || ""} · ` : ""}{fmtDateTime(r.created_at)}
                  {r.nha_cung_cap ? ` · NCC: ${r.nha_cung_cap}` : ""}
                </p>
                {r.lines.length > 0 && (
                  <ul className="mt-1.5 text-xs text-slate-600 space-y-0.5">
                    {r.lines.map((l, i) => (
                      <li key={i}>• {l.item_name}: <b>{formatQty(l.quantity)}</b> {l.unit} × {formatMoney(l.don_gia, r.loai_tien || req.loai_tien)}{l.lot_no ? ` (lô ${l.lot_no})` : ""}</li>
                    ))}
                  </ul>
                )}
                {r.ghi_chu && <p className="mt-1 text-xs text-slate-600">Ghi chú: {r.ghi_chu}</p>}
                {r.image_urls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.image_urls.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt={`Ảnh ${i + 1}`} onClick={() => setLightbox(u)} className="h-14 w-14 rounded-lg object-cover border border-slate-200 cursor-zoom-in" />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.adjustments.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-2">Phiếu điều chỉnh</h3>
          <ul className="space-y-1.5 text-sm">
            {detail.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/purchase/${a.id}`} className="font-mono font-bold text-teal-700 hover:underline">{formatSoPhieuFull(a.so, a.nam)}</Link>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${PURCHASE_STATUS_CLASS[a.trang_thai]}`}>
                  {a.trang_thai === "hoan_tat" ? "Đã duyệt — đã áp dụng" : PURCHASE_STATUS_LABEL[a.trang_thai]}
                </span>
                <span className="text-xs text-slate-500 truncate">{a.ly_do_dieu_chinh}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

// ── Modal Ghi nhận mua / Nhập kho ────────────────────────────────────────────

type ReceiveDraftLine = { on: boolean; soLuong: string; donGia: string; lotNo: string; expiry: string; ghiChu: string }

export function ReceiveModal({
  detail, factoryId, onClose, onDone,
}: { detail: PurchaseDetail; factoryId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const req = detail.request
  const lines = useMemo(() => detail.effectiveLines.filter((e) => remainingQty(e) > 0 && !e.pending_adjust), [detail.effectiveLines])
  const [warehouses, setWarehouses] = useState<{ id: string; code: string; name: string }[]>([])
  const [manageLot, setManageLot] = useState<Set<string>>(new Set())
  const [warehouseId, setWarehouseId] = useState("")
  const [ngay, setNgay] = useState(getFactoryTodayISO())
  const [nhaCungCap, setNhaCungCap] = useState("")
  const [ghiChu, setGhiChu] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [draft, setDraft] = useState<Record<string, ReceiveDraftLine>>(() =>
    Object.fromEntries(lines.map((e) => [e.root_line_id, {
      on: true, soLuong: String(remainingQty(e)), donGia: String(e.don_gia), lotNo: "", expiry: "", ghiChu: "",
    }])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const itemIds = lines.map((e) => e.item_id).filter(Boolean) as string[]
    const run = async () => {
      const [{ data: whs }, { data: items }, { data: rules }] = await Promise.all([
        supabase.from("inventory_warehouses").select("id, code, name").eq("factory_id", factoryId).order("code"),
        itemIds.length ? supabase.from("inventory_items").select("id, manages_lot").in("id", itemIds) : Promise.resolve({ data: [] }),
        itemIds.length
          ? supabase.from("inventory_item_warehouse_rules").select("item_id, warehouse_id, is_primary").in("item_id", itemIds)
          : Promise.resolve({ data: [] }),
      ])
      const list = (whs || []) as { id: string; code: string; name: string }[]
      setWarehouses(list)
      setManageLot(new Set(((items || []) as { id: string; manages_lot: boolean | null }[]).filter((i) => i.manages_lot).map((i) => i.id)))
      // Kho mặc định = kho chính của vật tư dòng đầu, không có thì kho đầu danh sách.
      const firstItem = itemIds[0]
      const primary = ((rules || []) as { item_id: string; warehouse_id: string; is_primary: boolean | null }[])
        .find((r) => r.item_id === firstItem && r.is_primary)?.warehouse_id
      // GĐ2g: phiếu lập từ biên bản bảo trì → nhập cứng vào kho tạm KT.
      const forced = detail.maintenanceSource?.ktWarehouseId || null
      setWarehouseId((cur) => forced || cur || primary || list[0]?.id || "")
    }
    void run()
  }, [factoryId, lines, detail.maintenanceSource])

  const patch = (id: string, p: Partial<ReceiveDraftLine>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }))

  const rows = lines.map((e) => {
    const d = draft[e.root_line_id]
    const qty = Number(d.soLuong)
    const price = Number(d.donGia)
    const rem = remainingQty(e)
    const pct = priceDeviationPct(price, e.don_gia)
    const errs: string[] = []
    if (d.on) {
      if (!(qty > 0)) errs.push("Số lượng phải > 0")
      else if (qty > rem + 1e-9) errs.push(`Vượt SL còn lại (${formatQty(rem)}) — mua thêm phải lập phiếu đề nghị mới`)
      if (!(price >= 0) || d.donGia.trim() === "") errs.push("Đơn giá không hợp lệ")
      else if (pct !== null && Math.abs(pct) > RECEIVE_PRICE_TOLERANCE_PCT) {
        errs.push(`Giá lệch ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% so với giá duyệt — cần lập phiếu điều chỉnh`)
      }
      if (e.item_id && manageLot.has(e.item_id) && !d.lotNo.trim()) errs.push("Vật tư quản lý theo lô — nhập số lô")
    }
    return { e, d, qty, price, rem, pct, errs }
  })
  const selected = rows.filter((r) => r.d.on)
  const total = selected.reduce((s, r) => s + (r.qty > 0 && r.price >= 0 ? r.qty * r.price : 0), 0)
  const blocking = !warehouseId || !selected.length || selected.some((r) => r.errs.length > 0)

  const handleSubmit = async () => {
    setError(null)
    if (blocking) return
    setSaving(true)
    try {
      const res = await receivePurchase(req.id, {
        warehouseId, ngay, nhaCungCap, ghiChu, imageUrls: images,
        lines: selected.map((r) => ({
          lineId: r.e.root_line_id, soLuong: r.qty, donGia: r.price,
          lotNo: r.d.lotNo.trim() || null, expiryDate: r.d.expiry || null, ghiChu: r.d.ghiChu.trim() || null,
        })),
      })
      onDone(`Đã nhập kho phiếu ${res.documentCode}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không ghi nhận được")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`Ghi nhận mua / Nhập kho — ${formatSoPhieuFull(req.so, req.nam)}`}
      onClose={onClose}
      maxWidth="4xl"
      closeOnBackdrop={false}
      footer={
        <>
          <span className="mr-auto text-sm text-slate-600">Tổng đợt này: <b>{formatMoney(total, req.loai_tien)} {req.loai_tien}</b></span>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Đóng</button>
          <button onClick={handleSubmit} disabled={saving || blocking} className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={15} />} Ghi nhận & nhập kho
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="whitespace-pre-line rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Kho nhập *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!!detail.maintenanceSource} className={`${inputCls} disabled:bg-slate-100`}>
              <option value="">— Chọn kho —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
            {detail.maintenanceSource && (
              <p className={`mt-1 text-[11px] ${detail.maintenanceSource.ktWarehouseId ? "text-slate-500" : "text-red-600 font-semibold"}`}>
                {detail.maintenanceSource.ktWarehouseId
                  ? `Phiếu từ biên bản bảo trì — nhập cứng vào kho tạm ${detail.maintenanceSource.ktCode}.`
                  : `Chưa có kho tạm mã ${detail.maintenanceSource.ktCode} — tạo kho này trong Cài đặt trước.`}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Ngày nhập *</label>
            <input type="date" value={ngay} max={getFactoryTodayISO()} onChange={(e) => setNgay(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nhà cung cấp</label>
            <input value={nhaCungCap} onChange={(e) => setNhaCungCap(e.target.value)} placeholder="Tên cửa hàng / NCC" className={inputCls} />
          </div>
        </div>

        <div className="space-y-2">
          {rows.map(({ e, d, rem, errs }) => (
            <div key={e.root_line_id} className={`rounded-xl border p-3 ${d.on ? (errs.length ? "border-red-300 bg-red-50/30" : "border-emerald-200") : "border-slate-200 opacity-60"}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={d.on} onChange={(ev) => patch(e.root_line_id, { on: ev.target.checked })} className="mt-1" />
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-slate-800">{e.item_name}</span>
                  <span className="ml-1.5 text-xs font-mono text-slate-500">{e.item_code}</span>
                  <span className="block text-xs text-slate-500">
                    Duyệt {formatQty(e.so_luong)} {e.unit} · đã nhập {formatQty(e.received)} · còn <b>{formatQty(rem)}</b> · giá duyệt {formatMoney(e.don_gia, req.loai_tien)}
                  </span>
                </span>
              </label>
              {d.on && (
                <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">SL mua ({e.unit})</label>
                    <input type="number" inputMode="decimal" min={0} max={rem} value={d.soLuong} onChange={(ev) => patch(e.root_line_id, { soLuong: ev.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">Đơn giá thực tế ({req.loai_tien})</label>
                    <input type="number" inputMode="decimal" min={0} value={d.donGia} onChange={(ev) => patch(e.root_line_id, { donGia: ev.target.value })} className={inputCls} />
                  </div>
                  {e.item_id && manageLot.has(e.item_id) && (
                    <>
                      <div>
                        <label className="text-[11px] font-bold text-slate-500">Số lô *</label>
                        <input value={d.lotNo} onChange={(ev) => patch(e.root_line_id, { lotNo: ev.target.value })} className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-500">Hạn sử dụng</label>
                        <input type="date" value={d.expiry} onChange={(ev) => patch(e.root_line_id, { expiry: ev.target.value })} className={inputCls} />
                      </div>
                    </>
                  )}
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[11px] font-bold text-slate-500">Ghi chú dòng</label>
                    <input value={d.ghiChu} onChange={(ev) => patch(e.root_line_id, { ghiChu: ev.target.value })} className={inputCls} />
                  </div>
                </div>
              )}
              {d.on && errs.length > 0 && <p className="mt-1.5 text-xs font-semibold text-red-600">{errs.join(" · ")}</p>}
            </div>
          ))}
          {detail.effectiveLines.some((e) => e.pending_adjust && remainingQty(e) > 0) && (
            <p className="text-xs text-amber-700">Dòng đang có phiếu điều chỉnh chưa duyệt không hiện ở đây — chờ duyệt xong mới nhập được.</p>
          )}
        </div>

        <PurchaseImagePicker factoryId={factoryId} images={images} onChange={setImages} documentType="purchase-receipts" label={`Ảnh đính kèm (hoá đơn, hàng nhận…) — tối đa ${PURCHASE_MAX_IMAGES}`} />

        <div>
          <label className={labelCls}>Ghi chú</label>
          <textarea value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={2} className={inputCls} />
        </div>
        <p className="text-[11px] text-slate-500">
          Hệ thống tự tạo và ghi sổ phiếu nhập kho, cộng tồn ngay. Không nhập được quá số lượng duyệt; đơn giá lệch quá ±{RECEIVE_PRICE_TOLERANCE_PCT}% so với giá duyệt hoặc đổi mã vật tư phải lập phiếu điều chỉnh trước.
        </p>
      </div>
    </ModalShell>
  )
}

// ── Modal Lập phiếu điều chỉnh ───────────────────────────────────────────────

type AdjustDraftLine = { on: boolean; item: ItemOpt | null; soLuong: string; donGia: string; ghiChu: string }

export function AdjustModal({
  detail, factoryId, onClose, onCreated,
}: { detail: PurchaseDetail; factoryId: string; onClose: () => void; onCreated: (adjId: string) => Promise<void> }) {
  const req = detail.request
  const lines = useMemo(() => detail.effectiveLines.filter((e) => remainingQty(e) > 0), [detail.effectiveLines])
  const [items, setItems] = useState<ItemOpt[]>([])
  const [lyDo, setLyDo] = useState("")
  const [draft, setDraft] = useState<Record<string, AdjustDraftLine>>(() =>
    Object.fromEntries(lines.map((e) => [e.root_line_id, {
      on: false, item: null, soLuong: String(e.so_luong), donGia: String(e.don_gia), ghiChu: "",
    }])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      const all: ItemOpt[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await supabase
          .from("inventory_items")
          .select("id, code, name, unit, category_id, don_gia, loai_tien, nguon_tao")
          .eq("factory_id", factoryId).eq("is_active", true).order("code").range(from, from + 999)
        if (e) break
        all.push(...((data || []) as ItemOpt[]))
        if (!data || data.length < 1000) break
      }
      setItems(all)
    }
    void run()
  }, [factoryId])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const patch = (id: string, p: Partial<AdjustDraftLine>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }))

  const rows = lines.map((e) => {
    const d = draft[e.root_line_id]
    const item = d.item || (e.item_id ? itemById.get(e.item_id) || null : null)
    const qty = Number(d.soLuong)
    const price = Number(d.donGia)
    const errs: string[] = []
    if (d.on) {
      if (!item) errs.push("Chọn vật tư")
      if (!(qty > 0)) errs.push("Số lượng phải > 0")
      else if (qty < e.received) errs.push(`Không nhỏ hơn số đã nhập (${formatQty(e.received)})`)
      else if (qty > e.so_luong) errs.push("Không tăng số lượng — mua thêm phải lập đề nghị mới")
      if (!(price >= 0) || d.donGia.trim() === "") errs.push("Đơn giá không hợp lệ")
      if (item && item.id !== e.item_id && e.received > 0) errs.push("Đã nhập theo mã cũ — không đổi mã được")
      if (item && item.id === e.item_id && qty === e.so_luong && price === e.don_gia) errs.push("Chưa thay đổi gì")
    }
    return { e, d, item, qty, price, errs }
  })
  const selected = rows.filter((r) => r.d.on)
  const blocking = !lyDo.trim() || !selected.length || selected.some((r) => r.errs.length > 0)

  const handleSubmit = async () => {
    setError(null)
    if (blocking) return
    setSaving(true)
    try {
      const adjId = await createAdjustment(req.id, {
        lyDo: lyDo.trim(),
        lines: selected.map((r) => ({
          parentLineId: r.e.root_line_id, itemId: r.item!.id, soLuong: r.qty, donGia: r.price, ghiChu: r.d.ghiChu.trim() || null,
        })),
      })
      await onCreated(adjId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lập được phiếu điều chỉnh")
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`Lập phiếu điều chỉnh — ${formatSoPhieuFull(req.so, req.nam)}`}
      onClose={onClose}
      maxWidth="4xl"
      closeOnBackdrop={false}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Đóng</button>
          <button onClick={handleSubmit} disabled={saving || blocking} className="flex items-center gap-1.5 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl disabled:opacity-60">
            {saving && <Loader2 size={14} className="animate-spin" />} Lập phiếu & gửi ký
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="whitespace-pre-line rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
        <p className="text-sm text-slate-600">
          Phiếu gốc giữ nguyên. Phiếu điều chỉnh có số mới, ghi rõ <b>Trước / Sau</b>, ký lại đủ 3 bước (Người đề nghị → Giám đốc → Kế toán). Duyệt xong mới nhập kho theo thông số mới. Không tăng được số lượng — mua thêm phải lập phiếu đề nghị mới.
        </p>
        <div className="space-y-2">
          {rows.map(({ e, d, item, errs }) => (
            <div key={e.root_line_id} className={`rounded-xl border p-3 ${d.on ? (errs.length ? "border-red-300 bg-red-50/30" : "border-sky-200") : "border-slate-200"}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={d.on} onChange={(ev) => patch(e.root_line_id, { on: ev.target.checked })} className="mt-1" />
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-slate-800">{e.item_name}</span>
                  <span className="ml-1.5 text-xs font-mono text-slate-500">{e.item_code}</span>
                  <span className="block text-xs text-slate-500">
                    Đang duyệt {formatQty(e.so_luong)} {e.unit} × {formatMoney(e.don_gia, req.loai_tien)} · đã nhập {formatQty(e.received)}
                  </span>
                </span>
              </label>
              {d.on && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="md:col-span-2">
                    <label className="text-[11px] font-bold text-slate-500">Vật tư sau điều chỉnh</label>
                    <ItemPicker
                      items={items}
                      value={item}
                      onSelect={(it) => patch(e.root_line_id, { item: it })}
                      disabledIds={new Set()}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">Tổng SL duyệt mới</label>
                    <input type="number" inputMode="decimal" min={e.received} max={e.so_luong} value={d.soLuong} onChange={(ev) => patch(e.root_line_id, { soLuong: ev.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500">Đơn giá mới ({req.loai_tien})</label>
                    <input type="number" inputMode="decimal" min={0} value={d.donGia} onChange={(ev) => patch(e.root_line_id, { donGia: ev.target.value })} className={inputCls} />
                  </div>
                  <div className="md:col-span-4">
                    <input value={d.ghiChu} onChange={(ev) => patch(e.root_line_id, { ghiChu: ev.target.value })} placeholder="Ghi chú dòng (tuỳ chọn)" className={inputCls} />
                  </div>
                </div>
              )}
              {d.on && errs.length > 0 && <p className="mt-1.5 text-xs font-semibold text-red-600">{errs.join(" · ")}</p>}
            </div>
          ))}
        </div>
        <div>
          <label className={labelCls}>Lý do điều chỉnh *</label>
          <textarea value={lyDo} onChange={(e) => setLyDo(e.target.value)} rows={3} placeholder="VD: Nhà cung cấp tăng giá; hết mã cũ, thay bằng mã tương đương…" className={inputCls} />
        </div>
      </div>
    </ModalShell>
  )
}

// ── Modal Đóng phiếu ─────────────────────────────────────────────────────────

export function ClosePurchaseModal({
  detail, onClose, onDone,
}: { detail: PurchaseDetail; onClose: () => void; onDone: () => void }) {
  const req = detail.request
  const [lyDo, setLyDo] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remaining: PurchaseEffectiveLine[] = detail.effectiveLines.filter((e) => remainingQty(e) > 0)

  const handle = async () => {
    if (!lyDo.trim()) return
    setSaving(true)
    setError(null)
    try {
      await closePurchase(req.id, lyDo.trim())
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đóng được phiếu")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`Đóng phiếu ${formatSoPhieuFull(req.so, req.nam)}`}
      onClose={onClose}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Huỷ bỏ</button>
          <button onClick={handle} disabled={saving || !lyDo.trim()} className="flex items-center gap-1.5 px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl disabled:opacity-60">
            {saving && <Loader2 size={14} className="animate-spin" />} Xác nhận đóng phiếu
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
        <p className="text-sm text-slate-600">Phần còn lại sẽ <b>không được nhập kho nữa</b>. Giám đốc và Kế toán nhận thông báo.</p>
        {remaining.length > 0 && (
          <ul className="text-xs text-slate-600 space-y-0.5">
            {remaining.map((e) => <li key={e.root_line_id}>• {e.item_name}: còn {formatQty(remainingQty(e))} {e.unit}</li>)}
          </ul>
        )}
        <label className={labelCls}>Lý do đóng phiếu *</label>
        <textarea value={lyDo} onChange={(e) => setLyDo(e.target.value)} rows={3} placeholder="VD: Nhà cung cấp hết hàng, không mua tiếp" className={inputCls} />
      </div>
    </ModalShell>
  )
}

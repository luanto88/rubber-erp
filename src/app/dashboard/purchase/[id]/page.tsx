"use client"

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle, ArrowLeft, Ban, BarChart3, Bell, Building, Calendar, CalendarClock, CheckCircle2, Clock, Coins, Download, Eye, FilePen, FileText, ImagePlus, Images, Loader2, Lock, PackageCheck,
  Pencil, PenTool, Send, ShieldCheck, ShoppingCart, Tag, User,
} from "lucide-react"
import { DetailCard, DetailFieldItem, DetailFileCard, DetailQrBox } from "@/app/dashboard/_components/detail-view-ui"
import { getActiveFactoryId, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { authFetch } from "@/lib/auth-fetch"
import { buildStorageDownloadUrl, safeDownloadFileName } from "@/lib/storage-download"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import {
  formatMoney, formatQty, formatSoPhieuFull, isPurchaseActive, PURCHASE_SIGN_ORDER, PURCHASE_STATUS_CLASS, PURCHASE_STATUS_LABEL,
  insightWarnings, purchaseUrgency, type PurchaseSignRole,
} from "@/lib/purchase/types"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { PurchaseForm } from "../_components/purchase-form"
import { fetchPurchaseDetail, readJson, submitPurchaseForSigning, updateLineImages, type PurchaseDetail } from "../_components/purchase-client"
import { ImageLightbox, PurchaseImagePicker } from "../_components/purchase-image-picker"
import { PurchaseInsightPanel } from "../_components/purchase-insight-panel"
import { AdjustModal, ClosePurchaseModal, PurchaseFulfillmentPanel, ReceiveModal } from "../_components/purchase-fulfillment"

const LOG_LABEL: Record<string, string> = {
  tao: "Tạo phiếu",
  gui_ky: "Gửi ký duyệt",
  gui_lai: "Gửi ký lại sau khi sửa",
  tra_ve: "Bị trả về",
  da_duyet: "Đã duyệt xong",
  huy: "Huỷ phiếu",
  nhap_kho: "Ghi nhận mua / nhập kho",
  lap_dieu_chinh: "Lập phiếu điều chỉnh",
  tao_dieu_chinh: "Tạo phiếu điều chỉnh",
  dieu_chinh_duyet: "Phiếu điều chỉnh đã duyệt",
  dong: "Đóng phiếu",
  cap_nhat_anh: "Cập nhật ảnh dòng vật tư",
  tao_tu_bao_tri: "Lập từ biên bản bảo trì",
  nhan_xu_ly: "Nhận xử lý phiếu từ biên bản bảo trì",
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ""
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

function PurchaseDetailInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = params.id
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PurchaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(searchParams.get("submitError"))
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  // Sửa ảnh 1 dòng: id dòng + danh sách ảnh đang chỉnh.
  const [imageEdit, setImageEdit] = useState<{ lineId: string; label: string; urls: string[]; readOnly: boolean } | null>(null)
  const [imageSaving, setImageSaving] = useState(false)
  // Dòng đang mở panel "Bằng chứng" (số liệu tồn kho chụp lúc gửi ký).
  const [openInsight, setOpenInsight] = useState<Record<string, boolean>>({})
  const [imageError, setImageError] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      const { user: u } = await hydrateActiveSession()
      if (!u) { setLoading(false); return }
      setUser(u)
      setFactoryId(await getActiveFactoryId())
    }
    void bootstrap()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await fetchPurchaseDetail(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được phiếu")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const existing = useMemo(() => (detail ? { request: detail.request, lines: detail.lines } : null), [detail])

  const handleSubmit = async () => {
    if (!factoryId) return
    setBusy(true)
    setActionError(null)
    try {
      const yeuCauId = await submitPurchaseForSigning(id, factoryId)
      router.push(`/dashboard/ky/${yeuCauId}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không gửi ký được")
    } finally {
      setBusy(false)
    }
  }

  const handleAdjustmentCreated = async (adjId: string) => {
    setAdjustOpen(false)
    if (!factoryId) { router.push(`/dashboard/purchase/${adjId}`); return }
    try {
      const yeuCauId = await submitPurchaseForSigning(adjId, factoryId)
      router.push(`/dashboard/ky/${yeuCauId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Không gửi ký được"
      router.push(`/dashboard/purchase/${adjId}?submitError=${encodeURIComponent(msg)}`)
    }
  }

  const handleSaveImages = async () => {
    if (!imageEdit) return
    setImageSaving(true)
    setImageError(null)
    try {
      await updateLineImages(id, imageEdit.lineId, imageEdit.urls)
      setImageEdit(null)
      void load()
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Không lưu được ảnh")
    } finally {
      setImageSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelReason.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      await readJson(await authFetch(`/api/purchase/requests/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lyDo: cancelReason.trim() }),
      }))
      setCancelOpen(false)
      setCancelReason("")
      void load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không huỷ được phiếu")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !detail) {
    return <div className="p-12 text-center text-slate-400"><Loader2 className="mx-auto animate-spin mb-2" />Đang tải phiếu...</div>
  }
  if (error || !detail) {
    return (
      <div className="p-12 text-center">
        <AlertTriangle className="mx-auto mb-2 text-red-500" />
        <p className="font-bold text-red-600">{error || "Không tìm thấy phiếu"}</p>
        <Link href="/dashboard" className="inline-block mt-3 text-sm text-teal-700 underline">Về Dashboard</Link>
      </div>
    )
  }

  const req = detail.request
  const soPhieu = formatSoPhieuFull(req.so, req.nam)
  const signerByThuTu = new Map(detail.signers.map((s) => [s.thuTu, s]))
  const pending = detail.signers.filter((s) => s.trangThai !== "da_ky").sort((a, b) => a.thuTu - b.thuTu)
  const myTurn = req.trang_thai === "cho_ky" && !!pending[0] && pending.filter((s) => s.thuTu === pending[0].thuTu).some((s) => s.userId === user?.id)
  const assigned: Record<PurchaseSignRole, string | null> = {
    nguoi_de_nghi: req.nguoi_de_nghi_id,
    giam_doc: req.giam_doc_user_id,
    ke_toan: req.ke_toan_user_id,
  }
  const isAdjustment = req.loai === "dieu_chinh"
  const urgency = isPurchaseActive(req.trang_thai) ? purchaseUrgency(req.ngay_can_hang, getFactoryTodayISO()) : null
  const fileName = safeDownloadFileName(`${isAdjustment ? "Phiếu điều chỉnh" : "Phiếu đề nghị mua"} ${soPhieu.replace("/", "-")}`, "pdf")

  if (editing) {
    return (
      <div className="space-y-4">
        <PageHeaderBanner title={`Sửa phiếu ${soPhieu}`} subtitle="Sửa xong bấm Lưu & gửi ký để gửi lại" theme="teal" icon={ShoppingCart} />
        {factoryId && user && existing && (
          <PurchaseForm
            factoryId={factoryId}
            userId={user.id}
            existing={existing}
            onCancel={() => setEditing(false)}
            onSaved={async (_id, submitAfter) => {
              setEditing(false)
              if (submitAfter) await handleSubmit()
              else void load()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeaderBanner
        title={`${isAdjustment ? "Phiếu điều chỉnh" : "Phiếu đề nghị mua"} ${soPhieu}`}
        subtitle={`Ngày ${fmtDate(req.ngay)} · Người đề nghị: ${req.nguoi_de_nghi_ten || detail.names[req.nguoi_de_nghi_id] || ""}${req.bo_phan ? ` · Bộ phận: ${req.bo_phan}` : ""}`}
        theme="teal"
        icon={ShoppingCart}
        action={
          <button onClick={() => router.push("/dashboard/purchase")} className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 border border-white/40 text-white font-bold rounded-xl">
            <ArrowLeft size={16} /> Danh sách
          </button>
        }
      />

      {detail.maintenanceSource && (
        <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-900">
          <b>Lập từ biên bản bảo trì</b>{" "}
          <Link href={`/dashboard/maintenance/records/${detail.maintenanceSource.id}`} className="font-bold underline">{detail.maintenanceSource.maBb || "(chưa có mã)"}</Link>
          {" "}— vật tư mua ngoài, nhập kho vào kho tạm {detail.maintenanceSource.ktCode}; biên bản chỉ gửi ký được khi kho tạm đủ hàng.
          {detail.perms.canTakeOver && " Bạn có thể thêm/bớt vật tư, tăng số lượng: bấm “Nhận xử lý” rồi Lưu — bạn sẽ là người đề nghị (ký bước 1 và ghi nhận mua)."}
        </div>
      )}
      {isAdjustment && (
        <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900">
          <b>Phiếu điều chỉnh</b>{detail.parent && <> của phiếu <Link href={`/dashboard/purchase/${detail.parent.id}`} className="font-bold underline">{formatSoPhieuFull(detail.parent.so, detail.parent.nam)}</Link></>}.
          {" "}Lý do: {req.ly_do_dieu_chinh}.
          {req.trang_thai === "hoan_tat" ? " Đã duyệt — thông số mới đã áp dụng cho phiếu gốc." : " Duyệt xong mới nhập kho theo thông số mới."}
          {req.trang_thai === "tra_ve" && " Phiếu điều chỉnh không sửa được — huỷ rồi lập phiếu điều chỉnh mới nếu cần đổi nội dung."}
        </div>
      )}
      {urgency && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm ${urgency.level === "qua_han" || urgency.level === "gap" ? "bg-red-50 border border-red-200 text-red-800" : urgency.level === "sap" ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-slate-50 border border-slate-200 text-slate-700"}`}>
          <CalendarClock size={16} className="shrink-0" />
          <span>Cần hàng sớm nhất: <b>{fmtDate(req.ngay_can_hang as string)}</b></span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${urgency.className}`}>{urgency.label}</span>
        </div>
      )}
      {notice && <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
      {detail.pendingAdjustmentId && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Đang có <Link href={`/dashboard/purchase/${detail.pendingAdjustmentId}`} className="font-bold underline">phiếu điều chỉnh chưa duyệt</Link> — các dòng liên quan tạm khoá nhập kho.
        </div>
      )}
      {req.trang_thai === "tra_ve" && detail.traVeLyDo && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          <b>Phiếu bị trả về:</b> {detail.traVeLyDo}. Người đề nghị sửa lại rồi gửi ký lại.
        </div>
      )}
      {req.trang_thai === "huy" && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <b>Đã huỷ</b> lúc {fmtDateTime(req.huy_luc)}{detail.request.huy_boi ? ` bởi ${detail.names[detail.request.huy_boi] || ""}` : ""}. Lý do: {req.ly_do_huy}. Số phiếu vẫn được giữ.
        </div>
      )}
      {actionError && <div className="whitespace-pre-line rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700">{actionError}</div>}

      {/* Top Card: File-First nếu đã có PDF */}
      {detail.fileHienTai && (
        <DetailFileCard
          fileName={fileName}
          fileType="pdf"
          fileSize="PDF Bản điện tử"
          statusLabel={PURCHASE_STATUS_LABEL[req.trang_thai]}
          statusTone={req.trang_thai === "hoan_tat" ? "emerald" : req.trang_thai === "cho_ky" ? "amber" : "blue"}
          onView={() => window.open(detail.fileHienTai!, "_blank")}
          onDownload={() => { window.location.href = buildStorageDownloadUrl(detail.fileHienTai!, fileName) }}
        />
      )}

      {/* Thông tin chung phiếu đề nghị */}
      <DetailCard
        title={`${isAdjustment ? "Phiếu điều chỉnh" : "Đề nghị mua sắm"} ${soPhieu}`}
        subtitle={`Phiếu được khởi tạo ngày ${fmtDate(req.ngay)} · Đề xuất vật tư sản xuất & vận hành`}
        icon={<ShoppingCart size={18} />}
        iconTone="teal"
        badge={
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${PURCHASE_STATUS_CLASS[req.trang_thai]}`}>
            {PURCHASE_STATUS_LABEL[req.trang_thai]}
          </span>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
          <DetailFieldItem
            icon={<Tag size={15} />}
            iconTone="rose"
            label="Mã / Số phiếu"
            value={soPhieu}
            mono
          />
          <DetailFieldItem
            icon={<Calendar size={15} />}
            iconTone="emerald"
            label="Ngày đề nghị"
            value={fmtDate(req.ngay)}
          />
          <DetailFieldItem
            icon={<User size={15} />}
            iconTone="pink"
            label="Người đề nghị"
            value={req.nguoi_de_nghi_ten || detail.names[req.nguoi_de_nghi_id] || "—"}
          />
          <DetailFieldItem
            icon={<Building size={15} />}
            iconTone="blue"
            label="Bộ phận đề nghị"
            value={req.bo_phan || "—"}
          />
          <DetailFieldItem
            icon={<CalendarClock size={15} />}
            iconTone="amber"
            label="Cần hàng sớm nhất"
            value={req.ngay_can_hang ? fmtDate(req.ngay_can_hang) : "—"}
            extra={
              urgency ? (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${urgency.className}`}>
                  {urgency.label}
                </span>
              ) : null
            }
          />
          <DetailFieldItem
            icon={<Coins size={15} />}
            iconTone="emerald"
            label="Tổng tiền dự toán"
            value={`${formatMoney(req.tong_tien, req.loai_tien)} ${req.loai_tien}`}
            highlight="emerald"
            mono
          />
          <DetailFieldItem
            icon={<ShieldCheck size={15} />}
            iconTone="teal"
            label="Trạng thái duyệt"
            value={PURCHASE_STATUS_LABEL[req.trang_thai]}
          />
          <DetailFieldItem
            icon={<FileText size={15} />}
            iconTone="slate"
            label="Ghi chú / Mục đích"
            value={req.ghi_chu || req.ly_do_dieu_chinh || "Không có ghi chú"}
            colSpan={2}
          />
        </div>

        {typeof window !== "undefined" && (
          <div className="mt-4 pt-3.5 border-t border-slate-100">
            <DetailQrBox
              qrUrl={`${window.location.origin}/dashboard/purchase/${id}`}
              label="Tra cứu trực tuyến phiếu đề nghị mua"
            />
          </div>
        )}
      </DetailCard>

      {/* Thanh hành động */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${PURCHASE_STATUS_CLASS[req.trang_thai]}`}>{PURCHASE_STATUS_LABEL[req.trang_thai]}</span>
        <div className="flex-1" />
        {detail.fileHienTai && (
          <>
            <a href={detail.fileHienTai} target="_blank" rel="noreferrer" className="p-2 rounded-lg text-teal-700 hover:bg-teal-50" title="Xem file PDF">
              <Eye size={17} />
            </a>
            <a href={buildStorageDownloadUrl(detail.fileHienTai, fileName)} className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Tải file PDF">
              <Download size={17} />
            </a>
          </>
        )}
        {myTurn && req.yeu_cau_ky_id && (
          <Link href={`/dashboard/ky/${req.yeu_cau_ky_id}`} className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl shadow">
            <Bell size={15} /> Ký ngay
          </Link>
        )}
        {!myTurn && req.trang_thai === "cho_ky" && req.yeu_cau_ky_id && (
          <Link href={`/dashboard/ky/${req.yeu_cau_ky_id}`} className="flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50">
            <PenTool size={15} /> Màn ký
          </Link>
        )}
        {detail.perms.canEdit && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-4 py-2 border border-sky-300 text-sky-700 text-sm font-bold rounded-xl hover:bg-sky-50">
            <Pencil size={15} /> {detail.perms.canTakeOver ? "Nhận xử lý" : "Sửa"}
          </button>
        )}
        {detail.perms.canSubmit && (
          <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {req.trang_thai === "tra_ve" ? "Gửi ký lại" : "Gửi ký"}
          </button>
        )}
        {detail.perms.canReceive && (
          <button onClick={() => { setNotice(null); setReceiveOpen(true) }} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow">
            <PackageCheck size={15} /> Ghi nhận mua / Nhập kho
          </button>
        )}
        {detail.perms.canAdjust && (
          <button onClick={() => setAdjustOpen(true)} className="flex items-center gap-1.5 px-4 py-2 border border-sky-300 text-sky-700 text-sm font-bold rounded-xl hover:bg-sky-50">
            <FilePen size={15} /> Lập phiếu điều chỉnh
          </button>
        )}
        {detail.perms.canClose && (
          <button onClick={() => setCloseOpen(true)} className="flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50">
            <Lock size={15} /> Đóng phiếu
          </button>
        )}
        {detail.perms.canCancel && (
          <button onClick={() => setCancelOpen(true)} className="flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 text-sm font-bold rounded-xl hover:bg-red-50">
            <Ban size={15} /> Huỷ phiếu
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bảng vật tư */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-700">Nội dung đề nghị</h3>
            <span className="text-sm font-extrabold text-slate-800">{formatMoney(req.tong_tien, req.loai_tien)} {req.loai_tien}</span>
          </div>
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Vật tư</th>
                  <th className="px-2 py-2 text-right">SL</th>
                  <th className="px-2 py-2 text-right">Đơn giá</th>
                  <th className="px-2 py-2 text-right">Thành tiền</th>
                  <th className="px-2 py-2 text-left">{isAdjustment ? "Trước điều chỉnh / Ghi chú" : "Mục đích / Ghi chú"}</th>
                  <th className="px-2 py-2 text-center w-12">Ảnh</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => {
                  const lech = l.lech_gia_pct !== null && Math.abs(Number(l.lech_gia_pct)) > 10
                  const snap = l.insight_snapshot || null
                  const warnCount = snap ? insightWarnings(snap).length : 0
                  const insightOpen = !!openInsight[l.id]
                  return (
                    <Fragment key={l.id}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-2 py-2">
                        <p className="font-semibold text-slate-800">{l.item_name}</p>
                        <p className="text-xs text-slate-500 font-mono">{l.item_code} · {l.unit}</p>
                        {l.la_vat_tu_moi && <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Vật tư mới</span>}
                        {req.trang_thai !== "nhap" && (
                          <button
                            type="button"
                            onClick={() => setOpenInsight((prev) => ({ ...prev, [l.id]: !prev[l.id] }))}
                            aria-expanded={insightOpen}
                            className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                              warnCount > 0 ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-sky-50 text-sky-700 hover:bg-sky-100"
                            }`}
                            title="Tồn kho, tiêu hao, lần mua trước — số liệu lúc gửi ký"
                          >
                            <BarChart3 size={12} /> Bằng chứng{warnCount > 0 ? ` · ${warnCount} cảnh báo` : ""}
                          </button>
                        )}
                        {(l.mua_tai || l.ngay_co_hang || l.ngay_can_hang) && (
                          <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                            {[
                              l.mua_tai && `Mua tại: ${l.mua_tai}`,
                              l.ngay_co_hang && `Có hàng: ${fmtDate(l.ngay_co_hang)}`,
                              l.ngay_can_hang && `Cần hàng: ${fmtDate(l.ngay_can_hang)}`,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">{formatQty(l.so_luong)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {formatMoney(l.don_gia, req.loai_tien)}
                        {lech && (
                          <p className="text-[11px] text-red-600 font-semibold">{Number(l.lech_gia_pct) > 0 ? "+" : ""}{Number(l.lech_gia_pct).toFixed(0)}% so với gợi ý</p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold whitespace-nowrap">{formatMoney(l.thanh_tien, req.loai_tien)}</td>
                      <td className="px-2 py-2 text-xs text-slate-600">
                        {isAdjustment && (
                          <p className="text-slate-500">
                            Trước: {(l.truoc_item_code || "") !== (l.item_code || "") ? `${l.truoc_item_code} ${l.truoc_item_name} · ` : ""}
                            SL {formatQty(l.truoc_so_luong)} · giá {formatMoney(l.truoc_don_gia, req.loai_tien)}
                          </p>
                        )}
                        {l.muc_dich}
                        {l.ghi_chu && <p className="text-slate-500">{l.ghi_chu}</p>}
                        {lech && l.ly_do_lech_gia && <p className="text-red-600">Lý do lệch giá: {l.ly_do_lech_gia}</p>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {(() => {
                          const n = l.image_urls?.length || 0
                          const canEdit = detail.perms.canEditImages
                          if (!canEdit && n === 0) return null
                          const Icon = canEdit ? ImagePlus : Images
                          return (
                            <button
                              type="button"
                              onClick={() => { setImageError(null); setImageEdit({ lineId: l.id, label: l.item_name, urls: [...(l.image_urls || [])], readOnly: !canEdit }) }}
                              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-teal-600 hover:bg-teal-50"
                              title={canEdit ? "Ảnh của dòng này" : "Xem ảnh của dòng này"}
                            >
                              <Icon size={16} />
                              {n > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-teal-600 text-white text-[10px] font-bold leading-4">{n}</span>
                              )}
                            </button>
                          )
                        })()}
                      </td>
                    </tr>
                    {insightOpen && (
                      <tr className="bg-white">
                        <td colSpan={7} className="px-2 pb-3">
                          {snap ? (
                            <PurchaseInsightPanel insight={snap} unit={l.unit} capturedAt={snap.capturedAt} />
                          ) : (
                            <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500">
                              Phiếu gửi ký trước khi có tính năng chụp số liệu — không có bằng chứng tồn kho lúc gửi ký.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
          {req.ghi_chu && <p className="px-4 py-3 text-sm text-slate-600 border-t border-slate-100">Ghi chú: {req.ghi_chu}</p>}
        </div>
        {!isAdjustment && detail.effectiveLines.length > 0 && (
          <div className="lg:col-span-2 lg:row-start-2">
            <PurchaseFulfillmentPanel detail={detail} />
          </div>
        )}

        {/* Luồng ký */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-extrabold text-slate-700 mb-3">Luồng ký duyệt</h3>
            <ol className="space-y-3">
              {(Object.keys(PURCHASE_SIGN_ORDER) as PurchaseSignRole[]).map((role) => {
                const cfg = PURCHASE_SIGN_ORDER[role]
                const s = signerByThuTu.get(cfg.thuTu)
                const uid = s?.userId || assigned[role]
                const done = s?.trangThai === "da_ky"
                const isTurn = req.trang_thai === "cho_ky" && pending[0]?.thuTu === cfg.thuTu
                return (
                  <li key={role} className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-600" : isTurn ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-400"}`}>
                      {done ? <CheckCircle2 size={15} /> : <Clock size={15} />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-500">{cfg.label}</p>
                      <p className="text-sm font-semibold text-slate-800">{(uid && detail.names[uid]) || s?.hoTen || "—"}</p>
                      <p className="text-xs text-slate-500">{done ? `Đã ký ${fmtDateTime(s?.kyLuc)}` : isTurn ? "Đang chờ ký" : req.trang_thai === "nhap" ? "Chưa gửi" : "Chờ bước trước"}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-extrabold text-slate-700 mb-2">Nhật ký</h3>
            <ul className="space-y-1.5 text-xs text-slate-600">
              {detail.logs.map((l, i) => (
                <li key={i}>
                  <span className="text-slate-400">{fmtDateTime(l.created_at)}</span> · <b>{LOG_LABEL[l.hanh_dong] || l.hanh_dong}</b>
                  {l.user_id && detail.names[l.user_id] ? ` — ${detail.names[l.user_id]}` : ""}
                  {l.noi_dung ? `: ${l.noi_dung}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {receiveOpen && factoryId && (
        <ReceiveModal
          detail={detail}
          factoryId={factoryId}
          onClose={() => setReceiveOpen(false)}
          onDone={(msg) => { setReceiveOpen(false); setNotice(msg); void load() }}
        />
      )}
      {adjustOpen && factoryId && (
        <AdjustModal detail={detail} factoryId={factoryId} onClose={() => setAdjustOpen(false)} onCreated={handleAdjustmentCreated} />
      )}
      {closeOpen && (
        <ClosePurchaseModal detail={detail} onClose={() => setCloseOpen(false)} onDone={() => { setCloseOpen(false); void load() }} />
      )}
      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
      {imageEdit && factoryId && (
        <ModalShell
          title={`Ảnh: ${imageEdit.label}`}
          onClose={() => setImageEdit(null)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setImageEdit(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Đóng</button>
              {!imageEdit.readOnly && (
                <button onClick={handleSaveImages} disabled={imageSaving} className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-60">
                  {imageSaving && <Loader2 size={14} className="animate-spin" />} Lưu ảnh
                </button>
              )}
            </>
          }
        >
          {imageEdit.readOnly ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {imageEdit.urls.map((u, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${k}-${u}`} src={u} alt={`Ảnh ${k + 1}`} onClick={() => setLightbox(u)} className="aspect-square w-full rounded-lg object-cover border border-slate-200 cursor-zoom-in" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Ảnh không in lên phiếu nên cập nhật được cả sau khi đã ký — không ảnh hưởng chữ ký số. Bấm vào ảnh để phóng to.</p>
              <PurchaseImagePicker
                factoryId={factoryId}
                documentType="purchase-requests"
                images={imageEdit.urls}
                onChange={(urls) => setImageEdit((p) => (p ? { ...p, urls } : p))}
                onPreview={setLightbox}
              />
              {imageError && <p className="text-sm font-semibold text-red-600">{imageError}</p>}
            </div>
          )}
        </ModalShell>
      )}
      {cancelOpen && (
        <ModalShell
          title={`Huỷ phiếu ${soPhieu}`}
          onClose={() => setCancelOpen(false)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setCancelOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Đóng</button>
              <button onClick={handleCancel} disabled={busy || !cancelReason.trim()} className="flex items-center gap-1.5 px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl disabled:opacity-60">
                {busy && <Loader2 size={14} className="animate-spin" />} Xác nhận huỷ
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Phiếu bị huỷ vẫn giữ nguyên số <b>{soPhieu}</b> (không cấp lại).
              {req.trang_thai === "da_duyet" && " File đã ký được giữ nguyên làm bằng chứng."}
            </p>
            <label className="text-xs font-bold text-slate-600 block">Lý do huỷ *</label>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-red-500" />
          </div>
        </ModalShell>
      )}
    </div>
  )
}

export default function PurchaseDetailPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Đang tải...</div>}>
      <PurchaseDetailInner />
    </Suspense>
  )
}

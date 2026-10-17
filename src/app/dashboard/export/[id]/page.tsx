"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ClipboardList, Download, FileOutput, FileText, Leaf, Truck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, hydrateActiveSession } from "@/lib/auth"
import { formatDateDisplay } from "@/lib/date-utils"
import {
  buildExportOrderPdfBytes,
  downloadExportOrderPdf,
  type ExportOrderPdfAssignment,
  type ExportOrderPdfInput,
  type ExportOrderPdfVehicle,
} from "@/lib/export-order-pdf"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

/**
 * Trang chi tiết đơn xuất hàng (rule 29 mục C, 2026-10-17).
 * Cột trái nhúng PDF biên bản giao nhận dựng ngay trong trình duyệt (DocViewer loadBytes).
 * Duyệt / Sửa / Cấp quyền KH vẫn làm ở danh sách (duyệt có reconcile trạng thái lô).
 */

type ChiTieuReq = { ten: string; min: string; max: string }
type ExportOrderRow = {
  id: string
  factory_id: string
  ma_don: string
  ngay: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  chung_loai: string
  loai_pallet: string
  loai_banh: number
  loai_boc: string
  vehicles: ExportOrderPdfVehicle[] | null
  assignments: ExportOrderPdfAssignment[] | null
  tong_banh: number
  yeu_cau_chi_tieu: ChiTieuReq[] | null
  trang_thai: string | null
  updated_at?: string | null
  customers?: { ma_kh: string | null; ten_kh_en: string | null } | null
}

const EUDR_BASE = "https://qlsxkpt.vercel.app/dashboard/eudr?order="

const sumKien = (a: ExportOrderPdfAssignment) =>
  (a.kien_a || 0) + (a.kien_b || 0) + (a.kien_c || 0) + (a.kien_d || 0)

export default function ExportOrderDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const orderId = typeof params?.id === "string" ? params.id : ""
  const isDesktop = useIsDesktop()

  const [order, setOrder] = useState<ExportOrderRow | null>(null)
  const [factoryName, setFactoryName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "content">("file")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  const loadOrder = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { user } = await hydrateActiveSession()
      if (!user) {
        window.location.replace(`/login?next=${encodeURIComponent(`/dashboard/export/${orderId}`)}`)
        return
      }
      if (!hasPermission(user, "export.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = user.factory_id
      if (!fid) {
        setLoadError("Tài khoản chưa được gán nhà máy.")
        return
      }
      const { data, error } = await supabase
        .from("export_orders")
        .select("*, customers(ma_kh,ten_kh_en)")
        .eq("id", orderId)
        .eq("factory_id", fid)
        .maybeSingle()
      if (error) {
        setLoadError(error.message)
        return
      }
      if (!data) {
        setOrder(null)
        return
      }
      setOrder(data as ExportOrderRow)
      const { data: fac } = await supabase.from("factories").select("name").eq("id", fid).maybeSingle()
      setFactoryName((fac as { name?: string } | null)?.name ?? null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được đơn xuất hàng.")
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (orderId) void loadOrder()
  }, [orderId, loadOrder])

  const pdfInput = useMemo<ExportOrderPdfInput | null>(() => {
    if (!order) return null
    return {
      ma_don: order.ma_don,
      ngay: order.ngay,
      so_thong_bao: order.so_thong_bao,
      so_hoa_don: order.so_hoa_don,
      so_hop_dong: order.so_hop_dong,
      chung_loai: order.chung_loai,
      loai_pallet: order.loai_pallet,
      loai_banh: order.loai_banh,
      loai_boc: order.loai_boc,
      vehicles: order.vehicles ?? [],
      assignments: order.assignments ?? [],
      tong_banh: order.tong_banh,
      customerName: order.customers?.ten_kh_en || null,
    }
  }, [order])

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (loading) {
    return <div className={moduleThemeClass("ocean")}><ListState kind="loading" /></div>
  }
  if (loadError) {
    return (
      <div className={moduleThemeClass("ocean")}>
        <ListState kind="error" message={loadError} onRetry={() => void loadOrder()} />
      </div>
    )
  }
  if (!order || !pdfInput) {
    return (
      <div className={moduleThemeClass("ocean")}>
        <ListState kind="empty" message="Không tìm thấy đơn xuất hàng, hoặc bạn không có quyền xem." />
      </div>
    )
  }

  const vehicles = order.vehicles ?? []
  const assignments = order.assignments ?? []
  const chiTieu = (order.yeu_cau_chi_tieu ?? []).filter((c) => c?.ten)
  const status = order.trang_thai || "da_phe_duyet"
  const customerName = order.customers?.ten_kh_en || "—"
  const fileBase = `Biên bản xuất hàng ${order.ma_don}`.replace(/[\\/:*?"<>|]/g, "-")

  const downloadPdf = async () => {
    try {
      await downloadExportOrderPdf(pdfInput, factoryName)
    } catch {
      showToast("Không tạo được PDF biên bản.", false)
    }
  }
  const openInList = () => router.push(`/dashboard/export?search=${encodeURIComponent(order.ma_don)}`)

  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF biên bản", icon: <Download size={14} />, onClick: () => void downloadPdf() },
    { key: "list", label: "Mở trong danh sách (duyệt/sửa/cấp quyền)", icon: <ClipboardList size={14} />, onClick: openInList },
    { key: "eudr", label: "Truy xuất EUDR", icon: <Leaf size={14} />, onClick: () => router.push(`/dashboard/eudr?order=${encodeURIComponent(order.ma_don)}`) },
  ]

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const contentTables = (
    <div className="space-y-4">
      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[640px]">
          <thead>
            <tr>
              <th>Xe</th>
              <th>Biển trước</th>
              <th>Biển sau</th>
              <th>Loại xe</th>
              <th className="text-right">Số lô</th>
              <th className="text-right">Số bành</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <ListState kind="empty" message="Đơn chưa có xe" asRow colSpan={6} />
            ) : vehicles.map((v, idx) => {
              const vAssign = assignments.filter((a) => a.vehicleIdx === idx)
              return (
                <tr key={v.id || idx}>
                  <td className="whitespace-nowrap font-semibold text-slate-700">Xe {idx + 1}</td>
                  <td className="whitespace-nowrap font-code">{v.bien_truoc || "—"}</td>
                  <td className="whitespace-nowrap font-code">{v.bien_sau || "—"}</td>
                  <td>{v.loai_xe || "—"}</td>
                  <td className="text-right">{vAssign.length}</td>
                  <td className="text-right font-semibold">{vAssign.reduce((s, a) => s + sumKien(a), 0).toLocaleString("vi-VN")}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[640px]">
          <thead>
            <tr>
              <th>Mã lô</th>
              <th>Xe</th>
              <th className="text-right">A</th>
              <th className="text-right">B</th>
              <th className="text-right">C</th>
              <th className="text-right">D</th>
              <th className="text-right">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 ? (
              <ListState kind="empty" message="Đơn chưa gán lô" asRow colSpan={7} />
            ) : assignments.map((a, i) => (
              <tr key={`${a.lot_id}-${a.vehicleIdx}-${i}`}>
                <td className="whitespace-nowrap font-semibold text-slate-800">{a.ma_lo}</td>
                <td className="whitespace-nowrap">Xe {a.vehicleIdx + 1}</td>
                <td className="text-right">{a.kien_a || ""}</td>
                <td className="text-right">{a.kien_b || ""}</td>
                <td className="text-right">{a.kien_c || ""}</td>
                <td className="text-right">{a.kien_d || ""}</td>
                <td className="text-right font-semibold">{sumKien(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {chiTieu.length > 0 && (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense">
            <thead>
              <tr>
                <th>Chỉ tiêu yêu cầu</th>
                <th className="text-right">Min</th>
                <th className="text-right">Max</th>
              </tr>
            </thead>
            <tbody>
              {chiTieu.map((c, i) => (
                <tr key={`${c.ten}-${i}`}>
                  <td>{c.ten}</td>
                  <td className="text-right">{c.min || "—"}</td>
                  <td className="text-right">{c.max || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}
    </div>
  )

  return (
    <div className={moduleThemeClass("ocean")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/export"
            backLabel="Quay lại danh sách xuất hàng"
            eyebrow="Biên bản giao nhận xuất hàng"
            title={customerName !== "—" ? customerName : `Đơn ngày ${formatDateDisplay(order.ngay)}`}
            code={order.ma_don}
            tags={
              <>
                <span className={chip}>{formatDateDisplay(order.ngay)}</span>
                <span className={chip}>{vehicles.length} xe</span>
                <span className={chip}>{Number(order.tong_banh || 0).toLocaleString("vi-VN")} bành</span>
                {order.chung_loai && <span className={chip}>{order.chung_loai}</span>}
              </>
            }
            actions={
              <>
                <HeaderButton icon={<Download size={15} />} label="Tải PDF biên bản" onClick={() => void downloadPdf()} />
                <HeaderQr value={`${EUDR_BASE}${encodeURIComponent(order.ma_don)}`} code={order.ma_don} title="QR truy xuất EUDR" />
              </>
            }
          />
        }
        document={
          <>
            <SegmentedTabs
              ariaLabel="Chọn nội dung cột tài liệu"
              value={docTab}
              onChange={setDocTab}
              items={[
                { key: "file", label: "Biên bản PDF", icon: FileText },
                { key: "content", label: "Nội dung", icon: Truck },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`export-${order.id}`}
                active={isDesktop || mobileTab === "doc"}
                loadBytes={() => buildExportOrderPdfBytes(pdfInput, factoryName)}
                sourceKey={`export-${order.id}-${order.updated_at ?? ""}-${assignments.length}-${vehicles.length}-${factoryName ?? ""}`}
                kind="pdf"
                fileExt="pdf"
                label={`${fileBase} · Bản xem trước PDF`}
              />
            ) : contentTables}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="export"
              status={status}
              headline={`${Number(order.tong_banh || 0).toLocaleString("vi-VN")} bành · ${vehicles.length} xe`}
            />
            <SignActionBox primary={null} secondary={secondary} danger={[]} />
            <InspectorCard title="Thông tin đơn" icon={FileOutput}>
              <MetaList>
                <MetaRow label="Khách hàng" value={customerName} />
                <MetaRow label="Ngày xuất" value={formatDateDisplay(order.ngay)} />
                <MetaRow label="Số thông báo" value={order.so_thong_bao || "—"} />
                <MetaRow label="Số hóa đơn" value={order.so_hoa_don || "—"} />
                <MetaRow label="Số hợp đồng" value={order.so_hop_dong || "—"} />
                <MetaRow label="Chủng loại" value={order.chung_loai || "—"} />
                <MetaRow label="Loại bành" value={order.loai_banh ? `${order.loai_banh} kg` : "—"} />
                <MetaRow label="Loại bọc" value={order.loai_boc || "—"} />
                <MetaRow label="Pallet" value={order.loai_pallet || "—"} />
                <MetaRow label="Số lô gán" value={`${new Set(assignments.map((a) => a.ma_lo)).size} lô`} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Ban, Check, ClipboardList, Download, FileText, Package, Pencil, Printer, RotateCcw, Warehouse } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getFreshAuthSession, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { formatDateDisplay } from "@/lib/date-utils"
import {
  buildInventoryDocumentPdfBytes,
  downloadInventoryDocumentPdf,
  inventoryDocumentTitle,
  type InventoryDocumentPdfInput,
  type InventoryDocumentPdfType,
  type InventoryDocumentPdfWarehouse,
} from "@/lib/inventory-document-pdf"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
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
import { fetchInventoryDocumentByReference } from "../../../_components/inventory-document-loader"
import { resolveCanApproveInventory } from "../../../_components/inventory-approval"
import { InventoryActionButton } from "../../../_components/inventory-ui"

/**
 * Trang chi tiết phiếu Nhập / Xuất / Chuyển kho (rule 29 mục C, 2026-10-17).
 * Cột trái nhúng PDF phiếu dựng ngay trong trình duyệt (DocViewer loadBytes) — cùng nội dung trang in.
 * Sửa phiếu nháp vẫn ở form cũ (`<route>?documentId=`); Duyệt / Hủy phiếu làm được ngay tại đây.
 */

type LoadedDoc = NonNullable<Awaited<ReturnType<typeof fetchInventoryDocumentByReference>>>

const ROUTE_BY_TYPE: Record<InventoryDocumentPdfType, string> = {
  import: "/dashboard/inventory/receipts",
  export: "/dashboard/inventory/issues",
  transfer: "/dashboard/inventory/transfers",
}

const isDocType = (v: string): v is InventoryDocumentPdfType => v === "import" || v === "export" || v === "transfer"

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"

function fmtDateTime(value: string | null | undefined) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

export default function InventoryDocumentDetailPage() {
  const params = useParams<{ type: string; id: string }>()
  const rawType = typeof params?.type === "string" ? params.type : ""
  const docId = typeof params?.id === "string" ? params.id : ""
  const docType: InventoryDocumentPdfType | null = isDocType(rawType) ? rawType : null
  const isDesktop = useIsDesktop()

  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)
  const [warehouses, setWarehouses] = useState<Record<string, InventoryDocumentPdfWarehouse>>({})
  const [canApprove, setCanApprove] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "content">("file")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [modal, setModal] = useState<"approve" | "cancel" | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState("")

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  const loadDoc = useCallback(async () => {
    if (!docType) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) {
        window.location.replace(`/login?next=${encodeURIComponent(`/dashboard/inventory/document/${docType}/${docId}`)}`)
        return
      }
      if (!hasPermission(sessionUser, "inventory.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = sessionUser.factory_id
      if (!fid) {
        setLoadError("Tài khoản chưa được gán nhà máy.")
        return
      }
      setUser(sessionUser)
      setFactoryId(fid)
      const result = await fetchInventoryDocumentByReference(fid, docType, { documentId: docId })
      setLoaded(result)
      if (!result) return
      const whIds = [result.document.source_warehouse_id, result.document.target_warehouse_id].filter(
        (v): v is string => Boolean(v),
      )
      if (whIds.length) {
        const { data: whRows } = await supabase
          .from("inventory_warehouses")
          .select("id, code, name, keeper_name")
          .eq("factory_id", fid)
          .in("id", whIds)
        const map: Record<string, InventoryDocumentPdfWarehouse> = {}
        for (const w of (whRows || []) as Array<{ id: string; code: string; name: string; keeper_name: string | null }>) {
          map[w.id] = { code: w.code, name: w.name, keeper_name: w.keeper_name }
        }
        setWarehouses(map)
      }
      if (docType !== "transfer") {
        const allowed = await resolveCanApproveInventory(fid, sessionUser).catch(() => false)
        setCanApprove(allowed)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được phiếu kho.")
    } finally {
      setLoading(false)
    }
  }, [docType, docId])

  useEffect(() => {
    if (docId) void loadDoc()
  }, [docId, loadDoc])

  const detailUrl = origin && docType ? `${origin}/dashboard/inventory/document/${docType}/${docId}` : ""

  const pdfInput = useMemo<InventoryDocumentPdfInput | null>(() => {
    if (!loaded || !docType) return null
    const d = loaded.document
    return {
      type: docType,
      document_code: d.document_code,
      document_date: d.document_date,
      status: d.status,
      notes: d.notes,
      source_name: d.source_name,
      recipient_name: d.recipient_name,
      requester_name: d.requester_name,
      posted_at: d.posted_at,
      posted_by_name: d.posted_by_name ?? null,
      cancel_reason: d.cancel_reason,
      approved_by_name: d.approved_by_name,
      approved_at: d.approved_at,
      sourceWarehouse: d.source_warehouse_id ? warehouses[d.source_warehouse_id] ?? null : null,
      targetWarehouse: d.target_warehouse_id ? warehouses[d.target_warehouse_id] ?? null : null,
      lines: loaded.lines.map((l) => ({
        item_code: l.item_code,
        item_name: l.item_name,
        unit: l.unit,
        quantity: Number(l.quantity || 0),
        lot_no: l.lot_no,
        expiry_date: l.expiry_date,
        line_notes: l.line_notes,
      })),
      qrUrl: detailUrl || null,
    }
  }, [loaded, docType, warehouses, detailUrl])

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (!docType) {
    return <div className={moduleThemeClass("amber")}><ListState kind="empty" message="Loại phiếu không hợp lệ." /></div>
  }
  if (loading) {
    return <div className={moduleThemeClass("amber")}><ListState kind="loading" /></div>
  }
  if (loadError) {
    return (
      <div className={moduleThemeClass("amber")}>
        <ListState kind="error" message={loadError} onRetry={() => void loadDoc()} />
      </div>
    )
  }
  if (!loaded || !pdfInput) {
    return (
      <div className={moduleThemeClass("amber")}>
        <ListState kind="empty" message="Không tìm thấy phiếu kho, hoặc bạn không có quyền xem." />
      </div>
    )
  }

  const doc = loaded.document
  const lines = loaded.lines
  const route = ROUTE_BY_TYPE[docType]
  const title = inventoryDocumentTitle(docType)
  const supportsApproval = docType !== "transfer"
  const statusKey = supportsApproval && doc.status === "posted" && !doc.approved_at ? "cho_duyet" : doc.status
  const showApprove = supportsApproval && canApprove && doc.status === "posted" && !doc.approved_at
  const canCancel = hasPermission(user, "inventory.cancel") && doc.status === "posted"
  const canEdit =
    doc.status === "draft" &&
    (hasPermission(user, "inventory.create") || hasPermission(user, "inventory.edit") || user?.role === "admin")
  const openFormHref = `${route}?documentId=${encodeURIComponent(doc.id)}`
  const printHref = `/dashboard/inventory/print?type=${docType}&documentId=${encodeURIComponent(doc.id)}`
  const srcWh = doc.source_warehouse_id ? warehouses[doc.source_warehouse_id] : null
  const tgtWh = doc.target_warehouse_id ? warehouses[doc.target_warehouse_id] : null
  const whLabel = (w: InventoryDocumentPdfWarehouse | null | undefined, fallback: string | null) =>
    w ? `${w.code} - ${w.name}` : fallback || "—"

  const downloadPdf = async () => {
    try {
      await downloadInventoryDocumentPdf(pdfInput)
    } catch {
      showToast("Không tạo được PDF phiếu.", false)
    }
  }

  const handleApprove = async () => {
    if (!factoryId) return
    setBusy(true)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) throw new Error("Phiên đăng nhập đã hết hạn.")
      const byName = user?.full_name || user?.username || session.user.email || ""
      const { error } = await supabase
        .from("inventory_documents")
        .update({ approved_by: session.user.id, approved_by_name: byName, approved_at: new Date().toISOString() })
        .eq("id", doc.id)
        .eq("factory_id", factoryId)
        .eq("status", "posted")
      if (error) throw error
      setModal(null)
      showToast(`Đã phê duyệt phiếu ${doc.document_code}.`)
      void loadDoc()
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể phê duyệt phiếu.", false)
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    if (!factoryId || !cancelReason.trim()) return
    setBusy(true)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) throw new Error("Phiên đăng nhập đã hết hạn.")
      const { error } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: doc.id,
        p_cancelled_by: session.user.id,
        p_cancel_reason: cancelReason.trim(),
      })
      if (error) throw error
      setModal(null)
      setCancelReason("")
      showToast(`Đã hủy phiếu ${doc.document_code}. Tồn kho đã được hoàn nguyên.`)
      void loadDoc()
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể hủy phiếu.", false)
    } finally {
      setBusy(false)
    }
  }

  const primary: SignAction | null = showApprove
    ? { key: "approve", label: "Phê duyệt phiếu", icon: <Check size={16} />, onClick: () => setModal("approve") }
    : null
  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF phiếu", icon: <Download size={14} />, onClick: () => void downloadPdf() },
    { key: "print", label: "In phiếu", icon: <Printer size={14} />, onClick: () => window.open(printHref, "_blank") },
    canEdit
      ? { key: "edit", label: "Sửa phiếu nháp", icon: <Pencil size={14} />, onClick: () => window.location.assign(openFormHref) }
      : { key: "form", label: "Mở phiếu (form)", icon: <ClipboardList size={14} />, onClick: () => window.location.assign(openFormHref) },
  ]
  const danger: SignAction[] = canCancel
    ? [{ key: "cancel", label: "Hủy phiếu", icon: <Ban size={14} />, onClick: () => setModal("cancel") }]
    : []

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"
  const warehouseChip =
    docType === "import"
      ? whLabel(tgtWh, doc.recipient_name)
      : docType === "export"
        ? whLabel(srcWh, doc.source_name)
        : `${srcWh?.code || "?"} → ${tgtWh?.code || "?"}`

  const contentTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[760px]">
        <thead>
          <tr>
            <th className="w-10 text-right">#</th>
            <th>Mã vật tư</th>
            <th>Tên vật tư</th>
            <th className="text-right">Số lượng</th>
            <th>ĐVT</th>
            <th>Số lô</th>
            <th>Hạn sử dụng</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <ListState kind="empty" message="Phiếu chưa có dòng vật tư" asRow colSpan={8} />
          ) : lines.map((l, idx) => (
            <tr key={l.id}>
              <td className="text-right text-slate-500">{idx + 1}</td>
              <td className="whitespace-nowrap font-code">{l.item_code || "—"}</td>
              <td>{l.item_name || "—"}</td>
              <td className="text-right font-semibold">{Number(l.quantity || 0).toLocaleString("vi-VN")}</td>
              <td className="whitespace-nowrap">{l.unit || "—"}</td>
              <td className="whitespace-nowrap">{l.lot_no || "—"}</td>
              <td className="whitespace-nowrap">{l.expiry_date ? formatDateDisplay(l.expiry_date.slice(0, 10)) : "—"}</td>
              <td>{l.line_notes || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  return (
    <div className={moduleThemeClass("amber")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref={route}
            backLabel={`Quay lại danh sách ${title.toLowerCase()}`}
            eyebrow={title}
            title={warehouseChip}
            code={doc.document_code}
            tags={
              <>
                <span className={chip}>{formatDateDisplay(doc.document_date)}</span>
                <span className={chip}>{lines.length} dòng vật tư</span>
              </>
            }
            actions={
              <>
                <HeaderButton icon={<Download size={15} />} label="Tải PDF" onClick={() => void downloadPdf()} />
                <HeaderButton icon={<Printer size={15} />} label="In phiếu" onClick={() => window.open(printHref, "_blank")} />
                {detailUrl ? <HeaderQr value={detailUrl} code={doc.document_code} title="QR phiếu kho" /> : null}
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
                { key: "file", label: "Phiếu PDF", icon: FileText },
                { key: "content", label: "Dòng vật tư", icon: Package },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`inv-${doc.id}`}
                active={(isDesktop || mobileTab === "doc") && !modal}
                loadBytes={() => buildInventoryDocumentPdfBytes(pdfInput)}
                sourceKey={`inv-${doc.id}-${doc.status}-${doc.approved_at ?? ""}-${lines.length}-${Object.keys(warehouses).length}-${detailUrl}`}
                kind="pdf"
                fileExt="pdf"
                label={`${title} ${doc.document_code} · Bản xem trước PDF`}
              />
            ) : contentTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar domain="inventory" status={statusKey} headline={`${lines.length} dòng vật tư`} />
            <SignActionBox title="Hành động" primary={primary} secondary={secondary} danger={danger} />
            <InspectorCard title="Thông tin phiếu" icon={Warehouse}>
              <MetaList>
                <MetaRow label="Ngày phiếu" value={formatDateDisplay(doc.document_date)} />
                {docType !== "import" && <MetaRow label={docType === "transfer" ? "Kho nguồn" : "Kho xuất"} value={whLabel(srcWh, doc.source_name)} />}
                {docType !== "export" && <MetaRow label={docType === "transfer" ? "Kho đích" : "Kho nhập"} value={whLabel(tgtWh, doc.recipient_name)} />}
                <MetaRow label="Người lập" value={doc.requester_name || "—"} />
                {docType === "export" && <MetaRow label="Người nhận" value={doc.recipient_name || "—"} />}
                {docType === "import" && <MetaRow label="Nguồn nhập" value={doc.source_name || "—"} />}
                <MetaRow
                  label="Ghi sổ"
                  value={doc.posted_at ? [fmtDateTime(doc.posted_at), doc.posted_by_name].filter(Boolean).join(" · ") : "Chưa ghi sổ"}
                />
                {supportsApproval && (
                  <MetaRow
                    label="Phê duyệt"
                    value={doc.approved_at ? [doc.approved_by_name, fmtDateTime(doc.approved_at)].filter(Boolean).join(" · ") : "Chưa phê duyệt"}
                  />
                )}
                {doc.status === "cancelled" && (
                  <MetaRow label="Lý do hủy" value={[doc.cancel_reason, fmtDateTime(doc.cancelled_at)].filter(Boolean).join(" · ") || "—"} />
                )}
                {doc.notes && <MetaRow label="Ghi chú" value={doc.notes} />}
              </MetaList>
            </InspectorCard>
          </>
        }
      />

      {modal === "approve" ? (
        <ModalShell
          title="Phê duyệt phiếu"
          onClose={() => (busy ? undefined : setModal(null))}
          maxWidth="md"
          footer={
            <>
              <InventoryActionButton icon={RotateCcw} label="Đóng" tone="slate" onClick={() => setModal(null)} disabled={busy} />
              <InventoryActionButton icon={Check} label={busy ? "Đang duyệt..." : "Duyệt"} tone="emerald" onClick={() => void handleApprove()} disabled={busy} />
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xác nhận phê duyệt phiếu <strong>{doc.document_code}</strong> ngày {formatDateDisplay(doc.document_date)}?
          </p>
        </ModalShell>
      ) : null}

      {modal === "cancel" ? (
        <ModalShell
          title="Hủy phiếu"
          onClose={() => (busy ? undefined : setModal(null))}
          maxWidth="md"
          footer={
            <>
              <InventoryActionButton icon={RotateCcw} label="Đóng" tone="slate" onClick={() => setModal(null)} disabled={busy} />
              <InventoryActionButton
                icon={Ban}
                label={busy ? "Đang hủy..." : "Hủy phiếu"}
                tone="rose"
                onClick={() => void handleCancel()}
                disabled={busy || !cancelReason.trim()}
              />
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            Hủy phiếu <strong>{doc.document_code}</strong> sẽ hoàn nguyên tồn kho. Bắt buộc nhập lý do.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Lý do hủy phiếu"
            className={INPUT_CLASS}
          />
        </ModalShell>
      ) : null}
    </div>
  )
}

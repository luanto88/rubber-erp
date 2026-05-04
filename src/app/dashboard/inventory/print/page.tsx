"use client"

import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, Ban, Printer } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { getActiveFactoryId } from "@/lib/auth"
import { fetchInventoryDocumentByReference } from "../_components/inventory-document-loader"
import { loadInventoryAdminData, type InventoryWarehouseOption } from "../_components/inventory-data"

type DocumentType = "import" | "export" | "transfer"

function formatDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("vi-VN")
}

function getDocumentTitle(documentType: DocumentType) {
  if (documentType === "import") return "Phiếu nhập kho"
  if (documentType === "export") return "Phiếu xuất kho"
  return "Phiếu chuyển kho"
}

function getDocumentPath(documentType: DocumentType) {
  if (documentType === "import") return "/dashboard/inventory/receipts"
  if (documentType === "export") return "/dashboard/inventory/issues"
  return "/dashboard/inventory/transfers"
}

function getWarehouseFields(
  documentType: DocumentType,
  sourceWarehouse: InventoryWarehouseOption | null,
  targetWarehouse: InventoryWarehouseOption | null,
  sourceNameFallback: string | null,
  recipientNameFallback: string | null,
): { label: string; value: string }[] {
  const sourceLabel =
    documentType === "export" ? "Kho xuất" : documentType === "transfer" ? "Kho nguồn" : null
  const targetLabel =
    documentType === "import" ? "Kho nhập" : documentType === "transfer" ? "Kho đích" : null

  const fields: { label: string; value: string }[] = []
  if (sourceLabel) {
    fields.push({
      label: sourceLabel,
      value: sourceWarehouse
        ? `${sourceWarehouse.code} - ${sourceWarehouse.name}`
        : sourceNameFallback || "—",
    })
  }
  if (targetLabel) {
    fields.push({
      label: targetLabel,
      value: targetWarehouse
        ? `${targetWarehouse.code} - ${targetWarehouse.name}`
        : recipientNameFallback || "—",
    })
  }
  return fields
}

export default function InventoryPrintPage() {
  const searchParams = useSearchParams()
  const documentType = (searchParams.get("type") || "import") as DocumentType
  const documentId = searchParams.get("documentId")
  const code = searchParams.get("code")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([])
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchInventoryDocumentByReference>>>(null)

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      setError(null)
      try {
        const factoryId = await getActiveFactoryId()
        if (!factoryId) {
          setError("Chưa xác định được nhà máy đang thao tác.")
          return
        }
        const inventoryData = await loadInventoryAdminData()
        setWarehouses(inventoryData.warehouses)
        const loaded = await fetchInventoryDocumentByReference(factoryId, documentType, {
          documentId,
          code,
        })
        if (!loaded) {
          setError("Không tìm thấy phiếu để in.")
          return
        }
        setPayload(loaded)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [code, documentId, documentType])

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w])),
    [warehouses],
  )

  const qrPath = useMemo(() => {
    if (!payload?.document.document_code) return ""
    return `/dashboard/inventory/print?type=${documentType}&code=${encodeURIComponent(payload.document.document_code)}`
  }, [documentType, payload?.document.document_code])

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const absoluteQrUrl = qrPath && origin ? `${origin}${qrPath}` : qrPath

  const sourceWarehouse = payload?.document.source_warehouse_id
    ? warehouseMap.get(payload.document.source_warehouse_id) ?? null
    : null
  const targetWarehouse = payload?.document.target_warehouse_id
    ? warehouseMap.get(payload.document.target_warehouse_id) ?? null
    : null

  const warehouseFields = useMemo(
    () =>
      getWarehouseFields(
        documentType,
        sourceWarehouse,
        targetWarehouse,
        payload?.document.source_name ?? null,
        payload?.document.recipient_name ?? null,
      ),
    [documentType, payload, sourceWarehouse, targetWarehouse],
  )

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx global>{`
        @media print {
          @page {
            size: A5 landscape;
            margin: 8mm;
          }
          body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          aside {
            display: none !important;
          }
          main {
            overflow: visible !important;
          }
          main > div {
            padding: 0 !important;
          }
          .print-hidden {
            display: none !important;
          }
          .print-sheet {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            border-radius: 0 !important;
            padding: 6mm !important;
            max-width: 100% !important;
          }
          .print-compact-table th,
          .print-compact-table td {
            padding: 3px 6px !important;
            font-size: 10px !important;
            line-height: 1.3 !important;
          }
          .print-info-card {
            padding: 4px 8px !important;
          }
          .print-info-label {
            font-size: 8px !important;
          }
          .print-info-value {
            font-size: 11px !important;
            margin-top: 2px !important;
          }
          .print-sig-gap {
            margin-top: 24px !important;
          }
          .print-title {
            font-size: 16px !important;
          }
          .print-code {
            font-size: 10px !important;
          }
          .print-qr-wrap {
            padding: 4px !important;
          }
        }
      `}</style>

      {/* Toolbar — ẩn khi in */}
      <div className="print-hidden mx-auto mb-4 flex max-w-4xl items-center justify-between gap-3">
        <Link
          href={
            payload?.document
              ? `${getDocumentPath(documentType)}?documentId=${payload.document.id}`
              : "/dashboard/inventory"
          }
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
        >
          <ArrowLeft size={16} />
          Quay lại phiếu
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Printer size={16} />
          In phiếu (A5 ngang)
        </button>
      </div>

      {/* Print sheet */}
      <div className="print-sheet mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Đang tải dữ liệu phiếu...</div>
        ) : error || !payload ? (
          <div className="py-20 text-center text-red-600">{error || "Không thể tải phiếu."}</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Quản lý kho
                </div>
                <h1 className="print-title mt-1 text-xl font-extrabold text-slate-800">
                  {getDocumentTitle(documentType)}
                </h1>
                <div className="print-code mt-1 text-xs font-semibold text-slate-500">
                  {payload.document.document_code}
                </div>
              </div>
              <div className="print-qr-wrap rounded-xl border border-slate-200 bg-white p-2 text-center">
                <QRCodeSVG value={absoluteQrUrl || payload.document.document_code} size={80} level="M" />
                <div className="mt-1 text-[9px] font-semibold text-slate-400">
                  {payload.document.document_code}
                </div>
              </div>
            </div>

            {/* Banners */}
            {payload.document.status === "draft" && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2">
                <AlertTriangle size={15} className="shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-bold text-amber-800">Phiếu chưa ghi sổ</p>
                  <p className="text-[10px] text-amber-700">Giao dịch này chưa ảnh hưởng đến tồn kho.</p>
                </div>
              </div>
            )}
            {payload.document.status === "cancelled" && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-2">
                <Ban size={15} className="shrink-0 text-red-600" />
                <div>
                  <p className="text-xs font-bold text-red-800">Phiếu đã bị hủy</p>
                  {payload.document.cancel_reason && (
                    <p className="text-[10px] text-red-700">Lý do: {payload.document.cancel_reason}</p>
                  )}
                </div>
              </div>
            )}

            {/* Info grid */}
            <div
              className={`mt-4 grid gap-2 ${
                documentType === "transfer" ? "grid-cols-4" : "grid-cols-3"
              }`}
            >
              {/* Ngày phiếu */}
              <div className="print-info-card rounded-xl bg-slate-50 px-4 py-3">
                <div className="print-info-label text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Ngày phiếu
                </div>
                <div className="print-info-value mt-1.5 text-sm font-semibold text-slate-800">
                  {formatDate(payload.document.document_date)}
                </div>
              </div>

              {/* Trạng thái */}
              <div className="print-info-card rounded-xl bg-slate-50 px-4 py-3">
                <div className="print-info-label text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Trạng thái
                </div>
                <div className="print-info-value mt-1.5 text-sm font-semibold text-slate-800">
                  {payload.document.status === "posted"
                    ? "Đã ghi sổ"
                    : payload.document.status === "cancelled"
                      ? "Đã hủy"
                      : "Nháp"}
                </div>
                {payload.document.status === "posted" && payload.document.posted_at && (
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {new Date(payload.document.posted_at).toLocaleString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                    {payload.document.posted_by_name ? ` · ${payload.document.posted_by_name}` : ""}
                  </div>
                )}
              </div>

              {/* Warehouse fields: 1 field (import/export) or 2 fields (transfer) */}
              {warehouseFields.map((field) => (
                <div key={field.label} className="print-info-card rounded-xl bg-slate-50 px-4 py-3">
                  <div className="print-info-label text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    {field.label}
                  </div>
                  <div className="print-info-value mt-1.5 text-sm font-semibold text-slate-800">
                    {field.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <table className="print-compact-table w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["STT", "Mã vật tư", "Tên vật tư", "Đơn vị", "Số lượng", "Số lô", "Hạn sử dụng", "Ghi chú"].map(
                      (head) => (
                        <th key={head} className="px-3 py-2.5 text-left text-xs font-bold">
                          {head}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.map((line, index) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-500">{index + 1}</td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-700">{line.item_code}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{line.item_name}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{line.unit}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-800">
                        {Number(line.quantity || 0).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{line.lot_no || ""}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDate(line.expiry_date)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{line.line_notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ghi chú phiếu */}
            {payload.document.notes && (
              <div className="mt-3 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                <span className="font-bold text-slate-700">Ghi chú: </span>
                {payload.document.notes}
              </div>
            )}

            {/* Chữ ký */}
            <div className="print-sig-gap mt-8 grid grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-xs font-bold text-slate-700">Người lập phiếu</div>
                <div className="mt-12 border-t border-slate-300 pt-1.5 text-xs text-slate-500">
                  {payload.document.requester_name || " "}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs font-bold text-slate-700">Thủ kho</div>
                <div className="mt-12 border-t border-slate-300 pt-1.5 text-xs text-slate-500"> </div>
              </div>
              <div className="text-center">
                <div className="text-xs font-bold text-slate-700">
                  {documentType === "export" ? "Người nhận" : "Người bàn giao"}
                </div>
                <div className="mt-12 border-t border-slate-300 pt-1.5 text-xs text-slate-500">
                  {payload.document.recipient_name || payload.document.source_name || " "}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

"use client"

import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
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
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])),
    [warehouses],
  )

  const qrPath = useMemo(() => {
    if (!payload?.document.document_code) {
      return ""
    }

    return `${getDocumentPath(documentType)}?code=${encodeURIComponent(payload.document.document_code)}`
  }, [documentType, payload?.document.document_code])

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const absoluteQrUrl = qrPath && origin ? `${origin}${qrPath}` : qrPath
  const sourceWarehouse = payload?.document.source_warehouse_id
    ? warehouseMap.get(payload.document.source_warehouse_id)
    : null
  const targetWarehouse = payload?.document.target_warehouse_id
    ? warehouseMap.get(payload.document.target_warehouse_id)
    : null

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 10mm;
          }
          body {
            background: white !important;
          }
          .print-hidden {
            display: none !important;
          }
          .print-sheet {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div className="print-hidden mx-auto mb-4 flex max-w-5xl items-center justify-between gap-3">
        <Link
          href={payload?.document ? `${getDocumentPath(documentType)}?documentId=${payload.document.id}` : "/dashboard/inventory"}
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
          In phiếu
        </button>
      </div>

      <div className="print-sheet mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Đang tải dữ liệu phiếu...</div>
        ) : error || !payload ? (
          <div className="py-20 text-center text-red-600">{error || "Không thể tải phiếu."}</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Quản lý kho</div>
                <h1 className="mt-2 text-2xl font-extrabold text-slate-800">{getDocumentTitle(documentType)}</h1>
                <div className="mt-2 text-sm text-slate-500">{payload.document.document_code}</div>
              </div>
              <div className="text-center">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <QRCodeSVG value={absoluteQrUrl || payload.document.document_code} size={110} level="M" />
                </div>
                <div className="mt-2 text-[11px] font-semibold text-slate-500 break-all">
                  {payload.document.document_code}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Ngày phiếu</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  {formatDate(payload.document.document_date)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Trạng thái</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  {payload.document.status === "posted" ? "Đã ghi sổ" : "Nháp"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Kho nguồn</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  {sourceWarehouse ? `${sourceWarehouse.code} - ${sourceWarehouse.name}` : payload.document.source_name || "Không áp dụng"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Kho đích</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  {targetWarehouse ? `${targetWarehouse.code} - ${targetWarehouse.name}` : payload.document.recipient_name || "Không áp dụng"}
                </div>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["STT", "Mã vật tư", "Tên vật tư", "Đơn vị", "Số lượng", "Số lô", "Hạn sử dụng", "Ghi chú"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.map((line, index) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                      <td className="px-4 py-3 font-bold text-slate-700">{line.item_code}</td>
                      <td className="px-4 py-3 text-slate-700">{line.item_name}</td>
                      <td className="px-4 py-3 text-slate-500">{line.unit}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {Number(line.quantity || 0).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{line.lot_no || ""}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(line.expiry_date)}</td>
                      <td className="px-4 py-3 text-slate-500">{line.line_notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="font-bold text-slate-700">Ghi chú phiếu</div>
              <div className="mt-2 whitespace-pre-wrap">{payload.document.notes || "Không có ghi chú."}</div>
            </div>

            <div className="mt-10 grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="text-sm font-bold text-slate-700">Người lập phiếu</div>
                <div className="mt-16 border-t border-slate-300 pt-2 text-sm text-slate-500">
                  {payload.document.requester_name || " "}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-700">Thủ kho</div>
                <div className="mt-16 border-t border-slate-300 pt-2 text-sm text-slate-500"> </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-700">Người nhận / bàn giao</div>
                <div className="mt-16 border-t border-slate-300 pt-2 text-sm text-slate-500">
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

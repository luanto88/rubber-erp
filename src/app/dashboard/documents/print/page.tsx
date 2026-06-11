"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { QRCodeSVG } from "qrcode.react"
import {
  LOAI_VAN_BAN_LABEL,
  PHAN_LOAI_LABEL,
  TRANG_THAI_LABEL,
  fmtDate,
  type VanBanDocument,
  type ThuTuKyStep,
} from "../_components/documents-types"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

type NguoiKyEntry = { ten: string; chuc_vu: string; ky_at: string }

export default function VanBanPrintPage() {
  const searchParams = useSearchParams()
  const docId = searchParams.get("docId")
  const [doc, setDoc] = useState<VanBanDocument | null>(null)
  const [factoryName, setFactoryName] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!docId) { setLoading(false); return }
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }

      const [{ data: docData }, { data: factoryData }] = await Promise.all([
        supabase
          .from("van_ban_documents")
          .select("*")
          .eq("id", docId)
          .eq("factory_id", fid)
          .single(),
        supabase.from("factories").select("name").eq("id", fid).single(),
      ])

      if (docData) setDoc(docData as VanBanDocument)
      if (factoryData?.name) setFactoryName(factoryData.name as string)
      setLoading(false)
    }
    void load()
  }, [docId])

  useEffect(() => {
    if (!loading && doc) {
      setTimeout(() => window.print(), 800)
    }
  }, [loading, doc])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">Đang tải...</p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">Không tìm thấy văn bản.</p>
      </div>
    )
  }

  const steps = (doc.thu_tu_ky_json || []) as ThuTuKyStep[]
  const nguoiKy = (doc.nguoi_ky || {}) as Record<string, NguoiKyEntry>
  const isMat = doc.phan_loai === "Mat"
  const qrUrl = `${APP_URL}/dashboard/documents/${doc.id}`

  const fileUrl = doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url

  return (
    <>
      <style>{`
        @page { size: A4; margin: 20mm 15mm; }
        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; font-size: 11pt; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        body { font-family: 'Times New Roman', serif; color: #1a1a1a; }
        .watermark {
          position: fixed; inset: 0; display: flex; align-items: center;
          justify-content: center; pointer-events: none; z-index: 0; opacity: 0.07;
        }
        .watermark-text {
          font-size: 120px; font-weight: 900; color: #dc2626;
          transform: rotate(-45deg); user-select: none; letter-spacing: 8px;
        }
        .content { position: relative; z-index: 1; max-width: 800px; margin: 0 auto; padding: 24px; }
      `}</style>

      {isMat && (
        <div className="watermark">
          <div className="watermark-text">MẬT</div>
        </div>
      )}

      <div className="content">
        {/* Nút in (ẩn khi in) */}
        <div className="no-print flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
          <button
            onClick={() => window.history.back()}
            className="text-sm text-blue-600 underline"
          >
            ← Quay lại
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg"
          >
            In văn bản
          </button>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-700 uppercase tracking-wide">
              CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
            </p>
            <p className="text-sm text-slate-600">Độc lập – Tự do – Hạnh phúc</p>
            <p className="text-xs text-slate-400 mt-1">{factoryName}</p>
          </div>
          <div className="flex flex-col items-center gap-2 shrink-0 ml-4">
            <QRCodeSVG value={qrUrl} size={80} level="M" />
            <p className="text-[9px] text-slate-400 text-center max-w-[90px] leading-tight">
              Quét để xem & xác thực
            </p>
          </div>
        </div>

        {/* Mã văn bản + phân loại */}
        <div className="text-center mb-6">
          {isMat && (
            <div className="inline-block px-3 py-0.5 mb-2 border-2 border-red-600 text-red-700 font-black text-sm rounded tracking-widest uppercase">
              Mật
            </div>
          )}
          {doc.ma_van_ban && (
            <p className="text-sm text-slate-500 font-mono mb-1">Số: {doc.ma_van_ban}</p>
          )}
          <h1 className="text-xl font-bold text-slate-900 leading-snug">{doc.ten_van_ban}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {doc.loai_van_ban ? LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban : ""}
            {doc.phong_ban ? ` — Phòng ban: ${doc.phong_ban}` : ""}
          </p>
        </div>

        {/* Thông tin chi tiết */}
        <table className="w-full text-sm border-collapse mb-6" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <tbody>
            <MetaRow label="Trạng thái" value={TRANG_THAI_LABEL[doc.trang_thai] || doc.trang_thai} />
            <MetaRow label="Phân loại" value={PHAN_LOAI_LABEL[doc.phan_loai] || doc.phan_loai || "Thường"} />
            <MetaRow label="Cấp văn bản" value={doc.cap_tl || ""} />
            <MetaRow label="Người soạn thảo" value={doc.nguoi_soan_thao_display || ""} />
            {doc.trang_thai === "da_phe_duyet" && (
              <>
                <MetaRow label="Người phê duyệt" value={doc.phe_duyet || ""} />
                <MetaRow label="Ngày phê duyệt" value={fmtDate(doc.ngay_phe_duyet)} />
              </>
            )}
            {doc.ghi_chu && <MetaRow label="Ghi chú" value={doc.ghi_chu} />}
          </tbody>
        </table>

        {/* Tiến trình ký duyệt */}
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide border-b border-slate-200 pb-1">
          Tiến trình ký duyệt
        </h2>
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th className="text-left py-2 px-3 font-bold text-slate-600">Bước</th>
              <th className="text-left py-2 px-3 font-bold text-slate-600">Phòng ban</th>
              <th className="text-left py-2 px-3 font-bold text-slate-600">Người ký</th>
              <th className="text-left py-2 px-3 font-bold text-slate-600">Ngày ký</th>
              <th className="text-left py-2 px-3 font-bold text-slate-600">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {/* Soạn thảo */}
            <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td className="py-2 px-3 text-slate-500">0</td>
              <td className="py-2 px-3 text-slate-600">—</td>
              <td className="py-2 px-3 font-semibold">{doc.nguoi_soan_thao_display || "—"}</td>
              <td className="py-2 px-3 text-slate-500">{fmtDate(doc.created_at)}</td>
              <td className="py-2 px-3">
                <span className="text-emerald-700 font-bold text-xs">Soạn thảo ✓</span>
              </td>
            </tr>
            {/* Từng bước ký */}
            {steps.map((step, i) => {
              const entry = nguoiKy[String(i + 1)]
              const isCurrentStep = doc.trang_thai === "cho_ky_phong_ban" && doc.buoc_hien_tai === i
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td className="py-2 px-3 text-slate-500">{i + 1}</td>
                  <td className="py-2 px-3 text-slate-600">{step.phong_ban_code || "—"}</td>
                  <td className="py-2 px-3 font-semibold">{entry?.ten || (isCurrentStep ? "Đang chờ..." : "—")}</td>
                  <td className="py-2 px-3 text-slate-500">{fmtDate(entry?.ky_at)}</td>
                  <td className="py-2 px-3">
                    {entry ? (
                      <span className="text-emerald-700 font-bold text-xs">Đã ký ✓</span>
                    ) : isCurrentStep ? (
                      <span className="text-amber-600 font-bold text-xs">Đang chờ</span>
                    ) : (
                      <span className="text-slate-300 text-xs">Chờ</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {/* Phê duyệt */}
            <tr>
              <td className="py-2 px-3 text-slate-500">{steps.length + 1}</td>
              <td className="py-2 px-3 text-slate-600">—</td>
              <td className="py-2 px-3 font-semibold">{doc.phe_duyet || "—"}</td>
              <td className="py-2 px-3 text-slate-500">{fmtDate(doc.ngay_phe_duyet)}</td>
              <td className="py-2 px-3">
                {doc.trang_thai === "da_phe_duyet" ? (
                  <span className="text-emerald-700 font-bold text-xs">Đã phê duyệt ✓</span>
                ) : doc.trang_thai === "cho_phe_duyet" ? (
                  <span className="text-amber-600 font-bold text-xs">Đang chờ</span>
                ) : (
                  <span className="text-slate-300 text-xs">Chờ phê duyệt</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Trả về */}
        {doc.trang_thai === "tra_ve" && doc.tra_ve_ly_do && (
          <div style={{ background: "#fff1f2", border: "1px solid #fda4af", borderRadius: "8px", padding: "12px 16px", marginBottom: "24px" }}>
            <p className="text-sm font-bold text-red-700 mb-1">Văn bản bị trả về</p>
            <p className="text-sm text-red-600">
              <strong>{doc.tra_ve_nguoi}</strong> trả về bước {doc.tra_ve_step != null ? doc.tra_ve_step + 1 : ""}:{" "}
              {doc.tra_ve_ly_do}
            </p>
          </div>
        )}

        {/* File đính kèm */}
        {fileUrl && (
          <div className="no-print mb-4">
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-all"
            >
              Xem file đính kèm
            </a>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 flex items-center justify-between">
          <span>In lúc: {new Date().toLocaleString("vi-VN")}</span>
          <span className="font-mono">{doc.ma_van_ban || doc.id.substring(0, 8)}</span>
        </div>
      </div>
    </>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td className="py-1.5 pr-4 text-slate-500 font-semibold whitespace-nowrap w-40">{label}</td>
      <td className="py-1.5 text-slate-800">{value}</td>
    </tr>
  )
}

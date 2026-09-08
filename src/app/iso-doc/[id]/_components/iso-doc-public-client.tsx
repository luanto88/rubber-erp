"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2, Download, ExternalLink, Loader2, XCircle } from "lucide-react"
import { LOAI_TAI_LIEU_LABEL, TRANG_THAI_LABEL } from "@/app/dashboard/iso/_components/iso-types"
import { buildStorageDownloadUrl } from "@/lib/storage-download"

// Trang tra cứu CÔNG KHAI cho QR in trên tài liệu ISO — mirror `/storage` (tra cứu ngăn lưu) và
// `/van-ban-verify` (xác thực chữ ký). Nguồn dữ liệu là route service-role
// `/api/iso/public-doc/[id]`, vốn chỉ trả đúng phần metadata đã in công khai trên bản giấy.

type ReplacementInfo = {
  id: string
  maTaiLieu: string | null
  tenTaiLieu: string | null
  lanBanHanh: string | null
  ngayHieuLuc: string | null
}

type PublicDocResponse = {
  id: string
  maTaiLieu: string | null
  tenTaiLieu: string | null
  loaiTaiLieu: string | null
  phanLoaiTl: string | null
  phongBan: string | null
  capTl: string | null
  lanBanHanh: string | null
  trangThai: string
  ngayHieuLuc: string | null
  ngayHetHieuLuc: string | null
  fileUrl: string | null
  replacement: ReplacementInfo | null
  error?: string
}

function fmtDate(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("vi-VN")
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`text-right font-bold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  )
}

export function IsoDocPublicClient({ docId }: { docId: string }) {
  const [data, setData] = useState<PublicDocResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError("")
    ;(async () => {
      try {
        const res = await fetch(`/api/iso/public-doc/${docId}`)
        const json = (await res.json()) as PublicDocResponse
        if (!res.ok) throw new Error(json.error || "Không tra cứu được tài liệu")
        if (alive) setData(json)
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "Lỗi không xác định")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [docId])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 shadow-md">
        <Loader2 size={18} className="animate-spin" /> Đang tra cứu tài liệu...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-md">
        <XCircle size={32} className="mx-auto mb-2 text-red-500" />
        <p className="font-semibold text-red-600">{loadError || "Không tải được thông tin tài liệu"}</p>
      </div>
    )
  }

  const expired = data.trangThai === "het_hieu_luc"
  const trangThaiLabel = (TRANG_THAI_LABEL as Record<string, string>)[data.trangThai] || data.trangThai
  const loaiLabel = data.loaiTaiLieu ? LOAI_TAI_LIEU_LABEL[data.loaiTaiLieu] || data.loaiTaiLieu : null
  const downloadUrl = buildStorageDownloadUrl(
    data.fileUrl,
    `${data.maTaiLieu || "Tài liệu ISO"} ${data.tenTaiLieu || ""}`.trim(),
  )

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md">
        <div className={`flex items-center gap-3 p-6 ${expired ? "bg-red-50" : "bg-emerald-50"}`}>
          {expired ? (
            <AlertTriangle size={32} className="shrink-0 text-red-600" />
          ) : (
            <CheckCircle2 size={32} className="shrink-0 text-emerald-600" />
          )}
          <div>
            <p className={`text-lg font-extrabold ${expired ? "text-red-700" : "text-emerald-700"}`}>
              {expired ? "TÀI LIỆU ĐÃ HẾT HIỆU LỰC" : "Tài liệu đang có hiệu lực"}
            </p>
            <p className={`mt-0.5 text-sm ${expired ? "text-red-600" : "text-emerald-600"}`}>
              {expired
                ? "Không sử dụng bản này cho công việc. Hãy dùng bản thay thế đang có hiệu lực."
                : "Đây là bản ban hành mới nhất đang được áp dụng."}
            </p>
          </div>
        </div>

        <div className="space-y-3 p-6 text-sm">
          {data.maTaiLieu && <Row label="Mã tài liệu" value={data.maTaiLieu} mono />}
          {data.tenTaiLieu && <Row label="Tên tài liệu" value={data.tenTaiLieu} />}
          {loaiLabel && (
            <Row
              label={data.phanLoaiTl === "con" ? "Loại hồ sơ" : "Loại tài liệu"}
              value={loaiLabel}
            />
          )}
          {data.phongBan && <Row label="Phòng ban" value={data.phongBan} />}
          {data.capTl && <Row label="Cấp tài liệu" value={data.capTl} />}
          <Row label="Lần ban hành" value={data.lanBanHanh || "—"} />
          <Row label="Ngày hiệu lực" value={fmtDate(data.ngayHieuLuc)} />
          {expired && <Row label="Ngày hết hiệu lực" value={fmtDate(data.ngayHetHieuLuc)} />}
          <Row label="Trạng thái" value={trangThaiLabel} />
        </div>

        {data.fileUrl && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 p-6">
            <a
              href={data.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
            >
              <ExternalLink size={16} /> Xem tài liệu
            </a>
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-100"
            >
              <Download size={16} /> Tải về
            </a>
          </div>
        )}
      </div>

      {expired && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <p className="mb-3 text-sm font-extrabold text-slate-700">Bản thay thế</p>
          {data.replacement ? (
            <Link
              href={`/iso-doc/${data.replacement.id}`}
              className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 transition-all hover:bg-emerald-100"
            >
              <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-emerald-800">
                  {data.replacement.maTaiLieu || "—"}
                </p>
                <p className="truncate text-xs text-emerald-700">{data.replacement.tenTaiLieu || ""}</p>
                <p className="mt-0.5 text-[11px] text-emerald-600">
                  Lần ban hành {data.replacement.lanBanHanh || "—"} · Hiệu lực từ{" "}
                  {fmtDate(data.replacement.ngayHieuLuc)}
                </p>
              </div>
              <ArrowRight size={18} className="shrink-0 text-emerald-600" />
            </Link>
          ) : (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
              Chưa tìm thấy bản thay thế đang có hiệu lực trong hệ thống. Vui lòng liên hệ bộ phận quản lý
              tài liệu để được cung cấp bản mới nhất.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2, Download, ExternalLink, FileText, Files, Loader2, Lock, XCircle } from "lucide-react"
import { LOAI_TAI_LIEU_LABEL } from "@/app/dashboard/iso/_components/iso-types"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"
import { InspectorCard, MetaList, MetaRow } from "@/app/dashboard/_components/doc-ui/inspector-card"

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

type PublicChildDoc = {
  id: string
  maTaiLieu: string | null
  tenTaiLieu: string | null
  loaiTaiLieu: string | null
  lanBanHanh: string | null
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
  /** Có file đính kèm hay không — URL file KHÔNG được trả ra trang công khai (xem route). */
  hasFile: boolean
  childDocs?: PublicChildDoc[]
  parentDoc?: {
    id: string
    maTaiLieu: string | null
    tenTaiLieu: string | null
  } | null
  replacement: ReplacementInfo | null
  error?: string
}

function fmtDate(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("vi-VN")
}

/**
 * Mọi thao tác Xem/Tải đều đi qua đăng nhập rồi mở trang chi tiết trong dashboard.
 *
 * Đi qua `/login?next=`: người đã có phiên được đưa thẳng tới tài liệu, người chưa có phiên
 * đăng nhập xong cũng tới đúng đó (từ 2026-10-13 dashboard luôn chuyển chưa-đăng-nhập sang
 * /login?next=, trang công khai này chỉ còn phục vụ URL /iso-doc đã chia sẻ trước đây).
 */
function loginGatedDocLink(targetDocId: string): string {
  return `/login?next=${encodeURIComponent(`/dashboard/iso/documents/${targetDocId}`)}`
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
      <div className="flex items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        <Loader2 size={18} className="animate-spin text-brand-600" /> Đang tra cứu tài liệu...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-[14px] border border-[#fecaca] bg-[#fef2f2] p-6 text-center">
        <XCircle size={30} className="mx-auto mb-2 text-[#dc2626]" />
        <p className="text-sm font-semibold text-[#991b1b]">{loadError || "Không tải được thông tin tài liệu"}</p>
      </div>
    )
  }

  const expired = data.trangThai === "het_hieu_luc"
  const loaiLabel = data.loaiTaiLieu ? LOAI_TAI_LIEU_LABEL[data.loaiTaiLieu] || data.loaiTaiLieu : null
  const btnPrimary =
    "inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-bold text-white shadow-sm transition-all sm:px-5 sm:text-sm"
  const btnPrimaryStyle = { background: "linear-gradient(135deg, #2f5d52 0%, #1c3a32 100%)" }

  return (
    <div className="space-y-4">
      {/* Nếu là Biểu mẫu con: Hiện banner liên kết về Quy trình cha */}
      {data.parentDoc && (
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-brand-200 bg-brand-50 p-4">
          <div className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-brand-700">
              Thuộc tài liệu quy trình
            </span>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-800">
              <DocCodePill code={data.parentDoc.maTaiLieu} />
              <span className="truncate">{data.parentDoc.tenTaiLieu}</span>
            </p>
          </div>
          <Link
            href={`/iso-doc/${data.parentDoc.id}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700"
          >
            Xem quy trình <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* Kết quả tra cứu hiệu lực */}
      <div
        className={`flex items-start gap-3 rounded-[14px] border p-4 sm:p-5 ${
          expired ? "border-[#fecaca] bg-[#fef2f2]" : "border-[#a7f3d0] bg-[#ecfdf5]"
        }`}
      >
        {expired ? (
          <AlertTriangle size={30} className="mt-0.5 shrink-0 text-[#dc2626]" />
        ) : (
          <CheckCircle2 size={30} className="mt-0.5 shrink-0 text-[#15803d]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-lg font-extrabold ${expired ? "text-[#991b1b]" : "text-[#065f46]"}`}>
              {expired ? "Tài liệu đã hết hiệu lực" : "Tài liệu đang có hiệu lực"}
            </p>
            <StatusBadge domain="iso" status={data.trangThai} size="xs" />
          </div>
          <p className={`mt-1 text-sm ${expired ? "text-[#b91c1c]" : "text-[#047857]"}`}>
            {expired
              ? "Không sử dụng bản này cho công việc. Hãy dùng bản thay thế đang có hiệu lực."
              : "Đây là bản ban hành mới nhất đang được áp dụng."}
          </p>
        </div>
      </div>

      <InspectorCard title="Thông tin tài liệu" icon={FileText}>
        <MetaList>
          {data.maTaiLieu && <MetaRow label="Mã tài liệu" value={<DocCodePill code={data.maTaiLieu} />} />}
          {data.tenTaiLieu && <MetaRow label="Tên tài liệu" value={data.tenTaiLieu} />}
          {loaiLabel && (
            <MetaRow label={data.phanLoaiTl === "con" ? "Loại hồ sơ" : "Loại tài liệu"} value={loaiLabel} />
          )}
          {data.phongBan && <MetaRow label="Phòng ban" value={data.phongBan} />}
          {data.capTl && <MetaRow label="Cấp tài liệu" value={data.capTl} />}
          <MetaRow label="Lần ban hành" value={data.lanBanHanh || "—"} />
          <MetaRow label="Ngày hiệu lực" value={fmtDate(data.ngayHieuLuc)} />
          {expired && <MetaRow label="Ngày hết hiệu lực" value={fmtDate(data.ngayHetHieuLuc)} />}
        </MetaList>

        {/* Cụm thao tác — luôn nằm GỌN MỘT DÒNG ở mọi khổ màn hình: không `flex-wrap`, mỗi nút
            `flex-1` chia đều, phần chữ dài chỉ hiện từ `sm:` trở lên.
            Bản hết hiệu lực CỐ Ý không có nút Xem/Tải bản cũ: chỉ tài khoản được cấp
            `iso.view_het_hieu_luc` mới mở được nội dung. Thay bằng 1 link chữ nhỏ có ghi rõ điều
            kiện, để người thật sự có quyền vẫn vào được từ QR. */}
        {(!expired ? data.hasFile : Boolean(data.replacement) || data.hasFile) && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-stretch gap-2">
              {expired ? (
                data.replacement && (
                  <Link href={loginGatedDocLink(data.replacement.id)} className={btnPrimary} style={btnPrimaryStyle}>
                    <ExternalLink size={16} className="shrink-0" />
                    <span>Xem <span className="hidden sm:inline">tài liệu </span>thay thế</span>
                  </Link>
                )
              ) : (
                <>
                  <Link href={loginGatedDocLink(data.id)} className={btnPrimary} style={btnPrimaryStyle}>
                    <ExternalLink size={16} className="shrink-0" />
                    <span>Xem<span className="hidden sm:inline"> tài liệu</span></span>
                  </Link>
                  <Link
                    href={loginGatedDocLink(data.id)}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 sm:px-5 sm:text-sm"
                  >
                    <Download size={16} className="shrink-0" />
                    <span>Tải<span className="hidden sm:inline"> tài liệu</span></span>
                  </Link>
                </>
              )}
            </div>
            {expired && data.hasFile ? (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
                <Lock size={12} className="mt-0.5 shrink-0" />
                <span>
                  Cần bản hết hiệu lực để đối chiếu?{" "}
                  <Link href={loginGatedDocLink(data.id)} className="font-semibold text-slate-700 underline">
                    Đăng nhập
                  </Link>{" "}
                  bằng tài khoản được cấp quyền xem file bản hết hiệu lực.
                </span>
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Lock size={12} className="shrink-0" />
                Cần đăng nhập tài khoản nội bộ để xem hoặc tải nội dung tài liệu.
              </p>
            )}
          </div>
        )}
      </InspectorCard>

      {/* Danh mục Hồ sơ & Biểu mẫu đính kèm trong bộ này (nếu là Quy trình cha) */}
      {data.childDocs && data.childDocs.length > 0 && (
        <InspectorCard
          title={`Hồ sơ & biểu mẫu trong bộ này (${data.childDocs.length})`}
          icon={Files}
          actions={<StatusBadge tone="valid" label="Đang áp dụng" size="xs" />}
        >
          <ul className="divide-y divide-slate-100">
            {data.childDocs.map((child) => (
              <li key={child.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <DocCodePill code={child.maTaiLieu} />
                    <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                      {child.loaiTaiLieu || "F"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-700">{child.tenTaiLieu || ""}</p>
                </div>
                <Link
                  href={`/iso-doc/${child.id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  Chi tiết <ArrowRight size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </InspectorCard>
      )}

      {expired && (
        <InspectorCard title="Bản thay thế" icon={CheckCircle2}>
          {data.replacement ? (
            <Link
              href={`/iso-doc/${data.replacement.id}`}
              className="flex items-center gap-3 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] p-4 transition-colors hover:bg-[#d1fae5]"
            >
              <div className="min-w-0 flex-1">
                <DocCodePill code={data.replacement.maTaiLieu} />
                <p className="mt-1 truncate text-xs font-semibold text-slate-700">{data.replacement.tenTaiLieu || ""}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Lần ban hành {data.replacement.lanBanHanh || "—"} · Hiệu lực từ {fmtDate(data.replacement.ngayHieuLuc)}
                </p>
              </div>
              <ArrowRight size={18} className="shrink-0 text-[#15803d]" />
            </Link>
          ) : (
            <p className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4 text-sm text-[#92400e]">
              Chưa tìm thấy bản thay thế đang có hiệu lực trong hệ thống. Vui lòng liên hệ bộ phận quản lý
              tài liệu để được cung cấp bản mới nhất.
            </p>
          )}
        </InspectorCard>
      )}
    </div>
  )
}

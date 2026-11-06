import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { CalendarCheck, Cog } from "lucide-react"
import { ModuleThemeScope } from "@/app/dashboard/_components/doc-ui/module-theme"
import { EquipmentHistoryPanel, EquipmentQrBanner } from "@/app/dashboard/maintenance/_components/equipment-history-panel"
import { checkPublicRateLimit } from "@/lib/public-rate-limit"
import { loadPublicEquipment, resolveEquipmentToken } from "@/lib/equipment-lookup"
import { isEquipmentQrToken } from "@/lib/equipment-qr"

// Trang CÔNG KHAI mở từ QR dán trên thiết bị (docs/qr-equipment-plan.md, GĐ1).
// Chỉ hiện đúng whitelist đã chốt: tên, mã, loại, bộ phận, lần bảo trì gần nhất.
// Lịch sử chi tiết do EquipmentHistoryPanel tải SAU khi đăng nhập (API tự kiểm quyền).
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Tra cứu thiết bị",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

function formatDateVN(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export default async function EquipmentQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isEquipmentQrToken(token)) notFound()

  const allowed = await checkPublicRateLimit("tb", await headers(), 60)
  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-bold text-slate-800">Quá nhiều lượt truy cập</p>
          <p className="mt-2 text-sm text-slate-500">Vui lòng thử lại sau 1 phút.</p>
        </div>
      </div>
    )
  }

  const target = await resolveEquipmentToken(token)
  const info = target ? await loadPublicEquipment(target) : null
  if (!info) notFound()

  const loaiLabel = info.loai === "xe" ? "Xe" : "Máy móc"

  return (
    <>
      <meta httpEquiv="Cache-Control" content="no-store, must-revalidate" />
      <div className="min-h-screen bg-slate-100 px-4 py-4 pb-28 sm:px-6 sm:py-6">
        <ModuleThemeScope theme="slate" className="mx-auto max-w-2xl space-y-4">
          <EquipmentQrBanner />

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-xl font-extrabold leading-tight text-slate-900">{info.ten_tb}</h1>
            <p className="mt-1 font-code text-base font-bold text-slate-600">{info.ma_tb}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                <Cog size={14} /> {loaiLabel}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                Bộ phận: {info.bo_phan}
              </span>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-mod-50 p-3">
              <CalendarCheck size={20} className="mt-0.5 shrink-0 text-mod-600" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bảo trì gần nhất</p>
                {info.last_maintenance ? (
                  <p className="text-base font-bold text-slate-800">
                    {formatDateVN(info.last_maintenance.ngay)}{" "}
                    <span className="font-semibold text-slate-600">({info.last_maintenance.hang_muc})</span>
                  </p>
                ) : (
                  <p className="text-base font-semibold text-slate-500">Chưa có biên bản đã duyệt</p>
                )}
              </div>
            </div>
          </section>

          <EquipmentHistoryPanel token={token} />
        </ModuleThemeScope>
      </div>
    </>
  )
}

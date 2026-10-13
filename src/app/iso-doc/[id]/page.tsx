import { PublicDocShell } from "@/app/_components/public-doc-shell"
import { IsoDocPublicClient } from "./_components/iso-doc-public-client"

// Trang tra cứu CÔNG KHAI (không yêu cầu đăng nhập) cho tài liệu ISO.
//
// Từ 2026-10-13 QR in trên PDF (`/dashboard/iso/documents/{id}`) KHÔNG còn được chuyển hướng
// tới đây — người chưa đăng nhập sang `/login?next=`. Trang này giữ lại cho các link `/iso-doc/...`
// đã chia sẻ trước đó. Đặt ở top-level (ngoài /dashboard) để không bị layout dashboard đá về /login.
export default async function IsoDocPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loginHref = `/login?next=${encodeURIComponent(`/dashboard/iso/documents/${id}`)}`

  return (
    <PublicDocShell
      title="Tra cứu tài liệu ISO"
      subtitle="Kiểm tra bản đang áp dụng và tình trạng hiệu lực của tài liệu."
      footer={
        <>
          Là nhân viên nội bộ?{" "}
          <a href={loginHref} className="font-semibold text-brand-700 underline hover:text-brand-800">
            Đăng nhập
          </a>{" "}
          để xem đầy đủ hồ sơ và lịch sử ký duyệt.
        </>
      }
    >
      <IsoDocPublicClient docId={id} />
    </PublicDocShell>
  )
}

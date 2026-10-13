import { PublicDocShell } from "@/app/_components/public-doc-shell"
import { VanBanVerifyClient } from "./_components/van-ban-verify-client"

// Trang xác thực CÔNG KHAI (không yêu cầu đăng nhập) — mở khi bấm vào con dấu chữ ký trong file
// PDF đã ký. Đặt ở top-level (ngoài /dashboard) để không bị layout dashboard đá về /login, mirror
// đúng cách /sign-verify của hệ ký dùng chung. Người dùng đã chốt GIỮ CÔNG KHAI (2026-10-13) để
// đối tác/đánh giá viên bên ngoài vẫn xác minh được — trang không lộ file.
//
// DÙNG CHUNG cho Văn bản nội bộ và tài liệu ISO (từ 2026-09-08) — nhãn hiển thị tự đổi theo
// `docType` trả về từ API. Giữ nguyên đường dẫn `van-ban-verify` dù đã mở rộng sang ISO: link này
// đã được in vào các file PDF đã ký từ trước, không thể đổi lại.
export default async function VanBanVerifyPage({ params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params

  return (
    <PublicDocShell
      title="Xác thực chữ ký số"
      subtitle="Kiểm tra chữ ký số điện tử (PAdES) gắn với con dấu trên tài liệu."
    >
      <VanBanVerifyClient logId={logId} />
    </PublicDocShell>
  )
}

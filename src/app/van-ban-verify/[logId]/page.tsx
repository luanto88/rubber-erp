import { VanBanVerifyClient } from "./_components/van-ban-verify-client"

// Trang xác thực CÔNG KHAI (không yêu cầu đăng nhập) — mở khi bấm vào con dấu chữ ký trong file
// PDF đã ký. Đặt ở top-level (ngoài /dashboard) để không bị layout dashboard đá về /login, mirror
// đúng cách /sign-verify của hệ ký dùng chung.
//
// DÙNG CHUNG cho Văn bản nội bộ và tài liệu ISO (từ 2026-09-08) — nhãn hiển thị tự đổi theo
// `docType` trả về từ API. Giữ nguyên đường dẫn `van-ban-verify` dù đã mở rộng sang ISO: link này
// đã được in vào các file PDF đã ký từ trước, không thể đổi lại.
export default async function VanBanVerifyPage({ params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Xác thực chữ ký số</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kiểm tra trạng thái chữ ký số điện tử (PAdES) gắn với con dấu trên tài liệu.
          </p>
        </div>
        <VanBanVerifyClient logId={logId} />
      </div>
    </div>
  )
}

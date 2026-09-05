import { VanBanVerifyClient } from "./_components/van-ban-verify-client"

// Trang xác thực CÔNG KHAI cho văn bản nội bộ (không yêu cầu đăng nhập) — mở khi bấm vào con dấu
// chữ ký trong file PDF đã ký. Đặt ở top-level (ngoài /dashboard) để không bị layout dashboard
// đá về /login, mirror đúng cách /sign-verify của hệ ký dùng chung.
export default async function VanBanVerifyPage({ params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Xác thực chữ ký số</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kiểm tra trạng thái chữ ký số điện tử (PAdES) gắn với con dấu trên văn bản nội bộ.
          </p>
        </div>
        <VanBanVerifyClient logId={logId} />
      </div>
    </div>
  )
}

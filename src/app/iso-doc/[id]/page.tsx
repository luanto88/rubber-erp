import { IsoDocPublicClient } from "./_components/iso-doc-public-client"

// Trang tra cứu CÔNG KHAI (không yêu cầu đăng nhập) cho QR in trên tài liệu ISO.
//
// QR trong file PDF trỏ thẳng `/dashboard/iso/documents/{id}` — đường dẫn đó đã in ra giấy hàng
// trăm bản nên KHÔNG đổi được. `dashboard/layout.tsx` chịu trách nhiệm chuyển hướng sang trang này
// khi người xem chưa đăng nhập (xem `resolveUnauthenticatedRedirect`); người đã đăng nhập vẫn vào
// trang dashboard đầy đủ như cũ.
//
// Đặt ở top-level (ngoài /dashboard) để không bị layout dashboard đá về /login — mirror đúng
// `/storage` và `/van-ban-verify`.
export default async function IsoDocPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Tra cứu tài liệu ISO</h1>
          <p className="mt-1 text-sm text-slate-500">
            Mở từ mã QR in trên tài liệu để kiểm tra bản đang áp dụng và tình trạng hiệu lực.
          </p>
        </div>
        <IsoDocPublicClient docId={id} />

        {/* Lối thoát cho nhân viên bị rơi vào đây do phiên đăng nhập hết hạn giữa chừng — không
            có link này họ sẽ mắc kẹt ở trang công khai và phải tự gõ /login. */}
        <p className="mt-5 text-center text-xs text-slate-400">
          Là nhân viên nội bộ?{" "}
          <a href="/login" className="font-semibold text-slate-500 underline hover:text-slate-700">
            Đăng nhập
          </a>{" "}
          để xem đầy đủ hồ sơ và lịch sử ký duyệt.
        </p>
      </div>
    </div>
  )
}

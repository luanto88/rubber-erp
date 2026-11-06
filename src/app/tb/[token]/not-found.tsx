// 404 TRUNG TÍNH: token sai, không tồn tại hay đã thu hồi đều ra đúng màn này (không xác nhận gì).
export default function EquipmentQrNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-base font-bold text-slate-800">Không tìm thấy thiết bị</p>
        <p className="mt-2 text-sm text-slate-500">Mã QR không hợp lệ hoặc đã được thay bằng nhãn mới.</p>
      </div>
    </div>
  )
}

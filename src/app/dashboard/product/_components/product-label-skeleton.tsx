// Khung xương (skeleton) của thẻ tra cứu kiện thành phẩm — dùng chung giữa:
// - src/app/product-label/loading.tsx (Next.js route loading boundary)
// - ProductLabelClient (trạng thái đang fetch dữ liệu thật client-side)
export function ProductLabelSkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Header: icon tròn + tiêu đề + badge trạng thái */}
      <div className="mb-4 flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded-full bg-slate-200" />
          <div className="h-4 w-24 rounded-full bg-slate-200" />
        </div>
      </div>

      {/* Lưới thông tin 2 cột */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-16 rounded-full bg-slate-200" />
            <div className="h-4 w-20 rounded-full bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Khối "Đạt hạng" */}
      <div className="mt-3 h-10 rounded-xl bg-slate-200" />

      {/* Khối liên kết ngăn nguồn gốc */}
      <div className="mt-5 h-12 rounded-xl bg-slate-200" />
    </div>
  )
}

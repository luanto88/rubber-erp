// Khung xương (skeleton) của thẻ tra cứu kiện thành phẩm — dùng chung giữa:
// - src/app/product-label/loading.tsx (Next.js route loading boundary)
// - ProductLabelClient (trạng thái đang fetch dữ liệu thật client-side)
// Bố cục bám giao diện đơn sắc: đầu thẻ + lưới ô thông tin (2 ô trải 2 cột) + nút + liên kết ngăn.
export function ProductLabelSkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-40 rounded-full bg-slate-200" />
          <div className="h-4 w-28 rounded-full bg-slate-200" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {[false, false, true, false, false, false, false, true].map((wide, i) => (
          <div key={i} className={`h-[54px] rounded-xl bg-slate-100 ${wide ? "col-span-2" : ""}`} />
        ))}
      </div>

      <div className="mt-4 h-12 rounded-xl bg-slate-200" />
      <div className="mt-3 h-[54px] rounded-xl bg-slate-100" />
    </div>
  )
}

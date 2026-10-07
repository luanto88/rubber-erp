// Khung xương (skeleton) của thẻ tra cứu kiện thành phẩm — chuẩn hóa theo Detail View UI
// Dùng chung giữa:
// - src/app/product-label/loading.tsx (Next.js route loading boundary)
// - ProductLabelClient (trạng thái đang fetch dữ liệu thật client-side)

export function ProductLabelSkeletonCard() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* 1. File-First Top Card Skeleton */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/30 border border-slate-200/90 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-rose-100/70 shrink-0" />
            <div className="space-y-1.5 min-w-0">
              <div className="h-4 w-44 sm:w-60 rounded-md bg-slate-200" />
              <div className="h-3 w-28 rounded-md bg-slate-200" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
            <div className="h-7 w-16 rounded-xl bg-slate-200" />
            <div className="h-7 w-16 rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>

      {/* 2. Main Detail Card Skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6">
        {/* Header: icon pastel + tiêu đề + badge */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 sm:mb-5">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-100/70 shrink-0" />
            <div className="space-y-1.5">
              <div className="h-4 sm:h-5 w-40 sm:w-56 rounded-md bg-slate-200" />
              <div className="h-3 w-28 sm:w-36 rounded-md bg-slate-200" />
            </div>
          </div>
          <div className="h-6 w-24 rounded-full bg-slate-200 shrink-0" />
        </div>

        {/* Lưới 2 cột 50-50 mobile / 4 cột desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 sm:gap-2.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full sm:rounded-xl bg-slate-100 shrink-0" />
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="h-2.5 w-14 rounded-md bg-slate-200" />
                <div className="h-3.5 w-20 rounded-md bg-slate-200" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Khối Ngăn nguồn gốc Skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-100/70 shrink-0" />
            <div className="space-y-1.5">
              <div className="h-4 w-44 rounded-md bg-slate-200" />
              <div className="h-3 w-32 rounded-md bg-slate-200" />
            </div>
          </div>
        </div>
        <div className="h-10 rounded-xl bg-slate-100" />
      </div>

      {/* 4. Khối QR Skeleton */}
      <div className="h-16 rounded-xl bg-slate-100" />
    </div>
  )
}

import { ProductLabelSkeletonCard } from "@/app/dashboard/product/_components/product-label-skeleton"

export default function ProductLabelLoading() {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Tra cứu kiện thành phẩm</h1>
          <p className="mt-1 text-sm text-slate-500">Mở từ QR trên nhãn kiện để xem nguồn gốc nguyên liệu.</p>
        </div>
        <ProductLabelSkeletonCard />
      </div>
    </div>
  )
}

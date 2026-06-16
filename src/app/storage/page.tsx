import { StorageDetailClient } from "@/app/dashboard/storage/_components/storage-detail-client"

export default async function PublicStorageLookupPage(props: PageProps<"/storage">) {
  const searchParams = await props.searchParams
  const nganId = typeof searchParams.id === "string" ? searchParams.id : ""
  const nganCode = typeof searchParams.code === "string" ? searchParams.code : ""

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Tra cứu ngăn lưu nguyên liệu</h1>
          <p className="mt-1 text-sm text-slate-500">Mở từ QR hoặc liên kết công khai để xem đúng chi tiết ngăn.</p>
        </div>
        <StorageDetailClient nganId={nganId} nganCode={nganCode} />
      </div>
    </div>
  )
}

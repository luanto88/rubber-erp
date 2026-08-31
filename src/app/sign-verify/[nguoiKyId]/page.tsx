import { SignVerifyClient } from "./_components/sign-verify-client"

export default async function SignVerifyPage({ params }: { params: Promise<{ nguoiKyId: string }> }) {
  const { nguoiKyId } = await params

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">Xác thực chữ ký số</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kiểm tra trạng thái chữ ký số điện tử (PAdES) gắn với con dấu trên tài liệu.
          </p>
        </div>
        <SignVerifyClient nguoiKyId={nguoiKyId} />
      </div>
    </div>
  )
}

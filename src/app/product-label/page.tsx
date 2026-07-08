import type { Metadata } from "next"
import { ProductLabelClient } from "@/app/dashboard/product/_components/product-label-client"
import type { KienLetter } from "@/lib/product-label"

const VALID_KIEN: KienLetter[] = ["A", "B", "C", "D"]

// Trang được mở trực tiếp từ QR quét ngoài hiện trường — không được cache (kể cả bởi
// Next.js lẫn WebView nhúng như Zalo/Facebook) vì dữ liệu (ngày SX, ca SX, đạt hạng...)
// thay đổi liên tục ngay sau khi công nhân nhập liệu thật.
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Tra cứu kiện thành phẩm",
  other: {
    "Cache-Control": "no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
}

type ProductLabelPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function PublicProductLabelLookupPage(props: ProductLabelPageProps) {
  const searchParams = await props.searchParams
  const factoryId = typeof searchParams.f === "string" ? searchParams.f : ""
  const maLo = typeof searchParams.lo === "string" ? searchParams.lo : ""
  const kienParam = typeof searchParams.kien === "string" ? searchParams.kien.toUpperCase() : ""
  const kien: KienLetter = (VALID_KIEN as string[]).includes(kienParam) ? (kienParam as KienLetter) : "A"

  return (
    <>
      {/* Chặn cache ở tầng http-equiv — quan trọng với WebView nhúng (Zalo, Facebook...)
          thường bỏ qua header HTTP thật nhưng vẫn đọc các thẻ meta này. */}
      <meta httpEquiv="Cache-Control" content="no-store, must-revalidate" />
      <meta httpEquiv="Pragma" content="no-cache" />
      <meta httpEquiv="Expires" content="0" />
      <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold text-slate-900">Tra cứu kiện thành phẩm</h1>
            <p className="mt-1 text-sm text-slate-500">Mở từ QR trên nhãn kiện để xem nguồn gốc nguyên liệu.</p>
          </div>
          <ProductLabelClient factoryId={factoryId} maLo={maLo} kien={kien} />
        </div>
      </div>
    </>
  )
}

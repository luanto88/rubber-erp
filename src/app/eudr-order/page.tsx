import type { Metadata } from "next"
import { EudrOrderPublicClient } from "@/app/dashboard/eudr/_components/eudr-order-public-client"

// Trang được mở trực tiếp từ QR nhúng trong file DDS (Due Diligence Statement) — không cần
// đăng nhập, không đi qua bất kỳ tài khoản/quyền cấp phát nào. Mỗi đơn hàng có 1
// public_token ngẫu nhiên riêng, quét đúng token nào chỉ xem được đúng dữ liệu/file của
// đơn hàng đó — độc lập hoàn toàn với tài khoản Customer Portal (chặn lỗ hổng "quét 1 QR
// bất kỳ là xem được toàn bộ đơn hàng của tài khoản").
//
// Không được cache — mirror /product-label (cả 2 đều là đích quét QR ngoài hiện trường,
// WebView Zalo/Facebook thường bỏ qua header HTTP thật nhưng vẫn đọc thẻ meta).
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Tra cứu đơn hàng EUDR",
  other: {
    "Cache-Control": "no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
}

type EudrOrderPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function PublicEudrOrderPage(props: EudrOrderPageProps) {
  const searchParams = await props.searchParams
  const token = typeof searchParams.token === "string" ? searchParams.token : ""

  return (
    <>
      <meta httpEquiv="Cache-Control" content="no-store, must-revalidate" />
      <meta httpEquiv="Pragma" content="no-cache" />
      <meta httpEquiv="Expires" content="0" />
      <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <EudrOrderPublicClient token={token} />
        </div>
      </div>
    </>
  )
}

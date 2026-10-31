import type { NextConfig } from "next"
import path from "path"

const nextConfig: NextConfig = {
  // Mã bản build — gắn vào URL service worker (`/service-worker.js?v=`) để mỗi lần deploy trình duyệt
  // cài SW mới và đặt tên cache theo bản (xem public/service-worker.js, GĐ-B quét QR offline).
  env: {
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || String(Date.now()),
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Trang tra cứu QR mở trực tiếp từ nhãn hiện trường — dữ liệu (ngăn, ca SX, đạt hạng...)
  // đổi liên tục. Thẻ <meta http-equiv> chỉ là gợi ý cho WebView (Zalo/Facebook), Chrome và
  // các trình duyệt thật sự dựa vào response header thật để quyết định cache — nếu thiếu,
  // tab đã mở trước đó có thể tiếp tục phục vụ bản HTML cũ từ HTTP cache/bfcache của Chrome
  // dù `force-dynamic` đã bật ở tầng Next.js.
  async headers() {
    return [
      {
        source: "/product-label",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ]
  },
  outputFileTracingIncludes: {
    "/api/sign/generate-pdf": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/quality/parse-pdf": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/output/parse-report": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/sign/restamp-pdf": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
}

export default nextConfig

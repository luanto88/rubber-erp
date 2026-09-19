/**
 * Resolve hook cho phép các script `.mjs` import trực tiếp file `.ts` của dự án.
 *
 * Node (từ v22) tự bóc kiểu TypeScript khi chạy, nhưng không tự thêm đuôi `.ts` cho các
 * import không ghi đuôi (ví dụ `import ... from "./eudr-ring-topology"` bên trong file .ts).
 * Hook này bù đúng phần đó, nhờ vậy script kiểm chứng gọi được CHÍNH code thật của ứng dụng
 * thay vì một bản sao — nếu chạy trên bản sao thì bài kiểm chứng mất hết giá trị.
 *
 * Bổ sung (2026-09-19): alias `@/*` → `<root>/src/*`, mirror đúng `tsconfig.json`'s
 * `"paths": {"@/*": ["./src/*"]}`. Node không tự đọc path-mapping của TypeScript (đó là việc
 * của `tsc`/bundler lúc build) — thiếu bước này thì bất kỳ file `.ts` nào import qua `"@/..."`
 * (rất phổ biến trong `src/lib`, `src/app`) sẽ lỗi "Cannot find package '@/...'" khi một script
 * gọi thẳng nó qua Node. An toàn cho các hook usage cũ: chỉ thêm nhánh xử lý MỚI cho specifier
 * bắt đầu bằng "@/", không đổi hành vi nhánh import tương đối hiện có.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"]
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(rootDir, "src")

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = path.join(srcDir, specifier.slice(2))
    for (const ext of ["", ...EXTENSIONS]) {
      const candidate = target + ext
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return nextResolve(pathToFileURL(candidate).href, context)
      }
    }
    // Không tìm thấy file khớp — để lỗi gốc của Node hiện ra cho dễ debug, không tự nuốt.
  }

  if (specifier.startsWith(".") || specifier.startsWith("file:")) {
    try {
      return await nextResolve(specifier, context)
    } catch (error) {
      const base = context.parentURL ? new URL(specifier, context.parentURL) : new URL(specifier)
      for (const ext of EXTENSIONS) {
        const candidate = new URL(base.href + ext)
        if (fs.existsSync(candidate)) return nextResolve(base.href + ext, context)
      }
      throw error
    }
  }
  return nextResolve(specifier, context)
}

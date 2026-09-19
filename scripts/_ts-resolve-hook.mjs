/**
 * Resolve hook cho phép các script `.mjs` import trực tiếp file `.ts` của dự án.
 *
 * Node (từ v22) tự bóc kiểu TypeScript khi chạy, nhưng không tự thêm đuôi `.ts` cho các
 * import không ghi đuôi (ví dụ `import ... from "./eudr-ring-topology"` bên trong file .ts).
 * Hook này bù đúng phần đó, nhờ vậy script kiểm chứng gọi được CHÍNH code thật của ứng dụng
 * thay vì một bản sao — nếu chạy trên bản sao thì bài kiểm chứng mất hết giá trị.
 */

import fs from "node:fs"

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"]

export async function resolve(specifier, context, nextResolve) {
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

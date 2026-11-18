// Hook nạp module cho script Node gọi THẲNG code server TypeScript trong src/ (Node ≥ 23 tự bóc kiểu TS):
//   - "@/x/y"  → src/x/y(.ts|.tsx|/index.ts)
//   - import tương đối không đuôi từ file .ts → thêm .ts / .tsx / /index.ts
//   - gói con không đuôi (vd "next/server") → thử thêm ".js"
// Dùng: import { register } from "node:module"; register(new URL("./_ts-alias-hook.mjs", import.meta.url))
// cwd PHẢI là gốc repo.
import { existsSync, readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SRC = path.join(process.cwd(), "src")

function tryFile(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(c) && !c.endsWith(path.sep) && path.extname(c)) return c
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const f = tryFile(path.join(SRC, specifier.slice(2)))
    if (f) return next(pathToFileURL(f).href, context)
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL)
    if (/\.tsx?$/.test(parent) && !path.extname(specifier)) {
      const f = tryFile(path.resolve(path.dirname(parent), specifier))
      if (f) return next(pathToFileURL(f).href, context)
    }
  }
  try {
    return await next(specifier, context)
  } catch (err) {
    if (/^[a-z@][^:]*\/[^.]+$/i.test(specifier)) return next(`${specifier}.js`, context)
    throw err
  }
}

// Chế độ "transform" (không chỉ bóc kiểu) — code src/ có parameter property / enum.
export async function load(url, context, next) {
  if (url.startsWith("file:") && /\.ts$/.test(url)) {
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" })
    return { format: "module", source, shortCircuit: true }
  }
  return next(url, context)
}

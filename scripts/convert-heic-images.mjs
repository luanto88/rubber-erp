import { createClient } from "@supabase/supabase-js"
import convert from "heic-convert"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const APPLY = process.argv.includes("--apply")
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BUCKET = argOf("bucket", "order-files")
const PREFIX = argOf("prefix", "")
const LIMIT = Number(argOf("limit", "0")) || 0

// Bug (2026-09): điện thoại lưu ảnh ở định dạng HEIC nhưng đặt đuôi ".jpg". Vì `File.type` /
// `Content-Type` đều được suy ra từ ĐUÔI TÊN FILE nên mọi lớp kiểm tra dựa vào MIME đều bị qua
// mặt, file HEIC lọt lên Storage. Hệ quả: Chrome trên Android không giải mã được nên ảnh không
// hiển thị, và khi dựng PDF thì `new Image().src = "data:image/jpeg;base64,<dữ liệu HEIC>"`
// chọn nhầm bộ giải mã → PDF in "Không tải được ảnh" (kiểm chứng trên biên bản MT-020926/001:
// PDF ký số chỉ có đúng 1 XObject ảnh là QR, 0 stream JPEG).
//
// Script này chuyển các file HEIC đã nằm sẵn trong Storage sang JPEG thật.
//
// Cách làm — cố ý GHI ĐÈ ĐÚNG ĐƯỜNG DẪN CŨ thay vì tạo file mới:
//   1) sao lưu bản HEIC gốc sang "<path>.heic.bak" (giữ lại, không xóa gì);
//   2) ghi đè "<path>" bằng bản JPEG đã chuyển đổi, đặt content-type cho đúng.
// Nhờ vậy URL không đổi nên KHÔNG phải đụng vào bất kỳ bảng dữ liệu nào (image_urls,
// image_urls_chung, export_orders.vehicles JSONB, lots.image_url_*, quick_measurement_rows...)
// — tránh hẳn rủi ro sửa sai dữ liệu nghiệp vụ, và mọi nơi đang trỏ tới ảnh đều tự đúng.
//
// LƯU Ý: các file PDF ĐÃ KÝ là bất biến (PAdES + nhật ký ký) nên không thể sửa lại — ảnh trong
// những PDF đó vẫn hiển thị "Không tải được ảnh" vĩnh viễn. Script chỉ giúp ảnh hiển thị lại ở
// trang chi tiết và ở các bản PDF được in/ký MỚI.
//
// Chạy:
//   node --env-file=.env.local scripts/convert-heic-images.mjs                 # khảo sát
//   node --env-file=.env.local scripts/convert-heic-images.mjs --apply         # chuyển đổi thật
//   node --env-file=.env.local scripts/convert-heic-images.mjs --prefix=<factory_id>/maintenance

const BACKUP_SUFFIX = ".heic.bak"
const JPEG_QUALITY = 0.85
const SNIFF_CONCURRENCY = 4 // hạ từ 8 xuống sau khi bị Storage/CDN chặn nhịp ở lần chạy đầu
const DELAY_BETWEEN_CONVERTS_MS = 300

function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Nhận diện định dạng theo magic bytes — bản Node của src/lib/image-format.ts (giữ đồng bộ). */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"])

function sniffFormat(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"
  if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") return "png"
  if (buf.slice(0, 4).toString("latin1") === "GIF8") return "gif"
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp"
  if (buf.slice(4, 8).toString("latin1") === "ftyp") {
    const major = buf.slice(8, 12).toString("latin1")
    if (major === "avif" || major === "avis") return "avif"
    if (HEIC_BRANDS.has(major)) return "heic"
    const compatible = buf.slice(16, Math.min(buf.length, 64)).toString("latin1")
    for (let i = 0; i + 4 <= compatible.length; i += 4) {
      const brand = compatible.slice(i, i + 4)
      if (brand === "avif" || brand === "avis") return "avif"
      if (HEIC_BRANDS.has(brand)) return "heic"
    }
  }
  return null
}

/** Storage `list` chỉ trả về 1 cấp — phải tự đệ quy để quét hết cây thư mục. */
async function listAllFiles(prefix) {
  const out = []
  const queue = [prefix]
  while (queue.length > 0) {
    const dir = queue.shift()
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000, offset })
      if (error) throw new Error(`list "${dir}": ${error.message}`)
      const rows = data || []
      for (const item of rows) {
        const full = dir ? `${dir}/${item.name}` : item.name
        if (item.id === null || item.metadata === null) queue.push(full) // thư mục con
        else out.push({ path: full, size: item.metadata?.size ?? 0 })
      }
      if (rows.length < 1000) break
      offset += rows.length
    }
  }
  return out
}

/**
 * Thử lại khi lỗi mạng tạm thời. Bắt buộc phải có: lần chạy đầu tiên gặp hàng loạt "fetch
 * failed" sau vài chục request liên tiếp (Storage/CDN chặn nhịp hoặc mạng chập chờn), khiến
 * 39/49 file bị bỏ sót. Nguy hiểm hơn là lỗi ở bước NHẬN DIỆN: file lỗi mạng sẽ bị xếp nhầm
 * vào nhóm "không đọc được" và âm thầm không được chuyển đổi.
 */
async function withRetry(fn, retries = 4, baseDelayMs = 1500) {
  let lastErr
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * attempt))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Chỉ tải 64 byte đầu để biết định dạng — không kéo cả file khi đang khảo sát. */
async function sniffRemote(path) {
  try {
    const buf = await withRetry(async () => {
      const res = await fetch(publicUrl(path), { headers: { Range: "bytes=0-63" } })
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    })
    return { path, format: sniffFormat(buf) }
  } catch (err) {
    return { path, format: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function convertOne(path) {
  // Tải qua SDK (`download`) thay vì URL công khai: đi thẳng Storage API, không qua lớp CDN —
  // ổn định hơn hẳn khi chạy hàng loạt.
  const heicBuffer = await withRetry(async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error) throw new Error(`tải về lỗi: ${error.message}`)
    return Buffer.from(await data.arrayBuffer())
  })

  const jpegBuffer = Buffer.from(await convert({ buffer: heicBuffer, format: "JPEG", quality: JPEG_QUALITY }))
  if (jpegBuffer[0] !== 0xff || jpegBuffer[1] !== 0xd8) throw new Error("kết quả chuyển đổi không phải JPEG hợp lệ")

  // 1) Sao lưu bản gốc. Nếu đã có bản sao lưu (lần chạy trước) thì coi như xong, không ghi đè.
  await withRetry(async () => {
    const { error } = await supabase.storage.from(BUCKET).copy(path, path + BACKUP_SUFFIX)
    if (error && !/exist/i.test(error.message)) throw new Error(`sao lưu lỗi: ${error.message}`)
  })

  // 2) Ghi đè đúng đường dẫn cũ để URL không đổi.
  await withRetry(async () => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, jpegBuffer, {
      upsert: true,
      contentType: "image/jpeg",
    })
    if (error) throw new Error(`ghi đè lỗi: ${error.message}`)
  })

  return { heicBytes: heicBuffer.length, jpegBytes: jpegBuffer.length }
}

async function main() {
  console.log(`Bucket: ${BUCKET}${PREFIX ? ` | prefix: ${PREFIX}` : ""}`)
  console.log(APPLY ? "CHẾ ĐỘ: GHI THẬT (--apply)" : "CHẾ ĐỘ: khảo sát (dry-run) — thêm --apply để chuyển đổi thật")
  console.log("")

  const files = (await listAllFiles(PREFIX)).filter((f) => !f.path.endsWith(BACKUP_SUFFIX))
  console.log(`Tổng số file (bỏ qua bản sao lưu): ${files.length}`)
  if (files.length === 0) return

  const sniffed = await mapWithConcurrency(files, SNIFF_CONCURRENCY, (f) => sniffRemote(f.path))

  const byFormat = new Map()
  for (const r of sniffed) {
    const key = r.format || (r.error ? `lỗi đọc (${r.error})` : "không nhận ra")
    byFormat.set(key, (byFormat.get(key) || 0) + 1)
  }
  console.log("Phân bố định dạng thật:")
  for (const [format, count] of [...byFormat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(format).padEnd(24)} ${count}`)
  }
  console.log("")

  let heicFiles = sniffed.filter((r) => r.format === "heic")
  if (LIMIT > 0) heicFiles = heicFiles.slice(0, LIMIT)

  console.log(`Số file HEIC cần chuyển đổi: ${heicFiles.length}`)
  if (heicFiles.length === 0) return

  if (!APPLY) {
    for (const f of heicFiles.slice(0, 20)) console.log(`  ${f.path}`)
    if (heicFiles.length > 20) console.log(`  ... và ${heicFiles.length - 20} file khác`)
    console.log("")
    console.log("Chạy lại với --apply để thực hiện chuyển đổi.")
    return
  }

  let ok = 0
  const failures = []
  for (const [index, f] of heicFiles.entries()) {
    if (index > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CONVERTS_MS))
    try {
      const { heicBytes, jpegBytes } = await convertOne(f.path)
      ok++
      console.log(
        `[${index + 1}/${heicFiles.length}] OK  ${(heicBytes / 1048576).toFixed(2)}MB -> ${(jpegBytes / 1048576).toFixed(2)}MB  ${f.path}`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      failures.push({ path: f.path, reason })
      console.log(`[${index + 1}/${heicFiles.length}] LỖI ${f.path} — ${reason}`)
    }
  }

  console.log("")
  console.log(`Hoàn tất: ${ok} thành công, ${failures.length} lỗi.`)
  if (failures.length > 0) {
    console.log("Danh sách lỗi:")
    for (const f of failures) console.log(`  ${f.path} — ${f.reason}`)
  }
  console.log(`Bản HEIC gốc được giữ lại ở "<đường dẫn>${BACKUP_SUFFIX}".`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

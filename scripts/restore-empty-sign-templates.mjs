// Khôi phục mẫu vị trí ký (mau_vi_tri) bị ghi đè bằng phiên bản RỖNG hoặc thiếu khung ký.
// Mặc định CHỈ XEM. `--apply` chèn phiên bản MỚI = bản sao phiên bản có khung ký gần nhất
// (không sửa/xoá dòng cũ). Lọc thêm: `--prefix=iso:code:NMCB-QT77` (mặc định "iso:").
import { createClient } from "@supabase/supabase-js"

const apply = process.argv.includes("--apply")
const prefixArg = process.argv.find((a) => a.startsWith("--prefix="))
const prefix = prefixArg ? prefixArg.slice("--prefix=".length) : "iso:"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const signBoxCount = (khung) =>
  Array.isArray(khung) ? khung.filter((b) => b && (b.loai === "chu_ky" || !b.loai)).length : 0

let rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("mau_vi_tri")
    .select("id, factory_id, loai_tai_lieu, phien_ban, khung, tao_boi, tao_luc")
    .like("loai_tai_lieu", `${prefix}%`)
    .order("id")
    .range(from, from + 999)
  if (error) throw error
  rows = rows.concat(data || [])
  if (!data || data.length < 1000) break
}

const byKey = new Map()
for (const r of rows) {
  const k = `${r.factory_id}|${r.loai_tai_lieu}`
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(r)
}

const fixes = []
for (const [, list] of byKey) {
  list.sort((a, b) => b.phien_ban - a.phien_ban)
  const latest = list[0]
  if (signBoxCount(latest.khung) > 0) continue
  const good = list.find((r) => signBoxCount(r.khung) > 0)
  console.log(
    `${latest.loai_tai_lieu}: mới nhất v${latest.phien_ban} (${(latest.khung || []).length} khung, ${signBoxCount(latest.khung)} khung ký, ${latest.tao_luc})` +
      (good ? ` → khôi phục từ v${good.phien_ban} (${good.khung.length} khung, ${good.tao_luc})` : " → KHÔNG có phiên bản có khung ký"),
  )
  console.log(`   lịch sử: ${list.map((r) => `v${r.phien_ban}:${(r.khung || []).length}`).join(" ")}`)
  if (good) fixes.push({ latest, good })
}
console.log(`\nTổng khoá: ${byKey.size}. Cần khôi phục: ${fixes.length}.`)

if (apply) {
  for (const { latest, good } of fixes) {
    const { error } = await supabase.from("mau_vi_tri").insert({
      factory_id: latest.factory_id,
      loai_tai_lieu: latest.loai_tai_lieu,
      phien_ban: latest.phien_ban + 1,
      khung: good.khung,
      tao_boi: good.tao_boi,
    })
    console.log(error ? `LỖI ${latest.loai_tai_lieu}: ${error.message}` : `Đã khôi phục ${latest.loai_tai_lieu} → v${latest.phien_ban + 1}`)
  }
} else {
  console.log("Chế độ xem — thêm --apply để ghi.")
}

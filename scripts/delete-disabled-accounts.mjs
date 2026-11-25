// Xoá tài khoản đăng nhập ĐÃ KHOÁ (status = disabled) và tài khoản TEST (username e2e_* / testuser) — người dùng yêu cầu
// 2026-11-25. Mặc định CHỈ XEM; `--apply` mới xoá.
//
// An toàn: xoá qua auth.admin.deleteUser. Hầu hết bảng nghiệp vụ tham chiếu auth.users KHÔNG có ON DELETE ⇒ tài khoản đã
// từng ký / tạo chứng từ sẽ bị Postgres TỪ CHỐI xoá (giữ lịch sử) — script báo "giữ lại" và bỏ qua, không xoá gì của
// người đó. Chỉ profiles / quyền / PIN / thông báo (ON DELETE CASCADE) đi theo tài khoản bị xoá.
// Không bao giờ xoá tài khoản đang active (trừ username test) hay tài khoản đã gắn hồ sơ nhân sự.
//
//   node --env-file=.env.local scripts/delete-disabled-accounts.mjs            # xem trước
//   node --env-file=.env.local scripts/delete-disabled-accounts.mjs --apply    # xoá

import { createClient } from "@supabase/supabase-js"

const apply = process.argv.includes("--apply")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const isTestUsername = (u) => /^e2e_/i.test(u || "") || /^testuser$/i.test(u || "")

const { data: profiles, error } = await sb.from("profiles").select("id, username, full_name, status, factory_id").range(0, 4999)
if (error) throw error
const { data: staffLinks, error: e2 } = await sb.from("maintenance_staff").select("profile_id").not("profile_id", "is", null).range(0, 9999)
if (e2) throw e2
const linked = new Set(staffLinks.map((s) => s.profile_id))

const targets = profiles
  .filter((p) => p.status === "disabled" || isTestUsername(p.username))
  .filter((p) => !linked.has(p.id))
  .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi"))

const skippedLinked = profiles.filter((p) => (p.status === "disabled" || isTestUsername(p.username)) && linked.has(p.id))

console.log(apply ? "== XOÁ THẬT ==" : "== XEM TRƯỚC (thêm --apply để xoá) ==")
console.log(`Tài khoản sẽ thử xoá: ${targets.length}`)
for (const p of targets) console.log(`  - ${p.full_name} (${p.username}) · ${p.status}${isTestUsername(p.username) ? " · TEST" : ""}`)
if (skippedLinked.length) {
  console.log(`Bỏ qua vì đã gắn hồ sơ nhân sự: ${skippedLinked.length}`)
  for (const p of skippedLinked) console.log(`  - ${p.full_name} (${p.username})`)
}
if (!apply) process.exit(0)

let ok = 0
const kept = []
for (const p of targets) {
  const { error: delErr } = await sb.auth.admin.deleteUser(p.id)
  if (delErr) kept.push(`${p.full_name} (${p.username}): ${delErr.message}`)
  else ok += 1
}
console.log(`Đã xoá: ${ok}`)
if (kept.length) {
  console.log(`Giữ lại (có lịch sử tham chiếu / lỗi): ${kept.length}`)
  for (const k of kept) console.log(`  - ${k}`)
}

// Kiểm toán quyền ISO — CHỈ ĐỌC, không ghi gì vào DB.
//
// Mục đích: trước khi chạy migration 20261006_iso_permissions_normalize.sql (GĐ2 chuẩn hoá bộ
// quyền ISO), mô phỏng đúng các bước chép/gỡ quyền của migration trên dữ liệu thật rồi so khả
// năng thao tác của TỪNG user active trước/sau — báo ai mất quyền ngoài ý muốn.
//
// Dùng đúng logic `fetchPermissionCodesForUser` (src/lib/auth.ts): user có BẤT KỲ dòng
// user_permissions granted=true nào thì CHỈ dùng tập đó; không có thì dùng role_permissions.
// Admin luôn có mọi quyền (hasPermission trả true).
//
// Chạy:
//   node --env-file=.env.local scripts/audit-iso-permissions.mjs            # bảng tóm tắt
//   node --env-file=.env.local scripts/audit-iso-permissions.mjs --verbose  # kèm từng user
//
// Sau khi chạy migration, chạy lại: phần "trước" lúc đó chính là trạng thái thật sau migration,
// và cột "mô phỏng lại" phải không đổi gì nữa (migration idempotent).

import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (chạy với --env-file=.env.local)")
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })
const verbose = process.argv.includes("--verbose")

// ── Đặc tả migration (PHẢI khớp tuyệt đối với file SQL) ──────────────────────────────────────
const DEPRECATED = new Set([
  "iso.edit", "iso.delete", "iso.print", "iso.soat_xet", "iso.signature",
  "iso.forms.view", "iso.forms.edit", "iso.forms.delete", "iso.sign",
])
// nguồn → các mã được chép thêm. `force` = ghi đè cả dòng granted=false (chỉ dùng khi user
// trước đây THỰC SỰ có khả năng đó qua mã nguồn, vd soát xét = xem xét).
const COPY_RULES = [
  { from: "iso.soat_xet", to: "iso.xem_xet", force: true },
  { from: "iso.soat_xet", to: "iso.forms.view_all" },
  { from: "iso.xem_xet", to: "iso.forms.view_all" },
  { from: "iso.phe_duyet", to: "iso.forms.approve" },
  { from: "iso.phe_duyet", to: "iso.forms.view_all" },
  { from: "iso.view", to: "iso.view_library" },
  { from: "iso.view", to: "iso.forms.create" },
  { from: "iso.create", to: "iso.forms.create" },
]

// Khả năng thao tác thật (theo code) — trước và sau GĐ2.
const CAPABILITIES = [
  ["Vào module ISO", (s) => s.has("iso.view"), (s) => s.has("iso.view")],
  ["Tạo tài liệu hồ sơ", (s) => s.has("iso.create"), (s) => s.has("iso.create")],
  ["Xem xét tài liệu", (s) => s.has("iso.soat_xet") || s.has("iso.xem_xet"), (s) => s.has("iso.xem_xet")],
  ["Phê duyệt tài liệu", (s) => s.has("iso.phe_duyet"), (s) => s.has("iso.phe_duyet")],
  ["Phân phối", (s) => s.has("iso.distribute"), (s) => s.has("iso.distribute")],
  ["Mở bản hết hiệu lực", (s) => s.has("iso.view_het_hieu_luc"), (s) => s.has("iso.view_het_hieu_luc")],
  ["Phê duyệt hồ sơ thực hiện", (s) => s.has("iso.forms.approve"), (s) => s.has("iso.forms.approve")],
  [
    "Lưu mẫu vị trí ký ISO",
    (s) => s.has("iso.create") || s.has("iso.edit") || s.has("iso.signature"),
    (s) => s.has("iso.create") || s.has("iso.forms.create"),
  ],
  ["Đặt chữ ký/PIN trong Cài đặt", (s) => s.has("iso.signature"), () => true],
  // Hồ sơ thực hiện cần soát xét: trước dùng chung iso.soat_xet || iso.xem_xet
  ["Restamp hết hiệu lực (API)", (s) => s.has("iso.phe_duyet") || s.has("iso.soat_xet") || s.has("iso.xem_xet"),
    (s) => s.has("iso.phe_duyet") || s.has("iso.xem_xet")],
]

async function fetchAll(table, cols, apply) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols).range(from, from + 999)
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

function applyRules(rows) {
  // rows: Map<code, granted:boolean> → trả Map mới sau migration
  const next = new Map(rows)
  for (const r of COPY_RULES) {
    if (rows.get(r.from) !== true) continue
    if (!next.has(r.to) || r.force) next.set(r.to, true)
  }
  for (const code of DEPRECATED) next.delete(code)
  return next
}

function grantedSet(map) {
  return new Set([...map].filter(([, g]) => g).map(([c]) => c))
}

const [profiles, userPerms, rolePerms] = await Promise.all([
  fetchAll("profiles", "id, username, full_name, role, status, factory_id", (q) => q.eq("status", "active")),
  fetchAll("user_permissions", "user_id, permission_code, granted"),
  fetchAll("role_permissions", "role, permission_code"),
])

const roleBefore = new Map()
for (const r of rolePerms) {
  if (!roleBefore.has(r.role)) roleBefore.set(r.role, new Map())
  roleBefore.get(r.role).set(r.permission_code, true)
}
const roleAfter = new Map([...roleBefore].map(([role, m]) => [role, applyRules(m)]))

const userRows = new Map()
for (const r of userPerms) {
  if (!userRows.has(r.user_id)) userRows.set(r.user_id, new Map())
  userRows.get(r.user_id).set(r.permission_code, r.granted === true)
}

const lost = []
const gainedNonIso = []
const fellBackToRole = []
const capCountBefore = CAPABILITIES.map(() => 0)
const capCountAfter = CAPABILITIES.map(() => 0)
const detail = []

for (const p of profiles) {
  const name = p.full_name || p.username || p.id
  if (p.role === "admin") {
    CAPABILITIES.forEach((_, i) => { capCountBefore[i]++; capCountAfter[i]++ })
    detail.push({ name, role: "admin", before: "(admin — mọi quyền)", after: "(admin — mọi quyền)" })
    continue
  }
  const explicitBefore = userRows.get(p.id) || new Map()
  const explicitAfter = applyRules(explicitBefore)
  const setB = grantedSet(explicitBefore)
  const setA = grantedSet(explicitAfter)
  const effBefore = setB.size > 0 ? setB : grantedSet(roleBefore.get(p.role) || new Map())
  const effAfter = setA.size > 0 ? setA : grantedSet(roleAfter.get(p.role) || new Map())
  if (setB.size > 0 && setA.size === 0) fellBackToRole.push(name)

  CAPABILITIES.forEach(([label, fb, fa], i) => {
    const b = fb(effBefore)
    const a = fa(effAfter)
    if (b) capCountBefore[i]++
    if (a) capCountAfter[i]++
    if (b && !a) lost.push(`${name} [${p.role}] — mất: ${label}`)
  })
  for (const c of effAfter) {
    if (!c.startsWith("iso.") && !effBefore.has(c)) gainedNonIso.push(`${name}: +${c}`)
  }
  for (const c of effBefore) {
    if (!c.startsWith("iso.") && !effAfter.has(c)) lost.push(`${name}: mất mã ngoài ISO ${c}`)
  }
  detail.push({
    name,
    role: p.role,
    nguon: setB.size > 0 ? "user_permissions" : "role_permissions",
    before: [...effBefore].filter((c) => c.startsWith("iso.")).sort().join(", ") || "—",
    after: [...effAfter].filter((c) => c.startsWith("iso.")).sort().join(", ") || "—",
  })
}

console.log(`\n=== Kiểm toán quyền ISO — ${profiles.length} user active ===\n`)
console.log("Khả năng thao tác                 Trước   Sau(mô phỏng)")
CAPABILITIES.forEach(([label], i) => {
  console.log(`  ${label.padEnd(32)} ${String(capCountBefore[i]).padStart(4)}   ${String(capCountAfter[i]).padStart(4)}`)
})

console.log("\n--- role_permissions (mã ISO) ---")
for (const [role, m] of roleBefore) {
  const b = [...grantedSet(m)].filter((c) => c.startsWith("iso.")).sort()
  const a = [...grantedSet(roleAfter.get(role))].filter((c) => c.startsWith("iso.")).sort()
  console.log(`  ${role}:\n    trước: ${b.join(", ") || "—"}\n    sau  : ${a.join(", ") || "—"}`)
}

const pending = [...profiles].filter((p) => {
  if (p.role === "admin") return false
  const m = userRows.get(p.id) || new Map()
  const a = applyRules(m)
  return [...m].some(([c]) => DEPRECATED.has(c)) || [...a].some(([c, g]) => g && !m.get(c))
}).length
console.log(`\nUser còn cần migration chạm tới (thêm/gỡ dòng user_permissions): ${pending}`)

console.log(`\n⚠ Mất khả năng ngoài ý muốn: ${lost.length}`)
lost.forEach((l) => console.log("  - " + l))
console.log(`⚠ Rơi về role_permissions vì tập quyền tường minh bị gỡ sạch: ${fellBackToRole.length}`)
fellBackToRole.forEach((l) => console.log("  - " + l))
console.log(`⚠ Được thêm mã ngoài ISO (do rơi về role): ${gainedNonIso.length}`)
gainedNonIso.forEach((l) => console.log("  - " + l))

if (verbose) {
  console.log("\n--- Chi tiết từng user (chỉ mã iso.*) ---")
  for (const d of detail) {
    console.log(`\n${d.name} [${d.role}${d.nguon ? ", " + d.nguon : ""}]\n  trước: ${d.before}\n  sau  : ${d.after}`)
  }
}

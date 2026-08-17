// Điều tra bug thật: người dùng chọn ảnh trong KpiEvidencePicker (form "Cập nhật tiến độ" của
// Công việc KPI) nhưng không có gì xảy ra — không thumbnail, không lỗi hiển thị. Nghi ngờ chính:
// bucket "order-files" (dùng chung nhiều module) có thể đã bị thắt RLS thủ công qua Supabase
// Dashboard (không phản ánh trong migration — xem comment đầu
// supabase/migrations/20260820_inventory_storage_bucket_lockdown.sql) theo cách không tương thích
// với path convention mới `{factory_id}/kpi/tasks/{taskId}/...`.
//
// Script này ĐĂNG NHẬP THẬT (magic link + verifyOtp, mirror
// scripts/verify-kpi-substitution-new-generation.mjs) rồi thử upload 1 file test nhỏ lên đúng
// path đó bằng session authenticated thật — giống hệt những gì trình duyệt sẽ làm. Không dùng
// service role để test (service role bypass RLS, không phản ánh đúng hành vi client thật).
//
// Chạy: node --env-file=.env.local scripts/investigate-kpi-evidence-upload.mjs

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // phuochoa_kt
const LUAN_EMAIL = "luanto@auth.rubber-erp.example.com"
const FAKE_TASK_ID = "00000000-0000-0000-0000-000000000001"

// 1x1 PNG hợp lệ (base64) — đủ để test upload thật, không cần ảnh thật.
const PNG_1PX_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

async function main() {
  console.log("── Bước 1: đăng nhập thật ──")
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: LUAN_EMAIL,
  })
  if (linkErr) throw linkErr
  const hashedToken = linkData?.properties?.hashed_token
  if (!hashedToken) throw new Error("Không lấy được hashed_token từ generateLink")

  const anonForVerify = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verifyData, error: verifyErr } = await anonForVerify.auth.verifyOtp({
    token_hash: hashedToken,
    type: "magiclink",
  })
  if (verifyErr) throw verifyErr
  const accessToken = verifyData?.session?.access_token
  if (!accessToken) throw new Error("Không lấy được access_token sau verifyOtp")
  console.log("Đã đăng nhập thật với user:", verifyData.user?.email, "uid:", verifyData.user?.id)

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  console.log("\n── Bước 2: thử upload lên bucket order-files bằng session authenticated thật ──")
  const buf = Buffer.from(PNG_1PX_BASE64, "base64")
  const path = `${FACTORY_ID}/kpi/tasks/${FAKE_TASK_ID}/${Date.now()}_test.png`
  console.log("Path:", path)

  const { data: uploadData, error: uploadErr } = await asUser.storage
    .from("order-files")
    .upload(path, buf, { contentType: "image/png", upsert: false })

  if (uploadErr) {
    console.log("❌ UPLOAD THẤT BẠI — đây chính là nguyên nhân bug (RLS chặn hoặc lỗi khác):")
    console.log(JSON.stringify(uploadErr, null, 2))
  } else {
    console.log("✅ Upload THÀNH CÔNG:", JSON.stringify(uploadData, null, 2))
    const { data: pub } = asUser.storage.from("order-files").getPublicUrl(path)
    console.log("Public URL:", pub.publicUrl)

    // Thử luôn getPublicUrl có thực sự tải được không (fetch)
    try {
      const res = await fetch(pub.publicUrl)
      console.log("Fetch public URL status:", res.status)
    } catch (e) {
      console.log("Fetch public URL lỗi:", e.message)
    }

    // Dọn dẹp
    const { error: delErr } = await admin.storage.from("order-files").remove([path])
    console.log(delErr ? `Dọn dẹp lỗi: ${delErr.message}` : "Đã dọn dẹp file test.")
  }

  console.log("\n── Bước 3 (đối chiếu): thử upload cùng path bằng service role (luôn bypass RLS) ──")
  const path2 = `${FACTORY_ID}/kpi/tasks/${FAKE_TASK_ID}/${Date.now()}_test-admin.png`
  const { error: adminUploadErr } = await admin.storage.from("order-files").upload(path2, buf, { contentType: "image/png" })
  console.log(adminUploadErr ? `Service role cũng lỗi (bất thường): ${adminUploadErr.message}` : "Service role upload OK (như kỳ vọng, chỉ để đối chiếu).")
  if (!adminUploadErr) await admin.storage.from("order-files").remove([path2])
}

main().catch((err) => {
  console.error("Script lỗi:", err)
  process.exit(1)
})

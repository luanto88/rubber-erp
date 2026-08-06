// One-off: sửa factories.full_name_en thành đúng chuẩn viết hoa
// "PHUOC HOA KAMPONG THOM PROCESSING FACTORY" (giá trị cũ có lỗi "PROCeSSING").
// Giá trị này được dds-generator.ts đọc động ở cả khối "SELLER INFORMATION" lẫn cột
// "Factory Name" của DDS Lô hàng — chỉ cần sửa dữ liệu, không cần đổi code.
//
// Chạy: node --env-file=.env.local scripts/fix-factory-name-en.mjs

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const NEW_NAME = "PHUOC HOA KAMPONG THOM PROCESSING FACTORY"

async function main() {
  const { data: factories, error: selectError } = await supabase
    .from("factories")
    .select("id, code, full_name_en")

  if (selectError) {
    console.error("Lỗi khi đọc factories:", selectError.message)
    process.exit(1)
  }

  console.log("Danh sách factories hiện có:")
  for (const f of factories || []) {
    console.log(`  - id=${f.id} code=${f.code} full_name_en="${f.full_name_en}"`)
  }

  const target = (factories || []).find((f) => f.code === "phuochoa_kt") || factories?.[0]
  if (!target) {
    console.error("Không tìm thấy factory nào để sửa.")
    process.exit(1)
  }

  console.log(`\nSẽ cập nhật factory id=${target.id} (code=${target.code}):`)
  console.log(`  Trước: "${target.full_name_en}"`)
  console.log(`  Sau:   "${NEW_NAME}"`)

  const { error: updateError } = await supabase
    .from("factories")
    .update({ full_name_en: NEW_NAME })
    .eq("id", target.id)

  if (updateError) {
    console.error("Lỗi khi cập nhật:", updateError.message)
    process.exit(1)
  }

  const { data: verify, error: verifyError } = await supabase
    .from("factories")
    .select("id, code, full_name_en")
    .eq("id", target.id)
    .single()

  if (verifyError) {
    console.error("Lỗi khi xác nhận lại:", verifyError.message)
    process.exit(1)
  }

  console.log(`\nĐã xác nhận: full_name_en = "${verify.full_name_en}"`)
}

main()

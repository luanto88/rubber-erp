/**
 * Seed dữ liệu module Bảo trì:
 *   - maintenance_assets: 160 thiết bị từ danh_muc_thiet_bi_goc.xlsx
 *   - maintenance_staff: 14 nhân sự từ danh_sach_nm.xlsx (sheet danh_sach_co_dien)
 *
 * Chạy: node --env-file=.env.local scripts/seed-maintenance.mjs
 *
 * Script idempotent — chạy nhiều lần không bị trùng.
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

// Cần cài thêm: npm install xlsx (nếu chưa có)
const XLSX = await import("xlsx").then(m => m.default || m)

const __dirname = dirname(fileURLToPath(import.meta.url))
const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // Phước Hòa Kampong Thom
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function ok(msg)  { console.log(`  ✅ ${msg}`) }
function err(msg) { console.error(`  ❌ ${msg}`); process.exit(1) }

// Chuyển Excel date serial → năm (string)
function excelDateToYear(v) {
  if (!v) return null
  if (typeof v === "number") {
    // Excel serial: days since 1900-01-01 (with leap year bug)
    const d = new Date((v - 25569) * 86400 * 1000)
    return String(d.getUTCFullYear())
  }
  return String(v).trim()
}

// ─── Seed thiết bị ────────────────────────────────────────────────────────────

async function seedAssets() {
  const filePath = join(__dirname, "../cung_cap_dl/kho_bao_tri/bao_tri/danh_muc_thiet_bi_goc.xlsx")
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1)

  const assets = rows
    .filter(r => r[2] && r[1]) // cần ma_tb và ten_tb
    .map(r => ({
      factory_id: FACTORY_ID,
      ma_tb: String(r[2]).trim(),
      ten_tb: String(r[1]).trim(),
      bo_phan: r[4] ? String(r[4]).trim() : "Khác",
      loai: "may_moc",
      nam_sd: excelDateToYear(r[3]),
      trang_thai: "active",
    }))

  const { data, error } = await sb
    .from("maintenance_assets")
    .upsert(assets, { onConflict: "factory_id,ma_tb", ignoreDuplicates: false })
    .select()

  if (error) err(`Seed thiết bị: ${error.message}`)
  ok(`Thiết bị: ${data.length} bản ghi`)
}

// ─── Seed nhân sự ─────────────────────────────────────────────────────────────

async function seedStaff() {
  const filePath = join(__dirname, "../cung_cap_dl/kho_bao_tri/bao_tri/danh_sach_nm.xlsx")
  const wb = XLSX.readFile(filePath)

  // Sheet danh_sach_co_dien
  const sheetName = wb.SheetNames.find(n => n.includes("co_dien")) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1)

  const staff = rows
    .filter(r => r[1]) // cần ten
    .map(r => ({
      factory_id: FACTORY_ID,
      ten: String(r[1]).trim(),
      chuc_vu: r[2] ? String(r[2]).trim() : null,
      active: true,
    }))

  // Insert without upsert (no unique constraint on ten + factory_id)
  // Kiểm tra đã có chưa trước khi insert
  const { data: existing } = await sb
    .from("maintenance_staff")
    .select("ten")
    .eq("factory_id", FACTORY_ID)

  const existingNames = new Set((existing || []).map(r => r.ten))
  const newStaff = staff.filter(s => !existingNames.has(s.ten))

  if (newStaff.length === 0) {
    ok(`Nhân sự: đã có ${staff.length} người, bỏ qua`)
    return
  }

  const { data, error } = await sb
    .from("maintenance_staff")
    .insert(newStaff)
    .select()

  if (error) err(`Seed nhân sự: ${error.message}`)
  ok(`Nhân sự: thêm ${data.length} người mới (tổng ${staff.length})`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("🔧  Seed module Bảo trì...")
await seedAssets()
await seedStaff()
console.log("✅  Hoàn thành!")

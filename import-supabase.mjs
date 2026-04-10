/**
 * RUBBER ERP — Import backup.json → Supabase
 * ============================================
 * CÁCH CHẠY:
 *   1. Đặt file này vào cùng thư mục với backup.json
 *   2. Mở terminal, chạy:
 *        node import-supabase.mjs
 *
 *   Script tự đọc SUPABASE_URL và SUPABASE_SERVICE_KEY từ .env.local
 *   Hoặc set thẳng ở phần CONFIG bên dưới.
 */

import { readFileSync, existsSync } from "fs";
import { createInterface } from "readline";

// ─── Đọc .env.local nếu có ───────────────────────────────────────────────────
function loadEnv() {
  const envFile = ".env.local";
  if (!existsSync(envFile)) return;
  readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const [k, ...v] = line.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}
loadEnv();

// ─── CONFIG — Điền vào đây nếu không dùng .env.local ─────────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://kaoeenrewvltnrbxmjfe.supabase.co";

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || ""; // ← Dán service_role key vào đây

const BACKUP_FILE = "backup.json";
const BATCH = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
  gray:  (s) => `\x1b[90m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
  yellow:(s) => `\x1b[33m${s}\x1b[0m`,
};

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsert(table, rows, pk) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: `resolution=merge-duplicates,return=minimal`,
  };

  let ok = 0, fail = 0;
  for (const batch of chunks(rows, BATCH)) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    if (res.ok) {
      ok += batch.length;
      process.stdout.write(`\r  ${c.green("✓")} ${ok}/${rows.length}`);
    } else {
      fail += batch.length;
      const err = await res.text();
      process.stdout.write(`\r  ${c.red("✗")} batch lỗi: ${err.slice(0, 120)}\n`);
    }
  }
  process.stdout.write("\n");
  return { ok, fail };
}

// ─── Transform functions ──────────────────────────────────────────────────────
function transformDx(r) {
  return {
    id:          r.id,
    ngay:        r.ngay,
    total_xe:    r.totalXe   ?? 0,
    total_diem:  r.totalDiem ?? 0,
    status:      r.status    ?? "draft",
    rows:        r.rows      ?? [],
  };
}

function transformNgan(r) {
  return {
    key:          r.key,
    ma_ngan:      r.ma_ngan      ?? "",
    ten_ngan:     r.ten_ngan     ?? "",
    loai_nl:      r.loai_nl      ?? "",
    nguon_goc:    r.nguon_goc    ?? "",
    xu_ly:        r.xu_ly        ?? "",
    chung_nhan:   r.chung_nhan   ?? "",
    ngay_bd:      r.ngay_bd      || null,
    ngay_kt:      r.ngay_kt      || null,
    trang_thai:   r.trang_thai   ?? "",
    tong_tuoi:    r.tong_tuoi    ?? 0,
    tong_kho:     r.tong_kho     ?? 0,
    trips:        r.trips        ?? [],
    lo_nguon_goc: r.lo_nguon_goc ?? "",
  };
}

function transformLot(r) {
  return {
    key:            r.key,
    ma_lo:          r.ma_lo         ?? "",
    num:            r.num           ?? 0,
    suffix:         r.suffix        ?? "",
    year:           r.year          ?? "",
    ngay_sx:        r.ngay_sx       || null,
    ca:             r.ca            ?? "",
    ngan_ref:       r.ngan_ref      || null,
    loai_csr:       r.loai_csr      ?? "",
    loai_banh:      r.loai_banh     ?? 35,
    boc:            r.boc           ?? "",
    tham:           r.tham          ?? "",
    pallet:         r.pallet        ?? [],
    chi_thi:        r.chi_thi       ?? "",
    kien_a:         r.kien_a        ?? 0,
    kien_b:         r.kien_b        ?? 0,
    kien_c:         r.kien_c        ?? 0,
    kien_d:         r.kien_d        ?? 0,
    tong_banh:      r.tong_banh     ?? 0,
    tong_kg:        r.tong_kg       ?? 0,
    trang_thai:     r.trang_thai    ?? "",
    ghi_chu:        r.ghi_chu       ?? "",
    dd_snapshot:    r.dd_snapshot   ?? null,
    is_manual_edit: r.isManualEdit  ?? false,
    edit_key:       r.editKey       ?? null,
  };
}

function transformSuffix(r) {
  return {
    code:       r.code,
    name:       r.name       ?? "",
    nguon:      r.nguon      ?? "",
    chung_nhan: r.chung_nhan ?? "",
    congty:     r.congty     ?? "",
  };
}

function transformQc(r) {
  return {
    key:        r.key,
    lot_ref:    r.lot_ref    || null,
    ma_lo:      r.ma_lo      ?? "",
    pkn:        r.pkn        ?? 0,
    ngay_kn:    r.ngay_kn    || null,
    ngay_sx:    r.ngay_sx    || null,
    chung_loai: r.chung_loai ?? "",
    loai_csr:   r.loai_csr   ?? "",
    loai_kn:    r.loai_kn    ?? "",
    tieu_chuan: r.tieu_chuan ?? "",
    so_mau:     r.so_mau     ?? 6,
    samples:    r.samples    ?? {},
    grade:      r.grade      ?? {},
    dat_hang:   r.dat_hang   ?? "",
    trang_thai: r.trang_thai ?? "",
    ghi_chu:    r.ghi_chu    ?? "",
    audit_log:  r.audit_log  ?? [],
  };
}

function transformCustomer(r) {
  return {
    id:        r.id,
    ma_kh:     r.ma_kh      ?? "",
    ten_kh_en: r.ten_kh_en  ?? "",
    email:     r.email      ?? "",
    dia_chi:   r.dia_chi    ?? "",
  };
}

function transformXhOrder(r) {
  return {
    key:          r.key,
    ma_don:       r.ma_don       ?? "",
    ngay:         r.ngay         || null,
    so_thong_bao: r.so_thong_bao ?? "",
    so_hoa_don:   r.so_hoa_don   ?? "",
    so_hop_dong:  r.so_hop_dong  ?? "",
    ma_kh:        r.ma_kh        ?? "",
    ten_kh:       r.ten_kh       ?? "",
    chung_loai:   r.chung_loai   ?? "",
    loai_pallet:  r.loai_pallet  ?? "",
    vehicles:     r.vehicles     ?? [],
    assignments:  r.assignments  ?? [],
    tong_banh:    r.tong_banh    ?? 0,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(c.bold("\n╔══════════════════════════════════════╗"));
  console.log(c.bold("║   RUBBER ERP — Import to Supabase    ║"));
  console.log(c.bold("╚══════════════════════════════════════╝\n"));

  // Kiểm tra key
  if (!SUPABASE_SERVICE_KEY) {
    console.log(c.red("❌ Thiếu SUPABASE_SERVICE_KEY!"));
    console.log(c.yellow("   Thêm vào file .env.local:"));
    console.log(c.gray("   SUPABASE_SERVICE_KEY=eyJhbGci...\n"));
    console.log(c.gray("   Lấy key tại: Supabase Dashboard → Settings → API → service_role\n"));
    process.exit(1);
  }

  // Đọc backup
  if (!existsSync(BACKUP_FILE)) {
    console.log(c.red(`❌ Không tìm thấy file: ${BACKUP_FILE}`));
    process.exit(1);
  }

  const backup = JSON.parse(readFileSync(BACKUP_FILE, "utf8"));
  console.log(c.cyan(`📦 Backup date: ${backup._backup_date}`));
  console.log(c.cyan(`📊 Tổng collections: 8\n`));

  const jobs = [
    { name: "dx_history",   data: backup.dxHistory  ?? [], fn: transformDx,       pk: "id"   },
    { name: "ngans",        data: backup.ngans       ?? [], fn: transformNgan,     pk: "key"  },
    { name: "lots",         data: backup.lots        ?? [], fn: transformLot,      pk: "key"  },
    { name: "suffixes",     data: backup.suffixes    ?? [], fn: transformSuffix,   pk: "code" },
    { name: "qc_results",   data: backup.qcResults   ?? [], fn: transformQc,       pk: "key"  },
    { name: "qc_custom_std",data: backup.qcCustomStd ?? [], fn: r => r,            pk: "key"  },
    { name: "customers",    data: backup.customers   ?? [], fn: transformCustomer, pk: "id"   },
    { name: "xh_orders",    data: backup.xhOrders    ?? [], fn: transformXhOrder,  pk: "key"  },
  ];

  let totalOk = 0, totalFail = 0;

  for (const job of jobs) {
    if (job.data.length === 0) {
      console.log(c.gray(`  ⏭  ${job.name.padEnd(15)} (0 records — bỏ qua)`));
      continue;
    }
    process.stdout.write(`  📥 ${c.bold(job.name.padEnd(15))} ${job.data.length} records... \n`);
    const rows = job.data.map(job.fn);
    const { ok, fail } = await upsert(job.name, rows, job.pk);
    totalOk   += ok;
    totalFail += fail;
  }

  console.log(c.bold("\n─────────────────────────────────────"));
  console.log(c.green(`✅ Import xong: ${totalOk} records`));
  if (totalFail > 0)
    console.log(c.red(`⚠️  Lỗi: ${totalFail} records`));
  console.log(c.bold("─────────────────────────────────────\n"));
}

main().catch(e => {
  console.error(c.red("\n❌ Lỗi nghiêm trọng:"), e.message);
  process.exit(1);
});

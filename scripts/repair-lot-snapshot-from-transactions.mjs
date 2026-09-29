// Khôi phục các lô mà bảng `lots` (kien_a..d / tong_banh) LỆCH với tổng `lot_transactions`.
//
// Bối cảnh (2026-09-28): lô 371cs/26 có giao dịch 144 bành nhưng `lots` chỉ ghi 24 (D=24) — lệch từ
// trước khi Thay bọc. Xuất hàng tính "còn lại = lots − đã gán đơn xuất" = 24 − 120 < 0 nên lô bị ẩn.
// Quy tắc đúng: `lots` = tổng giao dịch sản xuất (đủ 144), Xuất hàng tự trừ phần đã gán; lô chỉ
// "Xuất hàng" khi đã gán đủ tổng.
//
// Cách sửa từng lô:
//   1. Nếu lots.boc khác bọc của giao dịch VÀ sk_history có "Thay bọc" cho lô này với to_boc = lots.boc
//      ⇒ lan bọc mới xuống lot_transactions (giữ kết quả Thay bọc; nếu không, bước 2 sẽ trả lô về bọc cũ).
//   2. Gọi RPC sync_lot_master_snapshot ⇒ lots = tổng giao dịch.
//   3. Tính lại trạng thái theo đơn xuất (mẫu reconcile trong .claude/rules/08-module-export.md).
//
// Lô có "đơn xuất gán nhiều hơn tổng lô" (nghi đơn xuất trùng) CHỈ được liệt kê, không tự sửa.
//
// Chạy:
//   node --env-file=.env.local scripts/repair-lot-snapshot-from-transactions.mjs          (chỉ xem)
//   node --env-file=.env.local scripts/repair-lot-snapshot-from-transactions.mjs --apply  (ghi thật)
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function fetchAll(table, cols) {
  let out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const KIEN = ["a", "b", "c", "d"];
const num = (v) => Number(v) || 0;

const [lots, txs, orders, skRows] = await Promise.all([
  fetchAll("lots", "id,factory_id,ma_lo,trang_thai,boc,loai_banh,kien_a,kien_b,kien_c,kien_d,tong_banh"),
  fetchAll("lot_transactions", "id,lot_id,kien_a,kien_b,kien_c,kien_d,so_banh,boc,ngay_nhap,created_at"),
  fetchAll("export_orders", "id,factory_id,assignments"),
  fetchAll("sk_history", "id,loai,to_boc,lots,created_at"),
]);

const txByLot = new Map();
for (const t of txs) {
  if (!txByLot.has(t.lot_id)) txByLot.set(t.lot_id, []);
  txByLot.get(t.lot_id).push(t);
}

const assignedByLot = new Map();
for (const o of orders) {
  for (const a of o.assignments || []) {
    if (!a?.lot_id) continue;
    const cur = assignedByLot.get(a.lot_id) || { a: 0, b: 0, c: 0, d: 0 };
    for (const k of KIEN) cur[k] += num(a[`kien_${k}`]);
    assignedByLot.set(a.lot_id, cur);
  }
}

// lot_id -> to_boc của lần Thay bọc gần nhất
const thayBocToBoc = new Map();
for (const h of [...skRows].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) {
  if (h.loai !== "Thay bọc" || !h.to_boc) continue;
  for (const l of h.lots || []) if (l?.id) thayBocToBoc.set(l.id, h.to_boc);
}

const mismatched = [];
const overAssigned = [];

for (const lot of lots) {
  const list = txByLot.get(lot.id);
  const asg = assignedByLot.get(lot.id) || { a: 0, b: 0, c: 0, d: 0 };
  const asgTotal = KIEN.reduce((s, k) => s + asg[k], 0);
  if (!list || list.length === 0) continue;

  const txKien = { a: 0, b: 0, c: 0, d: 0 };
  let txTotal = 0;
  for (const t of list) {
    for (const k of KIEN) txKien[k] += num(t[`kien_${k}`]);
    txTotal += num(t.so_banh);
  }
  const lotsDiff =
    num(lot.tong_banh) !== txTotal || KIEN.some((k) => num(lot[`kien_${k}`]) !== txKien[k]);

  if (lotsDiff) {
    const txBocs = [...new Set(list.map((t) => t.boc).filter(Boolean))];
    const toBoc = thayBocToBoc.get(lot.id);
    const needBocSync = !!lot.boc && txBocs.some((b) => b !== lot.boc) && toBoc === lot.boc;
    mismatched.push({ lot, txKien, txTotal, asg, asgTotal, txBocs, needBocSync });
  } else if (asgTotal > txTotal) {
    overAssigned.push({ ma_lo: lot.ma_lo, trang_thai: lot.trang_thai, tong: txTotal, da_gan: asgTotal });
  }
}

function fmtKien(o) {
  return KIEN.map((k) => `${k.toUpperCase()}${o[k]}`).join(" ");
}

console.log(`\n=== ${APPLY ? "GHI THẬT" : "CHỈ XEM"} — ${lots.length} lô, ${mismatched.length} lô lệch lots ≠ giao dịch ===\n`);
for (const m of mismatched) {
  const { lot, txKien, txTotal, asg } = m;
  const conLai = {};
  for (const k of KIEN) conLai[k] = txKien[k] - asg[k];
  const expectStatus =
    m.asgTotal > 0 && m.asgTotal >= txTotal ? "Xuất hàng" : txTotal >= (num(lot.loai_banh) === 20 ? 240 : 144) ? "Hoàn thành" : "Dở dang";
  console.log(`• ${lot.ma_lo} [${lot.trang_thai}]`);
  console.log(`    lots hiện tại : ${fmtKien({ a: num(lot.kien_a), b: num(lot.kien_b), c: num(lot.kien_c), d: num(lot.kien_d) })} = ${num(lot.tong_banh)}`);
  console.log(`    theo giao dịch: ${fmtKien(txKien)} = ${txTotal}`);
  console.log(`    đã gán xuất   : ${fmtKien(asg)} = ${m.asgTotal}`);
  console.log(`    còn lại xuất  : ${fmtKien(conLai)} = ${txTotal - m.asgTotal}`);
  console.log(`    bọc lô "${lot.boc}" | bọc giao dịch ${JSON.stringify(m.txBocs)}${m.needBocSync ? "  → lan bọc lô xuống giao dịch (theo Thay bọc)" : m.txBocs.some((b) => b !== lot.boc) ? "  ⚠ bọc lệch, KHÔNG tự sửa" : ""}`);
  console.log(`    trạng thái sau: ${expectStatus}\n`);
}

if (overAssigned.length > 0) {
  console.log(`=== ${overAssigned.length} lô đơn xuất gán NHIỀU HƠN tổng lô (chỉ liệt kê, không sửa) ===`);
  for (const o of overAssigned) console.log(`  ${o.ma_lo} [${o.trang_thai}] tổng ${o.tong}, đã gán ${o.da_gan}`);
  console.log("");
}

if (!APPLY) {
  console.log("Chưa ghi gì. Kiểm tra danh sách trên rồi chạy lại với --apply.");
  process.exit(0);
}

let ok = 0;
for (const m of mismatched) {
  const { lot } = m;
  try {
    if (m.needBocSync) {
      const { error } = await sb.from("lot_transactions").update({ boc: lot.boc }).eq("lot_id", lot.id);
      if (error) throw new Error(`lan bọc: ${error.message}`);
    }
    const { data: snap, error: snapErr } = await sb.rpc("sync_lot_master_snapshot", { p_lot_id: lot.id });
    if (snapErr) throw new Error(`sync_lot_master_snapshot: ${snapErr.message}`);
    const row = Array.isArray(snap) ? snap[0] : snap;
    const tong = num(row?.tong_banh);
    let nextStatus = row?.trang_thai;
    if (m.asgTotal > 0 && m.asgTotal >= tong) nextStatus = "Xuất hàng";
    else if (nextStatus === "Xuất hàng") nextStatus = "Hoàn thành";
    if (nextStatus && nextStatus !== row?.trang_thai) {
      const { error } = await sb.from("lots").update({ trang_thai: nextStatus }).eq("id", lot.id);
      if (error) throw new Error(`trạng thái: ${error.message}`);
    }
    console.log(`✔ ${lot.ma_lo}: ${tong} bành, ${nextStatus}`);
    ok += 1;
  } catch (err) {
    console.error(`✘ ${lot.ma_lo}: ${err.message}`);
  }
}
console.log(`\nXong: ${ok}/${mismatched.length} lô.`);

// Dọn đơn xuất (2026-09-29, tiếp):
//
//   A. Gỡ khỏi đơn xuất các dòng gán trỏ tới lô NĂM 2025 không có trong Thành phẩm: lot_id không còn
//      trong `lots` VÀ mã lô không khớp lô nào cùng nhà máy VÀ mã lô kết thúc "/25". Chỉ gỡ DÒNG; tính
//      lại export_orders.tong_banh.
//   A'. Đơn còn 0 dòng sau khi gỡ → XÓA hẳn đơn (người dùng chốt; sao lưu nguyên dòng trước khi xóa).
//      Thực tế: XH-PHR-1-080126/1 chỉ gồm đúng 23 dòng 1428–1450cs/25.
//   B. Bọc đơn theo lô (lô là chuẩn), tính theo TỪNG KIỆN được gán: bọc kiện lấy từ lot_transactions
//      (giao dịch sau ghi đè giao dịch trước), không có thì lots.boc. 1 loại → ghi loai_boc nếu khác;
//      ≥2 loại → chỉ liệt kê. Mirror src/lib/lot-kien-boc.ts.
//   C. FORCE_BOC: đơn người dùng xác nhận thực tế giao 100% một loại bọc → đơn ghi bọc đó VÀ sửa bọc
//      các kiện đã gán trong đơn (lot_transactions theo kiện; lots/dự đoán/nháp khi cả lô đồng nhất).
//      Chỉ sửa 1 giao dịch khi MỌI kiện có bành trong giao dịch đó đều được gán trong đơn FORCE_BOC.
//
// Chạy:
//   node --env-file=.env.local scripts/repair-export-2025-and-boc.mjs          (chỉ xem)
//   node --env-file=.env.local scripts/repair-export-2025-and-boc.mjs --apply  (ghi thật, có sao lưu)
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// Đơn đã xác nhận bọc thực tế (2026-09-29): giao 100% bọc nhãn.
const FORCE_BOC = new Map([
  ["XH-PHR-26-010626/1", "Bọc nhãn 0,04 VRG CSR10"],
  ["XH-KUMHO-20-250426/1", "Bọc nhãn 0,04 VRG CSR10"],
  ["XH-NBS-21-210426/1", "Bọc nhãn 0,04 VRG CSR10"],
]);

async function fetchAll(table, cols, orderCols = ["id"]) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols);
    for (const c of orderCols) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

const KIEN = ["a", "b", "c", "d"];
const num = (v) => Number(v) || 0;
const norm = (s) => String(s ?? "").normalize("NFC").trim().toLowerCase();
const bales = (a) => KIEN.reduce((s, k) => s + num(a?.[`kien_${k}`]), 0);

const [lots, orders, txs] = await Promise.all([
  fetchAll("lots", "id,factory_id,ma_lo,boc"),
  fetchAll("export_orders", "*"),
  fetchAll("lot_transactions", "id,lot_id,boc,kien_a,kien_b,kien_c,kien_d,created_at", ["created_at", "id"]),
]);
const lotById = new Map(lots.map((l) => [l.id, l]));
const lotsByMa = new Map();
for (const l of lots) {
  const k = `${l.factory_id}|${norm(l.ma_lo)}`;
  lotsByMa.set(k, [...(lotsByMa.get(k) || []), l]);
}

// Bọc theo kiện (mirror buildLotKienBocMap).
const kienBoc = new Map();
for (const tx of txs) {
  const boc = String(tx.boc || lotById.get(tx.lot_id)?.boc || "").trim();
  if (!boc) continue;
  const kb = kienBoc.get(tx.lot_id) || {};
  for (const k of KIEN) if (num(tx[`kien_${k}`]) > 0) kb[k] = boc;
  kienBoc.set(tx.lot_id, kb);
}

function resolveLot(o, a) {
  if (a?.lot_id && lotById.has(a.lot_id)) return lotById.get(a.lot_id);
  const hit = lotsByMa.get(`${o.factory_id}|${norm(a?.ma_lo)}`) || [];
  return hit.length === 1 ? hit[0] : null;
}

const updates = [];
const deletes = [];
const removedLines = [];
const mixed = [];
const forcedKien = new Map(); // `${lotId}|${kien}` → bọc đích

for (const o of orders) {
  const list = Array.isArray(o.assignments) ? o.assignments : [];
  const patch = {};
  const notes = [];

  // A
  const kept = list.filter((a) => {
    const orphan2025 = !resolveLot(o, a) && /\/25$/i.test(String(a?.ma_lo ?? "").trim());
    if (orphan2025) removedLines.push(`${o.ma_don} (${o.ngay}): ${a.ma_lo} — ${bales(a)} bành`);
    return !orphan2025;
  });
  if (kept.length !== list.length) {
    if (kept.length === 0) {
      deletes.push(o); // A'
      continue;
    }
    patch.assignments = kept;
    const tong = kept.reduce((s, a) => s + bales(a), 0);
    patch.tong_banh = tong;
    notes.push(`gỡ ${list.length - kept.length} dòng lô 2025; tong_banh ${o.tong_banh ?? "—"} → ${tong}`);
  }

  const forced = FORCE_BOC.get(o.ma_don);
  if (forced) {
    // C
    for (const a of kept) {
      const lot = resolveLot(o, a);
      if (!lot) continue;
      for (const k of KIEN) if (num(a?.[`kien_${k}`]) > 0) forcedKien.set(`${lot.id}|${k}`, forced);
    }
    if (o.loai_boc !== forced) {
      patch.loai_boc = forced;
      notes.push(`loai_boc "${o.loai_boc ?? ""}" → "${forced}" (xác nhận thực tế)`);
    }
  } else {
    // B
    const bocs = new Set();
    for (const a of kept) {
      const lot = resolveLot(o, a);
      if (!lot) continue;
      for (const k of KIEN) {
        if (num(a?.[`kien_${k}`]) <= 0) continue;
        const b = String(kienBoc.get(lot.id)?.[k] ?? lot.boc ?? "").trim();
        if (b) bocs.add(b);
      }
    }
    if (bocs.size === 1) {
      const [b] = bocs;
      if (b !== o.loai_boc) {
        patch.loai_boc = b;
        notes.push(`loai_boc "${o.loai_boc ?? ""}" → "${b}"`);
      }
    } else if (bocs.size > 1) {
      mixed.push(`${o.ma_don} (${o.ngay}): đơn ghi "${o.loai_boc ?? ""}" · kiện gán: ${[...bocs].join(" + ")}`);
    }
  }

  if (Object.keys(patch).length) updates.push({ order: o, patch, notes });
}

// C — giao dịch cần đổi bọc
const txUpdates = [];
const txSkipped = [];
for (const tx of txs) {
  const withBales = KIEN.filter((k) => num(tx[`kien_${k}`]) > 0);
  const targets = withBales.map((k) => forcedKien.get(`${tx.lot_id}|${k}`));
  if (!targets.some(Boolean)) continue;
  if (targets.some((t) => !t) || new Set(targets).size > 1) {
    txSkipped.push(`${lotById.get(tx.lot_id)?.ma_lo} giao dịch ${tx.id.slice(0, 8)} có kiện không thuộc đơn`);
    continue;
  }
  const cur = String(tx.boc || lotById.get(tx.lot_id)?.boc || "").trim();
  if (cur !== targets[0]) txUpdates.push({ tx, target: targets[0] });
}
const touchedLots = [...new Set(txUpdates.map((u) => u.tx.lot_id))];

console.log(`${APPLY ? "GHI THẬT" : "CHẾ ĐỘ XEM"} — ${orders.length} đơn, ${updates.length} đơn cần sửa, ${deletes.length} đơn xóa\n`);
for (const u of updates) {
  console.log(`• ${u.order.ma_don} (${u.order.ngay})`);
  for (const n of u.notes) console.log(`    ${n}`);
}
console.log(`\nĐơn XÓA (còn 0 dòng sau khi gỡ lô 2025): ${deletes.length}`);
for (const o of deletes) console.log(`    - ${o.ma_don} (${o.ngay}) — ${(o.assignments || []).length} dòng, ${o.tong_banh ?? "—"} bành`);
console.log(`Dòng lô 2025 gỡ: ${removedLines.length}`);
console.log(`\nGiao dịch đổi bọc theo đơn xác nhận: ${txUpdates.length} dòng / ${touchedLots.length} lô`);
console.log(`    ${touchedLots.map((id) => lotById.get(id)?.ma_lo).join(", ")}`);
console.log(`Giao dịch bỏ qua: ${txSkipped.length}`);
for (const x of txSkipped) console.log(`    - ${x}`);
console.log(`\nĐơn có kiện nhiều loại bọc (không ghi, cần xem tay): ${mixed.length}`);
for (const x of mixed) console.log(`    - ${x}`);

if (!APPLY) {
  console.log("\nChưa ghi gì. Chạy lại với --apply để ghi.");
  process.exit(0);
}
if (!updates.length && !deletes.length && !txUpdates.length) process.exit(0);

const { writeFileSync, mkdirSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const backupDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "rubber-erp-backups");
mkdirSync(backupDir, { recursive: true });
const backupFile = join(backupDir, `export-2025-boc-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  backupFile,
  JSON.stringify(
    {
      updatedOrders: updates.map((u) => ({ id: u.order.id, ma_don: u.order.ma_don, loai_boc: u.order.loai_boc, tong_banh: u.order.tong_banh, assignments: u.order.assignments })),
      deletedOrders: deletes,
      txBoc: txUpdates.map((u) => ({ id: u.tx.id, lot_id: u.tx.lot_id, boc: u.tx.boc })),
      lotsBoc: touchedLots.map((id) => ({ id, ma_lo: lotById.get(id)?.ma_lo, boc: lotById.get(id)?.boc })),
    },
    null,
    2,
  ),
);
console.log(`\nĐã sao lưu vào ${backupFile}`);

let ok = 0;
for (const u of updates) {
  const { error } = await sb.from("export_orders").update({ ...u.patch, updated_at: new Date().toISOString() }).eq("id", u.order.id);
  if (error) console.error(`  ✗ ${u.order.ma_don}: ${error.message}`);
  else ok += 1;
}
let okDel = 0;
for (const o of deletes) {
  const { error } = await sb.from("export_orders").delete().eq("id", o.id);
  if (error) console.error(`  ✗ xóa ${o.ma_don}: ${error.message}`);
  else okDel += 1;
}
let okTx = 0;
for (const u of txUpdates) {
  const { error } = await sb.from("lot_transactions").update({ boc: u.target }).eq("id", u.tx.id);
  if (error) console.error(`  ✗ giao dịch ${u.tx.id}: ${error.message}`);
  else okTx += 1;
}
// Bản chụp lô + dự đoán + nháp: chỉ khi toàn bộ giao dịch của lô giờ cùng 1 bọc.
const newBocByTx = new Map(txUpdates.map((u) => [u.tx.id, u.target]));
let okLot = 0;
for (const lotId of touchedLots) {
  const lot = lotById.get(lotId);
  const bocs = new Set(
    txs.filter((t) => t.lot_id === lotId).map((t) => String(newBocByTx.get(t.id) ?? t.boc ?? lot.boc ?? "").trim()).filter(Boolean),
  );
  if (bocs.size !== 1) continue;
  const [b] = bocs;
  const r1 = await sb.from("lots").update({ boc: b }).eq("id", lotId);
  const r2 = await sb.from("lot_prediction_lots").update({ boc: b }).eq("factory_id", lot.factory_id).eq("ma_lo", lot.ma_lo).neq("trang_thai", "Hủy");
  const r3 = await sb.from("product_confirm_drafts").update({ boc: b }).eq("factory_id", lot.factory_id).eq("ma_lo", lot.ma_lo);
  const err = r1.error || r2.error || r3.error;
  if (err) console.error(`  ✗ lô ${lot.ma_lo}: ${err.message}`);
  else okLot += 1;
}
console.log(`\nĐã sửa ${ok}/${updates.length} đơn, xóa ${okDel}/${deletes.length} đơn, đổi bọc ${okTx}/${txUpdates.length} giao dịch, ${okLot}/${touchedLots.length} lô.`);

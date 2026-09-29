// Sửa dữ liệu đơn xuất lệch chuẩn (2026-09-29).
//
// Bối cảnh: mở sửa đơn XH-NBS-14-060326/1 thì ô chọn lô trống. Nguyên nhân: 26 đơn nhập CSV (03/09/2026)
// ghi chung_loai "CSR 10" và loai_boc "Bọc 0,04 VRG CSR 10"/"Bọc 0,04 không nhãn" — lô thật là "CSR10" /
// "Bọc nhãn 0,04 VRG CSR10" / "Bọc trơn 0,04"; màn Xuất hàng so khớp chính xác nên không thấy lô nào. Ngoài
// ra 74 dòng gán có lot_id cũ (lô bị tạo lại id mới, cùng mã lô) ⇒ Xuất hàng/EUDR/F12 không nối được lô.
//
// Các bước (theo từng đơn):
//   B1  relink lot_id: dòng gán có lot_id không còn trong lots → lô cùng nhà máy + cùng ma_lo, CHỈ khi khớp
//       đúng 1 lô. Không khớp → liệt kê "mất hẳn", không sửa (người dùng chốt giữ nguyên 23 dòng lô 2025).
//   B2  chung_loai: bỏ khoảng trắng nếu kết quả là 1 loai_csr có thật.
//   B3  loai_boc: bọc thật của các lô trong đơn — đúng 1 loại thì ghi loại đó; ≥2 loại giữ nguyên + báo;
//       không có lô thì ánh xạ bí danh.
//   B4  đồng bộ trạng thái các lô được relink (đã gán đủ tổng ⇒ Xuất hàng, còn lại ⇒ Hoàn thành).
//
// Chạy:
//   node --env-file=.env.local scripts/repair-export-orders.mjs          (chỉ xem)
//   node --env-file=.env.local scripts/repair-export-orders.mjs --apply  (ghi thật)
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
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

const KIEN = ["a", "b", "c", "d"];
const num = (v) => Number(v) || 0;
const norm = (s) => String(s ?? "").normalize("NFC").trim().toLowerCase();
const compact = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

// Bí danh bọc cũ → tên chuẩn (theo CSR của đơn).
function bocAlias(boc, csr) {
  const n = norm(boc).replace(/\s+/g, " ");
  if (!n) return null;
  if (/không nhãn|trơn/.test(n)) return "Bọc trơn 0,04";
  if (/^bọc (nhãn )?0,04 vrg/.test(n)) return `Bọc nhãn 0,04 VRG ${csr}`;
  return null;
}

const [lots, orders] = await Promise.all([
  fetchAll("lots", "id,factory_id,ma_lo,loai_csr,boc,trang_thai,tong_banh"),
  fetchAll("export_orders", "id,factory_id,ma_don,ngay,chung_loai,loai_boc,assignments"),
]);
const lotById = new Map(lots.map((l) => [l.id, l]));
const lotsByMa = new Map();
for (const l of lots) {
  const k = `${l.factory_id}|${norm(l.ma_lo)}`;
  lotsByMa.set(k, [...(lotsByMa.get(k) || []), l]);
}
const csrByFactory = new Map();
for (const l of lots) {
  if (!csrByFactory.has(l.factory_id)) csrByFactory.set(l.factory_id, new Set());
  if (l.loai_csr) csrByFactory.get(l.factory_id).add(l.loai_csr);
}

const updates = []; // { order, patch, notes[] }
const lost = [];
const mixedBoc = [];
const relinkedLotIds = new Set();
let relinkCount = 0;

for (const o of orders) {
  const notes = [];
  const patch = {};
  const list = Array.isArray(o.assignments) ? o.assignments : [];

  // B1
  let changedAssign = false;
  const newList = list.map((a) => {
    if (!a || (a.lot_id && lotById.has(a.lot_id))) return a;
    const hit = lotsByMa.get(`${o.factory_id}|${norm(a.ma_lo)}`) || [];
    if (hit.length === 1) {
      changedAssign = true;
      relinkCount += 1;
      relinkedLotIds.add(hit[0].id);
      notes.push(`relink ${a.ma_lo}: ${String(a.lot_id).slice(0, 8)} → ${hit[0].id.slice(0, 8)}`);
      return { ...a, lot_id: hit[0].id };
    }
    lost.push(`${o.ma_don} ${o.ngay}: ${a.ma_lo || a.lot_id} — ${KIEN.reduce((s, k) => s + num(a[`kien_${k}`]), 0)} bành${hit.length > 1 ? ` (mã trùng ${hit.length} lô)` : ""}`);
    return a;
  });
  if (changedAssign) patch.assignments = newList;

  // B2
  const csrSet = csrByFactory.get(o.factory_id) || new Set();
  let csr = o.chung_loai;
  if (csr && !csrSet.has(csr)) {
    const fixed = [...csrSet].find((c) => compact(c) === compact(csr));
    if (fixed) {
      patch.chung_loai = fixed;
      notes.push(`chung_loai "${csr}" → "${fixed}"`);
      csr = fixed;
    }
  }

  // B3
  const realBocs = [...new Set(newList.map((a) => lotById.get(a?.lot_id)?.boc).filter(Boolean))];
  const aliasBoc = bocAlias(o.loai_boc, csr);
  let targetBoc = null;
  if (realBocs.length === 1) targetBoc = realBocs[0];
  else {
    // Nhiều loại bọc: chỉ chuẩn hoá chuỗi bí danh (để dropdown khớp option), không suy thay.
    if (realBocs.length > 1) mixedBoc.push(`${o.ma_don} ${o.ngay}: đơn ghi "${o.loai_boc ?? ""}" · lô: ${realBocs.join(" + ")}`);
    targetBoc = aliasBoc;
  }
  if (targetBoc && targetBoc !== o.loai_boc) {
    patch.loai_boc = targetBoc;
    const conflict = realBocs.length === 1 && aliasBoc && aliasBoc !== targetBoc;
    notes.push(`loai_boc "${o.loai_boc ?? ""}" → "${targetBoc}"${conflict ? `  ⚠ đơn ghi bọc khác lô thật (theo lô)` : ""}`);
  }

  if (Object.keys(patch).length > 0) updates.push({ order: o, patch, notes });
}

console.log(`${APPLY ? "GHI THẬT" : "CHẾ ĐỘ XEM"} — ${orders.length} đơn, ${updates.length} đơn cần sửa, ${relinkCount} dòng relink\n`);
for (const u of updates) {
  console.log(`• ${u.order.ma_don} (${u.order.ngay})`);
  const relinks = u.notes.filter((n) => n.startsWith("relink"));
  const other = u.notes.filter((n) => !n.startsWith("relink"));
  for (const n of other) console.log(`    ${n}`);
  if (relinks.length) console.log(`    relink ${relinks.length} dòng: ${relinks.map((n) => n.split(":")[0].replace("relink ", "")).join(", ")}`);
}
console.log(`\nDòng gán MẤT HẲN lô (giữ nguyên, không sửa): ${lost.length}`);
for (const x of lost) console.log(`    - ${x}`);
console.log(`\nĐơn có lô nhiều loại bọc (giữ nguyên loai_boc, cần xem tay): ${mixedBoc.length}`);
for (const x of mixedBoc) console.log(`    - ${x}`);

// B4 — trạng thái lô sau relink (tính trên assignments SAU khi sửa)
const finalAssign = new Map(); // lot_id -> tổng bành đã gán
for (const o of orders) {
  const u = updates.find((x) => x.order.id === o.id);
  const list = u?.patch.assignments ?? (Array.isArray(o.assignments) ? o.assignments : []);
  for (const a of list) {
    if (!a?.lot_id) continue;
    finalAssign.set(a.lot_id, (finalAssign.get(a.lot_id) || 0) + KIEN.reduce((s, k) => s + num(a[`kien_${k}`]), 0));
  }
}
const statusFix = [];
const overAssigned = [];
for (const id of relinkedLotIds) {
  const l = lotById.get(id);
  const assigned = finalAssign.get(id) || 0;
  const total = num(l.tong_banh);
  if (assigned > total) overAssigned.push(`${l.ma_lo}: gán ${assigned} / sản xuất ${total}`);
  const next = assigned > 0 && assigned >= total ? "Xuất hàng" : "Hoàn thành";
  if (l.trang_thai !== next && ["Hoàn thành", "Xuất hàng"].includes(l.trang_thai)) statusFix.push({ l, next });
}
console.log(`\nLô được relink: ${relinkedLotIds.size} — cần đổi trạng thái: ${statusFix.length}`);
for (const s of statusFix) console.log(`    - ${s.l.ma_lo}: ${s.l.trang_thai} → ${s.next}`);
console.log(`Lô gán vượt sau relink: ${overAssigned.length}`);
for (const x of overAssigned) console.log(`    - ${x}`);

if (!APPLY) {
  console.log("\nChưa ghi gì. Chạy lại với --apply để ghi.");
  process.exit(0);
}

// Sao lưu bản gốc các đơn sắp sửa (để hoàn tác nếu cần) — ghi ra thư mục ngoài repo
// (../rubber-erp-backups) để không lọt vào git.
const { writeFileSync, mkdirSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const backupDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "rubber-erp-backups");
mkdirSync(backupDir, { recursive: true });
const backupFile = join(backupDir, `export-orders-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  backupFile,
  JSON.stringify(updates.map((u) => ({ id: u.order.id, ma_don: u.order.ma_don, chung_loai: u.order.chung_loai, loai_boc: u.order.loai_boc, assignments: u.order.assignments })), null, 2),
);
console.log(`\nĐã sao lưu bản gốc ${updates.length} đơn vào ${backupFile}`);

let ok = 0;
for (const u of updates) {
  const { error } = await sb
    .from("export_orders")
    .update({ ...u.patch, updated_at: new Date().toISOString() })
    .eq("id", u.order.id);
  if (error) console.error(`  ✗ ${u.order.ma_don}: ${error.message}`);
  else ok += 1;
}
let okStatus = 0;
for (const s of statusFix) {
  const { error } = await sb.from("lots").update({ trang_thai: s.next }).eq("id", s.l.id);
  if (error) console.error(`  ✗ ${s.l.ma_lo}: ${error.message}`);
  else okStatus += 1;
}
console.log(`\nĐã sửa ${ok}/${updates.length} đơn, ${okStatus}/${statusFix.length} trạng thái lô.`);

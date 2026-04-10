/**
 * Import backup.json → Supabase kv_store
 * Chạy: node import-kv.mjs
 */
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  readFileSync(".env.local","utf8").split("\n").forEach(line => {
    const [k,...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://kaoeenrewvltnrbxmjfe.supabase.co";
const KEY  = process.env.SUPABASE_SERVICE_KEY || "";

if (!KEY) { console.error("❌ Thiếu SUPABASE_SERVICE_KEY"); process.exit(1); }

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

// Lấy factory_id đầu tiên
const fRes = await fetch(`${BASE}/rest/v1/factories?select=id,code,name&limit=10`, { headers: H });
const factories = await fRes.json();
console.log("Factories:", factories.map(f => `${f.code} (${f.id})`).join(", "));

const FACTORY_ID = factories[0]?.id;
if (!FACTORY_ID) { console.error("❌ Không tìm thấy factory"); process.exit(1); }
console.log(`✅ Dùng factory: ${FACTORY_ID}\n`);

const backup = JSON.parse(readFileSync("backup.json","utf8"));

const keys = ["dxHistory","ngans","lots","suffixes","qcResults","qcCustomStd","customers","xhOrders"];

const rows = keys.map(k => ({
  factory_id: FACTORY_ID,
  key: k,
  value: backup[k] ?? [],
  updated_at: new Date().toISOString(),
}));

console.log("📥 Đang import vào kv_store...");
console.log("   Collections:", keys.map(k => `${k}(${(backup[k]||[]).length})`).join(", "));

const res = await fetch(`${BASE}/rest/v1/kv_store`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(rows),
});

if (res.ok) {
  console.log("\n✅ Import thành công!");
  const total = keys.reduce((s,k) => s + (backup[k]?.length||0), 0);
  console.log(`   Tổng: ${total} records trong ${keys.length} collections`);
} else {
  const err = await res.text();
  console.error("❌ Lỗi:", err);
}

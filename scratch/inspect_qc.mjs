import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  readFileSync(".env.local", "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://kaoeenrewvltnrbxmjfe.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function main() {
  const res = await fetch(`${URL}/rest/v1/qc_results?select=*&order=ngay_kn.desc,pkn.desc`, { headers });
  if (!res.ok) {
    console.error("Fetch error:", res.status, await res.text());
    return;
  }
  const data = await res.json();
  console.log(`Total qc_results rows: ${data.length}`);

  console.log("\n--- Failed (Rớt hạng) records ---");
  const failed = data.filter(r => r.dat_hang?.endsWith("RH"));
  console.log(`Count of failed records: ${failed.length}`);
  failed.forEach(r => {
    console.log(`ID: ${r.id} | PKN: ${r.pkn} | Lot: ${r.ma_lo} | Date: ${r.ngay_kn} | Type: ${r.loai_csr} | KN_type: ${r.loai_kn} | dat_hang: ${r.dat_hang} | parent_id: ${r.parent_id || 'NULL'} | lan: ${r.lan}`);
  });

  console.log("\n--- Retest (parent_id != null OR loai_kn == kl_rot_hang) records ---");
  const retests = data.filter(r => r.parent_id || r.loai_kn === "kl_rot_hang");
  console.log(`Count of retest records: ${retests.length}`);
  retests.forEach(r => {
    console.log(`ID: ${r.id} | PKN: ${r.pkn} | Lot: ${r.ma_lo} | Date: ${r.ngay_kn} | Type: ${r.loai_csr} | KN_type: ${r.loai_kn} | dat_hang: ${r.dat_hang} | parent_id: ${r.parent_id || 'NULL'} | lan: ${r.lan}`);
  });

  console.log("\n--- Check all lots that have multiple qc_results ---");
  const byLot = new Map();
  data.forEach(r => {
    const key = r.lot_id || r.ma_lo;
    if (!byLot.has(key)) byLot.set(key, []);
    byLot.get(key).push(r);
  });

  for (const [lot, rows] of byLot.entries()) {
    if (rows.length > 1) {
      console.log(`\nLot [${lot}] has ${rows.length} QC records:`);
      rows.forEach(r => {
        console.log(`   - ID: ${r.id} | PKN: ${r.pkn} | Date: ${r.ngay_kn} | KN_type: ${r.loai_kn} | dat_hang: ${r.dat_hang} | parent_id: ${r.parent_id} | lan: ${r.lan}`);
      });
    }
  }
}

main();

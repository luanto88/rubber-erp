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

function normalizeLotCode(maLo) {
  return String(maLo || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\\/g, "/");
}

async function main() {
  const res = await fetch(`${URL}/rest/v1/qc_results?select=*&order=ngay_kn.desc,pkn.desc`, { headers });
  const results = await res.json();

  const byParent = new Map();
  const byLotKey = new Map();
  results.forEach(r => {
    if (r.loai_kn === "kl_rot_hang") {
      if (r.parent_id) {
        const ex = byParent.get(r.parent_id);
        if (!ex || (r.lan || 1) > (ex.lan || 1) || new Date(r.created_at || 0) > new Date(ex.created_at || 0)) {
          byParent.set(r.parent_id, r);
        }
      }
      const k = r.lot_id || (r.ma_lo ? normalizeLotCode(r.ma_lo) : null);
      if (k) {
        const ex = byLotKey.get(k);
        if (!ex || (r.lan || 1) > (ex.lan || 1) || new Date(r.created_at || 0) > new Date(ex.created_at || 0)) {
          byLotKey.set(k, r);
        }
      }
    }
  });

  const getEffectiveQc = (r) => {
    if (r.loai_kn === "kl_rot_hang") return r;

    let curr = r;
    const visited = new Set();
    if (curr.id) visited.add(curr.id);

    while (curr.id && byParent.has(curr.id)) {
      const next = byParent.get(curr.id);
      if (visited.has(next.id)) break;
      visited.add(next.id);
      curr = next;
    }

    if (curr.id === r.id) {
      const k = r.lot_id || (r.ma_lo ? normalizeLotCode(r.ma_lo) : null);
      if (k && byLotKey.has(k)) {
        const retest = byLotKey.get(k);
        if (new Date(retest.created_at || 0) >= new Date(r.created_at || 0)) {
          curr = retest;
          while (curr.id && byParent.has(curr.id)) {
            const next = byParent.get(curr.id);
            if (visited.has(next.id)) break;
            visited.add(next.id);
            curr = next;
          }
        }
      }
    }

    return curr;
  };

  console.log("=== NEW getEffectiveQc for 2026-03-16 records ===");
  const mar16 = results.filter(r => r.ngay_kn === "2026-03-16");
  mar16.forEach(r => {
    const eff = getEffectiveQc(r);
    const isFailed = eff.dat_hang?.endsWith("RH") === true;
    console.log(`Original: PKN ${r.pkn} Lot ${r.ma_lo} (ID ${r.id}) => Effective: PKN ${eff.pkn} Lot ${eff.ma_lo} (ID ${eff.id}, lan ${eff.lan}, dat_hang ${eff.dat_hang}, ngay_kn ${eff.ngay_kn}) | isFailed: ${isFailed}`);
  });
}

main();

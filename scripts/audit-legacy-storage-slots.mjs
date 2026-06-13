import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function getTripWeights(row, loaiNl) {
  switch (loaiNl) {
    case "Mủ chén":
      return { tuoi: Number(row.kl_ct || 0), kho: Number(row.kl_ck || 0) };
    case "Mủ đông chén":
      return { tuoi: Number(row.kl_dct || 0), kho: Number(row.kl_dck || 0) };
    case "Mủ đông khối":
      return { tuoi: Number(row.kl_dkt || 0), kho: Number(row.kl_dkk || 0) };
    case "Mủ dây":
      return { tuoi: Number(row.kl_dt || 0), kho: Number(row.kl_dk || 0) };
    case "Mủ nước":
      return { tuoi: Number(row.kl_mn || 0), kho: Number(row.kl_mnk || 0) };
    default:
      return { tuoi: 0, kho: 0 };
  }
}

function buildTripRef(entryId, row) {
  const rowId = String(row.row_id || row.uid || "").trim();
  return entryId && rowId ? `${entryId}::${rowId}` : String(row.uid || "").trim();
}

function parseArgs(argv) {
  const names = new Set();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--slot" && argv[i + 1]) {
      names.add(String(argv[i + 1]).trim());
      i += 1;
    }
  }
  return { names, json };
}

const { names: requestedNames, json } = parseArgs(process.argv.slice(2));
const env = loadEnv(".env.local");
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

const { data: ngans, error: ngansError } = await supabase
  .from("ngans")
  .select("id,factory_id,ten_ngan,ma_ngan,loai_nl,trang_thai,tong_tuoi,tong_kho,ngay_bd,ngay_kt,xe_tu_ngay,xe_den_ngay,trips")
  .order("ngay_bd", { ascending: true });

if (ngansError) throw ngansError;

const filteredNgans = (ngans || []).filter((ngan) => {
  if (requestedNames.size > 0 && !requestedNames.has(String(ngan.ten_ngan || "").trim())) {
    return false;
  }
  return Number(ngan.tong_kho || 0) <= 0;
});

const nganIds = filteredNgans.map((ngan) => ngan.id);
if (nganIds.length === 0) {
  console.log(json ? "[]" : "No matching zero-stock slots found.");
  process.exit(0);
}

const { data: lots, error: lotsError } = await supabase
  .from("lots")
  .select("id,ma_lo,ngan_id,tong_kg,trang_thai,ngay_sx")
  .in("ngan_id", nganIds);

if (lotsError) throw lotsError;

const legacyNgans = filteredNgans.filter((ngan) =>
  (lots || []).some((lot) => lot.ngan_id === ngan.id && Number(lot.tong_kg || 0) > 0),
);

if (legacyNgans.length === 0) {
  console.log(json ? "[]" : "No zero-stock slots with finished-product lots found.");
  process.exit(0);
}

const dateRanges = [
  ...new Set(
    legacyNgans.flatMap((ngan) => [normalizeDate(ngan.xe_tu_ngay), normalizeDate(ngan.xe_den_ngay)]).filter(Boolean),
  ),
].sort();

const minDate = dateRanges[0];
const maxDate = dateRanges[dateRanges.length - 1];

const { data: dispatchEntries, error: dispatchError } = await supabase
  .from("dispatch_entries")
  .select("id,ngay,rows")
  .gte("ngay", minDate)
  .lte("ngay", maxDate)
  .order("ngay", { ascending: true });

if (dispatchError) throw dispatchError;

const overlappingNames = (target) =>
  legacyNgans
    .filter((other) => other.id !== target.id)
    .filter((other) => {
      const aFrom = normalizeDate(target.xe_tu_ngay);
      const aTo = normalizeDate(target.xe_den_ngay || target.xe_tu_ngay);
      const bFrom = normalizeDate(other.xe_tu_ngay);
      const bTo = normalizeDate(other.xe_den_ngay || other.xe_tu_ngay);
      return aFrom && aTo && bFrom && bTo && aFrom <= bTo && bFrom <= aTo;
    })
    .map((other) => other.ten_ngan);

const report = legacyNgans.map((ngan) => {
  const nganLots = (lots || []).filter((lot) => lot.ngan_id === ngan.id);
  const fromDate = normalizeDate(ngan.xe_tu_ngay);
  const toDate = normalizeDate(ngan.xe_den_ngay || ngan.xe_tu_ngay);
  const candidateTrips = [];
  let candidateTuoi = 0;
  let candidateKho = 0;

  for (const entry of dispatchEntries || []) {
    const entryDate = normalizeDate(entry.ngay);
    if (fromDate && entryDate < fromDate) continue;
    if (toDate && entryDate > toDate) continue;
    for (const row of Array.isArray(entry.rows) ? entry.rows : []) {
      const weights = getTripWeights(row, ngan.loai_nl);
      if (weights.tuoi <= 0 && weights.kho <= 0) continue;
      candidateTrips.push({
        ref: buildTripRef(entry.id, row),
        ngay: entryDate,
        so_xe: row.so_xe || "",
        chuyen: Number(row.chuyen || 1),
        tuoi: Math.round(weights.tuoi * 100) / 100,
        kho: Math.round(weights.kho * 100) / 100,
      });
      candidateTuoi += weights.tuoi;
      candidateKho += weights.kho;
    }
  }

  return {
    ten_ngan: ngan.ten_ngan,
    ma_ngan: ngan.ma_ngan,
    trang_thai: ngan.trang_thai,
    loai_nl: ngan.loai_nl,
    ngay_bd: ngan.ngay_bd,
    ngay_kt: ngan.ngay_kt,
    xe_tu_ngay: ngan.xe_tu_ngay,
    xe_den_ngay: ngan.xe_den_ngay,
    persisted_trip_count: Array.isArray(ngan.trips) ? ngan.trips.length : 0,
    lot_count: nganLots.length,
    lot_kg: nganLots.reduce((sum, lot) => sum + Number(lot.tong_kg || 0), 0),
    lot_sample: nganLots.slice(0, 8).map((lot) => ({
      ma_lo: lot.ma_lo,
      kg: lot.tong_kg,
      trang_thai: lot.trang_thai,
      ngay_sx: lot.ngay_sx,
    })),
    candidate_trip_count: candidateTrips.length,
    candidate_tong_tuoi: Math.round(candidateTuoi * 100) / 100,
    candidate_tong_kho: Math.round(candidateKho * 100) / 100,
    candidate_trip_sample: candidateTrips.slice(0, 8),
    overlapping_legacy_slots: overlappingNames(ngan),
  };
});

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const item of report) {
    console.log(`\n[${item.ten_ngan}] ${item.ma_ngan}`);
    console.log(`  Status: ${item.trang_thai} | Loai NL: ${item.loai_nl}`);
    console.log(`  Dates : ${item.ngay_bd} -> ${item.ngay_kt} | Xe: ${item.xe_tu_ngay} -> ${item.xe_den_ngay}`);
    console.log(`  Lots  : ${item.lot_count} lots | ${item.lot_kg} kg`);
    console.log(`  Trips : persisted=${item.persisted_trip_count} | candidate=${item.candidate_trip_count}`);
    console.log(`  Cand. : tuoi=${item.candidate_tong_tuoi} | kho=${item.candidate_tong_kho}`);
    console.log(
      `  Overlap legacy slots: ${
        item.overlapping_legacy_slots.length > 0 ? item.overlapping_legacy_slots.join(", ") : "none"
      }`,
    );
    const sample = item.lot_sample.map((lot) => lot.ma_lo).join(", ");
    console.log(`  Lot sample: ${sample || "-"}`);
  }
}

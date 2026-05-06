import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function normalizeLotCode(maLo) {
  return String(maLo || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\\/g, "/")
}

function stripYear(maLo) {
  return normalizeLotCode(maLo).replace(/\/\d{2,4}$/, "")
}

function getLotRank(lot) {
  if (lot.trang_thai === "Xuất hàng") return 4
  if (lot.trang_thai === "Hoàn thành") return 3
  if (lot.trang_thai === "Dở dang") return 2
  return lot.tong_banh ? 1 : 0
}

function pickCanonicalLot(current, candidate) {
  if (!current) return candidate
  const currentRank = getLotRank(current)
  const candidateRank = getLotRank(candidate)
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current
  const currentDate = current.ngay_ht || ""
  const candidateDate = candidate.ngay_ht || ""
  if (candidateDate !== currentDate) return candidateDate > currentDate ? candidate : current
  return (candidate.tong_banh || 0) >= (current.tong_banh || 0) ? candidate : current
}

function inferCompletionDate(lot) {
  if (!lot) return null
  if (!["Hoàn thành", "Xuất hàng"].includes(lot.trang_thai)) return null

  const history = Array.isArray(lot.dd_snapshot?.history) ? lot.dd_snapshot.history : []
  const lastHistoryDate = [...history]
    .reverse()
    .map((entry) => entry?.ngay_sx || "")
    .find(Boolean)

  return lastHistoryDate || lot.ngay_ht || lot.ngay_sx || null
}

async function main() {
  const { data: lots, error: lotsError } = await supabase
    .from("lots")
    .select("id,factory_id,loai_csr,ma_lo,ngay_sx,ngay_ht,trang_thai,tong_banh,dd_snapshot")
  if (lotsError) throw lotsError

  const { data: qcResults, error: qcError } = await supabase
    .from("qc_results")
    .select("id,factory_id,loai_csr,lot_id,ma_lo,ngay_sx")
  if (qcError) throw qcError

  const lotById = new Map()
  const lotByFactoryLoaiExact = new Map()
  const lotByFactoryLoaiBase = new Map()
  const canonicalByFactoryLoaiMaLo = new Map()

  for (const lot of lots || []) {
    lotById.set(lot.id, lot)

    const exactKey = `${lot.factory_id}|${lot.loai_csr}|${normalizeLotCode(lot.ma_lo)}`
    const baseKey = `${lot.factory_id}|${lot.loai_csr}|${stripYear(lot.ma_lo)}`

    lotByFactoryLoaiExact.set(exactKey, pickCanonicalLot(lotByFactoryLoaiExact.get(exactKey), lot))
    lotByFactoryLoaiBase.set(baseKey, pickCanonicalLot(lotByFactoryLoaiBase.get(baseKey), lot))
    canonicalByFactoryLoaiMaLo.set(exactKey, pickCanonicalLot(canonicalByFactoryLoaiMaLo.get(exactKey), lot))
  }

  let relinkedQcCount = 0
  let updatedLotDateCount = 0
  let updatedQcDateCount = 0

  for (const row of qcResults || []) {
    const exactKey = `${row.factory_id}|${row.loai_csr}|${normalizeLotCode(row.ma_lo)}`
    const baseKey = `${row.factory_id}|${row.loai_csr}|${stripYear(row.ma_lo)}`
    const exactLot = canonicalByFactoryLoaiMaLo.get(exactKey) || lotByFactoryLoaiExact.get(exactKey)
    const baseLot = lotByFactoryLoaiBase.get(baseKey)
    const matched = exactLot || baseLot || null
    if (!matched) continue

    const qcDate = inferCompletionDate(matched) || matched.ngay_sx || row.ngay_sx
    const needsUpdate =
      row.lot_id !== matched.id ||
      row.ma_lo !== matched.ma_lo ||
      row.ngay_sx !== qcDate
    if (!needsUpdate) continue

    const { error } = await supabase
      .from("qc_results")
      .update({
        lot_id: matched.id,
        ma_lo: matched.ma_lo,
        ngay_sx: qcDate,
      })
      .eq("id", row.id)
    if (error) throw error
    relinkedQcCount += 1
  }

  for (const lot of lots || []) {
    const completionDate = inferCompletionDate(lot)
    if ((lot.ngay_ht || null) === (completionDate || null)) continue

    const { error } = await supabase
      .from("lots")
      .update({ ngay_ht: completionDate })
      .eq("id", lot.id)
    if (error) throw error

    lot.ngay_ht = completionDate
    lotById.set(lot.id, lot)
    updatedLotDateCount += 1
  }

  const { data: qcResultsAfterLink, error: qcAfterError } = await supabase
    .from("qc_results")
    .select("id,lot_id,ngay_sx")
    .not("lot_id", "is", null)
  if (qcAfterError) throw qcAfterError

  for (const row of qcResultsAfterLink || []) {
    const lot = lotById.get(row.lot_id)
    if (!lot) continue
    const qcDate = inferCompletionDate(lot) || lot.ngay_sx
    if (!qcDate || row.ngay_sx === qcDate) continue

    const { error } = await supabase
      .from("qc_results")
      .update({ ngay_sx: qcDate })
      .eq("id", row.id)
    if (error) throw error
    updatedQcDateCount += 1
  }

  console.log("Backfill completed.")
  console.log(`Relinked qc_results to canonical lots: ${relinkedQcCount}`)
  console.log(`Updated lots.ngay_ht: ${updatedLotDateCount}`)
  console.log(`Updated qc_results.ngay_sx: ${updatedQcDateCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

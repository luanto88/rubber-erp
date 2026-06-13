export type NormalizedLotStatus = "Dở dang" | "Hoàn thành" | "Xuất hàng";

type LotLike = {
  id: string;
  ma_lo: string;
  factory_id?: string | null;
  trang_thai?: string | null;
  tong_banh?: number | null;
  lot_transactions?: unknown[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function foldText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function normalizeLotStatus(status?: string | null): NormalizedLotStatus {
  const folded = foldText(status).replace(/\s+/g, "");
  if (folded === "xuathang") return "Xuất hàng";
  if (folded === "hoanthanh") return "Hoàn thành";
  return "Dở dang";
}

export function pickCanonicalLot<T extends LotLike>(lots: T[]): T {
  return [...lots].sort((a, b) => {
    const timestampDiff = getLotTimestamp(b) - getLotTimestamp(a);
    if (timestampDiff !== 0) return timestampDiff;

    const txCountDiff =
      (b.lot_transactions?.length || 0) - (a.lot_transactions?.length || 0);
    if (txCountDiff !== 0) return txCountDiff;

    const quantityDiff = Number(b.tong_banh || 0) - Number(a.tong_banh || 0);
    if (quantityDiff !== 0) return quantityDiff;

    return (
      getStatusRank(normalizeLotStatus(b.trang_thai)) -
      getStatusRank(normalizeLotStatus(a.trang_thai))
    );
  })[0];
}

export function dedupeLotsByMaLo<T extends LotLike>(lots: T[]): T[] {
  const grouped = new Map<string, T[]>();

  lots.forEach((lot) => {
    const key = `${lot.factory_id || ""}::${foldText(lot.ma_lo)}`;
    const items = grouped.get(key) || [];
    items.push(lot);
    grouped.set(key, items);
  });

  return Array.from(grouped.values()).map((group) => pickCanonicalLot(group));
}

function getStatusRank(status: NormalizedLotStatus) {
  switch (status) {
    case "Xuất hàng":
      return 3;
    case "Hoàn thành":
      return 2;
    default:
      return 1;
  }
}

function getLotTimestamp(lot: LotLike) {
  return new Date(lot.updated_at || lot.created_at || 0).getTime();
}

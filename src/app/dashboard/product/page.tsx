"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { getActiveFactoryId } from "@/lib/auth";
import {
  deleteLotTransaction,
  saveLotTransaction,
} from "@/app/dashboard/product/actions";
import {
  dedupeLotsByMaLo,
  normalizeLotStatus,
} from "@/app/dashboard/product/shared";
import { InventoryImageUpload } from "@/app/dashboard/inventory/_components/inventory-image-upload";
import {
  Plus,
  Search,
  X,
  ChevronLeft,
  Edit2,
  Trash2,
  Package,
  CheckCircle,
  Clock,
  Layers,
  Weight,
  AlertTriangle,
  Lock,
  Warehouse,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type Lot = {
  id: string;
  factory_id?: string;
  ma_lo: string;
  num: number;
  suffix: string;
  year: string;
  ngay_sx: string;
  ngay_ht?: string | null;
  ca: string;
  ngan_id: string | null;
  day_chuyen: string;
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  pallet: string[];
  chi_thi: string;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  tong_banh: number;
  tong_kg: number;
  trang_thai: string;
  ghi_chu: string;
  image_url_1?: string;
  image_url_2?: string;
  created_at?: string;
  updated_at?: string;
  ngans?: { ten_ngan: string; ma_ngan: string; loai_nl: string };
  lot_transactions?: LotTransaction[];
};

type LotTransaction = {
  id: string;
  lot_id: string;
  ngan_id: string;
  ca: string;
  ngay_nhap: string;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  so_banh: number;
  so_kg: number;
  created_at?: string;
};

type Ngan = {
  id: string;
  ten_ngan: string;
  ma_ngan: string;
  tong_kho: number;
  trang_thai: string;
  ngay_bd: string;
  loai_nl: string;
  chung_nhan: string;
  ngay_kt: string;
};

type SuffixItem = {
  code: string;
  name: string;
  nguon: string;
  chung_nhan: string;
};

type SessionHeader = {
  year: string;
  ngay_sx: string; // d\u00f9ng chung m\u1ecdi ca, m\u1eb7c \u0111\u1ecbnh maxDate+1
  day_chuyen: string;
  so_ca: 1 | 2 | 3;
  ngan_id: string;
  suffix: string; // "" = Tr\u1ed1ng
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  chi_thi: string;
  pallet: string[];
  image_url_1: string;
  image_url_2: string;
};

type LotDraft = {
  num: number;
  role: "dau" | "giua" | "cuoi" | "single";
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  prev_a: number;
  prev_b: number;
  prev_c: number;
  prev_d: number;
  locked_a: boolean;
  locked_b: boolean;
  locked_c: boolean;
  locked_d: boolean;
  is_continuation: boolean;
  existing_id?: string;
  is_already_completed?: boolean;
  tong_banh: number;
  tong_kg: number;
  trang_thai: string;
};

type CaSection = {
  ca: "A" | "B" | "C";
  from_num: number;
  to_num: number;
  lots: LotDraft[];
};

type EditForm = {
  ma_lo: string;
  num: number;
  suffix: string;
  year: string;
  ngay_sx: string;
  ca: string;
  ngan_id: string;
  day_chuyen: string;
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  pallet: string[];
  chi_thi: string;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  tong_banh: number;
  tong_kg: number;
  trang_thai: string;
  ghi_chu: string;
};

type LotContribution = Lot & {
  uid: string;
  transaction_id?: string;
  tong_banh_cua_ca: number;
  tong_kg_cua_ca: number;
  locked_a?: boolean;
  locked_b?: boolean;
  locked_c?: boolean;
  locked_d?: boolean;
  disp_a: number;
  disp_b: number;
  disp_c: number;
  disp_d: number;
};

type LotSeries = {
  loai_csr: string;
  loai_banh: number;
  year: string;
};

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CA_OPTS = ["A", "B", "C"];
const THAM_OPTS = ["c\u0169", "M\u1edbi"];
const TRANG_THAI_OPTS = ["Ho\u00e0n th\u00e0nh", "D\u1edf dang", "Xu\u1ea5t h\u00e0ng"];
const PALLET_OPTS = ["S\u1eaft \u0111\u1ebf g\u1ed7", "S\u1eaft \u0111\u1ebf nh\u1ef1a", "S\u1eaft m\u1ecfng", "MB5", "G\u1ed7"];

// â”€â”€â”€ Business Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getLoaiBanhConfig(loai_csr: string, selected_banh?: number) {
  if (["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"].includes(loai_csr)) {
    const b = selected_banh || 35;
    return b === 20
      ? { loai_banh: 20, max_per_kien: 60, lo_tron: 240 }
      : { loai_banh: 35, max_per_kien: 36, lo_tron: 144 };
  }
  if (["CSRL", "CSR3L", "SVRL", "SVR3L"].includes(loai_csr)) {
    const b = selected_banh || 33.33;
    return { loai_banh: b, max_per_kien: 36, lo_tron: 144 };
  }
  return { loai_banh: 35, max_per_kien: 36, lo_tron: 144 };
}

function getLoaiBanhOptions(loai_csr: string): number[] {
  if (["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"].includes(loai_csr))
    return [35, 20];
  if (["CSRL", "CSR3L", "SVRL", "SVR3L"].includes(loai_csr)) return [35, 33.33];
  return [35];
}

function getLoaiCSRByDayChuyen(dc: string, prefix: "CSR" | "SVR"): string[] {
  if (dc === "M\u1ee7 n\u01b0\u1edbc")
    return [
      `${prefix}L`,
      `${prefix}3L`,
      `${prefix}CV50`,
      `${prefix}CV60`,
      "Ngo\u1ea1i l\u1ec7",
    ];
  return [`${prefix}10`, `${prefix}20`, "Ngo\u1ea1i l\u1ec7"];
}

function getBocsForLoaiCSR(dc: string, loai_csr: string): string[] {
  const base = [`B\u1ecdc tr\u01a1n 0,04`, `B\u1ecdc nh\u00e3n 0,04 VRG ${loai_csr}`];
  if (dc === "M\u1ee7 n\u01b0\u1edbc")
    return [...base, `B\u1ecdc tr\u01a1n 0,13`, `B\u1ecdc nh\u00e3n 0,13 VRG ${loai_csr}`];
  return base;
}

function autoTrangThai(
  tong_banh: number,
  lo_tron: number,
  current: string,
): string {
  if (current === "Xu\u1ea5t h\u00e0ng") return "Xu\u1ea5t h\u00e0ng";
  if (tong_banh >= lo_tron) return "Ho\u00e0n th\u00e0nh";
  return "D\u1edf dang";
}

function getLotCompletionDate(
  trang_thai: string,
  currentNgaySX: string,
  previousNgayHT?: string | null,
): string | null {
  if (trang_thai === "Ho\u00e0n th\u00e0nh" || trang_thai === "Xu\u1ea5t h\u00e0ng") {
    return currentNgaySX || previousNgayHT || null;
  }
  return null;
}

function calcDraftTotals(
  draft: LotDraft,
  loai_banh: number,
  lo_tron: number,
): LotDraft {
  const tb =
    (draft.kien_a || 0) +
    (draft.kien_b || 0) +
    (draft.kien_c || 0) +
    (draft.kien_d || 0);
  return {
    ...draft,
    tong_banh: tb,
    tong_kg: Math.round(tb * loai_banh * 100) / 100,
    trang_thai: autoTrangThai(tb, lo_tron, draft.trang_thai),
  };
}

function buildMaLo(num: number, suffix: string, year: string): string {
  return suffix === "" ? `${num}/${year}` : `${num}${suffix}/${year}`;
}

function yearFromDate(dateStr: string): string {
  return dateStr
    ? dateStr.slice(2, 4)
    : new Date().getFullYear().toString().slice(-2);
}

function normalizeLotYear(year: string, fallback?: string): string {
  const sanitized = year.replace(/\D/g, "").slice(-2);
  if (sanitized.length === 2) return sanitized;
  return fallback ? normalizeLotYear(fallback) : yearFromDate(todayStr());
}

function fmtKg(kg: number): string {
  return Math.round(kg).toLocaleString("vi-VN") + " kg";
}

const CA_ORDER_MAP: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };

function isSameLotSeries(
  lot: Pick<Lot, "loai_csr" | "loai_banh" | "year">,
  series: LotSeries,
) {
  return (
    lot.loai_csr === series.loai_csr &&
    Number(lot.loai_banh) === Number(series.loai_banh) &&
    lot.year === series.year
  );
}

function getJumpedLotNums(
  existingNums: number[],
  plannedNums: number[],
): number[] {
  const anchor = existingNums.length > 0 ? Math.max(...existingNums) : 0;
  const futureNums = Array.from(
    new Set(plannedNums.filter((num) => num > anchor)),
  ).sort((a, b) => a - b);
  const missing: number[] = [];
  let cursor = anchor;

  futureNums.forEach((num) => {
    for (let next = cursor + 1; next < num; next++) missing.push(next);
    cursor = Math.max(cursor, num);
  });

  return missing;
}

function generateLotDrafts(
  fromNum: number,
  toNum: number,
  suffix: string,
  loai_csr: string,
  sessionBanh: number,
  existingLots: Lot[],
  yearStr: string,
  prevCaLastDraft?: LotDraft,
): LotDraft[] {
  if (fromNum > toNum || fromNum < 1) return [];
  const cfg = getLoaiBanhConfig(loai_csr, sessionBanh);
  const { max_per_kien, lo_tron, loai_banh } = cfg;
  const drafts: LotDraft[] = [];
  const series: LotSeries = { loai_csr, loai_banh, year: yearStr };

  for (let n = fromNum; n <= toNum; n++) {
    const dbLot = existingLots.find(
      (l) => l.num === n && isSameLotSeries(l, series),
    );
    const role: LotDraft["role"] =
      fromNum === toNum
        ? "single"
        : n === fromNum
          ? "dau"
          : n === toNum
            ? "cuoi"
            : "giua";

    const isCompleted =
      dbLot && ["Ho\u00e0n th\u00e0nh", "Xu\u1ea5t h\u00e0ng"].includes(dbLot.trang_thai);
    if (isCompleted) {
      drafts.push({
        num: n,
        role,
        kien_a: dbLot.kien_a,
        kien_b: dbLot.kien_b,
        kien_c: dbLot.kien_c,
        kien_d: dbLot.kien_d,
        prev_a: 0,
        prev_b: 0,
        prev_c: 0,
        prev_d: 0,
        locked_a: true,
        locked_b: true,
        locked_c: true,
        locked_d: true,
        is_continuation: false,
        is_already_completed: true,
        existing_id: dbLot.id,
        tong_banh: dbLot.tong_banh,
        tong_kg: dbLot.tong_kg,
        trang_thai: dbLot.trang_thai,
      });
      continue;
    }

    const fromPrevDraft =
      n === fromNum && prevCaLastDraft?.trang_thai === "D\u1edf dang"
        ? prevCaLastDraft
        : undefined;
    const fromDB =
      n === fromNum && dbLot?.trang_thai === "D\u1edf dang" && !fromPrevDraft
        ? dbLot
        : undefined;
    const contSource = fromPrevDraft || fromDB;
    const is_continuation = !!contSource;

    if (role === "giua") {
      const tb = max_per_kien * 4;
      drafts.push({
        num: n,
        role: "giua",
        kien_a: max_per_kien,
        kien_b: max_per_kien,
        kien_c: max_per_kien,
        kien_d: max_per_kien,
        prev_a: 0,
        prev_b: 0,
        prev_c: 0,
        prev_d: 0,
        locked_a: true,
        locked_b: true,
        locked_c: true,
        locked_d: true,
        is_continuation: false,
        tong_banh: tb,
        tong_kg: Math.round(tb * loai_banh * 100) / 100,
        trang_thai: "Ho\u00e0n th\u00e0nh",
      });
      continue;
    }

    if (is_continuation && contSource) {
      const pA =
        "kien_a" in contSource
          ? contSource.kien_a
          : (contSource as LotDraft).kien_a;
      const pB =
        "kien_b" in contSource
          ? contSource.kien_b
          : (contSource as LotDraft).kien_b;
      const pC =
        "kien_c" in contSource
          ? contSource.kien_c
          : (contSource as LotDraft).kien_c;
      const pD =
        "kien_d" in contSource
          ? contSource.kien_d
          : (contSource as LotDraft).kien_d;
      const lA = pA >= max_per_kien;
      const lB = pB >= max_per_kien;
      const lC = pC >= max_per_kien;
      const lD = pD >= max_per_kien;
      const initA = lA ? pA : max_per_kien;
      const initB = lB ? pB : max_per_kien;
      const initC = lC ? pC : max_per_kien;
      const initD = lD ? pD : max_per_kien;
      const tb = initA + initB + initC + initD;
      drafts.push({
        num: n,
        role,
        kien_a: initA,
        kien_b: initB,
        kien_c: initC,
        kien_d: initD,
        prev_a: pA,
        prev_b: pB,
        prev_c: pC,
        prev_d: pD,
        locked_a: lA,
        locked_b: lB,
        locked_c: lC,
        locked_d: lD,
        is_continuation: true,
        existing_id:
          (fromDB as Lot | undefined)?.id ??
          (fromPrevDraft as LotDraft | undefined)?.existing_id,
        tong_banh: tb,
        tong_kg: Math.round(tb * loai_banh * 100) / 100,
        trang_thai: autoTrangThai(tb, lo_tron, "D\u1edf dang"),
      });
    } else {
      const tb = max_per_kien * 4;
      drafts.push({
        num: n,
        role,
        kien_a: max_per_kien,
        kien_b: max_per_kien,
        kien_c: max_per_kien,
        kien_d: max_per_kien,
        prev_a: 0,
        prev_b: 0,
        prev_c: 0,
        prev_d: 0,
        locked_a: false,
        locked_b: false,
        locked_c: false,
        locked_d: false,
        is_continuation: false,
        tong_banh: tb,
        tong_kg: Math.round(tb * loai_banh * 100) / 100,
        trang_thai: "Ho\u00e0n th\u00e0nh",
      });
    }
  }
  return drafts;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultSession(prefix: "CSR" | "SVR" = "CSR"): SessionHeader {
  const defaultCsr = `${prefix}10`;
  return {
    year: normalizeLotYear(yearFromDate(todayStr())),
    ngay_sx: todayStr(),
    day_chuyen: "M\u1ee7 t\u1ea1p",
    so_ca: 2,
    ngan_id: "",
    suffix: "cs",
    loai_csr: defaultCsr,
    loai_banh: 35,
    boc: `B\u1ecdc nh\u00e3n 0,04 VRG ${defaultCsr}`,
    tham: "C\u0169",
    chi_thi: "1",
    pallet: ["S\u1eaft \u0111\u1ebf g\u1ed7"],
    image_url_1: "",
    image_url_2: "",
  };
}

function defaultCaSection(ca: "A" | "B" | "C", fromNum = 1): CaSection {
  return { ca, from_num: fromNum, to_num: fromNum, lots: [] };
}

function emptyEditForm(): EditForm {
  return {
    ma_lo: "",
    num: 0,
    suffix: "cs",
    year: normalizeLotYear(yearFromDate(todayStr())),
    ngay_sx: todayStr(),
    ca: "A",
    ngan_id: "",
    day_chuyen: "M\u1ee7 t\u1ea1p",
    loai_csr: "CSR10",
    loai_banh: 35,
    boc: "B\u1ecdc nh\u00e3n 0,04 VRG CSR10",
    tham: "C\u0169",
    pallet: ["S\u1eaft \u0111\u1ebf g\u1ed7"],
    chi_thi: "1",
    kien_a: 36,
    kien_b: 36,
    kien_c: 36,
    kien_d: 36,
    tong_banh: 144,
    tong_kg: 5040,
    trang_thai: "Ho\u00e0n th\u00e0nh",
    ghi_chu: "",
  };
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ProductPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [ngans, setNgans] = useState<Ngan[]>([]);
  const [, setLoading] = useState(true);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [factory, setFactory] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [suffixList, setSuffixList] = useState<SuffixItem[]>([]);

  // Factory prefix: CSR cho NMPHK, SVR cho NMCP
  const factoryPrefix = useMemo<"CSR" | "SVR">(() => {
    if (!factory) return "CSR";
    return factory.name?.toLowerCase().includes("cuaparis") ? "SVR" : "CSR";
  }, [factory]);

  // List filters
  const [search, setSearch] = useState("");
  const [filterLoai, setFilterLoai] = useState("");
  const [filterTT, setFilterTT] = useState("");
  const [filterCa, setFilterCa] = useState("");
  const [filterDC, setFilterDC] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  const [view, setView] = useState<"list" | "create">("list");

  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [lotsBlockedByKn, setLotsBlockedByKn] = useState<string[]>([]);
  const [preCheckLoading, setPreCheckLoading] = useState(false);
  const [editDateModal, setEditDateModal] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<string | null>(null);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(
    new Set(),
  );
  const [maxNumFromDB, setMaxNumFromDB] = useState(0);

  const [session, setSession] = useState<SessionHeader>(defaultSession());
  const [caSections, setCaSections] = useState<CaSection[]>([
    defaultCaSection("A"),
  ]);

  // â”€â”€ Load data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadData = useCallback(async (fid: string) => {
    setLoading(true);
    try {
      const q = supabase
        .from("lots")
        .select(
          "*, ngans(ten_ngan, ma_ngan, loai_nl), lot_transactions(id, lot_id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, created_at)",
        )
        .eq("factory_id", fid)
        .order("ngay_sx", { ascending: false })
        .order("created_at", { ascending: false });

      const [{ data: lotsData }, { data: ngansData }] = await Promise.all([
        q,
        supabase
          .from("ngans")
          .select(
            "id,ten_ngan,ma_ngan,tong_kho,trang_thai,ngay_bd,loai_nl,chung_nhan,ngay_kt",
          )
          .eq("factory_id", fid),
      ]);
      const normalizedLots = (lotsData || []).map((lot) => ({
        ...lot,
        trang_thai: normalizeLotStatus(lot.trang_thai),
        lot_transactions: [...(lot.lot_transactions || [])].sort((a, b) => {
          const dateDiff =
            new Date(a.ngay_nhap).getTime() - new Date(b.ngay_nhap).getTime();
          if (dateDiff !== 0) return dateDiff;
          return (
            new Date(a.created_at || 0).getTime() -
            new Date(b.created_at || 0).getTime()
          );
        }),
      }));
      setLots(dedupeLotsByMaLo(normalizedLots));
      setNgans(ngansData || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId();
      if (!fid) {
        setLoading(false);
        return;
      }
      setFactoryId(fid);
      loadData(fid);

      supabase
        .from("factories")
        .select("id,name")
        .eq("id", fid)
        .single()
        .then(({ data }) => {
          if (data) setFactory(data);
        });

      supabase
        .from("suffixes")
        .select("code,name,nguon,chung_nhan")
        .eq("factory_id", fid)
        .order("code")
        .then(({ data }) => {
          if (data) setSuffixList(data);
        });

      supabase
        .from("lots")
        .update({ day_chuyen: "Má»§ táº¡p" })
        .eq("factory_id", fid)
        .or("day_chuyen.is.null,day_chuyen.eq.")
        .then(() => {});
    };
    void bootstrap();
  }, [loadData]);

  // â”€â”€ Computed BĂ³c tĂ¡ch sáº£n lÆ°á»£ng (Contributions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const contributions = useMemo(() => {
    const arr: LotContribution[] = [];
    lots.forEach((lot) => {
      const transactions = lot.lot_transactions || [];
      if (transactions.length > 0) {
        transactions.forEach((tx, index) => {
          arr.push({
            ...lot,
            uid: tx.id,
            transaction_id: tx.id,
            ngay_sx: tx.ngay_nhap || lot.ngay_sx,
            ca: tx.ca,
            ngan_id: tx.ngan_id || lot.ngan_id,
            tong_banh_cua_ca: tx.so_banh,
            tong_kg_cua_ca: tx.so_kg,
            trang_thai:
              index === transactions.length - 1 ? lot.trang_thai : "D\u1edf dang",
            kien_a: tx.kien_a,
            kien_b: tx.kien_b,
            kien_c: tx.kien_c,
            kien_d: tx.kien_d,
            tong_banh: tx.so_banh,
            disp_a: tx.kien_a,
            disp_b: tx.kien_b,
            disp_c: tx.kien_c,
            disp_d: tx.kien_d,
          });
        });
      } else {
        arr.push({
          ...lot,
          uid: lot.id,
          tong_banh_cua_ca: lot.tong_banh,
          tong_kg_cua_ca: lot.tong_kg,
          disp_a: lot.kien_a,
          disp_b: lot.kien_b,
          disp_c: lot.kien_c,
          disp_d: lot.kien_d,
        });
      }
    });
    return arr;
  }, [lots]);
  const filteredContribs = useMemo(() => {
    return contributions.filter((c) => {
      if (
        search &&
        !c.ma_lo.toLowerCase().includes(search.toLowerCase()) &&
        !(c.ngans?.ten_ngan || "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (filterCa && c.ca !== filterCa) return false;
      if (filterDC && c.day_chuyen !== filterDC) return false;
      if (filterLoai && c.loai_csr !== filterLoai) return false;
      if (filterTT && c.trang_thai !== filterTT) return false;
      if (filterFrom && c.ngay_sx < filterFrom) return false;
      if (filterTo && c.ngay_sx > filterTo) return false;
      return true;
    });
  }, [
    contributions,
    search,
    filterCa,
    filterDC,
    filterLoai,
    filterTT,
    filterFrom,
    filterTo,
  ]);

  const groupedByDateAndCa = useMemo(() => {
    const groups: Record<string, Record<string, LotContribution[]>> = {};
    filteredContribs.forEach((c) => {
      const date = c.ngay_sx || "ChÆ°a cĂ³ ngĂ y";
      if (!groups[date]) groups[date] = {};
      if (!groups[date][c.ca]) groups[date][c.ca] = [];
      groups[date][c.ca].push(c);
    });
    return groups;
  }, [filteredContribs]);

  const stats = {
    total: lots.length,
    hoanThanh: lots.filter(
      (l) => l.trang_thai === "HoĂ n thĂ nh" || l.trang_thai === "Xuáº¥t hĂ ng",
    ).length,
    dorDang: lots.filter((l) => l.trang_thai === "Dá»Ÿ dang").length,
    tongBanh: filteredContribs.reduce(
      (s, c) => s + (c.tong_banh_cua_ca || 0),
      0,
    ),
    tongKg: filteredContribs.reduce((s, c) => s + (c.tong_kg_cua_ca || 0), 0),
  };

  // â”€â”€ Create view computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const nganKgMap = useMemo(() => {
    const map: Record<string, number> = {};
    contributions.forEach((c) => {
      if (c.ngan_id) {
        map[c.ngan_id] = (map[c.ngan_id] || 0) + (c.tong_kg_cua_ca || 0);
      }
    });
    return map;
  }, [contributions]);

  const eligibleNgans = useMemo(() => {
    const now = new Date();
    const validLoaiNl =
      session.day_chuyen === "Má»§ táº¡p"
        ? [
            "Má»§ chĂ©n",
            "Má»§ Ä‘Ă´ng chĂ©n",
            "Má»§ Ä‘Ă´ng khá»‘i",
            "Má»§ dĂ¢y",
            "Má»§ dÆ¡",
            "Má»§ táº¡p",
          ]
        : ["Má»§ nÆ°á»›c"];

    return ngans
      .filter((n) => {
        if (!validLoaiNl.includes(n.loai_nl)) return false;
        if (["ÄĂ³ng", "ÄĂ£ sáº£n xuáº¥t"].includes(n.trang_thai)) return false;
        if (!n.ngay_bd) return false;
        const days = Math.floor(
          (now.getTime() - new Date(n.ngay_bd).getTime()) / 86400000,
        );
        return days >= 21;
      })
      .sort((a, b) => {
        const da = Math.floor(
          (now.getTime() - new Date(a.ngay_bd).getTime()) / 86400000,
        );
        const db = Math.floor(
          (now.getTime() - new Date(b.ngay_bd).getTime()) / 86400000,
        );
        return da - db;
      });
  }, [ngans, session.day_chuyen]);

  const selectedNgan = ngans.find((n) => n.id === session.ngan_id);
  const allDorDangLots = lots.filter(
    (l) =>
      l.trang_thai === "Dá»Ÿ dang" &&
      l.tong_banh > 0 &&
      (!filterDC || l.day_chuyen === filterDC),
  );
  const dorDangLots = allDorDangLots.filter((l) => l.ngan_id === session.ngan_id);

  const kgDaCoTrongNgan = nganKgMap[session.ngan_id] || 0;

  const kgLanNay = useMemo(() => {
    let total = 0;
    caSections.forEach((cs) => {
      cs.lots.forEach((lot) => {
        if (lot.is_already_completed) return;
        if (lot.is_continuation) {
          const added =
            Math.max(0, lot.kien_a - lot.prev_a) +
            Math.max(0, lot.kien_b - lot.prev_b) +
            Math.max(0, lot.kien_c - lot.prev_c) +
            Math.max(0, lot.kien_d - lot.prev_d);
          total += added * session.loai_banh;
        } else {
          total += lot.tong_kg;
        }
      });
    });
    return Math.round(total * 100) / 100;
  }, [caSections, session.loai_banh]);

  const kgTotal = kgDaCoTrongNgan + kgLanNay;
  const nganPct =
    selectedNgan && selectedNgan.tong_kho > 0
      ? (kgTotal / selectedNgan.tong_kho) * 100
      : 0;
  const nganBlocked = nganPct > 110;

  const sessionTotals = useMemo(() => {
    let lots_count = 0,
      banh = 0;
    caSections.forEach((cs) => {
      cs.lots.forEach((lot) => {
        if (lot.is_already_completed) return;
        if (!lot.is_continuation) lots_count++;
        if (lot.is_continuation) {
          banh +=
            Math.max(0, lot.kien_a - lot.prev_a) +
            Math.max(0, lot.kien_b - lot.prev_b) +
            Math.max(0, lot.kien_c - lot.prev_c) +
            Math.max(0, lot.kien_d - lot.prev_d);
        } else {
          banh += lot.tong_banh;
        }
      });
    });
    return { lots_count, banh };
  }, [caSections]);

  const sessionYear = session.year;
  const currentSeries = useMemo<LotSeries>(
    () => ({
      loai_csr: session.loai_csr,
      loai_banh: session.loai_banh,
      year: sessionYear,
    }),
    [session.loai_csr, session.loai_banh, sessionYear],
  );
  const jumpLotNums = useMemo(() => {
    const existingNums = lots
      .filter((l) => isSameLotSeries(l, currentSeries))
      .map((l) => l.num)
      .filter((num) => num > 0);
    const plannedNums = caSections
      .flatMap((cs) => cs.lots.map((lot) => lot.num))
      .filter((num) => num > 0);
    return getJumpedLotNums(existingNums, plannedNums);
  }, [caSections, currentSeries, lots]);

  const getMaxLotNum = (
    loai_csr: string,
    loai_banh: number,
    year: string,
  ) =>
    lots
      .filter((l) => isSameLotSeries(l, { loai_csr, loai_banh, year }))
      .reduce((m, l) => Math.max(m, l.num || 0), 0);

  const getSuggestedStartNum = (
    loai_csr: string,
    loai_banh: number,
    year: string,
  ) => {
    const latestDang = lots
      .filter(
        (l) =>
          isSameLotSeries(l, { loai_csr, loai_banh, year }) &&
          l.trang_thai === "Dá»Ÿ dang",
      )
      .sort((a, b) => {
        if (b.ngay_sx !== a.ngay_sx) return b.ngay_sx.localeCompare(a.ngay_sx);
        return (CA_ORDER_MAP[b.ca] || 0) - (CA_ORDER_MAP[a.ca] || 0);
      })[0];

    return latestDang?.num ?? getMaxLotNum(loai_csr, loai_banh, year) + 1;
  };

  useEffect(() => {
    if (!factoryId) return;
    setMaxNumFromDB(
      getMaxLotNum(
        session.loai_csr,
        session.loai_banh,
        sessionYear,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, session.loai_csr, session.loai_banh, sessionYear, lots]);

  // â”€â”€ Session handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const autoSelectNganId = (dayChuyenVal: string): string => {
    const validNl =
      dayChuyenVal === "Má»§ táº¡p"
        ? [
            "Má»§ chĂ©n",
            "Má»§ Ä‘Ă´ng chĂ©n",
            "Má»§ Ä‘Ă´ng khá»‘i",
            "Má»§ dĂ¢y",
            "Má»§ dÆ¡",
            "Má»§ táº¡p",
          ]
        : ["Má»§ nÆ°á»›c"];
    const now = new Date();
    const eligible = ngans.filter((n) => {
      if (!validNl.includes(n.loai_nl)) return false;
      if (["ÄĂ³ng", "ÄĂ£ sáº£n xuáº¥t"].includes(n.trang_thai)) return false;
      if (!n.ngay_bd) return false;
      return (
        Math.floor(
          (now.getTime() - new Date(n.ngay_bd).getTime()) / 86400000,
        ) >= 21
      );
    });
    const dangSX = eligible
      .filter((n) => n.trang_thai === "Äang sáº£n xuáº¥t")
      .sort(
        (a, b) => new Date(b.ngay_bd).getTime() - new Date(a.ngay_bd).getTime(),
      )[0];
    const recentFromSameDayChuyen = contributions
      .filter(
        (c) =>
          c.day_chuyen === dayChuyenVal &&
          c.ngan_id &&
          c.tong_kg_cua_ca > 0 &&
          eligible.some((n) => n.id === c.ngan_id),
      )
      .sort((a, b) => {
        if (b.ngay_sx !== a.ngay_sx) return b.ngay_sx.localeCompare(a.ngay_sx);
        return (CA_ORDER_MAP[b.ca] || 0) - (CA_ORDER_MAP[a.ca] || 0);
      })[0];
    if (recentFromSameDayChuyen?.ngan_id) return recentFromSameDayChuyen.ngan_id;
    if (dangSX) return dangSX.id;
    // Fallback: ngÄƒn Chá» sáº£n xuáº¥t Má»I NHáº¤T (ngay_bd lá»›n nháº¥t)
    const newest = eligible
      .filter((n) => n.trang_thai === "Chá» sáº£n xuáº¥t")
      .sort(
        (a, b) => new Date(b.ngay_bd).getTime() - new Date(a.ngay_bd).getTime(),
      )[0];
    return newest?.id || "";
  };

  const updateSession = (patch: Partial<SessionHeader>) => {
    setSession((prev) => {
      const next = { ...prev, ...patch };
      if (patch.day_chuyen !== undefined) {
        const csrOpts = getLoaiCSRByDayChuyen(patch.day_chuyen, factoryPrefix);
        next.loai_csr = csrOpts[0] || "";
        const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
        next.boc = getBocsForLoaiCSR(patch.day_chuyen, next.loai_csr)[1] || "";
        next.ngan_id = autoSelectNganId(patch.day_chuyen);
        next.so_ca = 2;
      }
      if (patch.loai_csr !== undefined || patch.loai_banh !== undefined) {
        const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
        next.boc = getBocsForLoaiCSR(next.day_chuyen, next.loai_csr)[1] || "";
      }
      return next;
    });
    if (
      patch.loai_csr !== undefined ||
      patch.suffix !== undefined ||
      patch.loai_banh !== undefined ||
      patch.year !== undefined
    ) {
      const newCsr = patch.loai_csr ?? session.loai_csr;
      const newSuffix =
        patch.suffix !== undefined ? patch.suffix : session.suffix;
      const newBanh = patch.loai_banh ?? session.loai_banh;
      const newYear = normalizeLotYear(
        patch.year ?? session.year,
        session.year,
      );
      setCaSections((prev) => {
        return prev.map((cs, ci) => {
          let fromNum = cs.from_num;
          let toNum = cs.to_num;
          if (
            ci === 0 &&
            (patch.suffix !== undefined ||
              patch.loai_csr !== undefined ||
              patch.loai_banh !== undefined ||
              patch.year !== undefined)
          ) {
            fromNum = getSuggestedStartNum(newCsr, newBanh, newYear);
            toNum = Math.max(fromNum, cs.to_num);
          }
          const prevLast = ci > 0 ? prev[ci - 1].lots.at(-1) : undefined;
          return {
            ...cs,
            from_num: fromNum,
            to_num: toNum,
            lots: generateLotDrafts(
              fromNum,
              toNum,
              newSuffix,
              newCsr,
              newBanh,
              lots,
              newYear,
              prevLast?.trang_thai === "Dá»Ÿ dang" ? prevLast : undefined,
            ),
          };
        });
      });
    }
  };

  const updateSoCa = (so_ca: 1 | 2 | 3) => {
    setSession((prev) => ({ ...prev, so_ca }));
    const caLabels: ("A" | "B" | "C")[] = ["A", "B", "C"];
    const curSuffix = session.suffix;
    const curLoaiCsr = session.loai_csr;
    const curBanh = session.loai_banh;
    setCaSections((prev) => {
      const next: CaSection[] = [];
      for (let i = 0; i < so_ca; i++) {
        if (prev[i]) {
          next.push(prev[i]);
          continue;
        }
        const prevSection = prev[i - 1];
        const prevLastDraft = prevSection?.lots.at(-1);
        const fromNum =
          prevLastDraft?.trang_thai === "Dá»Ÿ dang"
            ? prevSection.to_num
            : (prevSection?.to_num || 0) + 1;
        const prevLast =
          prevLastDraft?.trang_thai === "Dá»Ÿ dang" ? prevLastDraft : undefined;
        const newSection: CaSection = {
          ca: caLabels[i],
          from_num: fromNum,
          to_num: fromNum,
          lots: generateLotDrafts(
            fromNum,
            fromNum,
            curSuffix,
            curLoaiCsr,
            curBanh,
            lots,
            sessionYear,
            prevLast,
          ),
        };
        next.push(newSection);
      }
      return next;
    });
  };

  // â”€â”€ Ca section handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const updateCaSection = (idx: number, patch: Partial<CaSection>) => {
    // Náº¿u chá»‰ Ä‘á»•i ca letter (khĂ´ng Ä‘á»•i from_num/to_num), giá»¯ nguyĂªn kien values
    if ("ca" in patch && !("from_num" in patch) && !("to_num" in patch)) {
      setCaSections((prev) =>
        prev.map((cs, i) =>
          i === idx
            ? {
                ...cs,
                ca: patch.ca as "A" | "B" | "C",
                lots: cs.lots.map((d) => ({ ...d, ca: patch.ca as string })),
              }
            : cs,
        ),
      );
      return;
    }
    setCaSections((prev) => {
      const updated = prev.map((cs, i) =>
        i === idx ? { ...cs, ...patch } : cs,
      );
      const cs = updated[idx];
      const prevLast = idx > 0 ? updated[idx - 1].lots.at(-1) : undefined;
      updated[idx] = {
        ...cs,
        lots: generateLotDrafts(
          cs.from_num,
          cs.to_num,
          session.suffix,
          session.loai_csr,
          session.loai_banh,
          lots,
          sessionYear,
          prevLast?.trang_thai === "Dá»Ÿ dang" ? prevLast : undefined,
        ),
      };
      if (idx + 1 < updated.length) {
        const nextSec = updated[idx + 1];
        const prevToNum = prev[idx].to_num;
        if (nextSec.from_num === prevToNum || nextSec.from_num === 0) {
          const lastDraft = updated[idx].lots.at(-1);
          const suggestFrom =
            lastDraft?.trang_thai === "Dá»Ÿ dang" ? cs.to_num : cs.to_num + 1;
          const nextLast = updated[idx].lots.at(-1);
          updated[idx + 1] = {
            ...nextSec,
            from_num: suggestFrom,
            lots: generateLotDrafts(
              suggestFrom,
              Math.max(suggestFrom, nextSec.to_num),
              session.suffix,
              session.loai_csr,
              session.loai_banh,
              lots,
              sessionYear,
              lastDraft?.trang_thai === "Dá»Ÿ dang" ? nextLast : undefined,
            ),
          };
        }
      }
      return updated;
    });
  };

  // â”€â”€ Lot draft handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const updateLotDraft = (
    caIdx: number,
    lotIdx: number,
    patch: Partial<LotDraft>,
  ) => {
    if (nganBlocked) return;
    setCaSections((prev) =>
      prev.map((cs, ci) => {
        if (ci !== caIdx) return cs;
        const newLots = cs.lots.map((lot, li) => {
          if (li !== lotIdx) return lot;
          const cfg = getLoaiBanhConfig(session.loai_csr, session.loai_banh);
          const next = { ...lot, ...patch };
          if (next.is_continuation) {
            next.kien_a = next.locked_a
              ? next.prev_a
              : Math.min(Math.max(next.kien_a, next.prev_a), cfg.max_per_kien);
            next.kien_b = next.locked_b
              ? next.prev_b
              : Math.min(Math.max(next.kien_b, next.prev_b), cfg.max_per_kien);
            next.kien_c = next.locked_c
              ? next.prev_c
              : Math.min(Math.max(next.kien_c, next.prev_c), cfg.max_per_kien);
            next.kien_d = next.locked_d
              ? next.prev_d
              : Math.min(Math.max(next.kien_d, next.prev_d), cfg.max_per_kien);
          } else {
            next.kien_a = Math.min(Math.max(0, next.kien_a), cfg.max_per_kien);
            next.kien_b = Math.min(Math.max(0, next.kien_b), cfg.max_per_kien);
            next.kien_c = Math.min(Math.max(0, next.kien_c), cfg.max_per_kien);
            next.kien_d = Math.min(Math.max(0, next.kien_d), cfg.max_per_kien);
          }
          return calcDraftTotals(next, session.loai_banh, cfg.lo_tron);
        });
        return { ...cs, lots: newLots };
      }),
    );
  };

  // Reset má»™t kiá»‡n vá» 0 (hoáº·c vá» prev náº¿u lĂ  lĂ´ káº¿ thá»«a)
  const resetKien = (
    caIdx: number,
    lotIdx: number,
    kien: "kien_a" | "kien_b" | "kien_c" | "kien_d",
  ) => {
    setCaSections((prev) =>
      prev.map((cs, ci) => {
        if (ci !== caIdx) return cs;
        const newLots = cs.lots.map((lot, li) => {
          if (li !== lotIdx) return lot;
          const prevMap = {
            kien_a: lot.prev_a,
            kien_b: lot.prev_b,
            kien_c: lot.prev_c,
            kien_d: lot.prev_d,
          };
          const resetVal = lot.is_continuation ? prevMap[kien] : 0;
          const next = { ...lot, [kien]: resetVal };
          const cfg = getLoaiBanhConfig(session.loai_csr, session.loai_banh);
          return calcDraftTotals(next, session.loai_banh, cfg.lo_tron);
        });
        return { ...cs, lots: newLots };
      }),
    );
  };

  // â”€â”€ Open create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openCreate = async (presetDate?: string) => {
    if (!factoryId) return;
    const maxDate =
      lots.length > 0
        ? lots.reduce(
            (max, l) => (l.ngay_sx > max ? l.ngay_sx : max),
            "2000-01-01",
          )
        : todayStr();
    const nextDay = new Date(maxDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const ngaySX = presetDate || nextDay.toISOString().slice(0, 10);
    const yrStr = normalizeLotYear(yearFromDate(ngaySX));

    const lastChiThi = lots.length > 0 ? lots[0]?.chi_thi || "1" : "1";
    const defaultSuffix =
      suffixList.find((s) => s.code !== "")?.code ||
      suffixList[0]?.code ||
      "cs";

    const defaultCsr =
      getLoaiCSRByDayChuyen("Má»§ táº¡p", factoryPrefix)[0] || `${factoryPrefix}10`;
    const cfg = getLoaiBanhConfig(defaultCsr);
    const latestDang = lots
      .filter(
        (l) =>
          l.loai_csr === defaultCsr &&
          Number(l.loai_banh) === Number(cfg.loai_banh) &&
          l.year === yrStr &&
          l.trang_thai === "Dá»Ÿ dang",
      )
      .sort((a, b) => {
        if (b.ngay_sx !== a.ngay_sx) return b.ngay_sx.localeCompare(a.ngay_sx);
        return (CA_ORDER_MAP[b.ca] || 0) - (CA_ORDER_MAP[a.ca] || 0);
      })[0];
    const fromNum = latestDang
      ? latestDang.num
      : getMaxLotNum(defaultCsr, cfg.loai_banh, yrStr) + 1;

    const s: SessionHeader = {
      year: yrStr,
      ngay_sx: ngaySX,
      day_chuyen: "Má»§ táº¡p",
      so_ca: 2,
      ngan_id: autoSelectNganId("Má»§ táº¡p"),
      suffix: defaultSuffix,
      loai_csr: defaultCsr,
      loai_banh: cfg.loai_banh,
      boc:
        getBocsForLoaiCSR("Má»§ táº¡p", defaultCsr)[1] ||
        getBocsForLoaiCSR("Má»§ táº¡p", defaultCsr)[0] ||
        "",
      tham: "cÅ©",
      chi_thi: lastChiThi,
      pallet: ["Sáº¯t Ä‘áº¿ gá»—"],
      image_url_1: "",
      image_url_2: "",
    };
    setSession(s);
    setCaSections([defaultCaSection("A", fromNum)]);
    setView("create");
  };

  // â”€â”€ Save create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCreateSave = async (markNganDone: boolean) => {
    if (!factoryId || !session.ngan_id) return;
    const lotYear = normalizeLotYear(session.year, session.ngay_sx);
    if (lotYear.length !== 2) {
      setSaveError("NÄƒm lĂ´ pháº£i cĂ³ Ä‘Ăºng 2 chá»¯ sá»‘.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    let hasError = false;
    try {
      const cfg = getLoaiBanhConfig(session.loai_csr, session.loai_banh);
      const year = lotYear;
      for (const cs of caSections) {
        for (const draft of cs.lots) {
          if (draft.is_already_completed) continue;

          const deltaA = draft.is_continuation
            ? Math.max(0, draft.kien_a - draft.prev_a)
            : draft.kien_a;
          const deltaB = draft.is_continuation
            ? Math.max(0, draft.kien_b - draft.prev_b)
            : draft.kien_b;
          const deltaC = draft.is_continuation
            ? Math.max(0, draft.kien_c - draft.prev_c)
            : draft.kien_c;
          const deltaD = draft.is_continuation
            ? Math.max(0, draft.kien_d - draft.prev_d)
            : draft.kien_d;
          const added_banh = deltaA + deltaB + deltaC + deltaD;

          if (added_banh <= 0) continue;

          const ma_lo = buildMaLo(draft.num, session.suffix, year);
          const duplicateLot = lots.find((lot) => lot.ma_lo === ma_lo);
          if (!draft.is_continuation && duplicateLot) {
            setSaveError(
              duplicateLot.trang_thai === "D\u1edf dang"
                ? `L\u00f4 ${ma_lo} \u0111ang t\u1ed3n t\u1ea1i \u1edf tr\u1ea1ng th\u00e1i D\u1edf dang. H\u00e3y ti\u1ebfp t\u1ee5c l\u00f4 hi\u1ec7n c\u00f3 thay v\u00ec t\u1ea1o m\u1edbi.`
                : `L\u00f4 ${ma_lo} \u0111\u00e3 t\u1ed3n t\u1ea1i trong th\u00e0nh ph\u1ea9m, kh\u00f4ng th\u1ec3 t\u1ea1o tr\u00f9ng.`,
            );
            hasError = true;
            break;
          }

          const tb = draft.kien_a + draft.kien_b + draft.kien_c + draft.kien_d;
          const trang_thai = autoTrangThai(tb, cfg.lo_tron, "D\u1edf dang");

          await saveLotTransaction({
            lot: {
              factory_id: factoryId,
              ma_lo,
              num: draft.num,
              suffix: session.suffix,
              year,
              ngay_sx: session.ngay_sx,
              ca: cs.ca,
              ngan_id: session.ngan_id,
              day_chuyen: session.day_chuyen,
              loai_csr: session.loai_csr,
              loai_banh: session.loai_banh,
              boc: session.boc,
              tham: session.tham,
              chi_thi: session.chi_thi,
              pallet: session.pallet,
              ghi_chu: "",
              image_url_1: session.image_url_1 || null,
              image_url_2: session.image_url_2 || null,
              trang_thai,
            },
            transaction: {
              ngan_id: session.ngan_id,
              ca: cs.ca,
              ngay_nhap: session.ngay_sx,
              kien_a: deltaA,
              kien_b: deltaB,
              kien_c: deltaC,
              kien_d: deltaD,
              so_banh: added_banh,
              so_kg: Math.round(added_banh * session.loai_banh * 100) / 100,
            },
          });
        }
        if (hasError) break;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      hasError = true;
    }
    if (!hasError) {
      const nganStatus = markNganDone ? "\u0110\u00e3 s\u1ea3n xu\u1ea5t" : "\u0110ang s\u1ea3n xu\u1ea5t";
      await supabase
        .from("ngans")
        .update({ trang_thai: nganStatus })
        .eq("id", session.ngan_id);
      setSaving(false);
      setView("list");
      loadData(factoryId);
    } else {
      setSaving(false);
    }
  };
  const openEdit = (lot: Lot) => {
    if (lot.trang_thai === "Xuáº¥t hĂ ng") {
      setSaveError("LĂ´ Ä‘Ă£ xuáº¥t hĂ ng, khĂ´ng thá»ƒ sá»­a.");
      return;
    }
    setEditForm({
      ma_lo: lot.ma_lo,
      num: lot.num,
      suffix: lot.suffix,
      year: lot.year,
      ngay_sx: lot.ngay_sx?.slice(0, 10) || "",
      ca: lot.ca,
      ngan_id: lot.ngan_id || "",
      day_chuyen: lot.day_chuyen || "Má»§ táº¡p",
      loai_csr: lot.loai_csr,
      loai_banh: lot.loai_banh || 35,
      boc: lot.boc,
      tham: lot.tham,
      pallet: lot.pallet || [],
      chi_thi: lot.chi_thi,
      kien_a: lot.kien_a,
      kien_b: lot.kien_b,
      kien_c: lot.kien_c,
      kien_d: lot.kien_d,
      tong_banh: lot.tong_banh,
      tong_kg: lot.tong_kg,
      trang_thai: lot.trang_thai,
      ghi_chu: lot.ghi_chu || "",
    });
    setEditId(lot.id);
    setEditModal(true);
  };

  const updateEditForm = (patch: Partial<EditForm>) => {
    setEditForm((prev) => {
      const next = { ...prev, ...patch };
      if (patch.loai_csr !== undefined) {
        const cfg = getLoaiBanhConfig(patch.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
      }
      const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
      if (patch.kien_a !== undefined)
        next.kien_a = Math.min(Math.max(0, next.kien_a), cfg.max_per_kien);
      if (patch.kien_b !== undefined)
        next.kien_b = Math.min(Math.max(0, next.kien_b), cfg.max_per_kien);
      if (patch.kien_c !== undefined)
        next.kien_c = Math.min(Math.max(0, next.kien_c), cfg.max_per_kien);
      if (patch.kien_d !== undefined)
        next.kien_d = Math.min(Math.max(0, next.kien_d), cfg.max_per_kien);
      const tb = next.kien_a + next.kien_b + next.kien_c + next.kien_d;
      next.tong_banh = tb;
      next.tong_kg = Math.round(tb * next.loai_banh * 100) / 100;
      next.trang_thai = autoTrangThai(tb, cfg.lo_tron, next.trang_thai);

      if (
        patch.num !== undefined ||
        patch.suffix !== undefined ||
        patch.year !== undefined
      ) {
        const yr = normalizeLotYear(patch.year ?? next.year, prev.year);
        next.year = yr;
        next.ma_lo = buildMaLo(next.num, next.suffix, yr);
      }
      return next;
    });
  };

  const getProjectedNganPct = (nganId: string, excludeLotId?: string) => {
    const ngan = ngans.find((item) => item.id === nganId);
    if (!ngan || !ngan.tong_kho) return 0;

    const totalKg = lots
      .filter((lot) => lot.ngan_id === nganId && lot.id !== excludeLotId)
      .reduce((sum, lot) => sum + (lot.tong_kg || 0), 0);

    return ((totalKg + (editForm.tong_kg || 0)) / ngan.tong_kho) * 100;
  };

  const syncNganStatusAfterLotEdit = async (nganId: string) => {
    const ngan = ngans.find((item) => item.id === nganId);
    if (!ngan) return;

    const { data: lotsWithTx, error: lotsError } = await supabase
      .from("lots")
      .select("lot_transactions(ngan_id,so_kg)")
      .eq("factory_id", factoryId!);
    if (lotsError) throw new Error(lotsError.message);

    const totalKg =
      lotsWithTx?.reduce((sum, lot) => {
        const txs = (lot.lot_transactions || []) as { ngan_id: string; so_kg: number }[];
        return (
          sum +
          txs
            .filter((tx) => tx.ngan_id === nganId)
            .reduce((inner, tx) => inner + Number(tx.so_kg || 0), 0)
        );
      }, 0) || 0;

    if (totalKg <= 0) {
      const { error: emptyStatusError } = await supabase
        .from("ngans")
        .update({ trang_thai: "Ch\u1edd s\u1ea3n xu\u1ea5t" })
        .eq("id", nganId);
      if (emptyStatusError) throw new Error(emptyStatusError.message);
      return;
    }

    const pct = ngan.tong_kho > 0 ? (totalKg / ngan.tong_kho) * 100 : 0;

    if (pct < 100) {
      const { error: underStatusError } = await supabase
        .from("ngans")
        .update({ trang_thai: "\u0110ang s\u1ea3n xu\u1ea5t" })
        .eq("id", nganId);
      if (underStatusError) throw new Error(underStatusError.message);
      return;
    }

    if (pct <= 110 && ngan.trang_thai === "ÄĂ£ sáº£n xuáº¥t") {
      return;
    }
  };

  const handleEditSave = async () => {
    if (!factoryId || !editId) return;
    const lotYear = normalizeLotYear(editForm.year, editForm.ngay_sx);
    if (lotYear.length !== 2) {
      setSaveError("N\u0103m l\u00f4 ph\u1ea3i c\u00f3 \u0111\u00fang 2 ch\u1eef s\u1ed1.");
      return;
    }
    setSaving(true);
    try {
      const dbLot = lots.find((l) => l.id === editId);
      if (!dbLot) {
        setSaveError("Kh\u00f4ng t\u00ecm th\u1ea5y l\u00f4 c\u1ea7n s\u1eeda.");
        return;
      }

      const targetNganId = editForm.ngan_id || "";
      if (targetNganId) {
        const projectedPct =
          targetNganId === dbLot.ngan_id
            ? getProjectedNganPct(targetNganId, editId)
            : getProjectedNganPct(targetNganId);
        if (projectedPct > 110) {
          setSaveError(
            `Kh\u00f4ng th\u1ec3 chuy\u1ec3n sang ng\u0103n n\u00e0y v\u00ec t\u1ef7 l\u1ec7 l\u1ea5p \u0111\u1ea7y s\u1ebd l\u00e0 ${projectedPct.toFixed(1)}%, v\u01b0\u1ee3t 110%.`,
          );
          return;
        }
      }

      const transactions = dbLot.lot_transactions || [];
      const latestTx = transactions[transactions.length - 1];
      if (!latestTx) {
        setSaveError("L\u00f4 n\u00e0y ch\u01b0a c\u00f3 giao d\u1ecbch \u0111\u1ec3 s\u1eeda.");
        return;
      }

      const previousTransactions = transactions.slice(0, -1);
      const prevA = previousTransactions.reduce((sum, tx) => sum + (tx.kien_a || 0), 0);
      const prevB = previousTransactions.reduce((sum, tx) => sum + (tx.kien_b || 0), 0);
      const prevC = previousTransactions.reduce((sum, tx) => sum + (tx.kien_c || 0), 0);
      const prevD = previousTransactions.reduce((sum, tx) => sum + (tx.kien_d || 0), 0);

      if (
        editForm.kien_a < prevA ||
        editForm.kien_b < prevB ||
        editForm.kien_c < prevC ||
        editForm.kien_d < prevD
      ) {
        setSaveError("Kh\u00f4ng th\u1ec3 gi\u1ea3m s\u1ed1 ki\u1ec7n nh\u1ecf h\u01a1n t\u1ed5ng c\u1ee7a c\u00e1c ca tr\u01b0\u1edbc.");
        return;
      }

      const deltaA = editForm.kien_a - prevA;
      const deltaB = editForm.kien_b - prevB;
      const deltaC = editForm.kien_c - prevC;
      const deltaD = editForm.kien_d - prevD;
      const deltaBanh = deltaA + deltaB + deltaC + deltaD;

      await saveLotTransaction({
        lot: {
          factory_id: factoryId,
          ma_lo: buildMaLo(editForm.num, editForm.suffix, lotYear),
          num: editForm.num,
          suffix: editForm.suffix,
          year: lotYear,
          ngay_sx: editForm.ngay_sx,
          ca: editForm.ca,
          ngan_id: editForm.ngan_id || null,
          day_chuyen: editForm.day_chuyen,
          loai_csr: editForm.loai_csr,
          loai_banh: editForm.loai_banh,
          boc: editForm.boc,
          tham: editForm.tham,
          chi_thi: editForm.chi_thi,
          pallet: editForm.pallet,
          ghi_chu: editForm.ghi_chu,
          trang_thai: editForm.trang_thai,
        },
        transaction: {
          id: latestTx.id,
          ngan_id: editForm.ngan_id || latestTx.ngan_id,
          ca: editForm.ca,
          ngay_nhap: editForm.ngay_sx,
          kien_a: deltaA,
          kien_b: deltaB,
          kien_c: deltaC,
          kien_d: deltaD,
          so_banh: deltaBanh,
          so_kg: Math.round(deltaBanh * editForm.loai_banh * 100) / 100,
        },
      });

      const { error: updateError } = await supabase
        .from("lots")
        .update({
          ...editForm,
          year: lotYear,
          ma_lo: buildMaLo(editForm.num, editForm.suffix, lotYear),
          factory_id: factoryId,
          ngan_id: editForm.ngan_id || null,
          ngay_ht: getLotCompletionDate(
            editForm.trang_thai,
            editForm.ngay_sx,
            dbLot.ngay_ht,
          ),
          is_manual_edit: true,
        })
        .eq("id", editId);
      if (updateError) {
        setSaveError(`L\u1ed7i c\u1eadp nh\u1eadt l\u00f4: ${updateError.message}`);
        return;
      }
      const affectedNganIds = Array.from(
        new Set([dbLot.ngan_id, editForm.ngan_id].filter(Boolean) as string[]),
      );
      for (const nganId of affectedNganIds) {
        await syncNganStatusAfterLotEdit(nganId);
      }
      setEditModal(false);
      loadData(factoryId);
      setSaveError(null);
    } catch (err) {
      setSaveError(
        `L\u1ed7i c\u1eadp nh\u1eadt ng\u0103n l\u01b0u: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async (uid: string) => {
    if (!factoryId) return;

    const contribution = contributions.find((item) => item.uid === uid);
    const lotId = contribution?.id || uid;
    const lot = lots.find((l) => l.id === lotId);
    if (!lot) return;

    const transactionId = contribution?.transaction_id;
    const transactionCount = lot.lot_transactions?.length || 0;
    const latestTransactionId =
      transactionCount > 0
        ? lot.lot_transactions?.[transactionCount - 1]?.id
        : null;

    if (transactionId && transactionCount > 1) {
      if (transactionId !== latestTransactionId) {
        setSaveError("Chá»‰ Ä‘Æ°á»£c xĂ³a contribution má»›i nháº¥t cá»§a lĂ´ dá»Ÿ.");
        setDelConfirm(null);
        return;
      }
      try {
        const result = await deleteLotTransaction({ transactionId });
        const affectedNganIds = Array.from(
          new Set([result?.affectedNganId, lot.ngan_id].filter(Boolean) as string[]),
        );
        for (const nganId of affectedNganIds) {
          await syncNganStatusAfterLotEdit(nganId);
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setDelConfirm(null);
        return;
      }
      setDelConfirm(null);
      loadData(factoryId);
      return;
    }

    if (transactionCount === 1 && lot.lot_transactions?.[0]?.id) {
      try {
        const result = await deleteLotTransaction({ transactionId: lot.lot_transactions[0].id });
        const affectedNganIds = Array.from(
          new Set([result?.affectedNganId, lot.ngan_id].filter(Boolean) as string[]),
        );
        for (const nganId of affectedNganIds) {
          await syncNganStatusAfterLotEdit(nganId);
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setDelConfirm(null);
        return;
      }
    }

    if (!transactionId && transactionCount === 0) {
      const { error: delError } = await supabase.from("lots").delete().eq("id", lotId);
      if (delError) {
        setSaveError(
          delError.code === "23503"
            ? "Không thể xóa lô này vì đã có phiếu kiểm nghiệm liên quan. Xóa phiếu KN trước."
            : delError.message,
        );
        setDelConfirm(null);
        return;
      }
      if (lot.ngan_id) {
        await syncNganStatusAfterLotEdit(lot.ngan_id);
      }
    }

    setDelConfirm(null);
    loadData(factoryId);
  };
  const handleBulkDelete = async () => {
    const deletable = Array.from(selectedDeleteIds).filter(
      (id) => !lotsBlockedByKn.includes(id),
    );
    for (const id of deletable) {
      await handleDelete(id);
    }
    setLotsBlockedByKn([]);
    setDeleteMode(null);
    setSelectedDeleteIds(new Set());
    setDelConfirm(null);
  };

  const handleDeletePreCheck = async () => {
    if (!factoryId || selectedDeleteIds.size === 0) return;
    setPreCheckLoading(true);
    const ids = Array.from(selectedDeleteIds);
    const { data } = await supabase
      .from("qc_results")
      .select("lot_id")
      .in("lot_id", ids)
      .eq("factory_id", factoryId);
    const blocked = [...new Set((data || []).map((r) => r.lot_id as string))];
    setLotsBlockedByKn(blocked);
    setPreCheckLoading(false);
    setDelConfirm("bulk");
  };

  const toggleDate = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // CREATE VIEW
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  if (view === "create") {
    const cfg = getLoaiBanhConfig(session.loai_csr, session.loai_banh);
    const csrOpts = getLoaiCSRByDayChuyen(session.day_chuyen, factoryPrefix);
    const bocOpts = getBocsForLoaiCSR(session.day_chuyen, session.loai_csr);
    const banhOpts = getLoaiBanhOptions(session.loai_csr);
    const hasNgan = !!session.ngan_id;

    const displaySuffixes: SuffixItem[] =
      suffixList.length > 0
        ? suffixList
        : [
            {
              code: "cs",
              name: "Ná»™i tuyá»ƒn PEFC",
              nguon: "NT",
              chung_nhan: "PEFC CS",
            },
            { code: "m", name: "Mua ngoĂ i", nguon: "M", chung_nhan: "" },
          ];

    return (
      <div className="pb-32">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setView("list")}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-all"
          >
            <ChevronLeft size={16} /> Quay láº¡i
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">
              Nháº­p thĂ nh pháº©m
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Táº¡o lĂ´ má»›i theo ca sáº£n xuáº¥t
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">
                DĂ¢y chuyá»n <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {["Má»§ táº¡p", "Má»§ nÆ°á»›c"].map((dc) => (
                  <button
                    key={dc}
                    onClick={() => {
                      updateSession({ day_chuyen: dc });
                      updateSoCa(2);
                    }}
                    className={`px-5 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                      session.day_chuyen === dc
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {dc}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">
                Sá»‘ ca <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {([1, 2, 3] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => updateSoCa(n)}
                    className={`w-12 h-10 rounded-xl text-sm font-bold border-2 transition-all ${
                      session.so_ca === n
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {n} ca
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-4 flex items-center gap-2">
            <Package size={15} className="text-emerald-600" /> ThĂ´ng tin sáº£n
            pháº©m (dĂ¹ng chung má»i ca)
          </h3>

          <div className="space-y-3">
            {/* HĂ ng 1: NgĂ y sáº£n xuáº¥t â€” NÄƒm lĂ´ â€” Háº­u tá»‘ */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  NgĂ y sáº£n xuáº¥t <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={session.ngay_sx}
                  onChange={(e) => updateSession({ ngay_sx: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  NÄƒm lĂ´: {sessionYear}
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  NÄƒm lĂ´
                </label>
                <input
                  value={session.year}
                  onChange={(e) =>
                    updateSession({
                      year: e.target.value.replace(/\D/g, "").slice(0, 2),
                    })
                  }
                  placeholder="25"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Chá»‰nh tay khi giao thoa cuá»‘i nÄƒm
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Háº­u tá»‘ *
                </label>
                <select
                  value={session.suffix}
                  onChange={(e) => updateSession({ suffix: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">Trá»‘ng (khĂ´ng háº­u tá»‘)</option>
                  {displaySuffixes.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} â€” {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* HĂ ng 2: Loáº¡i CSR â€” BĂ nh â€” Bá»c â€” Tháº£m */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Loáº¡i CSR *
                </label>
                <select
                  value={session.loai_csr}
                  onChange={(e) => updateSession({ loai_csr: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {csrOpts.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  BĂ nh (kg/bĂ nh) *
                </label>
                {banhOpts.length > 1 ? (
                  <select
                    value={session.loai_banh}
                    onChange={(e) =>
                      updateSession({ loai_banh: +e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {banhOpts.map((b) => (
                      <option key={b} value={b}>
                        {b} kg
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    readOnly
                    value={`${cfg.loai_banh} kg`}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"
                  />
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  LĂ´ trĂ²n: {cfg.lo_tron} bĂ nh
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Bá»c *
                </label>
                <select
                  value={session.boc}
                  onChange={(e) => updateSession({ boc: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {bocOpts.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Tháº£m *
                </label>
                <select
                  value={session.tham}
                  onChange={(e) => updateSession({ tham: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {THAM_OPTS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* HĂ ng 3: Chá»‰ thá»‹ sx (1/3) â€” Pallet (2/3) */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Chá»‰ thá»‹ SX
                </label>
                <input
                  value={session.chi_thi}
                  onChange={(e) => updateSession({ chi_thi: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Pallet
                </label>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {PALLET_OPTS.map((p) => {
                    const checked = session.pallet.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() =>
                          updateSession({
                            pallet: checked
                              ? session.pallet.filter((x) => x !== p)
                              : [...session.pallet, p],
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                          checked
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 text-slate-500 hover:border-slate-300"
                        }`}
                      >
                        {checked ? "âœ“ " : ""}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* HĂ ng 4: HĂ¬nh áº£nh 1 â€” HĂ¬nh áº£nh 2 */}
            <div className="grid grid-cols-2 gap-3">
              <InventoryImageUpload
                factoryId={factoryId}
                bucket="product-files"
                documentType="lots"
                label="HĂ¬nh áº£nh 1"
                value={session.image_url_1}
                onChange={(url) => updateSession({ image_url_1: url })}
              />
              <InventoryImageUpload
                factoryId={factoryId}
                bucket="product-files"
                documentType="lots"
                label="HĂ¬nh áº£nh 2"
                value={session.image_url_2}
                onChange={(url) => updateSession({ image_url_2: url })}
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-1 flex items-center gap-2">
            <Warehouse size={15} className="text-blue-600" /> Chá»n ngÄƒn lÆ°u{" "}
            <span className="text-red-500">*</span>
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Hiá»ƒn thá»‹ ngÄƒn Ä‘á»§ 21 ngĂ y á»§ cá»§a dĂ¢y chuyá»n{" "}
            <strong>{session.day_chuyen}</strong>
          </p>

          {hasNgan && dorDangLots.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-600" />
                <span className="text-xs font-bold text-amber-700">
                  LĂ´ dá»Ÿ dang cáº§n hoĂ n thĂ nh ({dorDangLots.length} lĂ´)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {dorDangLots.map((l) => (
                  <span
                    key={l.id}
                    className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-lg"
                  >
                    {l.ma_lo} Â· {l.tong_banh} bĂ nh
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasNgan && jumpLotNums.length > 0 && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-rose-600" />
                <span className="text-xs font-bold text-rose-700">
                  Cáº£nh bĂ¡o nháº£y lĂ´ {session.loai_csr} Â· {session.loai_banh}kg (
                  {jumpLotNums.length} sá»‘ cĂ²n trá»‘ng)
                </span>
              </div>
              <div className="text-[11px] text-rose-600 mb-2">
                CĂ¹ng loáº¡i thĂ nh pháº©m vĂ  cĂ¹ng loáº¡i bĂ¡nh pháº£i dĂ¹ng dĂ£y sá»‘ lĂ´ liĂªn
                tá»¥c.
              </div>
              <div className="flex flex-wrap gap-2">
                {jumpLotNums.map((num) => (
                  <span
                    key={num}
                    className="px-2 py-1 bg-rose-100 text-rose-700 text-xs font-bold rounded-lg"
                  >
                    {buildMaLo(num, session.suffix, sessionYear)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {eligibleNgans.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Warehouse size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">KhĂ´ng cĂ³ ngÄƒn Ä‘á»§ Ä‘iá»u kiá»‡n sáº£n xuáº¥t</p>
              <p className="text-xs mt-1">
                Cáº§n ngÄƒn â‰¥ 21 ngĂ y á»§ vĂ  tráº¡ng thĂ¡i Chá»/Äang SX
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {eligibleNgans.map((n) => {
                const kgUsed = nganKgMap[n.id] || 0;
                const pct =
                  n.tong_kho > 0
                    ? Math.min((kgUsed / n.tong_kho) * 100, 100)
                    : 0;
                const days = Math.floor(
                  (Date.now() - new Date(n.ngay_bd).getTime()) / 86400000,
                );
                const selected = session.ngan_id === n.id;
                const hasDorDang = lots.some(
                  (l) => l.ngan_id === n.id && l.trang_thai === "Dá»Ÿ dang",
                );
                return (
                  <button
                    key={n.id}
                    onClick={() => setSession((s) => ({ ...s, ngan_id: n.id }))}
                    className={`p-3 rounded-xl border-2 text-left transition-all hover-lift ${
                      selected
                        ? "border-teal-500 bg-teal-50"
                        : "border-slate-200 bg-white hover:border-teal-300"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="font-extrabold text-slate-800 text-sm">
                        {n.ten_ngan}
                      </span>
                      <div className="flex gap-1">
                        {hasDorDang && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                            Dá»Ÿ dang
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                            n.trang_thai === "Äang sáº£n xuáº¥t"
                              ? "bg-emerald-100 text-emerald-700"
                              : n.trang_thai === "HoĂ n thĂ nh"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {n.trang_thai === "Äang sáº£n xuáº¥t"
                            ? "Äang SX"
                            : n.trang_thai === "HoĂ n thĂ nh"
                              ? "HT"
                              : "Chá» SX"}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-2 truncate">
                      {n.ma_ngan}
                    </p>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
                      <span>SX: {fmtKg(kgUsed)}</span>
                      <span className="font-bold text-teal-700">
                        CĂ²n: {fmtKg(n.tong_kho - kgUsed)}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : pct > 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {n.loai_nl} Â· {days} ngĂ y á»§ Â· DK SX:{" "}
                      {n.ngay_kt
                        ? new Date(n.ngay_kt).toLocaleDateString("vi-VN")
                        : "â€”"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {hasNgan &&
          caSections.map((cs, caIdx) => {
            const caLabel = cs.ca;
            const loCount = cs.to_num - cs.from_num + 1;
            const caTongBanh = cs.lots.reduce((s, l) => {
              if (l.is_already_completed) return s;
              if (l.is_continuation) {
                return (
                  s +
                  Math.max(0, l.kien_a - l.prev_a) +
                  Math.max(0, l.kien_b - l.prev_b) +
                  Math.max(0, l.kien_c - l.prev_c) +
                  Math.max(0, l.kien_d - l.prev_d)
                );
              }
              return s + l.tong_banh;
            }, 0);
            const caTongKg =
              Math.round(
                cs.lots.reduce((s, l) => {
                  if (l.is_already_completed) return s;
                  if (l.is_continuation) {
                    return (
                      s +
                      (l.kien_a +
                        l.kien_b +
                        l.kien_c +
                        l.kien_d -
                        l.prev_a -
                        l.prev_b -
                        l.prev_c -
                        l.prev_d) *
                        session.loai_banh
                    );
                  }
                  return s + l.tong_kg;
                }, 0) * 100,
              ) / 100;

            return (
              <div
                key={caIdx}
                className="bg-white rounded-2xl border border-slate-200 shadow-md mb-4 overflow-hidden"
              >
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-5 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-extrabold text-blue-700">
                    Ca
                  </span>
                  <select
                    value={cs.ca}
                    onChange={(e) =>
                      updateCaSection(caIdx, {
                        ca: e.target.value as "A" | "B" | "C",
                      })
                    }
                    className="px-3 py-1.5 border border-blue-200 rounded-xl text-sm font-bold text-blue-700 bg-white outline-none focus:border-blue-400"
                  >
                    {CA_OPTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {caTongBanh > 0 && (
                    <span className="ml-auto text-xs font-bold text-slate-600">
                      Ca {caLabel}: {caTongBanh} bĂ nh Â· {fmtKg(caTongKg)}
                    </span>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-500">
                        Khoáº£ng lĂ´:
                      </span>
                      <span className="text-xs text-slate-400">Tá»« lĂ´</span>
                      <input
                        type="number"
                        min={1}
                        value={cs.from_num}
                        onChange={(e) =>
                          updateCaSection(caIdx, {
                            from_num: Math.max(1, +e.target.value),
                            to_num: Math.max(cs.to_num, +e.target.value),
                          })
                        }
                        className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-sm text-center outline-none focus:border-emerald-500 font-bold"
                      />
                      <span className="text-xs text-slate-400">Ä‘áº¿n lĂ´</span>
                      <input
                        type="number"
                        min={cs.from_num}
                        value={cs.to_num}
                        onChange={(e) =>
                          updateCaSection(caIdx, {
                            to_num: Math.max(
                              cs.from_num,
                              +e.target.value || cs.from_num,
                            ),
                          })
                        }
                        className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-sm text-center outline-none focus:border-emerald-500 font-bold"
                      />
                      <span className="text-xs text-slate-400 ml-1">
                        {session.suffix ? `${session.suffix}/` : "/"}
                        {sessionYear}
                      </span>
                      {caIdx === 0 && maxNumFromDB > 0 && (
                        <span className="text-[10px] text-slate-400 italic">
                          (gáº§n nháº¥t: {maxNumFromDB}
                          {session.suffix}/{sessionYear})
                        </span>
                      )}
                      {loCount > 0 && (
                        <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                          {loCount} lĂ´
                        </span>
                      )}
                    </div>
                  </div>

                  {cs.lots.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4">
                      Nháº­p khoáº£ng lĂ´ Ä‘á»ƒ hiá»ƒn thá»‹...
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {cs.lots.map((lot, lotIdx) => {
                        if (lot.is_already_completed) {
                          return (
                            <div
                              key={`${caIdx}-${lotIdx}`}
                              className="border border-slate-200 bg-slate-50 rounded-xl p-4 opacity-60 flex justify-between items-center select-none pointer-events-none"
                            >
                              <span className="text-sm font-extrabold text-slate-500 line-through">
                                {buildMaLo(
                                  lot.num,
                                  session.suffix,
                                  sessionYear,
                                )}
                              </span>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-bold">
                                  đŸ”’ ÄĂ£ {lot.trang_thai}
                                </span>
                                <span>{lot.tong_banh} bĂ nh</span>
                              </div>
                            </div>
                          );
                        }

                        if (lot.role === "giua") {
                          const midStart = cs.from_num + 1;
                          const midEnd = cs.to_num - 1;
                          const midCount = midEnd - midStart + 1;
                          if (
                            lotIdx !==
                            cs.lots.findIndex((l) => l.role === "giua")
                          )
                            return null;
                          const sfxPart = session.suffix ? session.suffix : "";
                          return (
                            <div
                              key={`giua-${caIdx}`}
                              className="border border-slate-100 bg-slate-50 rounded-xl p-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-slate-500">
                                  LĂ´ giá»¯a: {midStart}
                                  {sfxPart} â†’ {midEnd}
                                  {sfxPart}
                                  <span className="ml-2 text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                    {midCount} lĂ´ trĂ²n
                                  </span>
                                </span>
                                <span className="text-xs text-slate-500 font-bold">
                                  {midCount} Ă— {cfg.lo_tron} bĂ nh ={" "}
                                  {(
                                    (midCount *
                                      cfg.lo_tron *
                                      session.loai_banh) /
                                    1000
                                  ).toFixed(3)}{" "}
                                  T
                                </span>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {(["A", "B", "C", "D"] as const).map((k) => (
                                  <div
                                    key={k}
                                    className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 text-center"
                                  >
                                    <div className="text-[10px] font-bold text-emerald-600">
                                      Kiá»‡n {k}
                                    </div>
                                    <div className="text-sm font-extrabold text-emerald-700">
                                      {cfg.max_per_kien}{" "}
                                      <Lock size={10} className="inline" />
                                    </div>
                                    <div className="text-[10px] text-emerald-500">
                                      {(
                                        (cfg.max_per_kien * session.loai_banh) /
                                        1000
                                      ).toFixed(3)}{" "}
                                      T
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        const roleLabel =
                          lot.role === "single"
                            ? ""
                            : lot.role === "dau"
                              ? " Â· LĂ´ Ä‘áº§u"
                              : " Â· LĂ´ cuá»‘i";
                        const contLabel = lot.is_continuation
                          ? " Â· Káº¿ thá»«a"
                          : "";
                        const kienKeys = [
                          "kien_a",
                          "kien_b",
                          "kien_c",
                          "kien_d",
                        ] as const;
                        const lockedArr = [
                          lot.locked_a,
                          lot.locked_b,
                          lot.locked_c,
                          lot.locked_d,
                        ];
                        const prevArr = [
                          lot.prev_a,
                          lot.prev_b,
                          lot.prev_c,
                          lot.prev_d,
                        ];
                        const resetKeys = [
                          "kien_a",
                          "kien_b",
                          "kien_c",
                          "kien_d",
                        ] as const;

                        return (
                          <div
                            key={`${caIdx}-${lotIdx}`}
                            className={`border rounded-xl p-4 ${lot.is_continuation ? "border-amber-200 bg-amber-50/30" : "border-slate-200"}`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-extrabold text-slate-700">
                                {buildMaLo(
                                  lot.num,
                                  session.suffix,
                                  sessionYear,
                                )}
                                <span className="text-xs font-normal text-slate-400 ml-2">
                                  {roleLabel}
                                  {contLabel}
                                </span>
                              </span>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <span>
                                  Tá»•ng:{" "}
                                  <strong
                                    className={
                                      lot.trang_thai === "HoĂ n thĂ nh"
                                        ? "text-emerald-600"
                                        : "text-amber-600"
                                    }
                                  >
                                    {lot.tong_banh} bĂ nh
                                  </strong>
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lot.trang_thai === "HoĂ n thĂ nh" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                                >
                                  {lot.trang_thai}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                              {kienKeys.map((k, ki) => {
                                const isLocked = lockedArr[ki];
                                const val = lot[k];
                                const prev = prevArr[ki];
                                const maxK = cfg.max_per_kien;
                                const kLabel = ["A", "B", "C", "D"][ki];

                                if (lot.is_continuation && isLocked) {
                                  return (
                                    <div
                                      key={k}
                                      className="flex flex-col items-center gap-1"
                                    >
                                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[9px] font-bold rounded-full whitespace-nowrap">
                                        Ca trÆ°á»›c Â· Ä‘Ă£ Ä‘á»§
                                      </span>
                                      <div className="w-full border border-indigo-300 bg-indigo-50 rounded-xl px-2 py-2 flex items-center justify-between">
                                        <span className="text-xs font-extrabold text-indigo-500">
                                          {kLabel}
                                        </span>
                                        <span className="text-sm font-extrabold text-indigo-700">
                                          {val}
                                        </span>
                                        <Lock
                                          size={10}
                                          className="text-indigo-400"
                                        />
                                      </div>
                                      <div className="text-[10px] text-center text-slate-400">
                                        {(
                                          (val * session.loai_banh) /
                                          1000
                                        ).toFixed(3)}{" "}
                                        T
                                      </div>
                                    </div>
                                  );
                                }

                                if (lot.is_continuation && !isLocked) {
                                  const remaining = maxK - prev;
                                  const delta = val - prev;
                                  return (
                                    <div
                                      key={k}
                                      className="flex flex-col items-center gap-1"
                                    >
                                      <span className="text-[9px] text-amber-600 font-bold whitespace-nowrap">
                                        ThĂªm â‰¤{remaining}
                                      </span>
                                      <div
                                        className={`relative border rounded-xl overflow-hidden w-full ${
                                          val >= maxK
                                            ? "border-emerald-300 bg-emerald-50"
                                            : delta > 0
                                              ? "border-amber-300 bg-amber-50"
                                              : "border-amber-200 bg-amber-50/40"
                                        }`}
                                      >
                                        <span
                                          className={`absolute left-2 top-1/2 -translate-y-1/2 text-xs font-extrabold ${
                                            val >= maxK
                                              ? "text-emerald-600"
                                              : "text-amber-700"
                                          }`}
                                        >
                                          {kLabel}
                                        </span>
                                        <input
                                          type="number"
                                          value={delta}
                                          min={0}
                                          max={remaining}
                                          disabled={nganBlocked}
                                          onChange={(e) => {
                                            const d = Math.min(
                                              remaining,
                                              Math.max(
                                                0,
                                                Number(e.target.value) || 0,
                                              ),
                                            );
                                            updateLotDraft(caIdx, lotIdx, {
                                              [k]: prev + d,
                                            } as Partial<LotDraft>);
                                          }}
                                          className={`w-full pl-7 pr-6 py-2.5 text-sm font-bold text-center outline-none bg-transparent ${
                                            val >= maxK
                                              ? "text-emerald-700"
                                              : "text-amber-700"
                                          }`}
                                        />
                                        {!nganBlocked && delta > 0 && (
                                          <button
                                            onClick={() =>
                                              resetKien(
                                                caIdx,
                                                lotIdx,
                                                resetKeys[ki],
                                              )
                                            }
                                            title={`Reset vá» ca trÆ°á»›c (${prev})`}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-300 hover:text-red-400 rounded transition-colors"
                                          >
                                            <X size={10} />
                                          </button>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-center text-amber-600 font-bold">
                                        +{delta} bĂ nh ca nĂ y
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={k} className="relative">
                                    <div
                                      className={`relative border rounded-xl overflow-hidden ${
                                        val > 0 && val < maxK
                                          ? "border-amber-300 bg-amber-50"
                                          : val >= maxK
                                            ? "border-emerald-300 bg-emerald-50"
                                            : "border-slate-300"
                                      }`}
                                    >
                                      <span
                                        className={`absolute left-2 top-1/2 -translate-y-1/2 text-xs font-extrabold ${
                                          val >= maxK
                                            ? "text-emerald-600"
                                            : val > 0
                                              ? "text-amber-700"
                                              : "text-slate-400"
                                        }`}
                                      >
                                        {kLabel}
                                      </span>
                                      <input
                                        type="number"
                                        value={val}
                                        min={0}
                                        max={maxK}
                                        disabled={nganBlocked}
                                        onChange={(e) =>
                                          updateLotDraft(caIdx, lotIdx, {
                                            [k]: +e.target.value,
                                          } as Partial<LotDraft>)
                                        }
                                        className={`w-full pl-7 pr-6 py-2.5 text-sm font-bold text-center outline-none bg-transparent ${
                                          val >= maxK
                                            ? "text-emerald-700"
                                            : val > 0
                                              ? "text-amber-700"
                                              : "text-slate-700"
                                        }`}
                                      />
                                      {!nganBlocked && val > 0 && (
                                        <button
                                          onClick={() =>
                                            resetKien(
                                              caIdx,
                                              lotIdx,
                                              resetKeys[ki],
                                            )
                                          }
                                          title="Reset vá» 0"
                                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-300 hover:text-red-400 rounded transition-colors"
                                        >
                                          <X size={10} />
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-center text-slate-400 mt-1">
                                      {(
                                        (val * session.loai_banh) /
                                        1000
                                      ).toFixed(3)}{" "}
                                      T
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="mt-2 text-xs text-slate-400 text-right">
                              {fmtKg(lot.tong_kg)} Â· {lot.tong_banh} bĂ nh
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {caTongBanh > 0 && (
                    <div className="mt-3 flex items-center flex-wrap gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-xs font-extrabold text-blue-700">
                        Tá»•ng Ca {caLabel}:
                      </span>
                      <span className="text-sm font-extrabold text-blue-800">
                        {caTongBanh} bĂ nh
                      </span>
                      <span className="text-xs text-blue-400">Â·</span>
                      <span className="text-sm font-extrabold text-blue-800">
                        {Math.round(caTongKg).toLocaleString("vi-VN")} kg
                      </span>
                      <span className="ml-auto text-xs text-blue-500">
                        â‰ˆ {fmtKg(caTongKg)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

        {saveError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm font-bold">{saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              className="ml-2 hover:opacity-70"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {hasNgan && selectedNgan && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-40">
            <div className="max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-bold text-slate-600 shrink-0">
                  NgÄƒn {selectedNgan.ten_ngan}
                </span>
                <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${nganBlocked ? "bg-red-500" : nganPct >= 100 ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(nganPct, 100)}%` }}
                  />
                </div>
                <span
                  className={`text-xs font-extrabold shrink-0 ${nganBlocked ? "text-red-600" : nganPct >= 100 ? "text-amber-600" : "text-emerald-600"}`}
                >
                  {nganPct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {fmtKg(kgDaCoTrongNgan)}
                  {kgLanNay > 0 ? ` + ${fmtKg(kgLanNay)}` : ""} /{" "}
                  {fmtKg(selectedNgan.tong_kho)}
                </span>
                {nganBlocked && (
                  <span className="text-[10px] text-red-600 font-bold shrink-0">
                    â›” VÆ°á»£t 110%
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  {new Date(session.ngay_sx + "T00:00:00").toLocaleDateString(
                    "vi-VN",
                  )}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  {session.loai_csr} Â· {session.loai_banh}kg
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap max-w-[200px] truncate">
                  {session.boc}
                </span>
                {session.pallet.length > 0 && (
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                    {session.pallet.join(" Â· ")}
                  </span>
                )}
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  CT:{session.chi_thi}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  ThĂ£m {session.tham === "Cá»§" ? "cÅ©" : session.tham}
                </span>
                <span className="text-slate-300 text-xs">â”‚</span>
                {caSections.map((cs, ci) => {
                  const caKg =
                    Math.round(
                      cs.lots.reduce((s, l) => {
                        if (l.is_already_completed) return s;
                        if (l.is_continuation)
                          return (
                            s +
                            (l.kien_a +
                              l.kien_b +
                              l.kien_c +
                              l.kien_d -
                              l.prev_a -
                              l.prev_b -
                              l.prev_c -
                              l.prev_d) *
                              session.loai_banh
                          );
                        return s + l.tong_kg;
                      }, 0) * 100,
                    ) / 100;
                  if (caKg <= 0) return null;
                  return (
                    <span
                      key={ci}
                      className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[11px] font-bold rounded-full whitespace-nowrap"
                    >
                      Ca {cs.ca}: {Math.round(caKg).toLocaleString("vi-VN")} kg
                    </span>
                  );
                })}
                {kgLanNay > 0 && (
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-extrabold rounded-full whitespace-nowrap">
                    Tá»•ng: {Math.round(kgLanNay).toLocaleString("vi-VN")} kg
                  </span>
                )}
                <div className="ml-auto flex gap-2 shrink-0">
                  <button
                    onClick={() => setView("list")}
                    className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    Há»§y
                  </button>
                  {nganPct >= 100 && !nganBlocked ? (
                    <button
                      onClick={() => handleCreateSave(true)}
                      disabled={
                        saving || caSections.every((cs) => cs.lots.length === 0)
                      }
                      className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                    >
                      {saving
                        ? "Äang lÆ°u..."
                        : `âœ“ LÆ°u Â· ÄĂ¡nh dáº¥u ngÄƒn ÄĂ£ sáº£n xuáº¥t`}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCreateSave(false)}
                      disabled={
                        saving ||
                        nganBlocked ||
                        !session.ngan_id ||
                        caSections.every((cs) => cs.lots.length === 0)
                      }
                      className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                    >
                      {saving
                        ? "Äang lÆ°u..."
                        : `LÆ°u ${sessionTotals.banh > 0 ? sessionTotals.banh + " bĂ nh" : "lĂ´"}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!hasNgan && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-4 z-40">
            <div className="max-w-7xl mx-auto flex justify-end gap-2">
              <button
                onClick={() => setView("list")}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Há»§y
              </button>
              <button
                disabled
                className="px-5 py-2 bg-slate-300 text-white text-sm font-bold rounded-xl cursor-not-allowed"
              >
                Chá»n ngÄƒn lÆ°u trÆ°á»›c
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // LIST VIEW
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">ThĂ nh pháº©m</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quáº£n lĂ½ lĂ´ vĂ  phĂ¢n tĂ¡ch sáº£n lÆ°á»£ng theo Ca
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press"
        >
          <Plus size={16} /> ThĂªm lĂ´
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        {(
          [
            {
              label: "Tá»•ng lĂ´",
              value: stats.total,
              color: "text-slate-700",
              Icon: Package,
              ic: "text-slate-400",
            },
            {
              label: "HoĂ n thĂ nh",
              value: stats.hoanThanh,
              color: "text-emerald-600",
              Icon: CheckCircle,
              ic: "text-emerald-400",
            },
            {
              label: "Dá»Ÿ dang",
              value: stats.dorDang,
              color: "text-amber-600",
              Icon: Clock,
              ic: "text-amber-400",
            },
            {
              label: "Tá»•ng bĂ nh (lá»c)",
              value: stats.tongBanh.toLocaleString("vi-VN"),
              color: "text-blue-600",
              Icon: Layers,
              ic: "text-blue-400",
            },
            {
              label: "Tá»•ng táº¥n (lá»c)",
              value: fmtKg(stats.tongKg),
              color: "text-purple-600",
              Icon: Weight,
              ic: "text-purple-400",
            },
          ] as const
        ).map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center"
          >
            <s.Icon size={20} className={`mx-auto mb-1 ${s.ic} opacity-80`} />
            <div className={`text-2xl font-extrabold ${s.color}`}>
              {s.value}
            </div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {(() => {
        const allDorDang = allDorDangLots;
        return allDorDang.length > 0 ? (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <AlertTriangle
              size={15}
              className="text-amber-600 mt-0.5 shrink-0"
            />
            <div>
              <span className="text-xs font-bold text-amber-700 block mb-1">
                {allDorDang.length} lô dở dang cần hoàn thành
                {filterDC ? ` (${filterDC})` : ""}:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {allDorDang.map((l) => (
                  <span
                    key={l.id}
                    className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-lg text-xs font-bold"
                  >
                    {l.ma_lo} · {l.tong_banh} bánh
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null;
      })()}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <Search size={15} className="text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="TĂ¬m mĂ£ lĂ´, ngÄƒn..."
            className="flex-1 text-sm outline-none"
          />
        </div>
        <select
          value={filterDC}
          onChange={(e) => {
            setFilterDC(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Táº¥t cáº£ dĂ¢y chuyá»n</option>
          <option value="Má»§ táº¡p">Má»§ táº¡p</option>
          <option value="Má»§ nÆ°á»›c">Má»§ nÆ°á»›c</option>
        </select>
        <select
          value={filterLoai}
          onChange={(e) => {
            setFilterLoai(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Táº¥t cáº£ loáº¡i</option>
          {[
            "CSR10",
            "CSR20",
            "CSR3L",
            "CSRL",
            "CSRCV50",
            "CSRCV60",
            "SVR10",
            "SVR20",
            "SVR3L",
            "SVRL",
            "SVRCV50",
            "SVRCV60",
            "CSR5",
            "Ngoáº¡i lá»‡",
          ].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select
          value={filterTT}
          onChange={(e) => {
            setFilterTT(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Táº¥t cáº£ tráº¡ng thĂ¡i</option>
          {TRANG_THAI_OPTS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterCa}
          onChange={(e) => {
            setFilterCa(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Táº¥t cáº£ ca</option>
          {CA_OPTS.map((c) => (
            <option key={c} value={c}>
              Ca {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filterFrom}
          onChange={(e) => {
            setFilterFrom(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        />
        <span className="text-slate-400 text-sm">â†’</span>
        <input
          type="date"
          value={filterTo}
          onChange={(e) => {
            setFilterTo(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        />
        {(filterLoai ||
          filterTT ||
          filterCa ||
          filterFrom ||
          filterTo ||
          search ||
          filterDC) && (
          <button
            onClick={() => {
              setFilterLoai("");
              setFilterTT("");
              setFilterCa("");
              setFilterFrom("");
              setFilterTo("");
              setSearch("");
              setFilterDC("");
            }}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500"
          >
            <X size={14} /> XĂ³a lá»c
          </button>
        )}
      </div>

      <div className="space-y-4 pb-32">
        {Object.keys(groupedByDateAndCa)
          .sort((a, b) => b.localeCompare(a))
          .map((date) => {
            const isExpanded = expandedDates.includes(date);
            const dateGroups = groupedByDateAndCa[date];
            const dayBanh = Object.values(dateGroups)
              .flat()
              .reduce((sum, c) => sum + c.tong_banh_cua_ca, 0);
            const dayKg = Object.values(dateGroups)
              .flat()
              .reduce((sum, c) => sum + c.tong_kg_cua_ca, 0);

            return (
              <div
                key={date}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200"
              >
                <div className="bg-slate-50 px-5 py-3.5 flex items-center justify-between hover:bg-slate-100 transition-colors select-none">
                  <div
                    onClick={() => toggleDate(date)}
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                  >
                    {isExpanded ? (
                      <ChevronDown
                        size={18}
                        className="text-slate-400 shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={18}
                        className="text-slate-400 shrink-0"
                      />
                    )}
                    <span className="font-extrabold text-slate-800 text-base">
                      {date !== "ChÆ°a cĂ³ ngĂ y"
                        ? new Date(date).toLocaleDateString("vi-VN")
                        : date}
                    </span>
                    <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-500 text-xs font-bold rounded-full">
                      {Object.values(dateGroups).flat().length} láº§n nháº­p
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4 text-sm font-bold text-slate-600">
                      <span>{dayBanh.toLocaleString("vi-VN")} bĂ nh</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-emerald-700">{fmtKg(dayKg)}</span>
                    </div>
                    {deleteMode === date ? (
                      <>
                        <span className="text-xs text-red-600 font-bold shrink-0">
                          Chá»n lĂ´ cáº§n xĂ³a...
                        </span>
                        <button
                          disabled={
                            selectedDeleteIds.size === 0 || preCheckLoading
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeletePreCheck();
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors shrink-0"
                        >
                          <Trash2 size={12} />
                          {preCheckLoading
                            ? "Äang kiá»ƒm tra..."
                            : `XĂ³a ${selectedDeleteIds.size} lĂ´`}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteMode(null);
                            setSelectedDeleteIds(new Set());
                            setLotsBlockedByKn([]);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors shrink-0"
                        >
                          Há»§y
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openCreate(date);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                          title="ThĂªm ca sáº£n xuáº¥t cho ngĂ y nĂ y"
                        >
                          <Plus size={12} /> ThĂªm
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditDateModal(date);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                          title="Sá»­a lĂ´ trong ngĂ y nĂ y"
                        >
                          <Edit2 size={12} /> Sá»­a
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteMode(date);
                            setSelectedDeleteIds(new Set());
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                          title="XĂ³a lĂ´ trong ngĂ y nĂ y"
                        >
                          <Trash2 size={12} /> XĂ³a
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 space-y-6">
                    {Object.keys(dateGroups)
                      .sort()
                      .map((ca) => {
                        const caContribs = dateGroups[ca];
                        const caBanh = caContribs.reduce(
                          (sum, c) => sum + c.tong_banh_cua_ca,
                          0,
                        );
                        const caKg = caContribs.reduce(
                          (sum, c) => sum + c.tong_kg_cua_ca,
                          0,
                        );

                        return (
                          <div key={ca}>
                            <div className="flex items-center gap-3 mb-3">
                              <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-extrabold rounded-lg text-sm">
                                Ca {ca}
                              </span>
                              <span className="text-xs font-bold text-slate-500">
                                {caBanh.toLocaleString("vi-VN")} b\u00e1nh \u00b7{" "}
                                {fmtKg(caKg)}
                              </span>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                                  <tr>
                                    {deleteMode === date && (
                                      <th className="px-3 py-2.5 w-10" />
                                    )}
                                    <th className="px-4 py-2.5 text-left">
                                      M\u00e3 l\u00f4
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Ng\u0103n
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Lo\u1ea1i
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      B\u1ecdc
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      SL Th\u1ef1c t\u1ebf ca n\u00e0y
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Ki\u1ec7n (A/B/C/D) th\u1eddi \u0111i\u1ec3m
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Tr\u1ea1ng th\u00e1i
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {caContribs.map((c) => (
                                    <tr
                                      key={c.uid}
                                      className={`hover:bg-slate-50 transition-colors ${deleteMode === date && selectedDeleteIds.has(c.id) ? "bg-red-50" : ""}`}
                                    >
                                      {deleteMode === date && (
                                        <td className="px-3 py-2.5">
                                          <input
                                            type="checkbox"
                                            checked={selectedDeleteIds.has(
                                              c.id,
                                            )}
                                            onChange={() =>
                                              setSelectedDeleteIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(c.id)) {
                                                  next.delete(c.id);
                                                } else {
                                                  next.add(c.id);
                                                }
                                                return next;
                                              })
                                            }
                                            className="w-4 h-4 rounded accent-red-500"
                                          />
                                        </td>
                                      )}
                                      <td className="px-4 py-2.5 font-bold text-slate-700">
                                        {c.ma_lo}
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                                        {c.ngans?.ten_ngan || "-"}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">
                                          {c.loai_csr}
                                        </span>
                                      </td>
                                      <td
                                        className="px-4 py-2.5 text-xs text-slate-500 max-w-[140px] truncate"
                                        title={c.boc || ""}
                                      >
                                        {c.boc || "-"}
                                      </td>
                                      <td className="px-4 py-2.5 font-extrabold text-blue-700">
                                        +{c.tong_banh_cua_ca}{" "}
                                        <span className="text-xs font-normal text-slate-500">
                                          ({fmtKg(c.tong_kg_cua_ca)})
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-xs text-slate-500">
                                        <span className="flex items-center gap-0.5 flex-wrap">
                                          {c.locked_a && (
                                            <Lock
                                              size={9}
                                              className="text-indigo-400 shrink-0"
                                            />
                                          )}
                                          <span>{c.disp_a}</span>
                                          <span>/</span>
                                          {c.locked_b && (
                                            <Lock
                                              size={9}
                                              className="text-indigo-400 shrink-0"
                                            />
                                          )}
                                          <span>{c.disp_b}</span>
                                          <span>/</span>
                                          {c.locked_c && (
                                            <Lock
                                              size={9}
                                              className="text-indigo-400 shrink-0"
                                            />
                                          )}
                                          <span>{c.disp_c}</span>
                                          <span>/</span>
                                          {c.locked_d && (
                                            <Lock
                                              size={9}
                                              className="text-indigo-400 shrink-0"
                                            />
                                          )}
                                          <span>{c.disp_d}</span>
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            c.trang_thai === "HoĂ n thĂ nh"
                                              ? "bg-emerald-100 text-emerald-700"
                                              : c.trang_thai === "Xuáº¥t hĂ ng"
                                                ? "bg-purple-100 text-purple-700"
                                                : "bg-amber-100 text-amber-700"
                                          }`}
                                        >
                                          {c.trang_thai}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        {Object.keys(groupedByDateAndCa).length === 0 && (
          <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
            <Package size={40} className="mx-auto mb-3 opacity-30" />
            <p>Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u ph\u00f9 h\u1ee3p</p>
          </div>
        )}
      </div>

      {editModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                S\u1eeda l\u00f4 {editForm.ma_lo}
              </h2>
              <button
                onClick={() => setEditModal(false)}
                className="p-2 hover:bg-slate-100 rounded-xl"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-start gap-2">
                <AlertTriangle
                  size={16}
                  className="text-amber-600 mt-0.5 shrink-0"
                />
                <p className="text-xs text-amber-700">
                  <strong>L\u01b0u \u00fd:</strong> Vi\u1ec7c s\u1eeda g\u1ed1c s\u1ebd thay \u0111\u1ed5i s\u1ed1 li\u1ec7u to\u00e0n
                  c\u1ee5c c\u1ee7a l\u00f4 n\u00e0y nh\u01b0ng kh\u00f4ng s\u1eeda \u0111\u1ed5i c\u00e1c nh\u00e1nh History ph\u00e2n ca
                  c\u1ee7a n\u00f3. Ch\u1ec9 s\u1eeda tay khi ph\u00e1t hi\u1ec7n sai s\u00f3t s\u1ed1 l\u01b0\u1ee3ng t\u1ed5ng.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  D\u00e2y chuy\u1ec1n *
                </label>
                <div className="flex gap-3">
                  {["M\u1ee7 t\u1ea1p", "M\u1ee7 n\u01b0\u1edbc"].map((dc) => (
                    <button
                      key={dc}
                      onClick={() => updateEditForm({ day_chuyen: dc })}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                        editForm.day_chuyen === dc
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      {dc}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Sá»‘ lĂ´ *
                  </label>
                  <input
                    type="number"
                    value={editForm.num}
                    onChange={(e) => updateEditForm({ num: +e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    MĂ£ lĂ´
                  </label>
                  <input
                    readOnly
                    value={editForm.ma_lo}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Háº­u tá»‘
                  </label>
                  <select
                    value={editForm.suffix}
                    onChange={(e) => updateEditForm({ suffix: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">Trá»‘ng</option>
                    {(suffixList.length > 0
                      ? suffixList
                      : [
                          { code: "cs", name: "Ná»™i tuyá»ƒn PEFC" },
                          { code: "m", name: "Mua ngoĂ i" },
                        ]
                    ).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} â€” {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    NgĂ y SX *
                  </label>
                  <input
                    type="date"
                    value={editForm.ngay_sx}
                    onChange={(e) =>
                      updateEditForm({ ngay_sx: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    NÄƒm lĂ´
                  </label>
                  <input
                    value={editForm.year}
                    onChange={(e) =>
                      updateEditForm({
                        year: e.target.value.replace(/\D/g, "").slice(0, 2),
                      })
                    }
                    placeholder="25"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Ca *
                  </label>
                  <select
                    value={editForm.ca}
                    onChange={(e) => updateEditForm({ ca: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {CA_OPTS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loáº¡i CSR *
                  </label>
                  <select
                    value={editForm.loai_csr}
                    onChange={(e) =>
                      updateEditForm({ loai_csr: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {getLoaiCSRByDayChuyen(
                      editForm.day_chuyen,
                      factoryPrefix,
                    ).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    NgÄƒn lÆ°u
                  </label>
                  <select
                    value={editForm.ngan_id}
                    onChange={(e) =>
                      updateEditForm({ ngan_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Chá»n ngÄƒn --</option>
                    {ngans.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.ten_ngan} â€” {n.ma_ngan}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loáº¡i bĂ nh
                  </label>
                  <input
                    readOnly
                    value={`${editForm.loai_banh} kg/bĂ nh`}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loáº¡i bá»c
                  </label>
                  <select
                    value={editForm.boc}
                    onChange={(e) => updateEditForm({ boc: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {getBocsForLoaiCSR(
                      editForm.day_chuyen,
                      editForm.loai_csr,
                    ).map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Tháº£m
                  </label>
                  <select
                    value={editForm.tham}
                    onChange={(e) => updateEditForm({ tham: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {THAM_OPTS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const cfg2 = getLoaiBanhConfig(
                  editForm.loai_csr,
                  editForm.loai_banh,
                );
                const maxK = cfg2.max_per_kien;
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-600">
                        Sá»‘ bĂ nh kiá»‡n (A / B / C / D)
                      </label>
                      <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold">
                        Max {maxK} bĂ nh Â· LĂ´ trĂ²n = {cfg2.lo_tron} bĂ nh
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {(["kien_a", "kien_b", "kien_c", "kien_d"] as const).map(
                        (k, i) => {
                          const val = editForm[k];
                          const isLocked = val >= maxK;
                          return (
                            <div key={k} className="relative">
                              <span
                                className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold ${isLocked ? "text-emerald-500" : "text-slate-400"}`}
                              >
                                {["A", "B", "C", "D"][i]}
                              </span>
                              <input
                                type="number"
                                value={val}
                                min={0}
                                max={maxK}
                                onChange={(e) =>
                                  updateEditForm({
                                    [k]: +e.target.value,
                                  } as Partial<EditForm>)
                                }
                                className={`w-full pl-7 pr-3 py-2 border rounded-xl text-sm outline-none transition-colors ${
                                  isLocked
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-bold"
                                    : val > 0
                                      ? "border-amber-300 bg-amber-50 text-amber-700 font-semibold focus:border-amber-500"
                                      : "border-slate-300 focus:border-emerald-500"
                                }`}
                              />
                              {isLocked && (
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 text-[10px] font-bold">
                                  đŸ”’
                                </span>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span>
                        Tá»•ng bĂ nh:{" "}
                        <strong className="text-slate-700">
                          {editForm.tong_banh}
                        </strong>
                      </span>
                      <span>
                        Tá»•ng kg:{" "}
                        <strong className="text-slate-700">
                          {editForm.tong_kg.toLocaleString()}
                        </strong>
                      </span>
                      <span>
                        Tráº¡ng thĂ¡i:{" "}
                        <strong
                          className={
                            editForm.trang_thai === "HoĂ n thĂ nh"
                              ? "text-emerald-600"
                              : "text-amber-600"
                          }
                        >
                          {editForm.trang_thai}
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Ghi chĂº
                </label>
                <input
                  value={editForm.ghi_chu}
                  onChange={(e) => updateEditForm({ ghi_chu: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => setEditModal(false)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Há»§y
              </button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Äang lÆ°u..." : "LÆ°u thay Ä‘á»•i"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editDateModal &&
        (() => {
          const dateLots = contributions.filter(
            (c) => c.ngay_sx === editDateModal,
          );
          const grouped: Record<string, typeof dateLots> = {};
          dateLots.forEach((c) => {
            const k = c.ca || "?";
            if (!grouped[k]) grouped[k] = [];
            grouped[k].push(c);
          });
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                  <div>
                    <h3 className="font-extrabold text-slate-800">
                      Sá»­a ngĂ y{" "}
                      {new Date(editDateModal).toLocaleDateString("vi-VN")}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Click vĂ o lĂ´ Ä‘á»ƒ má»Ÿ form sá»­a
                    </p>
                  </div>
                  <button
                    onClick={() => setEditDateModal(null)}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={18} className="text-slate-500" />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {Object.keys(grouped)
                    .sort()
                    .map((ca) => (
                      <div key={ca}>
                        <div className="px-6 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-extrabold rounded-lg">
                            Ca {ca}
                          </span>
                          <span className="text-xs text-slate-500">
                            {grouped[ca].reduce(
                              (s, c) => s + c.tong_banh_cua_ca,
                              0,
                            )}{" "}
                            bĂ nh
                          </span>
                        </div>
                        {grouped[ca].map((c) => {
                          const lot = lots.find((l) => l.id === c.id);
                          const latestTransactionId =
                            lot?.lot_transactions?.[lot.lot_transactions.length - 1]?.id;
                          const isLatestContribution =
                            !c.transaction_id || c.transaction_id === latestTransactionId;
                          const canEdit =
                            isLatestContribution && c.trang_thai !== "Xuáº¥t hĂ ng";
                          return (
                            <div
                              key={c.uid}
                              className="px-6 py-3 flex items-center justify-between border-b border-slate-100 hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-bold text-slate-800 shrink-0">
                                  {c.ma_lo}
                                </span>
                                <span className="text-xs text-slate-400 shrink-0">
                                  +{c.tong_banh_cua_ca} bĂ nh Â·{" "}
                                  {fmtKg(c.tong_kg_cua_ca)}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                    c.trang_thai === "HoĂ n thĂ nh"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : c.trang_thai === "Xuáº¥t hĂ ng"
                                        ? "bg-purple-100 text-purple-700"
                                        : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {c.trang_thai}
                                </span>
                              </div>
                              {canEdit && lot ? (
                                <button
                                  onClick={() => {
                                    setEditDateModal(null);
                                    openEdit(lot);
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                                >
                                  <Edit2 size={12} /> Sá»­a lĂ´
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400 shrink-0">
                                  ÄĂ£ xuáº¥t hĂ ng
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  {dateLots.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      KhĂ´ng cĂ³ lĂ´ nĂ o
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">
              XĂ¡c nháº­n xĂ³a?
            </h3>
            {lotsBlockedByKn.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-bold text-amber-700">
                  â ï¸ {lotsBlockedByKn.length} lĂ´ Ä‘Ă£ cĂ³ phiáº¿u KN â€” sáº½ khĂ´ng Ä‘Æ°á»£c
                  xĂ³a:
                </p>
                <p className="text-xs text-amber-600 mt-1 break-all">
                  {lotsBlockedByKn
                    .map((id) => lots.find((l) => l.id === id)?.ma_lo)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            )}
            <p className="text-sm text-slate-500 mb-5">
              {delConfirm === "bulk"
                ? lotsBlockedByKn.length === selectedDeleteIds.size
                  ? "Táº¥t cáº£ lĂ´ Ä‘Ă£ chá»n Ä‘á»u cĂ³ phiáº¿u KN, khĂ´ng thá»ƒ xĂ³a."
                  : lotsBlockedByKn.length > 0
                    ? `${selectedDeleteIds.size - lotsBlockedByKn.length} lĂ´ chÆ°a cĂ³ KN sáº½ bá»‹ xĂ³a vÄ©nh viá»…n.`
                    : `${selectedDeleteIds.size} lĂ´ Ä‘Ă£ chá»n sáº½ bá»‹ xĂ³a vÄ©nh viá»…n.`
                : "LĂ´ nĂ y sáº½ bá»‹ xĂ³a vÄ©nh viá»…n."}{" "}
              {(delConfirm !== "bulk" ||
                lotsBlockedByKn.length < selectedDeleteIds.size) &&
                "NgÄƒn lÆ°u liĂªn quan sáº½ Ä‘Æ°á»£c cáº­p nháº­t tráº¡ng thĂ¡i tá»± Ä‘á»™ng."}
            </p>
            <div className="flex gap-3">
              {delConfirm === "bulk" &&
              lotsBlockedByKn.length === selectedDeleteIds.size ? (
                <button
                  onClick={() => {
                    setDelConfirm(null);
                    setLotsBlockedByKn([]);
                  }}
                  className="w-full py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  ÄĂ³ng
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setDelConfirm(null)}
                    className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Há»§y
                  </button>
                  <button
                    onClick={() =>
                      delConfirm === "bulk"
                        ? handleBulkDelete()
                        : handleDelete(delConfirm)
                    }
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md"
                  >
                    XĂ³a
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  getActiveFactoryId,
  hydrateActiveSession,
  type SessionUser,
} from "@/lib/auth";
import {
  deleteLotTransaction,
  saveLotTransaction,
} from "@/app/dashboard/product/actions";
import {
  dedupeLotsByMaLo,
  normalizeLotStatus,
} from "@/app/dashboard/product/shared";
import { createRequiredNote, loadRequiredNotes } from "@/lib/required-notes";
import { EMPTY_NOTE_FILTER, matchesNoteFilter } from "@/lib/note-filter";
import { InventoryImageUpload } from "@/app/dashboard/inventory/_components/inventory-image-upload";
import {
  deriveStorageStatus,
  isProductSelectableStorageStatus,
  normalizeStorageStatus,
  STORAGE_STATUS_IN_PRODUCTION,
  STORAGE_STATUS_PRODUCED,
} from "@/lib/storage-status";
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
  ArrowLeftRight,
  MoveRight,
} from "lucide-react";

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
  ngay_sx: string;
  day_chuyen: string;
  so_ca: 1 | 2 | 3;
  ngan_id: string;
  suffix: string;
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  chi_thi: string;
  pallet: string[];
  ghi_chu: string;
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

type CaBlock = {
  id: string;
  from_num: number;
  to_num: number;
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  pallet: string[];
  lots: LotDraft[];
};

type CaSection = {
  ca: "A" | "B" | "C";
  blocks: CaBlock[];
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

type DateEditHeaderForm = {
  ngay_sx: string;
  ngan_id: string;
  suffix: string;
  chi_thi: string;
  ghi_chu: string;
  image_url_1: string;
  image_url_2: string;
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

type SkPendingLot = {
  lot: Lot;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
};

type ErrorWithDigest = Error & { digest?: string };

// â"€â"€â"€ Constants â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const CA_OPTS = ["A", "B", "C"];
const THAM_OPTS = ["c\u0169", "M\u1edbi"];
const TRANG_THAI_OPTS = ["Ho\u00e0n th\u00e0nh", "D\u1edf dang", "Xu\u1ea5t h\u00e0ng"];
const PALLET_OPTS = ["S\u1eaft \u0111\u1ebf g\u1ed7", "S\u1eaft \u0111\u1ebf nh\u1ef1a", "S\u1eaft m\u1ecfng", "MB5", "G\u1ed7"];
const DAY_CHUYEN_TAP = "Mủ tạp";
const DAY_CHUYEN_NUOC = "Mủ nước";
const STANDARD_NGAN_MAX = 24;

function foldText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function normalizeDayChuyen(value?: string | null) {
  const v = foldText(value);
  if (v.includes("nuoc")) return DAY_CHUYEN_NUOC;
  return DAY_CHUYEN_TAP;
}

function normalizeLoaiNl(value?: string | null) {
  const v = foldText(value);
  if (v.includes("nuoc")) return DAY_CHUYEN_NUOC;
  if (v.includes("tap")) return DAY_CHUYEN_TAP;
  return value || "";
}

function getValidLoaiNlOptions(dayChuyenVal: string) {
  return normalizeDayChuyen(dayChuyenVal) === DAY_CHUYEN_TAP
    ? [
        "Mủ chén",
        "Mủ đông chén",
        "Mủ đông khối",
        "Mủ dây",
        "Mủ dơ",
        "Mủ tạp",
      ]
    : ["Mủ nước"];
}

function normalizeNganCode(value?: string | null) {
  return foldText(value).replace(/\s+/g, "");
}

function getStandardNganNumber(ngan: Pick<Ngan, "ten_ngan" | "ma_ngan">): number | null {
  const candidates = [ngan.ma_ngan, ngan.ten_ngan];
  for (const candidate of candidates) {
    const match = normalizeNganCode(candidate).match(/^n(\d{1,2})$/);
    if (!match) continue;
    const num = Number(match[1]);
    if (num >= 1 && num <= STANDARD_NGAN_MAX) return num;
  }
  return null;
}

function getResolvedProductNganStatus(ngan: Pick<Ngan, "ngay_bd" | "ngay_kt" | "trang_thai">) {
  return deriveStorageStatus({
    ngayBd: ngan.ngay_bd,
    ngayKt: ngan.ngay_kt,
    current: normalizeStorageStatus(ngan.trang_thai),
  });
}

function getLotStatusBadgeClass(status?: string | null) {
  switch (normalizeLotStatus(status)) {
    case "Hoàn thành":
      return "bg-emerald-100 text-emerald-700";
    case "Xuất hàng":
      return "bg-purple-100 text-purple-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

// â"€â"€â"€ Business Logic â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

function getErrorMessage(error: unknown, fallback = "Lỗi không xác định") {
  if (error instanceof Error) {
    const digest = (error as ErrorWithDigest).digest;
    return digest ? `${error.message} [digest: ${digest}]` : error.message;
  }
  if (typeof error === "string") return error;
  return fallback;
}

function compareLotRecency(
  a: Pick<Lot, "ngay_sx" | "ca" | "updated_at" | "created_at">,
  b: Pick<Lot, "ngay_sx" | "ca" | "updated_at" | "created_at">,
) {
  if (b.ngay_sx !== a.ngay_sx) return b.ngay_sx.localeCompare(a.ngay_sx);
  const caDiff = (CA_ORDER_MAP[b.ca] || 0) - (CA_ORDER_MAP[a.ca] || 0);
  if (caDiff !== 0) return caDiff;
  const bStamp = b.updated_at || b.created_at || "";
  const aStamp = a.updated_at || a.created_at || "";
  return bStamp.localeCompare(aStamp);
}

function joinUniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatShiftDetailLabel(label: string, values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return `${label} ${values[0]}`;
  return `${label} ${values.join(", ")}`;
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

function buildLotSeriesKey(series: LotSeries) {
  return `${series.loai_csr}::${Number(series.loai_banh)}::${series.year}`;
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
  currentDrafts: LotDraft[] = [],
): LotDraft[] {
  if (fromNum > toNum || fromNum < 1) return [];
  const cfg = getLoaiBanhConfig(loai_csr, sessionBanh);
  const { max_per_kien, lo_tron, loai_banh } = cfg;
  const drafts: LotDraft[] = [];
  const series: LotSeries = { loai_csr, loai_banh, year: yearStr };
  const currentDraftMap = new Map(currentDrafts.map((draft) => [draft.num, draft]));

  for (let n = fromNum; n <= toNum; n++) {
    const dbLot = existingLots.find(
      (l) => l.num === n && isSameLotSeries(l, series),
    );
    const currentDraft = currentDraftMap.get(n);
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
    const pA = contSource?.kien_a ?? 0;
    const pB = contSource?.kien_b ?? 0;
    const pC = contSource?.kien_c ?? 0;
    const pD = contSource?.kien_d ?? 0;
    const lA = pA >= max_per_kien;
    const lB = pB >= max_per_kien;
    const lC = pC >= max_per_kien;
    const lD = pD >= max_per_kien;

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

    if (currentDraft && currentDraft.role !== "giua") {
      drafts.push(
        calcDraftTotals(
          {
            ...currentDraft,
            role,
            kien_a: is_continuation
              ? lA
                ? pA
                : clampNumber(currentDraft.kien_a, pA, max_per_kien)
              : clampNumber(currentDraft.kien_a, 0, max_per_kien),
            kien_b: is_continuation
              ? lB
                ? pB
                : clampNumber(currentDraft.kien_b, pB, max_per_kien)
              : clampNumber(currentDraft.kien_b, 0, max_per_kien),
            kien_c: is_continuation
              ? lC
                ? pC
                : clampNumber(currentDraft.kien_c, pC, max_per_kien)
              : clampNumber(currentDraft.kien_c, 0, max_per_kien),
            kien_d: is_continuation
              ? lD
                ? pD
                : clampNumber(currentDraft.kien_d, pD, max_per_kien)
              : clampNumber(currentDraft.kien_d, 0, max_per_kien),
            prev_a: is_continuation ? pA : 0,
            prev_b: is_continuation ? pB : 0,
            prev_c: is_continuation ? pC : 0,
            prev_d: is_continuation ? pD : 0,
            locked_a: is_continuation ? lA : false,
            locked_b: is_continuation ? lB : false,
            locked_c: is_continuation ? lC : false,
            locked_d: is_continuation ? lD : false,
            is_continuation,
            is_already_completed: false,
            existing_id:
              currentDraft.existing_id ??
              (fromDB as Lot | undefined)?.id ??
              (fromPrevDraft as LotDraft | undefined)?.existing_id,
          },
          loai_banh,
          lo_tron,
        ),
      );
      continue;
    }

    if (is_continuation && contSource) {
      const initA = lA ? pA : max_per_kien;
      const initB = lB ? pB : max_per_kien;
      const initC = lC ? pC : max_per_kien;
      const initD = lD ? pD : max_per_kien;
      drafts.push(
        calcDraftTotals(
          {
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
            tong_banh: 0,
            tong_kg: 0,
            trang_thai: "D\u1edf dang",
          },
          loai_banh,
          lo_tron,
        ),
      );
    } else {
      drafts.push(
        calcDraftTotals(
          {
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
            tong_banh: 0,
            tong_kg: 0,
            trang_thai: "Ho\u00e0n th\u00e0nh",
          },
          loai_banh,
          lo_tron,
        ),
      );
    }
  }
  return drafts;
}

function getLotDraftAddedBanh(lot: LotDraft) {
  if (lot.is_already_completed) return 0;
  if (lot.is_continuation) {
    return (
      Math.max(0, lot.kien_a - lot.prev_a) +
      Math.max(0, lot.kien_b - lot.prev_b) +
      Math.max(0, lot.kien_c - lot.prev_c) +
      Math.max(0, lot.kien_d - lot.prev_d)
    );
  }
  return lot.tong_banh;
}

function getLotRoleLabel(role: LotDraft["role"]) {
  switch (role) {
    case "dau":
      return "Lô đầu";
    case "giua":
      return "Lô giữa";
    case "cuoi":
      return "Lô cuối";
    case "single":
    default:
      return "Lô duy nhất";
  }
}

function getLotDraftMode(lot: LotDraft) {
  if (lot.is_already_completed) return "Hoàn thành readonly";
  if (lot.role === "giua") return "Lô giữa tròn readonly";
  if (lot.is_continuation) return "Kế thừa";
  return "Đang nhập";
}

function getLotSectionTone(lot: LotDraft) {
  if (lot.is_already_completed) {
    return {
      wrap: "border-slate-200 bg-slate-50/80 text-slate-400",
      badge: "bg-slate-200 text-slate-500",
      status: "bg-slate-200 text-slate-500",
      input: "border-slate-200 bg-slate-100 text-slate-400",
      warning: "border-slate-200 bg-slate-100 text-slate-500",
      meta: "text-slate-400",
    };
  }
  if (lot.is_continuation) {
    return {
      wrap: "border-amber-300 bg-amber-50/70 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
      badge: "bg-amber-100 text-amber-800",
      status: "bg-amber-100 text-amber-800",
      input: "border-amber-300 bg-white text-amber-900",
      warning: "border-amber-300 bg-amber-100/90 text-amber-800",
      meta: "text-amber-700",
    };
  }
  return {
    wrap: "border-slate-200 bg-white text-slate-700",
    badge: "bg-slate-100 text-slate-500",
    status: "bg-emerald-100 text-emerald-700",
    input: "border-emerald-400 bg-emerald-50 text-emerald-700",
    warning: "border-emerald-200 bg-emerald-50 text-emerald-700",
    meta: "text-slate-400",
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
      ghi_chu: "",
      image_url_1: "",
    image_url_2: "",
  };
}

function makeBlockId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultBlock(
  config: Pick<SessionHeader, "loai_csr" | "loai_banh" | "boc" | "tham" | "pallet">,
  fromNum = 1,
): CaBlock {
  return {
    id: makeBlockId(),
    from_num: fromNum,
    to_num: fromNum,
    loai_csr: config.loai_csr,
    loai_banh: config.loai_banh,
    boc: config.boc,
    tham: config.tham,
    pallet: [...config.pallet],
    lots: [],
  };
}

function defaultCaSection(
  ca: "A" | "B" | "C",
  config: Pick<SessionHeader, "loai_csr" | "loai_banh" | "boc" | "tham" | "pallet">,
  fromNum = 1,
): CaSection {
  return { ca, blocks: [defaultBlock(config, fromNum)] };
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

// â"€â"€â"€ Main Component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export default function ProductPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [ngans, setNgans] = useState<Ngan[]>([]);
  const [, setLoading] = useState(true);
  const [, setCurrentUser] = useState<SessionUser | null>(null);
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
  const [filterGhiChu, setFilterGhiChu] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [requiredNotes, setRequiredNotes] = useState<string[]>([]);

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
  const [dateEditHeader, setDateEditHeader] = useState<DateEditHeaderForm | null>(null);
  const [deleteMode, setDeleteMode] = useState<string | null>(null);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(
    new Set(),
  );

  // ── Sang kiện / Thay bọc ─────────────────────────────────────────
  const [skOpen, setSkOpen] = useState(false);
  const [skTab, setSkTab] = useState<"sang_kien" | "thay_boc">("sang_kien");
  const [skFilterDC, setSkFilterDC] = useState("");
  const [skFilterLoai, setSkFilterLoai] = useState("");
  const [skFilterBoc, setSkFilterBoc] = useState("");
  const [skFilterPallet, setSkFilterPallet] = useState("");
  const [skToBoc, setSkToBoc] = useState("");
  const [skToPallet, setSkToPallet] = useState<string[]>([]);
  const [skPending, setSkPending] = useState<SkPendingLot[]>([]);
  const [skConfirm, setSkConfirm] = useState(false);
  const [skSaving, setSkSaving] = useState(false);
  const [skError, setSkError] = useState<string | null>(null);
  const [skDone, setSkDone] = useState<Set<string>>(new Set());
  const [nganPickerCollapsed, setNganPickerCollapsed] = useState(false);
  const [nganManualQuery, setNganManualQuery] = useState("");

  const [session, setSession] = useState<SessionHeader>(defaultSession());
  const [caSections, setCaSections] = useState<CaSection[]>([
    defaultCaSection("A", defaultSession()),
    defaultCaSection("B", defaultSession(), 2),
  ]);

  // â"€â"€ Load data â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
      setNgans(
        ((ngansData || []) as Ngan[]).map((ngan) => ({
          ...ngan,
          trang_thai: getResolvedProductNganStatus(ngan),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const authState = await hydrateActiveSession().catch(() => ({
        session: null,
        user: null as SessionUser | null,
      }));
      setCurrentUser(authState.user);

      const fid = authState.user?.factory_id || (await getActiveFactoryId());
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

      loadRequiredNotes(supabase, fid)
        .then((rows) => setRequiredNotes(rows.map((row) => row.content)))
        .catch(() => setRequiredNotes([]));

      supabase
        .from("lots")
        .update({ day_chuyen: DAY_CHUYEN_TAP })
        .eq("factory_id", fid)
        .or("day_chuyen.is.null,day_chuyen.eq.")
        .then(() => {});
    };
    void bootstrap();
  }, [loadData]);

  // â"€â"€ Computed BĂ³c tĂ¡ch sáº£n lÆ°á»£ng (Contributions) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
      if (
        filterDC &&
        normalizeDayChuyen(c.day_chuyen) !== normalizeDayChuyen(filterDC)
      ) {
        return false;
      }
      if (filterLoai && c.loai_csr !== filterLoai) return false;
      if (filterTT && normalizeLotStatus(c.trang_thai) !== normalizeLotStatus(filterTT)) {
        return false;
      }
      if (!matchesNoteFilter(c.ghi_chu, filterGhiChu)) return false;
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
    filterGhiChu,
    filterFrom,
    filterTo,
  ]);

  const groupedByDateAndCa = useMemo(() => {
    const groups: Record<string, Record<string, LotContribution[]>> = {};
    filteredContribs.forEach((c) => {
      const date = c.ngay_sx || "Chưa có ngày";
      if (!groups[date]) groups[date] = {};
      if (!groups[date][c.ca]) groups[date][c.ca] = [];
      groups[date][c.ca].push(c);
    });
    return groups;
  }, [filteredContribs]);

  const stats = {
    total: lots.length,
    hoanThanh: lots.filter(
      (l) => {
        const status = normalizeLotStatus(l.trang_thai);
        return status === "Hoàn thành" || status === "Xuất hàng";
      },
    ).length,
    dorDang: lots.filter((l) => normalizeLotStatus(l.trang_thai) === "Dở dang")
      .length,
    tongBanh: filteredContribs.reduce(
      (s, c) => s + (c.tong_banh_cua_ca || 0),
      0,
    ),
    tongKg: filteredContribs.reduce((s, c) => s + (c.tong_kg_cua_ca || 0), 0),
  };

  // ── Sang kiện / Thay bọc computed ────────────────────────────────
  const skEligibleLots = useMemo(() => {
    const pendingIds = new Set(skPending.map((p) => p.lot.id));
    return lots.filter((l) => {
      if (normalizeLotStatus(l.trang_thai) !== "Hoàn thành") return false;
      if (pendingIds.has(l.id)) return false;
      if (skFilterDC && normalizeDayChuyen(l.day_chuyen) !== normalizeDayChuyen(skFilterDC)) return false;
      if (skFilterLoai && l.loai_csr !== skFilterLoai) return false;
      if (skFilterBoc && l.boc !== skFilterBoc) return false;
      if (skFilterPallet && !l.pallet?.includes(skFilterPallet)) return false;
      return true;
    });
  }, [lots, skPending, skFilterDC, skFilterLoai, skFilterBoc, skFilterPallet]);

  const skLoaiOptions = useMemo(
    () => [...new Set(lots.filter((l) => normalizeLotStatus(l.trang_thai) === "Hoàn thành").map((l) => l.loai_csr))],
    [lots],
  );
  const skBocOptions = useMemo(
    () => [...new Set(skEligibleLots.map((l) => l.boc).filter(Boolean))] as string[],
    [skEligibleLots],
  );
  const skPalletOptions = useMemo(
    () => [...new Set(skEligibleLots.flatMap((l) => l.pallet || []).filter(Boolean))] as string[],
    [skEligibleLots],
  );

  //â"€â"€ Create view computed â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const nganKgMap = useMemo(() => {
    const map: Record<string, number> = {};
    contributions.forEach((c) => {
      if (c.ngan_id) {
        map[c.ngan_id] = (map[c.ngan_id] || 0) + (c.tong_kg_cua_ca || 0);
      }
    });
    return map;
  }, [contributions]);

  const bagSuggestionMap = useMemo(() => {
    const exact = new Map<string, string>();
    const byLoai = new Map<string, string>();
    const sortedLots = [...lots].sort(compareLotRecency);

    sortedLots.forEach((lot) => {
      const normalizedDc = normalizeDayChuyen(lot.day_chuyen);
      const exactKey = [normalizedDc, lot.loai_csr, Number(lot.loai_banh)].join("::");
      const loaiKey = [normalizedDc, lot.loai_csr].join("::");
      if (!exact.has(exactKey) && lot.boc) exact.set(exactKey, lot.boc);
      if (!byLoai.has(loaiKey) && lot.boc) byLoai.set(loaiKey, lot.boc);
    });

    return { exact, byLoai };
  }, [lots]);

  const getSuggestedBoc = (
    dayChuyenVal: string,
    loaiCsr: string,
    loaiBanh: number,
    fallback = "",
  ) => {
    const normalizedDc = normalizeDayChuyen(dayChuyenVal);
    const bocOptions = getBocsForLoaiCSR(dayChuyenVal, loaiCsr);
    const exactKey = [normalizedDc, loaiCsr, Number(loaiBanh)].join("::");
    const loaiKey = [normalizedDc, loaiCsr].join("::");
    const historyMatch =
      bagSuggestionMap.exact.get(exactKey) || bagSuggestionMap.byLoai.get(loaiKey) || "";

    if (historyMatch && bocOptions.includes(historyMatch)) return historyMatch;
    return bocOptions[1] || bocOptions[0] || fallback;
  };

  const latestLotByNganId = useMemo(() => {
    const map = new Map<string, Lot>();
    const sortedLots = [...lots].sort(compareLotRecency);
    sortedLots.forEach((lot) => {
      if (!lot.ngan_id || map.has(lot.ngan_id)) return;
      map.set(lot.ngan_id, lot);
    });
    return map;
  }, [lots]);

  const compareProductNgans = useCallback((a: Ngan, b: Ngan) => {
    const aInProduction = normalizeStorageStatus(a.trang_thai) === STORAGE_STATUS_IN_PRODUCTION;
    const bInProduction = normalizeStorageStatus(b.trang_thai) === STORAGE_STATUS_IN_PRODUCTION;
    if (aInProduction !== bInProduction) return aInProduction ? -1 : 1;

    const latestA = latestLotByNganId.get(a.id);
    const latestB = latestLotByNganId.get(b.id);
    if (latestA && latestB) {
      const recencyDiff = compareLotRecency(latestA, latestB);
      if (recencyDiff !== 0) return recencyDiff;
    } else if (latestA || latestB) {
      return latestA ? -1 : 1;
    }

    const aStandard = getStandardNganNumber(a);
    const bStandard = getStandardNganNumber(b);
    if (aStandard !== null && bStandard !== null) return aStandard - bStandard;
    if (aStandard !== null) return -1;
    if (bStandard !== null) return 1;
    return `${a.ten_ngan} ${a.ma_ngan}`.localeCompare(`${b.ten_ngan} ${b.ma_ngan}`, "vi");
  }, [latestLotByNganId]);

  const productNganOptions = useMemo(() => {
    const validLoaiNl = getValidLoaiNlOptions(session.day_chuyen);

    return ngans
      .filter((n) => {
        if (!validLoaiNl.includes(normalizeLoaiNl(n.loai_nl))) return false;
        if (Number(n.tong_kho || 0) <= 0) return false;
        return isProductSelectableStorageStatus(n.trang_thai);
      })
      .sort(compareProductNgans);
  }, [ngans, session.day_chuyen, compareProductNgans]);

  const filteredProductNgans = useMemo(() => {
    const query = foldText(nganManualQuery);
    if (!query) return productNganOptions;
    return productNganOptions
      .filter((n) =>
        [n.ten_ngan, n.ma_ngan, n.loai_nl].some((value) => foldText(value).includes(query)),
      )
  }, [productNganOptions, nganManualQuery]);

  const selectedNgan = ngans.find((n) => n.id === session.ngan_id);
  const suggestedNganId = productNganOptions[0]?.id || "";
  const allDorDangLots = lots.filter(
    (l) =>
      normalizeLotStatus(l.trang_thai) === "Dở dang" &&
      l.tong_banh > 0 &&
      (!filterDC ||
        normalizeDayChuyen(l.day_chuyen) === normalizeDayChuyen(filterDC)),
  );
  const createDorDangLots = lots.filter(
    (l) =>
      normalizeLotStatus(l.trang_thai) === "Dở dang" &&
      l.tong_banh > 0 &&
      normalizeDayChuyen(l.day_chuyen) === normalizeDayChuyen(session.day_chuyen),
  );
  const selectedNganDorDangLots = createDorDangLots.filter(
    (l) => l.ngan_id === session.ngan_id,
  );

  const kgDaCoTrongNgan = nganKgMap[session.ngan_id] || 0;

  const kgLanNay = useMemo(() => {
    let total = 0;
    caSections.forEach((cs) => {
      cs.blocks.forEach((block) => {
        block.lots.forEach((lot) => {
          total += getLotDraftAddedBanh(lot) * block.loai_banh;
        });
      });
    });
    return Math.round(total * 100) / 100;
  }, [caSections]);

  const kgTotal = kgDaCoTrongNgan + kgLanNay;
  const nganPct =
    selectedNgan && selectedNgan.tong_kho > 0
      ? (kgTotal / selectedNgan.tong_kho) * 100
      : 0;
  const selectedNganHasMaterial = Number(selectedNgan?.tong_kho || 0) > 0;
  const nganBlocked = nganPct > 110;
  const showMarkDoneActions = nganPct >= 100 && nganPct <= 110;
  const canSaveCurrentSession =
    Boolean(session.ngan_id) && selectedNganHasMaterial && !nganBlocked;
  const sessionTotals = useMemo(() => {
    let lots_count = 0,
      banh = 0;
    caSections.forEach((cs) => {
      cs.blocks.forEach((block) => {
        block.lots.forEach((lot) => {
          if (lot.is_already_completed) return;
          if (!lot.is_continuation) lots_count++;
          banh += getLotDraftAddedBanh(lot);
        });
      });
    });
    return { lots_count, banh };
  }, [caSections]);

  const sessionYear = normalizeLotYear(yearFromDate(session.ngay_sx));
  const jumpLotNums = useMemo(() => {
    const missing = new Set<number>();
    const plannedBySeries = new Map<string, number[]>();

    caSections.forEach((cs) => {
      cs.blocks.forEach((block) => {
        const series = {
          loai_csr: block.loai_csr,
          loai_banh: block.loai_banh,
          year: sessionYear,
        };
        const seriesKey = buildLotSeriesKey(series);
        const plannedNums = block.lots.map((lot) => lot.num).filter((num) => num > 0);
        if (!plannedNums.length) return;
        const current = plannedBySeries.get(seriesKey) || [];
        plannedBySeries.set(seriesKey, current.concat(plannedNums));
      });
    });

    plannedBySeries.forEach((plannedNums, seriesKey) => {
      const [loai_csr, loai_banh, year] = seriesKey.split("::");
      const series = {
        loai_csr,
        loai_banh: Number(loai_banh),
        year,
      };
      const existingNums = lots
        .filter((l) => isSameLotSeries(l, series))
        .map((l) => l.num)
        .filter((num) => num > 0);
      getJumpedLotNums(existingNums, plannedNums).forEach((num) => missing.add(num));
    });

    return Array.from(missing).sort((a, b) => a - b);
  }, [caSections, lots, sessionYear]);

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
          normalizeLotStatus(l.trang_thai) === "Dở dang",
      )
      .sort((a, b) => {
        if (b.ngay_sx !== a.ngay_sx) return b.ngay_sx.localeCompare(a.ngay_sx);
        return (CA_ORDER_MAP[b.ca] || 0) - (CA_ORDER_MAP[a.ca] || 0);
      })[0];

    return latestDang?.num ?? getMaxLotNum(loai_csr, loai_banh, year) + 1;
  };

  const getSectionLastDraft = (section?: CaSection) =>
    section?.blocks.at(-1)?.lots.at(-1);

  const isSameBlockSeries = (a: CaBlock, b: Pick<CaBlock, "loai_csr" | "loai_banh">) =>
    a.loai_csr === b.loai_csr && Number(a.loai_banh) === Number(b.loai_banh);

  const getPreviousBlock = (
    sections: CaSection[],
    caIdx: number,
    blockIdx: number,
  ): CaBlock | undefined => {
    if (blockIdx > 0) return sections[caIdx]?.blocks[blockIdx - 1];
    return sections[caIdx - 1]?.blocks.at(-1);
  };

  const getBlockStartPlan = (
    block: Pick<CaBlock, "loai_csr" | "loai_banh" | "from_num" | "to_num">,
    previousBlock?: CaBlock,
  ) => {
    if (!previousBlock || !isSameBlockSeries(previousBlock, block)) {
      const suggested = getSuggestedStartNum(
        block.loai_csr,
        block.loai_banh,
        sessionYear,
      );
      return {
        fromNum: block.from_num > 0 ? block.from_num : suggested,
        inheritedDraft: undefined as LotDraft | undefined,
      };
    }

    const prevLastDraft = previousBlock.lots.at(-1);
    if (normalizeLotStatus(prevLastDraft?.trang_thai) === "Dở dang") {
      return {
        fromNum: previousBlock.to_num,
        inheritedDraft: prevLastDraft,
      };
    }

    return {
      fromNum: previousBlock.to_num + 1,
      inheritedDraft: undefined as LotDraft | undefined,
    };
  };

  const regenerateBlock = (
    block: CaBlock,
    prevDraft?: LotDraft,
    currentDrafts: LotDraft[] = block.lots,
  ): CaBlock => ({
    ...block,
    loai_banh: getLoaiBanhConfig(block.loai_csr, block.loai_banh).loai_banh,
    lots: generateLotDrafts(
      block.from_num,
      block.to_num,
      session.suffix,
      block.loai_csr,
      block.loai_banh,
      lots,
      sessionYear,
      prevDraft,
      currentDrafts,
    ),
  });

  const realignFollowingBlocks = (
    sections: CaSection[],
    startCaIdx: number,
    startBlockIdx: number,
  ) => {
    return sections.reduce<CaSection[]>((acc, section, caIndex) => {
      const nextSection: CaSection = { ...section, blocks: [] };
      section.blocks.forEach((block, blockIndex) => {
        if (
          caIndex < startCaIdx ||
          (caIndex === startCaIdx && blockIndex <= startBlockIdx)
        ) {
          nextSection.blocks.push(block);
          return;
        }
        const previousBlock = getPreviousBlock([...acc, nextSection], caIndex, blockIndex);
        if (!previousBlock || !isSameBlockSeries(previousBlock, block)) {
          nextSection.blocks.push(block);
          return;
        }
        const startPlan = getBlockStartPlan(block, previousBlock);
        const shouldContinue =
          normalizeLotStatus(startPlan.inheritedDraft?.trang_thai) === "Dở dang";
        const currentFirstLot = block.lots[0];
        const needsRealign =
          block.from_num !== startPlan.fromNum ||
          (shouldContinue && !currentFirstLot?.is_continuation) ||
          (!shouldContinue && currentFirstLot?.is_continuation);

        nextSection.blocks.push(
          needsRealign
            ? regenerateBlock(
                {
                  ...block,
                  from_num: startPlan.fromNum,
                  to_num: Math.max(startPlan.fromNum, block.to_num),
                },
                startPlan.inheritedDraft,
              )
            : block,
        );
      });
      acc.push(nextSection);
      return acc;
    }, []);
  };

  // â"€â"€ Session handlers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const autoSelectNganId = (dayChuyenVal: string): string => {
    const validLoaiNl = getValidLoaiNlOptions(dayChuyenVal);
    const available = ngans
      .filter((n) => {
        if (!validLoaiNl.includes(normalizeLoaiNl(n.loai_nl))) return false;
        if (Number(n.tong_kho || 0) <= 0) return false;
        return isProductSelectableStorageStatus(n.trang_thai);
      })
      .sort(compareProductNgans);
    return available[0]?.id || "";
  };

  const updateSession = (patch: Partial<SessionHeader>) => {
    setSession((prev) => {
      const next = { ...prev, ...patch };
      if (patch.ngay_sx !== undefined) {
        next.year = normalizeLotYear(yearFromDate(patch.ngay_sx));
      }
      if (patch.day_chuyen !== undefined) {
        const csrOpts = getLoaiCSRByDayChuyen(patch.day_chuyen, factoryPrefix);
        next.loai_csr = csrOpts[0] || "";
        const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
        next.boc = getSuggestedBoc(patch.day_chuyen, next.loai_csr, next.loai_banh, next.boc);
        next.ngan_id = autoSelectNganId(patch.day_chuyen);
        next.so_ca = 2;
      }
      if (patch.loai_csr !== undefined || patch.loai_banh !== undefined) {
        const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
        next.boc = getSuggestedBoc(next.day_chuyen, next.loai_csr, next.loai_banh, next.boc);
      }
      return next;
    });
    if (
      patch.loai_csr !== undefined ||
      patch.suffix !== undefined ||
      patch.loai_banh !== undefined ||
      patch.ngay_sx !== undefined ||
      patch.year !== undefined ||
      patch.day_chuyen !== undefined
    ) {
      const newYear = normalizeLotYear(
        patch.ngay_sx ? yearFromDate(patch.ngay_sx) : patch.year ?? session.year,
        session.year,
      );
      setCaSections((prev) => {
        return prev.map((cs, ci) => {
          const prevLast = ci > 0 ? getSectionLastDraft(prev[ci - 1]) : undefined;
          return {
            ...cs,
            blocks: cs.blocks.map((block, bi) => {
              const nextBlock = { ...block };
              if (patch.day_chuyen !== undefined) {
                const csrOpts = getLoaiCSRByDayChuyen(patch.day_chuyen, factoryPrefix);
                nextBlock.loai_csr = csrOpts[0] || nextBlock.loai_csr;
                const cfg = getLoaiBanhConfig(nextBlock.loai_csr, nextBlock.loai_banh);
                nextBlock.loai_banh = cfg.loai_banh;
                nextBlock.boc = getSuggestedBoc(
                  patch.day_chuyen,
                  nextBlock.loai_csr,
                  nextBlock.loai_banh,
                  nextBlock.boc,
                );
              }
              if (
                ci === 0 &&
                bi === 0 &&
                (patch.suffix !== undefined ||
                  patch.loai_csr !== undefined ||
                  patch.loai_banh !== undefined ||
                  patch.ngay_sx !== undefined ||
                  patch.year !== undefined)
              ) {
                nextBlock.loai_csr = patch.loai_csr ?? nextBlock.loai_csr;
                nextBlock.loai_banh = patch.loai_banh ?? nextBlock.loai_banh;
                nextBlock.from_num = getSuggestedStartNum(
                  nextBlock.loai_csr,
                  nextBlock.loai_banh,
                  newYear,
                );
                nextBlock.to_num = Math.max(nextBlock.from_num, nextBlock.to_num);
              }
              const inherited =
                bi === 0 && normalizeLotStatus(prevLast?.trang_thai) === "Dở dang"
                  ? prevLast
                  : undefined;
              return regenerateBlock(nextBlock, inherited);
            }),
          };
        });
      });
    }
  };

  const updateSoCa = (so_ca: 1 | 2 | 3) => {
    setSession((prev) => ({ ...prev, so_ca }));
    const caLabels: ("A" | "B" | "C")[] = ["A", "B", "C"];
    setCaSections((prev) => {
      const next: CaSection[] = [];
      for (let i = 0; i < so_ca; i++) {
        if (prev[i]) {
          next.push(prev[i]);
          continue;
        }
        const prevSection = next[i - 1];
        const templateBlock = prevSection?.blocks.at(-1) || defaultBlock(session, getSuggestedStartNum(session.loai_csr, session.loai_banh, sessionYear));
        const previousBlock = prevSection?.blocks.at(-1);
        const startPlan = getBlockStartPlan(templateBlock, previousBlock);
        next.push({
          ca: caLabels[i],
          blocks: [
            regenerateBlock(
              {
                ...defaultBlock(templateBlock, startPlan.fromNum),
                loai_csr: templateBlock.loai_csr,
                loai_banh: templateBlock.loai_banh,
                boc: templateBlock.boc,
                tham: templateBlock.tham,
                pallet: [...templateBlock.pallet],
                from_num: startPlan.fromNum,
                to_num: Math.max(startPlan.fromNum, startPlan.fromNum),
              },
              startPlan.inheritedDraft,
            ),
          ],
        });
      }
      return next;
    });
  };

  const updateCaLabel = (idx: number, ca: "A" | "B" | "C") => {
    setCaSections((prev) =>
      prev.map((cs, i) => (i === idx ? { ...cs, ca } : cs)),
    );
  };

  const updateCaBlock = (
    caIdx: number,
    blockIdx: number,
    patch: Partial<CaBlock>,
  ) => {
    const affectsLotDrafts =
      patch.loai_csr !== undefined ||
      patch.loai_banh !== undefined ||
      patch.from_num !== undefined ||
      patch.to_num !== undefined;

    setCaSections((prev) =>
      realignFollowingBlocks(prev.map((cs, ci) => {
        if (ci !== caIdx) return cs;
        const blocks = cs.blocks.map((block, bi) => {
          if (bi !== blockIdx) return block;
          const nextBlock = {
            ...block,
            ...patch,
            pallet: patch.pallet ? [...patch.pallet] : block.pallet,
          };
          if (patch.loai_csr !== undefined || patch.loai_banh !== undefined) {
            const cfg = getLoaiBanhConfig(nextBlock.loai_csr, nextBlock.loai_banh);
            nextBlock.loai_banh = cfg.loai_banh;
          }
          const previousBlock = getPreviousBlock(prev, caIdx, blockIdx);
            if (patch.loai_csr !== undefined) {
              nextBlock.boc =
                patch.boc ??
                getSuggestedBoc(
                  session.day_chuyen,
                  nextBlock.loai_csr,
                  nextBlock.loai_banh,
                  nextBlock.boc,
                );
            }
          if (!affectsLotDrafts) {
            return nextBlock;
          }
          if (patch.loai_csr !== undefined || patch.loai_banh !== undefined) {
            const startPlan = getBlockStartPlan(nextBlock, previousBlock);
            nextBlock.from_num = startPlan.fromNum;
            nextBlock.to_num = Math.max(startPlan.fromNum, nextBlock.to_num);
            return regenerateBlock(nextBlock, startPlan.inheritedDraft, block.lots);
          }
          const inheritedDraft =
            previousBlock &&
            isSameBlockSeries(previousBlock, nextBlock) &&
            normalizeLotStatus(previousBlock.lots.at(-1)?.trang_thai) === "Dở dang" &&
            previousBlock.lots.at(-1)?.num === nextBlock.from_num
              ? previousBlock.lots.at(-1)
              : undefined;
          return regenerateBlock(nextBlock, inheritedDraft, block.lots);
        });
        return { ...cs, blocks };
      }), caIdx, blockIdx),
    );
  };

  const addCaBlock = (caIdx: number) => {
    if (nganBlocked) return;
    setCaSections((prev) =>
      prev.map((cs, ci) => {
        if (ci !== caIdx) return cs;
        const lastBlock = cs.blocks.at(-1);
        const template = lastBlock || defaultBlock(session, getSuggestedStartNum(session.loai_csr, session.loai_banh, sessionYear));
        const startPlan = getBlockStartPlan(template, lastBlock);
        const nextBlock = regenerateBlock({
          ...defaultBlock(template, startPlan.fromNum),
          loai_csr: template.loai_csr,
          loai_banh: template.loai_banh,
          boc: template.boc,
          tham: template.tham,
          pallet: [...template.pallet],
          from_num: startPlan.fromNum,
          to_num: startPlan.fromNum,
        }, startPlan.inheritedDraft);
        return { ...cs, blocks: [...cs.blocks, nextBlock] };
      }),
    );
  };

  const removeCaBlock = (caIdx: number, blockIdx: number) => {
    setCaSections((prev) =>
      realignFollowingBlocks(prev.map((cs, ci) => {
        if (ci !== caIdx || cs.blocks.length === 1) return cs;
        return { ...cs, blocks: cs.blocks.filter((_, bi) => bi !== blockIdx) };
      }), caIdx, Math.max(-1, blockIdx - 1)),
    );
  };

  // â"€â"€ Lot draft handler â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const updateLotDraft = (
    caIdx: number,
    blockIdx: number,
    lotIdx: number,
    patch: Partial<LotDraft>,
  ) => {
    setCaSections((prev) =>
      realignFollowingBlocks(prev.map((cs, ci) => {
        if (ci !== caIdx) return cs;
        return {
          ...cs,
          blocks: cs.blocks.map((block, bi) => {
            if (bi !== blockIdx) return block;
            const cfg = getLoaiBanhConfig(block.loai_csr, block.loai_banh);
            const newLots = block.lots.map((lot, li) => {
              if (li !== lotIdx) return lot;
              if (
                nganBlocked &&
                (["kien_a", "kien_b", "kien_c", "kien_d"] as const).some(
                  (key) => patch[key] !== undefined && Number(patch[key]) > lot[key],
                )
              ) {
                return lot;
              }
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
              return calcDraftTotals(next, block.loai_banh, cfg.lo_tron);
            });
            return { ...block, lots: newLots };
          }),
        };
      }), caIdx, blockIdx),
    );
  };

  // ── Sang kiện / Thay bọc handlers ────────────────────────────────
  const openSk = () => {
    setSkDone(new Set());
    setSkPending([]);
    setSkTab("sang_kien");
    setSkFilterDC(""); setSkFilterLoai(""); setSkFilterBoc(""); setSkFilterPallet("");
    setSkToBoc(""); setSkToPallet([]);
    setSkConfirm(false); setSkError(null);
    setSkOpen(true);
  };
  const closeSk = () => {
    setSkOpen(false);
    setSkConfirm(false); setSkError(null);
  };
  const skAddLot = (lot: Lot) => {
    setSkPending((prev) => [
      ...prev,
      { lot, kien_a: lot.kien_a, kien_b: lot.kien_b, kien_c: lot.kien_c, kien_d: lot.kien_d },
    ]);
  };
  const skRemoveLot = (lotId: string) => {
    setSkPending((prev) => prev.filter((p) => p.lot.id !== lotId));
  };
  const skUpdateKien = (
    lotId: string,
    field: "kien_a" | "kien_b" | "kien_c" | "kien_d",
    value: number,
  ) => {
    setSkPending((prev) =>
      prev.map((p) => {
        if (p.lot.id !== lotId) return p;
        const max = p.lot[field];
        return { ...p, [field]: Math.min(Math.max(0, value), max) };
      }),
    );
  };
  const skSetAll = (lotId: string) => {
    setSkPending((prev) =>
      prev.map((p) =>
        p.lot.id !== lotId
          ? p
          : { ...p, kien_a: p.lot.kien_a, kien_b: p.lot.kien_b, kien_c: p.lot.kien_c, kien_d: p.lot.kien_d },
      ),
    );
  };

  const handleSkSave = async () => {
    if (!factoryId || skPending.length === 0) return;
    if (skTab === "thay_boc" && !skToBoc) { setSkError("Chưa chọn bọc mới"); return; }
    if (skTab === "sang_kien" && skToPallet.length === 0) { setSkError("Chưa chọn pallet mới"); return; }

    setSkSaving(true); setSkError(null);
    try {
      const convertedIds: string[] = [];

      for (const p of skPending) {
        const { lot, kien_a, kien_b, kien_c, kien_d } = p;
        const isFullConvert =
          kien_a === lot.kien_a && kien_b === lot.kien_b &&
          kien_c === lot.kien_c && kien_d === lot.kien_d;

        const tong_banh = kien_a + kien_b + kien_c + kien_d;
        const tong_kg = Math.round(tong_banh * lot.loai_banh * 100) / 100;
        const newBoc = skTab === "thay_boc" ? skToBoc : lot.boc;
        const newPallet = skTab === "sang_kien" ? skToPallet : lot.pallet;

        const { error: e1 } = await supabase.from("lots").update({
          kien_a, kien_b, kien_c, kien_d,
          tong_banh, tong_kg,
          boc: newBoc,
          pallet: newPallet,
          updated_at: new Date().toISOString(),
        }).eq("id", lot.id);
        if (e1) { setSkError(e1.message); return; }
        convertedIds.push(lot.id);

        if (!isFullConvert) {
          const rem_a = lot.kien_a - kien_a;
          const rem_b = lot.kien_b - kien_b;
          const rem_c = lot.kien_c - kien_c;
          const rem_d = lot.kien_d - kien_d;
          const rem_banh = rem_a + rem_b + rem_c + rem_d;
          const rem_kg = Math.round(rem_banh * lot.loai_banh * 100) / 100;
          const residualSuffix = lot.suffix + "r";
          const residualMaLo = buildMaLo(lot.num, residualSuffix, lot.year);

          const { data: existing } = await supabase
            .from("lots").select("id").eq("factory_id", factoryId).eq("ma_lo", residualMaLo).single();

          if (!existing) {
            const { error: e2 } = await supabase.from("lots").insert({
              factory_id: factoryId,
              ma_lo: residualMaLo,
              num: lot.num,
              suffix: residualSuffix,
              year: lot.year,
              ngay_sx: lot.ngay_sx,
              ngay_ht: lot.ngay_ht,
              ca: lot.ca,
              ngan_id: lot.ngan_id,
              day_chuyen: lot.day_chuyen,
              loai_csr: lot.loai_csr,
              loai_banh: lot.loai_banh,
              boc: lot.boc,
              tham: lot.tham,
              pallet: lot.pallet,
              chi_thi: lot.chi_thi,
              kien_a: rem_a, kien_b: rem_b, kien_c: rem_c, kien_d: rem_d,
              tong_banh: rem_banh,
              tong_kg: rem_kg,
              trang_thai: "Hoàn thành",
              ghi_chu: `Tồn dư từ ${lot.ma_lo}`,
            });
            if (e2) { setSkError(e2.message); return; }
          }
        }
      }

      const { error: eH } = await supabase.from("sk_history").insert({
        factory_id: factoryId,
        ngay: new Date().toISOString().slice(0, 10),
        loai: skTab === "sang_kien" ? "Sang kiện" : "Thay bọc",
        chung_loai: skFilterLoai || skPending[0]?.lot.loai_csr || "",
        from_boc: skTab === "thay_boc" ? (skFilterBoc || skPending[0]?.lot.boc || null) : null,
        to_boc: skTab === "thay_boc" ? skToBoc : null,
        from_pallet: skTab === "sang_kien" ? (skFilterPallet || null) : null,
        to_pallet: skTab === "sang_kien" ? skToPallet.join(", ") : null,
        lots: skPending.map((p) => ({
          id: p.lot.id,
          ma_lo: p.lot.ma_lo,
          converted: { a: p.kien_a, b: p.kien_b, c: p.kien_c, d: p.kien_d },
        })),
      });
      if (eH) { setSkError(eH.message); return; }

      setSkDone((prev) => new Set([...prev, ...convertedIds]));
      setSkPending([]);
      setSkConfirm(false);
      void loadData(factoryId);
    } catch (e) {
      setSkError(getErrorMessage(e));
    } finally {
      setSkSaving(false);
    }
  };

  // ── Open create ──────────────────────────────────────────────────
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
      getLoaiCSRByDayChuyen(DAY_CHUYEN_TAP, factoryPrefix)[0] || `${factoryPrefix}10`;
    const cfg = getLoaiBanhConfig(defaultCsr);
    const latestDang = lots
      .filter(
        (l) =>
          l.loai_csr === defaultCsr &&
          Number(l.loai_banh) === Number(cfg.loai_banh) &&
          l.year === yrStr &&
          normalizeLotStatus(l.trang_thai) === "Dở dang",
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
      day_chuyen: DAY_CHUYEN_TAP,
      so_ca: 2,
      ngan_id: autoSelectNganId(DAY_CHUYEN_TAP),
      suffix: defaultSuffix,
      loai_csr: defaultCsr,
      loai_banh: cfg.loai_banh,
      boc:
        getSuggestedBoc(DAY_CHUYEN_TAP, defaultCsr, cfg.loai_banh),
      tham: "cũ",
      chi_thi: lastChiThi,
    pallet: ["Sắt đế gỗ"],
    ghi_chu: "",
    image_url_1: "",
      image_url_2: "",
    };
    setSession(s);
    const firstBlock = regenerateBlock({
      ...defaultBlock(s, fromNum),
      from_num: fromNum,
      to_num: fromNum,
    });
    const secondPlan = getBlockStartPlan(firstBlock, firstBlock);
    const secondBlock = regenerateBlock({
      ...defaultBlock(s, secondPlan.fromNum),
      from_num: secondPlan.fromNum,
      to_num: secondPlan.fromNum,
    }, secondPlan.inheritedDraft);
    setCaSections([
      { ca: "A", blocks: [firstBlock] },
      { ca: "B", blocks: [secondBlock] },
    ]);
    setView("create");
  };

  // â"€â"€ Save create â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const handleCreateSave = async (markNganDone: boolean) => {
    if (!factoryId || !session.ngan_id) return;
    const lotYear = normalizeLotYear(session.year, session.ngay_sx);
    if (lotYear.length !== 2) {
      setSaveError("Năm lô phải có đúng 2 chữ số.");
      return;
    }
    if (!selectedNgan || !selectedNganHasMaterial) {
      setSaveError("Chỉ được tạo thành phẩm từ ngăn đã có nguyên liệu.");
      return;
    }
    if (nganBlocked) {
      setSaveError(`Tỷ lệ thành phẩm sẽ là ${nganPct.toFixed(1)}%, vượt 110%.`);
      return;
    }
    if (markNganDone && !showMarkDoneActions) {
      setSaveError("Chỉ được đánh dấu đã sản xuất khi tỷ lệ nằm trong khoảng 100% đến 110%.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    let hasError = false;
    try {
      const year = lotYear;
      for (const cs of caSections) {
        for (const block of cs.blocks) {
          const blockCfg = getLoaiBanhConfig(block.loai_csr, block.loai_banh);
          for (const draft of block.lots) {
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
            const trang_thai = autoTrangThai(tb, blockCfg.lo_tron, "D\u1edf dang");

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
                loai_csr: block.loai_csr,
                loai_banh: block.loai_banh,
                boc: block.boc,
                tham: block.tham,
                chi_thi: session.chi_thi,
                pallet: block.pallet,
                ghi_chu: session.ghi_chu,
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
                so_kg: Math.round(added_banh * block.loai_banh * 100) / 100,
              },
            });
          }
          if (hasError) break;
        }
        if (hasError) break;
      }
    } catch (err) {
      setSaveError(getErrorMessage(err));
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
    if (normalizeLotStatus(lot.trang_thai) === "Xuất hàng") {
      setSaveError("Lô đã xuất hàng, không thể sửa.");
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
      day_chuyen: normalizeDayChuyen(lot.day_chuyen) || DAY_CHUYEN_TAP,
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

  const openEditDate = (date: string) => {
    const dateLots = lots
      .filter((lot) => lot.ngay_sx === date)
      .sort((a, b) => (CA_ORDER_MAP[a.ca] || 0) - (CA_ORDER_MAP[b.ca] || 0));
    const firstLot = dateLots[0];
    setSaveError(null);
    setDateEditHeader({
      ngay_sx: date,
      ngan_id: firstLot?.ngan_id || "",
      suffix: firstLot?.suffix || session.suffix,
      chi_thi: firstLot?.chi_thi || "",
      ghi_chu: firstLot?.ghi_chu || "",
      image_url_1: firstLot?.image_url_1 || "",
      image_url_2: firstLot?.image_url_2 || "",
    });
    setEditDateModal(date);
  };

  const handleDateHeaderSave = async () => {
    if (!factoryId || !editDateModal || !dateEditHeader) return;
    const previousDate = editDateModal;
    const nextDate = dateEditHeader.ngay_sx;
    const editableLots = lots.filter(
      (lot) =>
        lot.ngay_sx === editDateModal &&
        normalizeLotStatus(lot.trang_thai) !== "Xuất hàng",
    );
    if (editableLots.length === 0) {
      setSaveError("Không có dòng nào còn được phép sửa trong phiếu này.");
      return;
    }
    if (!dateEditHeader.ngan_id) {
      setSaveError("Vui lòng chọn ngăn sản xuất cho phiếu này.");
      return;
    }

    const nextYear = normalizeLotYear(yearFromDate(dateEditHeader.ngay_sx));
    const duplicateMaLos = editableLots
      .map((lot) => buildMaLo(lot.num, dateEditHeader.suffix, nextYear))
      .filter((maLo, idx, arr) => arr.indexOf(maLo) !== idx);
    if (duplicateMaLos.length > 0) {
      setSaveError(`Trùng mã lô sau khi đổi header: ${duplicateMaLos.join(", ")}`);
      return;
    }

    const editableLotIds = new Set(editableLots.map((lot) => lot.id));
    const targetNgan = ngans.find((item) => item.id === dateEditHeader.ngan_id);
    if (targetNgan?.tong_kho) {
      const existingKg = lots
        .filter(
          (lot) =>
            lot.ngan_id === dateEditHeader.ngan_id && !editableLotIds.has(lot.id),
        )
        .reduce((sum, lot) => sum + (lot.tong_kg || 0), 0);
      const movingKg = editableLots.reduce(
        (sum, lot) => sum + (lot.tong_kg || 0),
        0,
      );
      const projectedPct =
        ((existingKg + movingKg) / targetNgan.tong_kho) * 100;
      if (projectedPct > 110) {
        setSaveError(
          `Không thể chuyển phiếu sang ngăn này vì tỷ lệ lấp đầy sẽ là ${projectedPct.toFixed(1)}%, vượt 110%.`,
        );
        return;
      }
      }

    setSaving(true);
    setSaveError(null);
    try {
      for (const lot of editableLots) {
        const nextMaLo = buildMaLo(lot.num, dateEditHeader.suffix, nextYear);
        const duplicatedOutsideDate = lots.find(
          (item) =>
            item.id !== lot.id &&
            item.ma_lo === nextMaLo &&
            item.ngay_sx !== editDateModal,
        );
        if (duplicatedOutsideDate) {
          throw new Error(`Mã lô ${nextMaLo} đã tồn tại ở phiếu khác.`);
        }

        if ((lot.lot_transactions?.length || 0) > 0) {
          const { error: txError } = await supabase
            .from("lot_transactions")
            .update({
              ngan_id: dateEditHeader.ngan_id,
              ngay_nhap: dateEditHeader.ngay_sx,
            })
            .eq("lot_id", lot.id);
          if (txError) throw new Error(txError.message);
        }

        const { error } = await supabase
          .from("lots")
          .update({
            ma_lo: nextMaLo,
            suffix: dateEditHeader.suffix,
            year: nextYear,
            ngay_sx: dateEditHeader.ngay_sx,
            ngan_id: dateEditHeader.ngan_id,
            chi_thi: dateEditHeader.chi_thi,
            ghi_chu: dateEditHeader.ghi_chu,
            image_url_1: dateEditHeader.image_url_1 || null,
            image_url_2: dateEditHeader.image_url_2 || null,
          })
          .eq("id", lot.id);
        if (error) throw new Error(error.message);
      }

      const affectedNganIds = Array.from(
        new Set(
          editableLots
            .map((lot) => lot.ngan_id)
            .concat(dateEditHeader.ngan_id)
            .filter(Boolean) as string[],
        ),
      );
      for (const nganId of affectedNganIds) {
        await syncNganStatusAfterLotEdit(nganId);
      }

      setExpandedDates((prev) => {
        const next = prev.filter((date) => date !== previousDate);
        return nextDate && !next.includes(nextDate) ? [...next, nextDate] : next;
      });
      await loadData(factoryId);
      setEditDateModal(null);
      setDateEditHeader(null);
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
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
      const resetStatus = deriveStorageStatus({
        ngayBd: ngan.ngay_bd,
        ngayKt: ngan.ngay_kt,
        current: "",
      });
      const { error: emptyStatusError } = await supabase
        .from("ngans")
        .update({ trang_thai: resetStatus })
        .eq("id", nganId);
      if (emptyStatusError) throw new Error(emptyStatusError.message);
      return;
    }

    const pct = ngan.tong_kho > 0 ? (totalKg / ngan.tong_kho) * 100 : 0;

    if (pct < 100) {
      const { error: underStatusError } = await supabase
        .from("ngans")
        .update({ trang_thai: STORAGE_STATUS_IN_PRODUCTION })
        .eq("id", nganId);
      if (underStatusError) throw new Error(underStatusError.message);
      return;
    }

    if (pct <= 110) {
      if (ngan.trang_thai === STORAGE_STATUS_PRODUCED) {
        return;
      }
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
      const isIncreasingSameNganLoad =
        targetNganId === dbLot.ngan_id &&
        (editForm.tong_kg || 0) > (dbLot.tong_kg || 0);
      if (targetNganId && (targetNganId !== dbLot.ngan_id || isIncreasingSameNganLoad)) {
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

      const saveResult = await saveLotTransaction({
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

      const syncedSnapshot = saveResult.snapshot;

      const { error: updateError } = await supabase
        .from("lots")
        .update({
          ...editForm,
          year: lotYear,
          ma_lo: buildMaLo(editForm.num, editForm.suffix, lotYear),
          factory_id: factoryId,
          kien_a: syncedSnapshot.kien_a,
          kien_b: syncedSnapshot.kien_b,
          kien_c: syncedSnapshot.kien_c,
          kien_d: syncedSnapshot.kien_d,
          tong_banh: syncedSnapshot.tong_banh,
          tong_kg: syncedSnapshot.tong_kg,
          trang_thai: syncedSnapshot.trang_thai,
          ca: syncedSnapshot.ca || editForm.ca,
          ngan_id: syncedSnapshot.ngan_id || null,
          ngay_ht: syncedSnapshot.ngay_ht,
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
        `L\u1ed7i c\u1eadp nh\u1eadt ng\u0103n l\u01b0u: ${getErrorMessage(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAddSessionRequiredNote = async () => {
    if (!factoryId) return;
    const input = window.prompt("Nhập ghi chú mới");
    if (!input || !input.trim()) return;
    try {
      const row = await createRequiredNote(supabase, factoryId, input);
      setRequiredNotes((prev) =>
        prev.includes(row.content) ? prev : [...prev, row.content],
      );
      updateSession({ ghi_chu: row.content });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không thêm được ghi chú");
    }
  };
  const handleDelete = async (uid: string) => {
    if (!factoryId) return;

    const contribution = contributions.find((item) => item.uid === uid);
    if (!contribution) {
      setSaveError("Không tìm thấy dòng session cần xóa.");
      setDelConfirm(null);
      return;
    }

    const lot = lots.find((l) => l.id === contribution.id);
    if (!lot) {
      setSaveError("Không tìm thấy lô gốc của dòng session này.");
      setDelConfirm(null);
      return;
    }

    const transactionId = contribution?.transaction_id;
    const transactionCount = lot.lot_transactions?.length || 0;

    if (transactionId) {
      try {
        const result = await deleteLotTransaction({ transactionId });
        const affectedNganIds = Array.from(
          new Set([result?.affectedNganId, lot.ngan_id].filter(Boolean) as string[]),
        );
        for (const nganId of affectedNganIds) {
          await syncNganStatusAfterLotEdit(nganId);
        }
      } catch (err) {
        setSaveError(getErrorMessage(err));
        setDelConfirm(null);
        return;
      }
      setDelConfirm(null);
      loadData(factoryId);
      return;
    }

    if (transactionCount === 0) {
      const { error: delError } = await supabase.from("lots").delete().eq("id", contribution.id);
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
    } else {
      setSaveError("Dòng session này không có transaction_id hợp lệ để xóa riêng.");
      setDelConfirm(null);
      return;
    }

    setDelConfirm(null);
    loadData(factoryId);
  };
  const handleBulkDelete = async () => {
    const deletable = Array.from(selectedDeleteIds).filter(
      (id) => {
        const contribution = contributions.find((item) => item.uid === id);
        return !lotsBlockedByKn.includes(contribution?.id || id);
      },
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
    const ids = Array.from(
      new Set(
        Array.from(selectedDeleteIds).map((id) => {
          const contribution = contributions.find((item) => item.uid === id);
          return contribution?.id || id;
        }),
      ),
    );
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

  const blockedSelectedCount = Array.from(selectedDeleteIds).filter((id) => {
    const contribution = contributions.find((item) => item.uid === id);
    return contribution ? lotsBlockedByKn.includes(contribution.id) : false;
  }).length;

  const toggleDate = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // CREATE VIEW
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  if (view === "create") {
    const hasNgan = !!session.ngan_id;
    const displaySuffixes: SuffixItem[] =
      suffixList.length > 0
        ? suffixList
        : [
            {
              code: "cs",
              name: "Nội tuyển PEFC",
              nguon: "NT",
              chung_nhan: "PEFC CS",
            },
            { code: "m", name: "Mua ngoài", nguon: "M", chung_nhan: "" },
          ];

    const shiftSummaries = caSections.map((cs) => {
      const summary = cs.blocks.reduce(
        (acc, block) => {
          const blockBanh = block.lots.reduce((sum, lot) => sum + getLotDraftAddedBanh(lot), 0);
          if (blockBanh <= 0) return acc;

          acc.loaiBanh.push(String(block.loai_banh));
          if (block.boc) acc.bocs.push(block.boc);
          acc.pallets.push(...block.pallet);
          block.lots.forEach((lot) => {
            const addedBanh = getLotDraftAddedBanh(lot);
            acc.banh += addedBanh;
            acc.kg += addedBanh * block.loai_banh;
          });
          return acc;
        },
        { banh: 0, kg: 0, loaiBanh: [] as string[], bocs: [] as string[], pallets: [] as string[] },
      );
      const loaiBanhValues = joinUniqueValues(summary.loaiBanh);
      const bocValues = joinUniqueValues(summary.bocs);
      const palletValues = joinUniqueValues(summary.pallets);
      const detailParts = [
        formatShiftDetailLabel("Bành", loaiBanhValues),
        formatShiftDetailLabel("Bọc", bocValues),
        formatShiftDetailLabel("Pallet", palletValues),
      ].filter(Boolean);
      return {
        ...cs,
        totalBanh: summary.banh,
        totalKg: Math.round(summary.kg * 100) / 100,
        detailParts,
        footerText: detailParts.join(" · "),
        compactFooterText: detailParts.join(" / "),
      };
    });

    return (
      <div className="pb-32">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setView("list")}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-sm transition-all"
          >
            <ChevronLeft size={16} /> Quay lại
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">
              Nhập thành phẩm
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Phiếu theo ngày sản xuất, mỗi ca có thể có nhiều block lô
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">
                Dây chuyền <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {[DAY_CHUYEN_TAP, DAY_CHUYEN_NUOC].map((dc) => (
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
                Số ca <span className="text-red-500">*</span>
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
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-700 flex items-center gap-2">
                <Package size={15} className="text-emerald-600" /> Header chung
                của phiếu
              </h3>
              <p className="mt-1 text-[11px] text-slate-400">
                Phiếu theo ngày sản xuất, mỗi ca có thể có nhiều block lô
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Ngày sản xuất <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={session.ngay_sx}
                onChange={(e) => updateSession({ ngay_sx: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Năm lô tự lấy theo ngày: {sessionYear}
              </p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Hậu tố *
              </label>
              <select
                value={session.suffix}
                onChange={(e) => updateSession({ suffix: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              >
                <option value="">Trống (không hậu tố)</option>
                {displaySuffixes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Số chỉ thị
              </label>
              <input
                value={session.chi_thi}
                onChange={(e) => updateSession({ chi_thi: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 block">
                Ghi chú
              </label>
              <button
                type="button"
                onClick={() => void handleAddSessionRequiredNote()}
                className="text-xs font-bold text-amber-700 hover:text-amber-800"
              >
                + Thêm ghi chú mới
              </button>
            </div>
            <input
              list="product-session-required-notes"
              value={session.ghi_chu}
              onChange={(e) => updateSession({ ghi_chu: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
            />
            <datalist id="product-session-required-notes">
              {requiredNotes.map((note) => (
                <option key={note} value={note} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InventoryImageUpload
              factoryId={factoryId}
              bucket="product-files"
              documentType="lots"
              label="Hình ảnh 1"
              value={session.image_url_1}
              onChange={(url) => updateSession({ image_url_1: url })}
            />
            <InventoryImageUpload
              factoryId={factoryId}
              bucket="product-files"
              documentType="lots"
              label="Hình ảnh 2"
              value={session.image_url_2}
              onChange={(url) => updateSession({ image_url_2: url })}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                  <Warehouse size={15} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-700">
                      Ngăn lưu
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">
                      {selectedNgan?.ten_ngan || "Chưa chọn ngăn"}
                    </span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-extrabold text-slate-600">
                      {selectedNgan?.ma_ngan || "Chưa có mã ngăn"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Quick pick dải N1-N24. Các mã ngoài dải chuẩn như BN, 10.2, MN chọn ở ô tìm bên dưới.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNganPickerCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
              >
                {nganPickerCollapsed ? (
                  <>
                    <ChevronRight size={14} /> Mở ngăn
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} /> Thu gọn
                  </>
                )}
              </button>
            </div>

            {!nganPickerCollapsed && (
              <div className="mt-3 space-y-3">
                {hasNgan && createDorDangLots.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
                      <AlertTriangle size={13} className="text-amber-600" />
                      Lô dở dang cần hoàn thành ({createDorDangLots.length} lô)
                    </div>
                    {session.ngan_id && selectedNganDorDangLots.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Ngăn đang chọn còn {selectedNganDorDangLots.length} lô dở dang.
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {createDorDangLots.map((l) => (
                        <span
                          key={l.id}
                          className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700"
                        >
                          {l.ma_lo} · {l.tong_banh} bành
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {hasNgan && jumpLotNums.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-rose-700">
                      <AlertTriangle size={13} className="text-rose-600" />
                      Cảnh báo nhảy lô ({jumpLotNums.length} số còn trống)
                    </div>
                    <p className="mt-1 text-[11px] text-rose-600">
                      Các block cùng series phải dùng dãy số liên tục.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {jumpLotNums.map((num) => (
                        <span
                          key={num}
                          className="rounded-lg bg-rose-100 px-2 py-1 text-[11px] font-bold text-rose-700"
                        >
                          {buildMaLo(num, session.suffix, sessionYear)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {productNganOptions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-slate-400">
                    <Warehouse size={24} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Không có ngăn lưu phù hợp</p>
                    <p className="mt-1 text-xs">
                      Chỉ hiện ngăn ở trạng thái Chờ sản xuất hoặc Đang sản xuất và đã có nguyên liệu.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                            Danh sách ngăn sản xuất
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            Các mã `N1-N24` và mã nhập tay đều hiển thị chung trong một danh sách.
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          {filteredProductNgans.length}/{productNganOptions.length} ngăn
                        </span>
                      </div>
                      <div className="relative">
                        <Search
                          size={14}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          value={nganManualQuery}
                          onChange={(e) => setNganManualQuery(e.target.value)}
                          placeholder="Tìm theo mã ngăn hoặc loại nguyên liệu"
                          className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                        {filteredProductNgans.length > 0 ? (
                          filteredProductNgans.map((n) => {
                            const kgUsed = nganKgMap[n.id] || 0;
                            const selected = session.ngan_id === n.id;
                            const isSuggested = n.id === suggestedNganId;
                            const latestLot = latestLotByNganId.get(n.id);
                            return (
                              <button
                                key={n.id}
                                type="button"
                                onClick={() => setSession((s) => ({ ...s, ngan_id: n.id }))}
                                className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                                  selected
                                    ? "border-teal-500 bg-teal-50"
                                    : "border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-white"
                                }`}
                              >
                                <div className="truncate text-xs font-extrabold text-slate-800">
                                  {n.ma_ngan || n.ten_ngan}
                                </div>
                                {isSuggested && (
                                  <div className="mt-1">
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                                      Gợi ý gần nhất
                                    </span>
                                  </div>
                                )}
                                <div className="mt-0.5 truncate text-[10px] text-slate-500">
                                  {n.ten_ngan} · {n.trang_thai} · Còn {fmtKg(Math.max(n.tong_kho - kgUsed, 0))}
                                </div>
                                {latestLot && (
                                  <div className="mt-0.5 truncate text-[10px] text-slate-400">
                                    TP gần nhất: {new Date(`${latestLot.ngay_sx}T00:00:00`).toLocaleDateString("vi-VN")} · Ca {latestLot.ca}
                                  </div>
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <p className="col-span-full text-[11px] text-slate-400">
                            {nganManualQuery.trim()
                              ? "Không tìm thấy ngăn phù hợp với từ khóa hiện tại."
                              : "Không có ngăn nào thỏa điều kiện hiển thị."}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {hasNgan &&
          shiftSummaries.map((cs, caIdx) => (
            <div
              key={`${cs.ca}-${caIdx}`}
              className="bg-white rounded-2xl border border-slate-200 shadow-md mb-4 overflow-hidden"
            >
              <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-5 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-extrabold text-blue-700">Ca</span>
                <select
                  value={cs.ca}
                  onChange={(e) =>
                    updateCaLabel(caIdx, e.target.value as "A" | "B" | "C")
                  }
                  className="px-3 py-1.5 border border-blue-200 rounded-xl text-sm font-bold text-blue-700 bg-white outline-none focus:border-blue-400"
                >
                  {CA_OPTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-bold text-slate-600">
                  {cs.totalBanh} bành · {fmtKg(cs.totalKg)}
                </span>
                {cs.footerText && (
                  <span className="text-xs font-semibold text-slate-500">
                    {cs.footerText}
                  </span>
                )}
                <button
                  onClick={() => addCaBlock(caIdx)}
                  disabled={nganBlocked}
                  className="ml-auto px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Thêm lô mới trong ca
                </button>
              </div>

              <div className="p-5 space-y-4">
                {cs.blocks.map((block, blockIdx) => {
                  const cfg = getLoaiBanhConfig(block.loai_csr, block.loai_banh);
                  const blockBanh = block.lots.reduce(
                    (sum, lot) => sum + getLotDraftAddedBanh(lot),
                    0,
                  );
                  const blockKg = Math.round(blockBanh * block.loai_banh * 100) / 100;
                  const banhOpts = getLoaiBanhOptions(block.loai_csr);
                  const bocOpts = getBocsForLoaiCSR(session.day_chuyen, block.loai_csr);
                  const firstLot = block.lots[0];
                  const lastLot = block.lots.at(-1);
                  const middleLots = block.lots.filter((lot) => lot.role === "giua");
                  const middleCount = middleLots.length;
                  const middleKg = Math.round(middleCount * cfg.lo_tron * block.loai_banh * 100) / 100;

                  return (
                    <div
                      key={block.id}
                      className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                          <div className="text-sm font-extrabold text-slate-700">
                            Block lô {blockIdx + 1}
                          </div>
                          <div className="text-xs text-slate-400">
                            {buildMaLo(block.from_num, session.suffix, sessionYear)} →{" "}
                            {buildMaLo(block.to_num, session.suffix, sessionYear)}
                          </div>
                        </div>
                        {cs.blocks.length > 1 && (
                          <button
                            onClick={() => removeCaBlock(caIdx, blockIdx)}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl"
                          >
                            Xóa block
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Loại CSR
                          </label>
                          <select
                            value={block.loai_csr}
                            onChange={(e) =>
                              updateCaBlock(caIdx, blockIdx, { loai_csr: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                          >
                            {getLoaiCSRByDayChuyen(session.day_chuyen, factoryPrefix).map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Bành
                          </label>
                          {banhOpts.length > 1 ? (
                            <select
                              value={block.loai_banh}
                              onChange={(e) =>
                                updateCaBlock(caIdx, blockIdx, { loai_banh: Number(e.target.value) })
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
                              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-100 text-slate-500"
                            />
                          )}
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Bọc
                          </label>
                          <select
                            value={block.boc}
                            onChange={(e) =>
                              updateCaBlock(caIdx, blockIdx, { boc: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                          >
                            {bocOpts.map((b) => (
                              <option key={b}>{b}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Thảm
                          </label>
                          <select
                            value={block.tham}
                            onChange={(e) =>
                              updateCaBlock(caIdx, blockIdx, { tham: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                          >
                            {THAM_OPTS.map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="mb-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="font-extrabold text-slate-600">Khoảng lô:</span>
                          <span className="text-slate-400">Từ lô</span>
                          <input
                            type="number"
                            min={1}
                            value={block.from_num}
                            onChange={(e) => {
                              const rawValue = Math.max(1, Number(e.target.value) || 1);
                              const nextFrom = nganBlocked
                                ? Math.max(block.from_num, rawValue)
                                : rawValue;
                              updateCaBlock(caIdx, blockIdx, {
                                from_num: nextFrom,
                                to_num: Math.max(block.to_num, nextFrom),
                              });
                            }}
                            className="w-36 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-center text-[22px] font-extrabold leading-none text-slate-800 outline-none focus:border-emerald-500"
                          />
                          <span className="text-slate-400">Đến lô</span>
                          <input
                            type="number"
                            min={block.from_num}
                            value={block.to_num}
                            onChange={(e) => {
                              const rawValue = Math.max(
                                block.from_num,
                                Number(e.target.value) || block.from_num,
                              );
                              const nextTo = nganBlocked
                                ? Math.min(block.to_num, rawValue)
                                : rawValue;
                              updateCaBlock(caIdx, blockIdx, { to_num: nextTo });
                            }}
                            className="w-36 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-center text-[22px] font-extrabold leading-none text-slate-800 outline-none focus:border-emerald-500"
                          />
                          <span className="font-extrabold text-slate-500">
                            {session.suffix}/{sessionYear}
                          </span>
                          <span className="text-xs font-semibold italic text-slate-400">
                            (gần nhất: {buildMaLo(block.from_num, session.suffix, sessionYear)})
                          </span>
                          <span className="ml-auto rounded-full bg-indigo-100 px-3 py-1 text-sm font-extrabold text-indigo-600">
                            {block.lots.length} lô
                          </span>
                        </div>
                      </div>

                      <div className="mb-3">
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">
                          Pallet
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {PALLET_OPTS.map((p) => {
                            const checked = block.pallet.includes(p);
                            return (
                              <button
                                key={p}
                                onClick={() =>
                                  updateCaBlock(caIdx, blockIdx, {
                                    pallet: checked
                                      ? block.pallet.filter((x) => x !== p)
                                      : [...block.pallet, p],
                                  })
                                }
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                                  checked
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 text-slate-500"
                                }`}
                              >
                                {checked ? "✓ " : ""}
                                {p}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-4">
                        {([
                          firstLot,
                          middleCount > 0 ? "middle" : null,
                          lastLot && lastLot.num !== firstLot?.num ? lastLot : null,
                        ] satisfies Array<LotDraft | "middle" | null>).map((entry, sectionIdx) => {
                          if (!entry) return null;
                          if (entry === "middle") {
                            return (
                              <div
                                key={`${block.id}-middle`}
                                className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3.5"
                              >
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                                      Lô giữa: {buildMaLo(block.from_num + 1, session.suffix, sessionYear)} →{" "}
                                      {buildMaLo(block.to_num - 1, session.suffix, sessionYear)}
                                    </span>
                                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-extrabold text-slate-500">
                                      {middleCount} lô tròn
                                    </span>
                                  </div>
                                  <div className="text-xs font-extrabold text-slate-500">
                                    {middleCount} × {cfg.lo_tron} bành = {fmtKg(middleKg)}
                                  </div>
                                </div>
                                <div className="grid gap-2.5 md:grid-cols-4">
                                  {(["A", "B", "C", "D"] as const).map((label) => (
                                    <div
                                      key={label}
                                      className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center"
                                    >
                                      <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">Kiện {label}</div>
                                      <div className="mt-1 text-[18px] font-extrabold leading-none text-emerald-700">
                                        {cfg.max_per_kien}
                                      </div>
                                      <div className="mt-1 text-[11px] font-bold text-emerald-600">
                                        {fmtKg(cfg.max_per_kien * block.loai_banh)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          }

                          const lot = entry;
                          const lotIdx = block.lots.findIndex((candidate) => candidate.num === lot.num);

                          const kienKeys = ["kien_a", "kien_b", "kien_c", "kien_d"] as const;
                          const lotMode = getLotDraftMode(lot);
                          const tone = getLotSectionTone(lot);
                          const isReadOnlyLot = lot.is_already_completed;
                          return (
                            <div
                              key={`${block.id}-${lot.num}-${sectionIdx}`}
                              className={`rounded-[22px] border px-3.5 py-3 ${tone.wrap}`}
                            >
                              <div className="mb-2.5 flex items-start justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                                    {buildMaLo(lot.num, session.suffix, sessionYear)}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-300">·</span>
                                  <span className="text-xs font-semibold text-slate-400">
                                    {getLotRoleLabel(lot.role)}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-300">·</span>
                                  <span className="text-xs font-semibold text-slate-400">
                                    {lotMode}
                                  </span>
                                  {lot.is_continuation && (
                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tone.badge}`}>
                                      Kế thừa ca trước
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-right">
                                  <span className="text-xs text-slate-500">
                                    Tổng: <strong className="font-extrabold text-emerald-600">{lot.tong_banh} bành</strong>
                                  </span>
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tone.status}`}>
                                    {normalizeLotStatus(lot.trang_thai)}
                                  </span>
                                </div>
                              </div>

                              <div className="grid gap-2.5 md:grid-cols-4">
                                {kienKeys.map((key, keyIdx) => {
                                  const prevValue = [lot.prev_a, lot.prev_b, lot.prev_c, lot.prev_d][keyIdx];
                                  const locked = [lot.locked_a, lot.locked_b, lot.locked_c, lot.locked_d][keyIdx];
                                  const rawValue = lot[key];
                                  const shownValue =
                                    lot.is_continuation && !locked
                                      ? Math.max(0, rawValue - prevValue)
                                      : rawValue;
                                  const fieldDisabled =
                                    isReadOnlyLot || (lot.is_continuation && locked);
                                  return (
                                    <div key={key} className="relative rounded-[18px] border border-black/5 bg-white/70 px-2.5 py-2 text-center">
                                      {!fieldDisabled && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateLotDraft(caIdx, blockIdx, lotIdx, {
                                              [key]: lot.is_continuation ? prevValue : 0,
                                            } as Partial<LotDraft>)
                                          }
                                          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-500 transition hover:bg-rose-100 hover:text-rose-600"
                                          aria-label={`Reset kiện ${["A", "B", "C", "D"][keyIdx]}`}
                                        >
                                          <X size={12} />
                                        </button>
                                      )}
                                      <div className="mb-1.5 flex items-center justify-start gap-2">
                                        <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">
                                          {["A", "B", "C", "D"][keyIdx]}
                                        </span>
                                      </div>
                                      <input
                                        type="number"
                                        min={0}
                                        max={lot.is_continuation && !locked ? cfg.max_per_kien - prevValue : cfg.max_per_kien}
                                        disabled={fieldDisabled}
                                        value={shownValue}
                                        onChange={(e) => {
                                          const nextValue = Number(e.target.value) || 0;
                                          updateLotDraft(caIdx, blockIdx, lotIdx, {
                                            [key]:
                                              lot.is_continuation && !locked
                                                ? prevValue + nextValue
                                                : nextValue,
                                          } as Partial<LotDraft>);
                                        }}
                                        className={`w-full rounded-2xl border px-3 py-2 text-center text-[18px] font-extrabold leading-none outline-none disabled:cursor-not-allowed ${tone.input}`}
                                      />
                                      {lot.is_continuation && (
                                        <div className={`mt-2 rounded-xl border px-2 py-1.5 text-left text-[11px] font-bold ${tone.warning}`}>
                                          <div>Ca trước đã làm {prevValue} bành</div>
                                          <div>{fmtKg(prevValue * block.loai_banh)}</div>
                                        </div>
                                      )}
                                      <div className={`mt-1 text-[11px] font-bold ${tone.meta}`}>
                                        {lot.is_continuation
                                          ? locked
                                            ? "Đã đủ từ ca trước · khóa"
                                            : `Ca này thêm ${shownValue} bành`
                                          : fmtKg(rawValue * block.loai_banh)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="mt-2.5 text-right text-[11px] font-bold text-slate-400">
                                {fmtKg(lot.tong_kg)} · {lot.tong_banh} bành
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-bold">
                          {block.lots.length} lô
                        </span>
                        <span>{blockBanh} bành</span>
                        <span>·</span>
                        <span>{fmtKg(blockKg)}</span>
                      </div>
                    </div>
                  );
                })}

                <div className="mt-3 flex items-center flex-wrap gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                  <span className="text-xs font-extrabold text-blue-700">
                    Tổng Ca {cs.ca}:
                  </span>
                  <span className="text-sm font-extrabold text-blue-800">
                    {cs.totalBanh} bành
                  </span>
                  <span className="text-xs text-blue-400">·</span>
                  <span className="text-sm font-extrabold text-blue-800">
                    {Math.round(cs.totalKg).toLocaleString("vi-VN")} kg
                  </span>
                  {cs.footerText && (
                    <>
                      <span className="text-xs text-blue-400">·</span>
                      <span className="text-xs font-bold text-blue-700">
                        {cs.footerText}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

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
                  Ngăn {selectedNgan.ten_ngan}
                </span>
                <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      nganBlocked ? "bg-red-500" : nganPct >= 100 ? "bg-amber-400" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(nganPct, 100)}%` }}
                  />
                </div>
                <span
                  className={`text-xs font-extrabold shrink-0 ${
                    nganBlocked ? "text-red-600" : nganPct >= 100 ? "text-amber-600" : "text-emerald-600"
                  }`}
                >
                  {nganPct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {fmtKg(kgDaCoTrongNgan)}
                  {kgLanNay > 0 ? ` + ${fmtKg(kgLanNay)}` : ""} /{" "}
                  {fmtKg(selectedNgan.tong_kho)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  {new Date(session.ngay_sx + "T00:00:00").toLocaleDateString("vi-VN")}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  Hậu tố: {session.suffix || "Trống"}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  CT: {session.chi_thi || "-"}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap max-w-[220px] truncate">
                  {session.ghi_chu || "Không ghi chú"}
                </span>
                <span className="text-slate-300 text-xs">|</span>
                {shiftSummaries.map((cs, idx) =>
                  cs.totalKg > 0 ? (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[11px] font-bold rounded-full whitespace-nowrap"
                    >
                      Ca {cs.ca}: {Math.round(cs.totalKg).toLocaleString("vi-VN")} kg
                      {cs.compactFooterText ? ` / ${cs.compactFooterText}` : ""}
                    </span>
                  ) : null,
                )}
                {kgLanNay > 0 && (
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-extrabold rounded-full whitespace-nowrap">
                    Tổng: {Math.round(kgLanNay).toLocaleString("vi-VN")} kg
                  </span>
                )}
                <div className="ml-auto flex gap-2 shrink-0">
                  <button
                    onClick={() => setView("list")}
                    className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    Hủy
                  </button>
                    <button
                      onClick={() => handleCreateSave(false)}
                      disabled={saving || !canSaveCurrentSession}
                      className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                    >
                    {saving
                      ? "Đang lưu..."
                      : `Lưu ${sessionTotals.banh > 0 ? `${sessionTotals.banh} bành` : "phiếu"}`}
                  </button>
                  {showMarkDoneActions && (
                    <button
                      onClick={() => handleCreateSave(true)}
                      disabled={saving || !canSaveCurrentSession}
                      className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                    >
                      {saving ? "Đang lưu..." : "Lưu & đánh dấu đã sản xuất"}
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
                Hủy
              </button>
              <button
                disabled
                className="px-5 py-2 bg-slate-300 text-white text-sm font-bold rounded-xl cursor-not-allowed"
              >
                Chọn ngăn lưu trước
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
          <h1 className="text-2xl font-extrabold text-slate-800">Thành phẩm</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý lô và phân tách sản lượng theo ca
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSk}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md transition-all btn-press"
          >
            <ArrowLeftRight size={16} /> Sang kiện / Thay bọc
          </button>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press"
          >
            <Plus size={16} /> Thêm lô
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        {(
          [
            {
              label: "Tổng lô",
              value: stats.total,
              color: "text-slate-700",
              Icon: Package,
              ic: "text-slate-400",
            },
            {
              label: "Hoàn thành",
              value: stats.hoanThanh,
              color: "text-emerald-600",
              Icon: CheckCircle,
              ic: "text-emerald-400",
            },
            {
              label: "Dở dang",
              value: stats.dorDang,
              color: "text-amber-600",
              Icon: Clock,
              ic: "text-amber-400",
            },
            {
              label: "Tổng bành (lọc)",
              value: stats.tongBanh.toLocaleString("vi-VN"),
              color: "text-blue-600",
              Icon: Layers,
              ic: "text-blue-400",
            },
            {
              label: "Tổng tấn (lọc)",
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
                    {l.ma_lo} · {l.tong_banh} bành
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
            placeholder="Tìm mã lô, ngăn..."
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
          <option value="">Tất cả dây chuyền</option>
          <option value={DAY_CHUYEN_TAP}>{DAY_CHUYEN_TAP}</option>
          <option value={DAY_CHUYEN_NUOC}>{DAY_CHUYEN_NUOC}</option>
        </select>
        <select
          value={filterLoai}
          onChange={(e) => {
            setFilterLoai(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Tất cả loại</option>
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
            "Ngoại lệ",
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
          <option value="">Tất cả trạng thái</option>
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
          <option value="">Tất cả ca</option>
          {CA_OPTS.map((c) => (
            <option key={c} value={c}>
              Ca {c}
            </option>
          ))}
        </select>
        <select
          value={filterGhiChu}
          onChange={(e) => {
            setFilterGhiChu(e.target.value);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
        >
          <option value="">Tất cả ghi chú</option>
          <option value={EMPTY_NOTE_FILTER}>Không có ghi chú</option>
          {requiredNotes.map((note) => (
            <option key={note} value={note}>
              {note}
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
        <span className="text-slate-400 text-sm">→</span>
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
          filterGhiChu ||
          filterFrom ||
          filterTo ||
          search ||
          filterDC) && (
          <button
            onClick={() => {
              setFilterLoai("");
              setFilterTT("");
              setFilterCa("");
              setFilterGhiChu("");
              setFilterFrom("");
              setFilterTo("");
              setSearch("");
              setFilterDC("");
            }}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500"
          >
            <X size={14} /> Xóa lọc
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
                      {date !== "Chưa có ngày"
                        ? new Date(date).toLocaleDateString("vi-VN")
                        : date}
                    </span>
                    <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-500 text-xs font-bold rounded-full">
                      {Object.values(dateGroups).flat().length} lần nhập
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4 text-sm font-bold text-slate-600">
                      <span>{dayBanh.toLocaleString("vi-VN")} bành</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-emerald-700">{fmtKg(dayKg)}</span>
                    </div>
                    {deleteMode === date ? (
                      <>
                        <span className="text-xs text-red-600 font-bold shrink-0">
                          Chọn dòng cần xóa...
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
                            ? "Đang kiểm tra..."
                            : `Xóa ${selectedDeleteIds.size} dòng`}
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
                          Hủy
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
                          title="Thêm ca sản xuất cho ngày này"
                        >
                          <Plus size={12} /> Thêm
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDate(date);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                          title="Sửa lô trong ngày này"
                        >
                          <Edit2 size={12} /> Sửa
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteMode(date);
                            setSelectedDeleteIds(new Set());
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors shrink-0"
                          title="Xóa lô trong ngày này"
                        >
                          <Trash2 size={12} /> Xóa
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
                                {caBanh.toLocaleString("vi-VN")} bành ·{" "}
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
                                      Mã lô
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Ngăn
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Loại
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Bọc
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      SL thực tế ca này
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Kiện (A/B/C/D) thời điểm
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Trạng thái
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {caContribs.map((c) => (
                                    <tr
                                      key={c.uid}
                                      className={`hover:bg-slate-50 transition-colors ${deleteMode === date && selectedDeleteIds.has(c.uid) ? "bg-red-50" : ""}`}
                                    >
                                      {deleteMode === date && (
                                        <td className="px-3 py-2.5">
                                          <input
                                            type="checkbox"
                                            checked={selectedDeleteIds.has(
                                              c.uid,
                                            )}
                                            onChange={() =>
                                              setSelectedDeleteIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(c.uid)) {
                                                  next.delete(c.uid);
                                                } else {
                                                  next.add(c.uid);
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
                                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getLotStatusBadgeClass(c.trang_thai)}`}
                                        >
                                          {normalizeLotStatus(c.trang_thai)}
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
            <p>Không có dữ liệu phù hợp</p>
          </div>
        )}
      </div>

      {editModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                Sửa lô {editForm.ma_lo}
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
                  <strong>Lưu ý:</strong> Header chung như ngày SX, hậu tố, ngăn
                  và ghi chú được sửa ở modal theo ngày. Màn này chỉ sửa chi tiết
                  riêng của từng lô.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  Dây chuyền *
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

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Số lô *
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
                    Mã lô
                  </label>
                  <input
                    readOnly
                    value={editForm.ma_lo}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Năm lô
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
                    Loại CSR *
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

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loại bành
                  </label>
                  <input
                    readOnly
                    value={`${editForm.loai_banh} kg/bành`}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loại bọc
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
                    Thảm
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
                        Số bành kiện (A / B / C / D)
                      </label>
                      <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold">
                        Max {maxK} bành · Lô tròn = {cfg2.lo_tron} bành
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
                                  🔒
                                </span>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span>
                        Tổng bành:{" "}
                        <strong className="text-slate-700">
                          {editForm.tong_banh}
                        </strong>
                      </span>
                      <span>
                        Tổng kg:{" "}
                        <strong className="text-slate-700">
                          {editForm.tong_kg.toLocaleString()}
                        </strong>
                      </span>
                      <span>
                        Trạng thái:{" "}
                        <strong
                          className={normalizeLotStatus(editForm.trang_thai) === "Hoàn thành"
                            ? "text-emerald-600"
                            : "text-amber-600"}
                        >
                          {normalizeLotStatus(editForm.trang_thai)}
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })()}

            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => setEditModal(false)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
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
                      Sửa ngày{" "}
                      {new Date(editDateModal).toLocaleDateString("vi-VN")}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Sửa header chung của phiếu. Phần chi tiết từng lô chỉ còn
                      số lô, ca, loại và số bành.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditDateModal(null);
                      setDateEditHeader(null);
                    }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={18} className="text-slate-500" />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {dateEditHeader && (
                    <div className="p-6 border-b border-slate-100 space-y-4 bg-slate-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid flex-1 grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold text-slate-600 block mb-1.5">
                              Ngày sản xuất
                            </label>
                            <input
                              type="date"
                              value={dateEditHeader.ngay_sx}
                              onChange={(e) =>
                                setDateEditHeader((prev) =>
                                  prev ? { ...prev, ngay_sx: e.target.value } : prev,
                                )
                              }
                              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-600 block mb-1.5">
                              Ngăn sản xuất *
                            </label>
                            <select
                              value={dateEditHeader.ngan_id}
                              onChange={(e) =>
                                setDateEditHeader((prev) =>
                                  prev ? { ...prev, ngan_id: e.target.value } : prev,
                                )
                              }
                              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                            >
                              <option value="">-- Chọn ngăn --</option>
                              {productNganOptions.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.ten_ngan} - {n.ma_ngan}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => void handleDateHeaderSave()}
                          disabled={saving}
                          className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50"
                        >
                          {saving ? "Đang lưu..." : "Lưu thay đổi"}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Hậu tố
                          </label>
                          <select
                            value={dateEditHeader.suffix}
                            onChange={(e) =>
                              setDateEditHeader((prev) =>
                                prev ? { ...prev, suffix: e.target.value } : prev,
                              )
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                          >
                            <option value="">Trống</option>
                            {suffixList.map((s) => (
                              <option key={s.code} value={s.code}>
                                {s.code} - {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 block mb-1.5">
                            Số chỉ thị
                          </label>
                          <input
                            value={dateEditHeader.chi_thi}
                            onChange={(e) =>
                              setDateEditHeader((prev) =>
                                prev ? { ...prev, chi_thi: e.target.value } : prev,
                              )
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">
                          Ghi chú
                        </label>
                        <input
                          value={dateEditHeader.ghi_chu}
                          onChange={(e) =>
                            setDateEditHeader((prev) =>
                              prev ? { ...prev, ghi_chu: e.target.value } : prev,
                            )
                          }
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <InventoryImageUpload
                          factoryId={factoryId}
                          bucket="product-files"
                          documentType="lots"
                          label="Hình ảnh 1"
                          value={dateEditHeader.image_url_1}
                          onChange={(url) =>
                            setDateEditHeader((prev) =>
                              prev ? { ...prev, image_url_1: url } : prev,
                            )
                          }
                        />
                        <InventoryImageUpload
                          factoryId={factoryId}
                          bucket="product-files"
                          documentType="lots"
                          label="Hình ảnh 2"
                          value={dateEditHeader.image_url_2}
                          onChange={(url) =>
                            setDateEditHeader((prev) =>
                              prev ? { ...prev, image_url_2: url } : prev,
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
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
                            bành
                          </span>
                        </div>
                        {grouped[ca].map((c) => {
                          const lot = lots.find((l) => l.id === c.id);
                          const latestTransactionId =
                            lot?.lot_transactions?.[lot.lot_transactions.length - 1]?.id;
                          const isLatestContribution =
                            !c.transaction_id || c.transaction_id === latestTransactionId;
                          const isExported =
                            normalizeLotStatus(c.trang_thai) === "Xuất hàng";
                          const canEdit =
                            isLatestContribution &&
                            !isExported;
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
                                  +{c.tong_banh_cua_ca} bành ·{" "}
                                  {fmtKg(c.tong_kg_cua_ca)}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${getLotStatusBadgeClass(c.trang_thai)}`}
                                >
                                  {normalizeLotStatus(c.trang_thai)}
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
                                  <Edit2 size={12} /> Sửa lô
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400 shrink-0">
                                  {isExported ? "Đã xuất hàng" : "Chỉ sửa dòng cuối"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  {dateLots.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      Không có lô nào
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
              Xác nhận xóa?
            </h3>
            {lotsBlockedByKn.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-bold text-amber-700">
                  {lotsBlockedByKn.length} lô đã có phiếu KN - sẽ không được
                  xóa:
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
                ? blockedSelectedCount === selectedDeleteIds.size
                  ? "Tất cả dòng đã chọn đều có phiếu KN, không thể xóa."
                  : blockedSelectedCount > 0
                    ? `${selectedDeleteIds.size - blockedSelectedCount} dòng chưa có KN sẽ bị xóa vĩnh viễn.`
                    : `${selectedDeleteIds.size} dòng đã chọn sẽ bị xóa vĩnh viễn.`
                : "Dòng này sẽ bị xóa vĩnh viễn."}{" "}
              {(delConfirm !== "bulk" ||
                blockedSelectedCount < selectedDeleteIds.size) &&
                "Ngăn lưu liên quan sẽ được cập nhật trạng thái tự động."}
            </p>
            <div className="flex gap-3">
              {delConfirm === "bulk" &&
              blockedSelectedCount === selectedDeleteIds.size ? (
                <button
                  onClick={() => {
                    setDelConfirm(null);
                    setLotsBlockedByKn([]);
                  }}
                  className="w-full py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Đóng
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setDelConfirm(null)}
                    className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={() =>
                      delConfirm === "bulk"
                        ? handleBulkDelete()
                        : handleDelete(delConfirm)
                    }
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md"
                  >
                    Xóa
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          OVERLAY: Sang kiện / Thay bọc
          ════════════════════════════════════════════════════════════ */}
      {skOpen && (() => {
        // Tính boc options cho "Bọc mới" dropdown
        const inferred_dc = skFilterLoai
          ? (["L","3L","CV50","CV60"].some((s) => skFilterLoai.includes(s)) ? DAY_CHUYEN_NUOC : DAY_CHUYEN_TAP)
          : "";
        const newBocOpts = skFilterLoai
          ? getBocsForLoaiCSR(inferred_dc, skFilterLoai)
          : skBocOptions;

        const totalConvertBanh = skPending.reduce(
          (s, p) => s + p.kien_a + p.kien_b + p.kien_c + p.kien_d,
          0,
        );
        const hasPartial = skPending.some(
          (p) =>
            p.kien_a !== p.lot.kien_a ||
            p.kien_b !== p.lot.kien_b ||
            p.kien_c !== p.lot.kien_c ||
            p.kien_d !== p.lot.kien_d,
        );

        const canConfirm =
          skPending.length > 0 &&
          (skTab === "thay_boc" ? !!skToBoc : skToPallet.length > 0);

        return (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
            <div className="w-full max-w-5xl bg-white flex flex-col shadow-2xl overflow-hidden relative">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-3">
                  <ArrowLeftRight size={18} className="text-violet-600" />
                  <h2 className="text-lg font-extrabold text-slate-800">Sang kiện / Thay bọc</h2>
                  {skPending.length > 0 && (
                    <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-bold rounded-full">
                      {skPending.length} lô đang xử lý
                    </span>
                  )}
                </div>
                <button
                  onClick={closeSk}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X size={18} className="text-slate-500" />
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">

                {/* ── PANEL TRÁI ─────────────────────────────────── */}
                <div className="flex flex-col border-r border-slate-200 overflow-hidden" style={{ width: "60%" }}>

                  {/* Filter bar */}
                  <div className="p-3 border-b border-slate-100 flex flex-wrap gap-2 items-center shrink-0">
                    <select
                      value={skFilterDC}
                      onChange={(e) => setSkFilterDC(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400"
                    >
                      <option value="">Tất cả dây chuyền</option>
                      <option value={DAY_CHUYEN_TAP}>{DAY_CHUYEN_TAP}</option>
                      <option value={DAY_CHUYEN_NUOC}>{DAY_CHUYEN_NUOC}</option>
                    </select>
                    <select
                      value={skFilterLoai}
                      onChange={(e) => setSkFilterLoai(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400"
                    >
                      <option value="">Tất cả chủng loại</option>
                      {skLoaiOptions.map((l) => <option key={l}>{l}</option>)}
                    </select>
                    <select
                      value={skFilterBoc}
                      onChange={(e) => setSkFilterBoc(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400"
                    >
                      <option value="">Bọc hiện tại</option>
                      {skBocOptions.map((b) => <option key={b}>{b}</option>)}
                    </select>
                    <select
                      value={skFilterPallet}
                      onChange={(e) => setSkFilterPallet(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400"
                    >
                      <option value="">Pallet hiện tại</option>
                      {skPalletOptions.map((p) => <option key={p}>{p}</option>)}
                    </select>
                    {(skFilterDC || skFilterLoai || skFilterBoc || skFilterPallet) && (
                      <button
                        onClick={() => { setSkFilterDC(""); setSkFilterLoai(""); setSkFilterBoc(""); setSkFilterPallet(""); }}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500"
                      >
                        <X size={12} /> Xóa lọc
                      </button>
                    )}
                    <span className="ml-auto text-xs text-slate-400 font-bold">
                      {skEligibleLots.length} lô
                    </span>
                  </div>

                  {/* Lot list */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {skEligibleLots.length === 0 ? (
                      <div className="py-12 text-center text-slate-400">
                        <Package size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Không có lô phù hợp với bộ lọc</p>
                      </div>
                    ) : (
                      skEligibleLots.map((lot) => {
                        const isDone = skDone.has(lot.id);
                        return (
                          <button
                            key={lot.id}
                            onClick={() => skAddLot(lot)}
                            className={`w-full text-left p-3 rounded-xl border transition-all ${
                              isDone
                                ? "border-violet-200 bg-violet-50 cursor-default"
                                : "border-slate-200 bg-white hover:border-violet-400 hover:bg-violet-50 cursor-pointer"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-extrabold text-slate-800 text-sm">
                                {lot.ma_lo}
                              </span>
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded">
                                {lot.loai_csr}
                              </span>
                              <span className="text-xs text-slate-500">
                                {lot.loai_banh}kg · {lot.tong_banh} bành
                              </span>
                              {isDone && (
                                <span className="ml-auto px-1.5 py-0.5 bg-violet-100 text-violet-600 text-[10px] font-bold rounded">
                                  Đã chuyển
                                </span>
                              )}
                              {!isDone && (
                                <MoveRight size={14} className="ml-auto text-violet-400 shrink-0" />
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                              <span>A={lot.kien_a} B={lot.kien_b} C={lot.kien_c} D={lot.kien_d}</span>
                              {lot.boc && <span className="truncate max-w-[160px]">{lot.boc}</span>}
                              {lot.pallet?.length > 0 && <span>{lot.pallet.join(" · ")}</span>}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ── PANEL PHẢI ────────────────────────────────── */}
                <div className="flex flex-col overflow-hidden" style={{ width: "40%" }}>

                  {/* Tab selector */}
                  <div className="flex gap-1 px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
                    {(["sang_kien", "thay_boc"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSkTab(tab)}
                        className={`px-4 py-1.5 rounded-xl text-sm font-bold transition-all ${
                          skTab === tab
                            ? "bg-violet-600 text-white shadow-sm"
                            : "text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {tab === "sang_kien" ? "Sang kiện" : "Thay bọc"}
                      </button>
                    ))}
                  </div>

                  {/* New boc/pallet selector */}
                  <div className="px-5 py-3 border-b border-slate-100 shrink-0">
                    {skTab === "thay_boc" ? (
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">
                          Bọc mới
                        </label>
                        <select
                          value={skToBoc}
                          onChange={(e) => setSkToBoc(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                        >
                          <option value="">— Chọn bọc mới —</option>
                          {newBocOpts.map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">
                          Pallet mới
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {PALLET_OPTS.map((p) => {
                            const checked = skToPallet.includes(p);
                            return (
                              <button
                                key={p}
                                onClick={() =>
                                  setSkToPallet(
                                    checked
                                      ? skToPallet.filter((x) => x !== p)
                                      : [...skToPallet, p],
                                  )
                                }
                                className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                                  checked
                                    ? "border-violet-500 bg-violet-50 text-violet-700"
                                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                                }`}
                              >
                                {checked ? "✓ " : ""}{p}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pending lot list */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {skPending.length === 0 ? (
                      <div className="py-10 text-center text-slate-400">
                        <MoveRight size={28} className="mx-auto mb-2 opacity-30 rotate-180" />
                        <p className="text-sm">Nhấn lô bên trái để thêm vào</p>
                      </div>
                    ) : (
                      skPending.map((p) => {
                        const rem_a = p.lot.kien_a - p.kien_a;
                        const rem_b = p.lot.kien_b - p.kien_b;
                        const rem_c = p.lot.kien_c - p.kien_c;
                        const rem_d = p.lot.kien_d - p.kien_d;
                        const isPartial = rem_a > 0 || rem_b > 0 || rem_c > 0 || rem_d > 0;
                        const convertBanh = p.kien_a + p.kien_b + p.kien_c + p.kien_d;
                        return (
                          <div
                            key={p.lot.id}
                            className="bg-white border border-violet-200 rounded-xl p-3 shadow-sm"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-slate-800 text-sm">
                                  {p.lot.ma_lo}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {p.lot.loai_csr} · {p.lot.loai_banh}kg
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => skSetAll(p.lot.id)}
                                  className="px-2 py-0.5 text-[10px] font-bold bg-violet-50 hover:bg-violet-100 text-violet-600 rounded border border-violet-200 transition-colors"
                                >
                                  Sang hết
                                </button>
                                <button
                                  onClick={() => skRemoveLot(p.lot.id)}
                                  className="p-1 text-slate-300 hover:text-red-400 rounded transition-colors"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>

                            {/* Kien inputs */}
                            <div className="grid grid-cols-2 gap-1.5 mb-2">
                              {(["kien_a","kien_b","kien_c","kien_d"] as const).map((k) => {
                                const label = k.replace("kien_","").toUpperCase();
                                const max = p.lot[k];
                                const val = p[k];
                                return (
                                  <div key={k} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2 py-1.5">
                                    <span className="text-xs font-extrabold text-violet-600 w-4 shrink-0">{label}</span>
                                    <input
                                      type="number"
                                      value={val}
                                      min={0}
                                      max={max}
                                      onChange={(e) => skUpdateKien(p.lot.id, k, +e.target.value)}
                                      className="w-full text-sm font-bold text-center outline-none bg-transparent text-slate-700"
                                    />
                                    <span className="text-[10px] text-slate-400 shrink-0">/{max}</span>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-violet-600 font-bold">
                                Chuyển: {convertBanh} bành
                              </span>
                              {isPartial && (
                                <span className="text-amber-600 font-bold">
                                  Còn lại: A={rem_a} B={rem_b} C={rem_c} D={rem_d}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Bottom action bar */}
                  <div className="border-t border-slate-200 px-5 py-3 bg-slate-50 shrink-0">
                    {skError && (
                      <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-bold">
                        <AlertTriangle size={13} className="shrink-0" />
                        {skError}
                        <button onClick={() => setSkError(null)} className="ml-auto hover:opacity-70">
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500 font-bold">
                        {skPending.length > 0
                          ? `${skPending.length} lô · ${totalConvertBanh} bành`
                          : "Chưa có lô nào"}
                      </span>
                      <button
                        onClick={() => { if (canConfirm) setSkConfirm(true); }}
                        disabled={!canConfirm}
                        className={`flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl shadow-sm transition-all ${
                          canConfirm
                            ? "bg-violet-600 hover:bg-violet-700 text-white"
                            : "bg-slate-200 text-slate-400 cursor-not-allowed"
                        }`}
                      >
                        Xác nhận chuyển <MoveRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Confirm dialog ─────────────────────────────── */}
              {skConfirm && (
                <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center p-8 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 max-w-sm w-full">
                    <h3 className="font-extrabold text-slate-800 mb-3 text-base">
                      Xác nhận chuyển?
                    </h3>
                    <div className="space-y-1 mb-3 text-sm text-slate-600">
                      <p>
                        <span className="font-bold">{skPending.length} lô</span>
                        {" · "}
                        {skTab === "sang_kien" ? "Sang kiện" : "Thay bọc"}
                        {" · "}
                        <span className="font-bold">{totalConvertBanh} bành</span>
                      </p>
                      {skTab === "thay_boc" && skToBoc && (
                        <p className="text-xs text-slate-400">
                          Bọc mới: <span className="font-bold text-violet-600">{skToBoc}</span>
                        </p>
                      )}
                      {skTab === "sang_kien" && skToPallet.length > 0 && (
                        <p className="text-xs text-slate-400">
                          Pallet mới: <span className="font-bold text-violet-600">{skToPallet.join(", ")}</span>
                        </p>
                      )}
                    </div>
                    {hasPartial && (
                      <div className="flex items-start gap-2 mb-4 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                        <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 font-bold">
                          Một số lô sang một phần — sẽ tách thành 2 lô riêng (phần đã chuyển + phần tồn dư).
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setSkConfirm(false)}
                        disabled={skSaving}
                        className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={() => void handleSkSave()}
                        disabled={skSaving}
                        className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                      >
                        {skSaving ? "Đang lưu..." : "Xác nhận"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

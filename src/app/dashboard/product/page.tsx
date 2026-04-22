"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
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

// ─── Types ────────────────────────────────────────────────────────────────────
type Lot = {
  id: string;
  ma_lo: string;
  num: number;
  suffix: string;
  year: string;
  ngay_sx: string;
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
  dd_snapshot?: any;
  ngans?: { ten_ngan: string; ma_ngan: string; loai_nl: string };
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
  ngay_sx: string; // dùng chung mọi ca, mặc định maxDate+1
  day_chuyen: string;
  so_ca: 1 | 2 | 3;
  ngan_id: string;
  suffix: string; // "" = Trống
  loai_csr: string;
  loai_banh: number;
  boc: string;
  tham: string;
  chi_thi: string;
  pallet: string[];
};

type HistoryEntry = {
  ca: string;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  added_banh: number;
  timestamp: string;
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
  existing_snapshot?: any;
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
  tong_banh_cua_ca: number;
  tong_kg_cua_ca: number;
  locked_a?: boolean;
  locked_b?: boolean;
  locked_c?: boolean;
  locked_d?: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const CA_OPTS = ["A", "B", "C"];
const THAM_OPTS = ["Củ", "Mới"];
const TRANG_THAI_OPTS = ["Hoàn thành", "Dở dang", "Xuất hàng"];
const PALLET_OPTS = ["Sắt đế gỗ", "Sắt đế nhựa", "Sắt mỏng", "MB5", "Gỗ"];

// ─── Business Logic ───────────────────────────────────────────────────────────
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
  if (dc === "Mủ nước")
    return [
      `${prefix}L`,
      `${prefix}3L`,
      `${prefix}CV50`,
      `${prefix}CV60`,
      "Ngoại lệ",
    ];
  return [`${prefix}10`, `${prefix}20`, "Ngoại lệ"];
}

function getBocsForLoaiCSR(dc: string, loai_csr: string): string[] {
  const base = [`Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG ${loai_csr}`];
  if (dc === "Mủ nước")
    return [...base, `Bọc trơn 0,13`, `Bọc nhãn 0,13 VRG ${loai_csr}`];
  return base;
}

function autoTrangThai(
  tong_banh: number,
  lo_tron: number,
  current: string,
): string {
  if (current === "Xuất hàng") return "Xuất hàng";
  if (tong_banh >= lo_tron) return "Hoàn thành";
  return "Dở dang";
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

  for (let n = fromNum; n <= toNum; n++) {
    const dbLot = existingLots.find(
      (l) => l.num === n && l.loai_csr === loai_csr && l.suffix === suffix && l.year === yearStr,
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
      dbLot && ["Hoàn thành", "Xuất hàng"].includes(dbLot.trang_thai);
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
      n === fromNum && prevCaLastDraft?.trang_thai === "Dở dang"
        ? prevCaLastDraft
        : undefined;
    const fromDB =
      n === fromNum && dbLot?.trang_thai === "Dở dang" && !fromPrevDraft
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
        trang_thai: "Hoàn thành",
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
      const tb = pA + pB + pC + pD;
      drafts.push({
        num: n,
        role,
        kien_a: pA,
        kien_b: pB,
        kien_c: pC,
        kien_d: pD,
        prev_a: pA,
        prev_b: pB,
        prev_c: pC,
        prev_d: pD,
        locked_a: pA >= max_per_kien,
        locked_b: pB >= max_per_kien,
        locked_c: pC >= max_per_kien,
        locked_d: pD >= max_per_kien,
        is_continuation: true,
        existing_id:
          (fromDB as Lot | undefined)?.id ??
          (fromPrevDraft as LotDraft | undefined)?.existing_id,
        existing_snapshot:
          (fromDB as Lot | undefined)?.dd_snapshot ??
          (fromPrevDraft as LotDraft | undefined)?.existing_snapshot,
        tong_banh: tb,
        tong_kg: Math.round(tb * loai_banh * 100) / 100,
        trang_thai: autoTrangThai(tb, lo_tron, "Dở dang"),
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
        trang_thai: "Hoàn thành",
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
    ngay_sx: todayStr(),
    day_chuyen: "Mủ tạp",
    so_ca: 1,
    ngan_id: "",
    suffix: "cs",
    loai_csr: defaultCsr,
    loai_banh: 35,
    boc: `Bọc nhãn 0,04 VRG ${defaultCsr}`,
    tham: "Củ",
    chi_thi: "1",
    pallet: ["Sắt đế gỗ"],
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
    year: new Date().getFullYear().toString().slice(-2),
    ngay_sx: todayStr(),
    ca: "A",
    ngan_id: "",
    day_chuyen: "Mủ tạp",
    loai_csr: "CSR10",
    loai_banh: 35,
    boc: "Bọc nhãn 0,04 VRG CSR10",
    tham: "Củ",
    pallet: ["Sắt đế gỗ"],
    chi_thi: "1",
    kien_a: 36,
    kien_b: 36,
    kien_c: 36,
    kien_d: 36,
    tong_banh: 144,
    tong_kg: 5040,
    trang_thai: "Hoàn thành",
    ghi_chu: "",
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProductPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [ngans, setNgans] = useState<Ngan[]>([]);
  const [lotsStats, setLotsStats] = useState<
    { ngan_id: string | null; tong_kg: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
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
  const [maxNumFromDB, setMaxNumFromDB] = useState(0);

  const [session, setSession] = useState<SessionHeader>(defaultSession());
  const [caSections, setCaSections] = useState<CaSection[]>([
    defaultCaSection("A"),
  ]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (fid: string) => {
    setLoading(true);
    let q = supabase
      .from("lots")
      .select("*, ngans(ten_ngan, ma_ngan, loai_nl)")
      .eq("factory_id", fid)
      .order("ngay_sx", { ascending: false })
      .order("created_at", { ascending: false });

    const [{ data: lotsData }, { data: ngansData }, { data: statsData }] =
      await Promise.all([
        q,
        supabase
          .from("ngans")
          .select(
            "id,ten_ngan,ma_ngan,tong_kho,trang_thai,ngay_bd,loai_nl,chung_nhan,ngay_kt",
          )
          .eq("factory_id", fid),
        supabase.from("lots").select("ngan_id,tong_kg").eq("factory_id", fid),
      ]);
    setLots(lotsData || []);
    setNgans(ngansData || []);
    setLotsStats(statsData || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const fid = localStorage.getItem("erp_factory");
    if (!fid) return;
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
      .update({ day_chuyen: "Mủ tạp" })
      .eq("factory_id", fid)
      .or("day_chuyen.is.null,day_chuyen.eq.")
      .then(() => {});
  }, [loadData]);

  // ── Computed Bóc tách sản lượng (Contributions) ────────────────────────────
  const contributions = useMemo(() => {
    const arr: LotContribution[] = [];
    lots.forEach((lot) => {
      if (
        lot.dd_snapshot &&
        Array.isArray(lot.dd_snapshot.history) &&
        lot.dd_snapshot.history.length > 0
      ) {
        const history = lot.dd_snapshot.history as HistoryEntry[];
        history.forEach((h, i) => {
          const prev = i > 0 ? history[i - 1] : null;
          arr.push({
            ...lot,
            uid: `${lot.id}-${i}`,
            ca: h.ca,
            tong_banh_cua_ca: h.added_banh,
            tong_kg_cua_ca: h.added_banh * lot.loai_banh,
            trang_thai: i === history.length - 1 ? lot.trang_thai : "Dở dang",
            kien_a: h.kien_a,
            kien_b: h.kien_b,
            kien_c: h.kien_c,
            kien_d: h.kien_d,
            tong_banh: h.kien_a + h.kien_b + h.kien_c + h.kien_d,
            locked_a: prev !== null && h.kien_a === prev.kien_a && h.kien_a > 0,
            locked_b: prev !== null && h.kien_b === prev.kien_b && h.kien_b > 0,
            locked_c: prev !== null && h.kien_c === prev.kien_c && h.kien_c > 0,
            locked_d: prev !== null && h.kien_d === prev.kien_d && h.kien_d > 0,
          });
        });
      } else {
        arr.push({
          ...lot,
          uid: lot.id,
          tong_banh_cua_ca: lot.tong_banh,
          tong_kg_cua_ca: lot.tong_kg,
        });
      }
    });
    return arr;
  }, [lots]);

  // ── List Filters & Grouping ────────────────────────────────────────────────
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
      (l) => l.trang_thai === "Hoàn thành" || l.trang_thai === "Xuất hàng",
    ).length,
    dorDang: lots.filter((l) => l.trang_thai === "Dở dang").length,
    tongBanh: filteredContribs.reduce(
      (s, c) => s + (c.tong_banh_cua_ca || 0),
      0,
    ),
    tongKg: filteredContribs.reduce((s, c) => s + (c.tong_kg_cua_ca || 0), 0),
  };

  // ── Create view computed ───────────────────────────────────────────────────
  const nganKgMap = useMemo(() => {
    const map: Record<string, number> = {};
    lotsStats.forEach((ls) => {
      if (ls.ngan_id)
        map[ls.ngan_id] = (map[ls.ngan_id] || 0) + (ls.tong_kg || 0);
    });
    return map;
  }, [lotsStats]);

  const eligibleNgans = useMemo(() => {
    const now = new Date();
    const validLoaiNl =
      session.day_chuyen === "Mủ tạp"
        ? [
            "Mủ chén",
            "Mủ đông chén",
            "Mủ đông khối",
            "Mủ dây",
            "Mủ dơ",
            "Mủ tạp",
          ]
        : ["Mủ nước"];

    return ngans
      .filter((n) => {
        if (!validLoaiNl.includes(n.loai_nl)) return false;
        if (["Đóng", "Đã sản xuất"].includes(n.trang_thai)) return false;
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
  const dorDangLots = lots.filter(
    (l) => l.ngan_id === session.ngan_id && l.trang_thai === "Dở dang",
  );

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

  const sessionYear = yearFromDate(session.ngay_sx);

  const getMaxLotNum = (loai_csr: string, suffix: string, year: string) =>
    lots.filter((l) => l.loai_csr === loai_csr && l.suffix === suffix && l.year === year)
      .reduce((m, l) => Math.max(m, l.num || 0), 0);

  useEffect(() => {
    if (!factoryId) return;
    setMaxNumFromDB(getMaxLotNum(session.loai_csr, session.suffix, sessionYear));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, session.suffix, sessionYear, lots]);

  // ── Session handlers ───────────────────────────────────────────────────────
  const updateSession = (patch: Partial<SessionHeader>) => {
    setSession((prev) => {
      const next = { ...prev, ...patch };
      if (patch.day_chuyen !== undefined) {
        const csrOpts = getLoaiCSRByDayChuyen(patch.day_chuyen, factoryPrefix);
        next.loai_csr = csrOpts[0] || "";
        const cfg = getLoaiBanhConfig(next.loai_csr, next.loai_banh);
        next.loai_banh = cfg.loai_banh;
        next.boc = getBocsForLoaiCSR(patch.day_chuyen, next.loai_csr)[1] || "";
        next.ngan_id = ""; // Reset ngan_id khi đổi dây chuyền
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
      patch.loai_banh !== undefined
    ) {
      const newCsr = patch.loai_csr ?? session.loai_csr;
      const newSuffix =
        patch.suffix !== undefined ? patch.suffix : session.suffix;
      const newBanh = patch.loai_banh ?? session.loai_banh;
      setCaSections((prev) => {
        return prev.map((cs, ci) => {
          let fromNum = cs.from_num;
          let toNum = cs.to_num;
          if (ci === 0 && patch.suffix !== undefined) {
            fromNum = getMaxLotNum(newCsr, newSuffix, sessionYear) + 1;
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
              sessionYear,
              prevLast?.trang_thai === "Dở dang" ? prevLast : undefined,
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
          prevLastDraft?.trang_thai === "Dở dang"
            ? prevSection.to_num
            : (prevSection?.to_num || 0) + 1;
        const prevLast =
          prevLastDraft?.trang_thai === "Dở dang" ? prevLastDraft : undefined;
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

  // ── Ca section handler ─────────────────────────────────────────────────────
  const updateCaSection = (idx: number, patch: Partial<CaSection>) => {
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
          prevLast?.trang_thai === "Dở dang" ? prevLast : undefined,
        ),
      };
      if (idx + 1 < updated.length) {
        const nextSec = updated[idx + 1];
        const prevToNum = prev[idx].to_num;
        if (nextSec.from_num === prevToNum || nextSec.from_num === 0) {
          const lastDraft = updated[idx].lots.at(-1);
          const suggestFrom =
            lastDraft?.trang_thai === "Dở dang" ? cs.to_num : cs.to_num + 1;
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
              lastDraft?.trang_thai === "Dở dang" ? nextLast : undefined,
            ),
          };
        }
      }
      return updated;
    });
  };

  // ── Lot draft handler ──────────────────────────────────────────────────────
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

  // Reset một kiện về 0 (hoặc về prev nếu là lô kế thừa)
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

  // ── Open create ────────────────────────────────────────────────────────────
  const openCreate = async () => {
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
    const ngaySX = nextDay.toISOString().slice(0, 10);
    const yrStr = yearFromDate(ngaySX);

    const lastChiThi = lots.length > 0 ? lots[0]?.chi_thi || "1" : "1";
    const defaultSuffix =
      suffixList.find((s) => s.code !== "")?.code ||
      suffixList[0]?.code ||
      "cs";

    const defaultCsr =
      getLoaiCSRByDayChuyen("Mủ tạp", factoryPrefix)[0] || `${factoryPrefix}10`;
    const cfg = getLoaiBanhConfig(defaultCsr);
    const fromNum = getMaxLotNum(defaultCsr, defaultSuffix, yrStr) + 1;

    const validLoaiNl = [
      "Mủ chén",
      "Mủ đông chén",
      "Mủ đông khối",
      "Mủ dây",
      "Mủ dơ",
      "Mủ tạp",
    ];
    const dangSxNgan = ngans.find(
      (n) =>
        n.trang_thai === "Đang sản xuất" && validLoaiNl.includes(n.loai_nl),
    );

    const s: SessionHeader = {
      ngay_sx: ngaySX,
      day_chuyen: "Mủ tạp",
      so_ca: 1,
      ngan_id: dangSxNgan?.id || "",
      suffix: defaultSuffix,
      loai_csr: defaultCsr,
      loai_banh: cfg.loai_banh,
      boc:
        getBocsForLoaiCSR("Mủ tạp", defaultCsr)[1] ||
        getBocsForLoaiCSR("Mủ tạp", defaultCsr)[0] ||
        "",
      tham: "Củ",
      chi_thi: lastChiThi,
      pallet: ["Sắt đế gỗ"],
    };
    setSession(s);
    setCaSections([defaultCaSection("A", fromNum)]);
    setView("create");
  };

  // ── Save create ────────────────────────────────────────────────────────────
  const handleCreateSave = async (markNganDone: boolean) => {
    if (!factoryId || !session.ngan_id) return;
    setSaving(true);
    setSaveError(null);
    let hasError = false;
    try {
      const cfg = getLoaiBanhConfig(session.loai_csr, session.loai_banh);
      const year = yearFromDate(session.ngay_sx);
      for (const cs of caSections) {
        for (const draft of cs.lots) {
          if (draft.is_already_completed) continue; // Bỏ qua lô đã khóa

          const tb = draft.kien_a + draft.kien_b + draft.kien_c + draft.kien_d;
          const tong_kg = Math.round(tb * session.loai_banh * 100) / 100;
          const trang_thai = autoTrangThai(tb, cfg.lo_tron, "Dở dang");

          const added_banh = draft.is_continuation
            ? Math.max(0, draft.kien_a - draft.prev_a) +
              Math.max(0, draft.kien_b - draft.prev_b) +
              Math.max(0, draft.kien_c - draft.prev_c) +
              Math.max(0, draft.kien_d - draft.prev_d)
            : tb;

          // History Tracking
          let history: HistoryEntry[] = [];
          if (draft.is_continuation && draft.existing_snapshot?.history) {
            history = [...draft.existing_snapshot.history];
          } else if (draft.is_continuation && draft.existing_snapshot) {
            history = [
              {
                ca: draft.existing_snapshot.ca || "Unknown",
                kien_a: draft.prev_a,
                kien_b: draft.prev_b,
                kien_c: draft.prev_c,
                kien_d: draft.prev_d,
                added_banh:
                  draft.prev_a + draft.prev_b + draft.prev_c + draft.prev_d,
                timestamp:
                  draft.existing_snapshot.timestamp || new Date().toISOString(),
              },
            ];
          }
          history.push({
            ca: cs.ca,
            kien_a: draft.kien_a,
            kien_b: draft.kien_b,
            kien_c: draft.kien_c,
            kien_d: draft.kien_d,
            added_banh,
            timestamp: new Date().toISOString(),
          });

          const dd_snapshot = {
            kien_a: draft.kien_a,
            kien_b: draft.kien_b,
            kien_c: draft.kien_c,
            kien_d: draft.kien_d,
            timestamp: new Date().toISOString(),
            history,
            ca: cs.ca,
          };

          if (draft.is_continuation && draft.existing_id) {
            const { error } = await supabase
              .from("lots")
              .update({
                kien_a: draft.kien_a,
                kien_b: draft.kien_b,
                kien_c: draft.kien_c,
                kien_d: draft.kien_d,
                tong_banh: tb,
                tong_kg,
                trang_thai,
                dd_snapshot,
                ca: cs.ca,
              })
              .eq("id", draft.existing_id);
            if (error) {
              setSaveError(`Lỗi cập nhật lô ${draft.num}: ${error.message}`);
              hasError = true;
              break;
            }
          } else {
            const ma_lo = buildMaLo(draft.num, session.suffix, year);
            const { error } = await supabase.from("lots").insert({
              factory_id: factoryId,
              day_chuyen: session.day_chuyen,
              ma_lo,
              num: draft.num,
              suffix: session.suffix,
              year,
              ngay_sx: session.ngay_sx,
              ca: cs.ca,
              ngan_id: session.ngan_id,
              loai_csr: session.loai_csr,
              loai_banh: session.loai_banh,
              boc: session.boc,
              tham: session.tham,
              chi_thi: session.chi_thi,
              pallet: session.pallet,
              kien_a: draft.kien_a,
              kien_b: draft.kien_b,
              kien_c: draft.kien_c,
              kien_d: draft.kien_d,
              tong_banh: tb,
              tong_kg,
              trang_thai,
              dd_snapshot,
              ghi_chu: "",
              is_manual_edit: false,
            });
            if (error) {
              setSaveError(`Lỗi tạo lô ${ma_lo}: ${error.message}`);
              hasError = true;
              break;
            }
          }
          if (hasError) break;
        }
        if (hasError) break;
      }
    } catch (err) {
      setSaveError(`Lỗi không xác định: ${String(err)}`);
      hasError = true;
    }
    if (!hasError) {
      const nganStatus = markNganDone ? "Đã sản xuất" : "Đang sản xuất";
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

  // ── Edit individual lot ────────────────────────────────────────────────────
  const openEdit = (lot: Lot) => {
    if (lot.trang_thai === "Hoàn thành") {
      setSaveError("Lô đã hoàn thành, không thể sửa.")
      return
    }
    setEditForm({
      ma_lo: lot.ma_lo,
      num: lot.num,
      suffix: lot.suffix,
      year: lot.year,
      ngay_sx: lot.ngay_sx?.slice(0, 10) || "",
      ca: lot.ca,
      ngan_id: lot.ngan_id || "",
      day_chuyen: lot.day_chuyen || "Mủ tạp",
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
        patch.ngay_sx !== undefined
      ) {
        const yr = yearFromDate(patch.ngay_sx ?? next.ngay_sx);
        next.year = yr;
        next.ma_lo = buildMaLo(next.num, next.suffix, yr);
      }
      return next;
    });
  };

  const handleEditSave = async () => {
    if (!factoryId || !editId) return;
    setSaving(true);
    try {
      // Lấy dbLot cũ để xem có history không
      const dbLot = lots.find((l) => l.id === editId);
      const dd_snapshot = dbLot?.dd_snapshot || {};
      dd_snapshot.kien_a = editForm.kien_a;
      dd_snapshot.kien_b = editForm.kien_b;
      dd_snapshot.kien_c = editForm.kien_c;
      dd_snapshot.kien_d = editForm.kien_d;
      dd_snapshot.timestamp = new Date().toISOString();
      // Note: manual edit doesnt touch history array to keep it simple, but marks it edited

      await supabase
        .from("lots")
        .update({
          ...editForm,
          factory_id: factoryId,
          ngan_id: editForm.ngan_id || null,
          dd_snapshot,
          is_manual_edit: true,
        })
        .eq("id", editId);
      if (editForm.ngan_id) {
        const { data: rem } = await supabase
          .from("lots")
          .select("id")
          .eq("ngan_id", editForm.ngan_id);
        if ((rem?.length ?? 0) > 0)
          await supabase
            .from("ngans")
            .update({ trang_thai: "Đang sản xuất" })
            .eq("id", editForm.ngan_id);
      }
      setEditModal(false);
      loadData(factoryId);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!factoryId) return;
    const lot = lots.find((l) => l.id === id);
    await supabase.from("lots").delete().eq("id", id);
    if (lot?.ngan_id) {
      const { data: rem } = await supabase
        .from("lots")
        .select("id")
        .eq("ngan_id", lot.ngan_id)
        .neq("id", id);
      const newStatus =
        (rem?.length ?? 0) === 0 ? "Chờ sản xuất" : "Đang sản xuất";
      await supabase
        .from("ngans")
        .update({ trang_thai: newStatus })
        .eq("id", lot.ngan_id);
    }
    setDelConfirm(null);
    loadData(factoryId);
  };

  const toggleDate = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // CREATE VIEW
  // ══════════════════════════════════════════════════════════════════════════════
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
              name: "Nội tuyển PEFC",
              nguon: "NT",
              chung_nhan: "PEFC CS",
            },
            { code: "m", name: "Mua ngoài", nguon: "M", chung_nhan: "" },
          ];

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
              Tạo lô mới theo ca sản xuất
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">
                Dây chuyền <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {["Mủ tạp", "Mủ nước"].map((dc) => (
                  <button
                    key={dc}
                    onClick={() => updateSession({ day_chuyen: dc })}
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
                        ? "border-blue-500 bg-blue-50 text-blue-700"
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
            <Package size={15} className="text-emerald-600" /> Thông tin sản
            phẩm (dùng chung mọi ca)
          </h3>

          <div className="mb-3">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Ngày sản xuất <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={session.ngay_sx}
              onChange={(e) => updateSession({ ngay_sx: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
            />
            <span className="text-[10px] text-slate-400 ml-3">
              Năm lô: {sessionYear}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
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
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Loại CSR *
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
                Loại bành (kg/bành) *
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
                Lô tròn: {cfg.lo_tron} bành
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Bọc *
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
                Thấm *
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
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                Chỉ thị SX
              </label>
              <input
                value={session.chi_thi}
                onChange={(e) => updateSession({ chi_thi: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-2">
              Pallet
            </label>
            <div className="flex flex-wrap gap-2">
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
                    {checked ? "✓ " : ""}
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 mb-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-1 flex items-center gap-2">
            <Warehouse size={15} className="text-blue-600" /> Chọn ngăn lưu{" "}
            <span className="text-red-500">*</span>
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Hiển thị ngăn đủ 21 ngày ủ của dây chuyền{" "}
            <strong>{session.day_chuyen}</strong>
          </p>

          {hasNgan && dorDangLots.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-600" />
                <span className="text-xs font-bold text-amber-700">
                  Lô dở dang cần hoàn thành ({dorDangLots.length} lô)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {dorDangLots.map((l) => (
                  <span
                    key={l.id}
                    className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-lg"
                  >
                    {l.ma_lo} · {l.tong_banh} bành
                  </span>
                ))}
              </div>
            </div>
          )}

          {eligibleNgans.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Warehouse size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Không có ngăn đủ điều kiện sản xuất</p>
              <p className="text-xs mt-1">
                Cần ngăn ≥ 21 ngày ủ và trạng thái Chờ/Đang SX
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
                  (l) => l.ngan_id === n.id && l.trang_thai === "Dở dang",
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
                            Dở dang
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                            n.trang_thai === "Đang sản xuất"
                              ? "bg-emerald-100 text-emerald-700"
                              : n.trang_thai === "Hoàn thành"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {n.trang_thai === "Đang sản xuất"
                            ? "Đang SX"
                            : n.trang_thai === "Hoàn thành"
                              ? "HT"
                              : "Chờ SX"}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-2 truncate">
                      {n.ma_ngan}
                    </p>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
                      <span>SX: {(kgUsed / 1000).toFixed(3)} T</span>
                      <span className="font-bold text-teal-700">
                        Còn: {((n.tong_kho - kgUsed) / 1000).toFixed(3)} T
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : pct > 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {n.loai_nl} · {days} ngày ủ · DK SX:{" "}
                      {n.ngay_kt
                        ? new Date(n.ngay_kt).toLocaleDateString("vi-VN")
                        : "—"}
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
                      Ca {caLabel}: {caTongBanh} bành ·{" "}
                      {(caTongKg / 1000).toFixed(3)} T
                    </span>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-500">
                        Khoảng lô:
                      </span>
                      <span className="text-xs text-slate-400">Từ lô</span>
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
                      <span className="text-xs text-slate-400">đến lô</span>
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
                          (gần nhất: {maxNumFromDB}
                          {session.suffix}/{sessionYear})
                        </span>
                      )}
                      {loCount > 0 && (
                        <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                          {loCount} lô
                        </span>
                      )}
                    </div>
                  </div>

                  {cs.lots.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4">
                      Nhập khoảng lô để hiển thị...
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
                                  🔒 Đã {lot.trang_thai}
                                </span>
                                <span>{lot.tong_banh} bành</span>
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
                                  Lô giữa: {midStart}
                                  {sfxPart} → {midEnd}
                                  {sfxPart}
                                  <span className="ml-2 text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                    {midCount} lô tròn
                                  </span>
                                </span>
                                <span className="text-xs text-slate-500 font-bold">
                                  {midCount} × {cfg.lo_tron} bành ={" "}
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
                                      Kiện {k}
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
                              ? " · Lô đầu"
                              : " · Lô cuối";
                        const contLabel = lot.is_continuation
                          ? " · Kế thừa"
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
                                  Tổng:{" "}
                                  <strong
                                    className={
                                      lot.trang_thai === "Hoàn thành"
                                        ? "text-emerald-600"
                                        : "text-amber-600"
                                    }
                                  >
                                    {lot.tong_banh} bành
                                  </strong>
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lot.trang_thai === "Hoàn thành" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
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
                                        Ca trước · đã đủ
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
                                  const added = val - prev;
                                  return (
                                    <div
                                      key={k}
                                      className="flex flex-col items-center gap-1"
                                    >
                                      <span className="text-[9px] text-amber-600 font-bold whitespace-nowrap">
                                        Ca trước: {prev} · thêm ≤{remaining}
                                      </span>
                                      <div
                                        className={`relative border rounded-xl overflow-hidden w-full ${
                                          val >= maxK
                                            ? "border-emerald-300 bg-emerald-50"
                                            : val > prev
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
                                          value={val}
                                          min={prev}
                                          max={maxK}
                                          disabled={nganBlocked}
                                          onChange={(e) => {
                                            const v = Math.min(
                                              maxK,
                                              Math.max(
                                                prev,
                                                Number(e.target.value) || prev,
                                              ),
                                            );
                                            updateLotDraft(caIdx, lotIdx, {
                                              [k]: v,
                                            } as Partial<LotDraft>);
                                          }}
                                          className={`w-full pl-7 pr-6 py-2.5 text-sm font-bold text-center outline-none bg-transparent ${
                                            val >= maxK
                                              ? "text-emerald-700"
                                              : "text-amber-700"
                                          }`}
                                        />
                                        {!nganBlocked && val > prev && (
                                          <button
                                            onClick={() =>
                                              resetKien(
                                                caIdx,
                                                lotIdx,
                                                resetKeys[ki],
                                              )
                                            }
                                            title={`Reset về ca trước (${prev})`}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-300 hover:text-red-400 rounded transition-colors"
                                          >
                                            <X size={10} />
                                          </button>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-center text-amber-600 font-bold">
                                        +{added} bành ca này
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
                                          title="Reset về 0"
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
                              {(lot.tong_kg / 1000).toFixed(3)} T ·{" "}
                              {lot.tong_banh} bành
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {caTongBanh > 0 && (
                    <div className="mt-3 flex items-center flex-wrap gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-xs font-extrabold text-blue-700">
                        Tổng Ca {caLabel}:
                      </span>
                      <span className="text-sm font-extrabold text-blue-800">
                        {caTongBanh} bành
                      </span>
                      <span className="text-xs text-blue-400">·</span>
                      <span className="text-sm font-extrabold text-blue-800">
                        {Math.round(caTongKg).toLocaleString("vi-VN")} kg
                      </span>
                      <span className="ml-auto text-xs text-blue-500">
                        ≈ {(caTongKg / 1000).toFixed(3)} tấn
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
                  Ngăn {selectedNgan.ten_ngan}
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
                  {(kgDaCoTrongNgan / 1000).toFixed(3)}T
                  {kgLanNay > 0 ? ` + ${(kgLanNay / 1000).toFixed(3)}T` : ""} /{" "}
                  {(selectedNgan.tong_kho / 1000).toFixed(3)}T
                </span>
                {nganBlocked && (
                  <span className="text-[10px] text-red-600 font-bold shrink-0">
                    ⛔ Vượt 110%
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
                  {session.loai_csr} · {session.loai_banh}kg
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap max-w-[200px] truncate">
                  {session.boc}
                </span>
                {session.pallet.length > 0 && (
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                    {session.pallet.join(" · ")}
                  </span>
                )}
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  CT:{session.chi_thi}
                </span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-full whitespace-nowrap">
                  Thấm {session.tham}
                </span>
                <span className="text-slate-300 text-xs">│</span>
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
                  {nganPct >= 100 && !nganBlocked ? (
                    <button
                      onClick={() => handleCreateSave(true)}
                      disabled={
                        saving || caSections.every((cs) => cs.lots.length === 0)
                      }
                      className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                    >
                      {saving
                        ? "Đang lưu..."
                        : `✓ Lưu · Đánh dấu ngăn Đã sản xuất`}
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
                        ? "Đang lưu..."
                        : `Lưu ${sessionTotals.banh > 0 ? sessionTotals.banh + " bành" : "lô"}`}
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

  // ══════════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Thành phẩm</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý lô và phân tách sản lượng theo Ca
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all btn-press"
        >
          <Plus size={16} /> Thêm lô
        </button>
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
              value: (stats.tongKg / 1000).toFixed(2) + " T",
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
          <option value="Mủ tạp">Mủ tạp</option>
          <option value="Mủ nước">Mủ nước</option>
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
                <div
                  onClick={() => toggleDate(date)}
                  className="bg-slate-50 px-5 py-3.5 cursor-pointer flex items-center justify-between hover:bg-slate-100 transition-colors select-none"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown size={18} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={18} className="text-slate-400" />
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
                  <div className="flex items-center gap-4 text-sm font-bold text-slate-600">
                    <span>{dayBanh.toLocaleString("vi-VN")} bành</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-emerald-700">
                      {(dayKg / 1000).toFixed(2)} T
                    </span>
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
                                {(caKg / 1000).toFixed(2)} Tấn
                              </span>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                                  <tr>
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
                                      SL Thực tế ca này
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Kiện (A/B/C/D) thời điểm
                                    </th>
                                    <th className="px-4 py-2.5 text-left">
                                      Trạng thái
                                    </th>
                                    <th className="px-4 py-2.5 text-center">
                                      Thao tác
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {caContribs.map((c) => (
                                    <tr
                                      key={c.uid}
                                      className="hover:bg-slate-50 transition-colors"
                                    >
                                      <td className="px-4 py-2.5 font-bold text-slate-700">
                                        {c.ma_lo}
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                                        {c.ngans?.ten_ngan || "—"}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">
                                          {c.loai_csr}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 font-extrabold text-blue-700">
                                        +{c.tong_banh_cua_ca}{" "}
                                        <span className="text-xs font-normal text-slate-500">
                                          (
                                          {(c.tong_kg_cua_ca / 1000).toFixed(2)}
                                          T)
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-xs text-slate-500">
                                        <span className="flex items-center gap-0.5 flex-wrap">
                                          {c.locked_a && <Lock size={9} className="text-indigo-400 shrink-0" />}
                                          <span>{c.kien_a}</span>
                                          <span>/</span>
                                          {c.locked_b && <Lock size={9} className="text-indigo-400 shrink-0" />}
                                          <span>{c.kien_b}</span>
                                          <span>/</span>
                                          {c.locked_c && <Lock size={9} className="text-indigo-400 shrink-0" />}
                                          <span>{c.kien_c}</span>
                                          <span>/</span>
                                          {c.locked_d && <Lock size={9} className="text-indigo-400 shrink-0" />}
                                          <span>{c.kien_d}</span>
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            c.trang_thai === "Hoàn thành"
                                              ? "bg-emerald-100 text-emerald-700"
                                              : c.trang_thai === "Xuất hàng"
                                                ? "bg-purple-100 text-purple-700"
                                                : "bg-amber-100 text-amber-700"
                                          }`}
                                        >
                                          {c.trang_thai}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <div className="flex justify-center gap-1">
                                          {c.trang_thai !== "Hoàn thành" && (
                                            <button
                                              onClick={() =>
                                                openEdit(
                                                  lots.find(
                                                    (l) => l.id === c.id,
                                                  )!,
                                                )
                                              }
                                              title="Sửa gốc lô này"
                                              className="p-1.5 hover:bg-blue-100 text-blue-500 rounded-lg transition-colors"
                                            >
                                              <Edit2 size={14} />
                                            </button>
                                          )}
                                          <button
                                            onClick={() => setDelConfirm(c.id)}
                                            title="Xóa gốc lô này"
                                            className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg transition-colors"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
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
                  <strong>Lưu ý:</strong> Việc sửa gốc sẽ thay đổi số liệu toàn
                  cục của lô này nhưng không sửa đổi các nhánh History phân ca
                  của nó. Chỉ sửa tay khi phát hiện sai sót số lượng tổng.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  Dây chuyền *
                </label>
                <div className="flex gap-3">
                  {["Mủ tạp", "Mủ nước"].map((dc) => (
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
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Hậu tố
                  </label>
                  <select
                    value={editForm.suffix}
                    onChange={(e) => updateEditForm({ suffix: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">Trống</option>
                    {(suffixList.length > 0
                      ? suffixList
                      : [
                          { code: "cs", name: "Nội tuyển PEFC" },
                          { code: "m", name: "Mua ngoài" },
                        ]
                    ).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Ngày SX *
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Ngăn lưu
                  </label>
                  <select
                    value={editForm.ngan_id}
                    onChange={(e) =>
                      updateEditForm({ ngan_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Chọn ngăn --</option>
                    {ngans.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.ten_ngan} — {n.ma_ngan}
                      </option>
                    ))}
                  </select>
                </div>
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
                          className={
                            editForm.trang_thai === "Hoàn thành"
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
                  Ghi chú
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

      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">
              Xác nhận xóa?
            </h3>
            <p className="text-sm text-slate-500 mb-5">
              Lô này sẽ bị xóa vĩnh viễn. Ngăn lưu liên quan sẽ được cập nhật
              trạng thái tự động.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

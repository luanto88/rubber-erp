"use client";
import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth";
import {
  dedupeLotsByMaLo,
  normalizeLotCode,
  normalizeLotStatus,
} from "@/app/dashboard/product/shared";
import {
  FileOutput,
  Plus,
  X,
  Search,
  Truck,
  Package,
  ChevronDown,
  ChevronUp,
  Edit2,
  Trash2,
  Check,
  QrCode,
  UserPlus,
  AlertTriangle,
  GripVertical,
  Printer,
  ImagePlus,
  ArrowLeftRight,
} from "lucide-react";
import { QRCodeSVG as QRCode } from "qrcode.react";
import { FilterBar } from "@/app/dashboard/_components/filter-bar";
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper";
import { ModalShell } from "@/app/dashboard/_components/modal-shell";
import { CustomerGrantModal } from "@/app/dashboard/export/_components/customer-grant-modal";

// --- Types -------------------------------------------------------------------
type Vehicle = {
  id: string;
  loai_xe: string;
  bien_truoc: string;
  bien_sau: string;
  ghi_chu: string;
  image_urls?: string[];
  // backward-compat fields from old data
  image_url_1?: string;
  image_url_2?: string;
  image_url_3?: string;
  // Đánh dấu xe đã đầy — chỉ toggle trên mobile; xe đầy bị loại khỏi danh sách gán lô nhanh
  confirmed?: boolean;
};
type Assignment = {
  lot_id: string;
  ma_lo: string;
  vehicleIdx: number;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
};
type ChiTieuReq = { ten: string; min: string; max: string };

type ExportOrder = {
  id: string;
  factory_id: string;
  ma_don: string;
  ngay: string;
  so_thong_bao: string;
  so_hoa_don: string;
  so_hop_dong: string;
  customer_id: string | null;
  chung_loai: string;
  loai_pallet: string;
  loai_banh: number;
  loai_boc: string;
  vehicles: Vehicle[];
  assignments: Assignment[];
  tong_banh: number;
  yeu_cau_chi_tieu: ChiTieuReq[];
  files: { name: string; url: string; path?: string; size?: number }[];
  trang_thai?: string | null;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  customers?: {
    ma_kh: string;
    ten_kh_en: string;
    quoc_gia: string;
    dia_chi: string;
    email: string;
    nguoi_lien_he: string;
  };
};

type LotRaw = {
  id: string;
  ma_lo: string;
  factory_id?: string | null;
  loai_csr: string;
  loai_banh: number;
  boc?: string | null;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  tong_banh: number;
  tong_kg: number;
  trang_thai: string;
  created_at?: string | null;
  updated_at?: string | null;
};
type LotExt = LotRaw & {
  rem_a: number;
  rem_b: number;
  rem_c: number;
  rem_d: number;
};

type Customer = {
  id: string;
  ma_kh: string;
  ten_kh_en: string;
  quoc_gia: string;
  dia_chi: string;
  email: string;
  nguoi_lien_he: string;
};

type QcGrade = {
  dat: boolean;
  tb?: number;
  min?: number;
  max?: number;
  detail?: string;
};
type QcResult = {
  id: string;
  lot_id: string | null;
  ma_lo?: string | null;
  loai_csr: string;
  trang_thai: string;
  dat_hang?: string | null;
  grade: Record<string, QcGrade>;
  ngay_kn: string;
  created_at?: string;
};

// --- Constants ---------------------------------------------------------------
const LOAI_XE_OPTS = [
  "Container 20ft",
  "Container 40ft",
  "Xe tải mui bạt",
  "Khác",
];
const CSR_OPTS = ["CSR10", "CSR20", "CSR3L", "CSRL", "CSRCV50", "CSRCV60"];
const SVR_OPTS = ["SVR10", "SVR20", "SVR3L", "SVRL", "SVRCV50", "SVRCV60"];
const PALLET_XUAT_BASE = ["Rời", "PE đế gỗ", "PE đế nhựa", "Gỗ", "MB4", "MB5"];
const CHI_TIEU_LIST = [
  "Tạp chất",
  "Tro",
  "Bay hơi",
  "Nitơ",
  "Po",
  "PRI",
  "Độ nhớt",
];
const CHI_TIEU_KEY: Record<string, string> = {
  "Tạp chất": "tap_chat",
  "Tro": "tro",
  "Bay hơi": "bay_hoi",
  "Nitơ": "nito",
  "Po": "po",
  "PRI": "pri",
  "Độ nhớt": "mooney",
};
const EXPORT_DRAFT_SESSION_KEY = "export_order_draft_v1";
const EXPORT_ORDER_STATUS_PENDING = "cho_phe_duyet";
const EXPORT_ORDER_STATUS_APPROVED = "da_phe_duyet";
const EXPORT_ORDER_APPROVER_TITLES = new Set([
  "giam doc nha may",
  "pho giam doc nha may",
]);

const emptyVehicle = (): Vehicle => ({
  id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  loai_xe: "Container 40ft",
  bien_truoc: "",
  bien_sau: "",
  ghi_chu: "",
  image_urls: [],
});

const emptyCustomerForm = () => ({
  ma_kh: "",
  ten_kh_en: "",
  quoc_gia: "",
  dia_chi: "",
  email: "",
  nguoi_lien_he: "",
});

const emptyForm = (prefix: "CSR" | "SVR" = "CSR") => ({
  ma_don: "",
  ngay: new Date().toISOString().slice(0, 10),
  so_thong_bao: "",
  so_hoa_don: "",
  so_hop_dong: "",
  customer_id: "",
  chung_loai: `${prefix}10`,
  loai_pallet: "Rời",
  loai_banh: 35,
  loai_boc: `Bọc nhãn 0,04 VRG ${prefix}10`,
  vehicles: [emptyVehicle()] as Vehicle[],
  assignments: [] as Assignment[],
  yeu_cau_chi_tieu: [] as ChiTieuReq[],
});
type ExportForm = ReturnType<typeof emptyForm>;
type PendingRetestAttach = {
  lotId: string;
  maLo: string;
  vehicleIdx: number;
  passed: boolean;
};
type ExportDraftSnapshot = {
  editId: string | null;
  form: ExportForm;
  pendingRetest: Omit<PendingRetestAttach, "passed">;
};

type SessionUserLite = {
  id: string;
  role?: string | null;
  full_name?: string | null;
  username?: string | null;
};

type MaintenanceStaffApproverRow = {
  ten: string | null;
  chuc_vu_chinh_quyen: string | null;
};

// --- Helpers -----------------------------------------------------------------
function getLoaiBanhOptions(chung_loai: string): number[] {
  if (["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"].includes(chung_loai))
    return [35, 20];
  if (["CSRL", "CSR3L", "SVRL", "SVR3L"].includes(chung_loai))
    return [35, 33.33];
  return [35];
}

function getBocOpts(chung_loai: string): string[] {
  const isMuNuoc = [
    "CSRL",
    "CSR3L",
    "CSRCV50",
    "CSRCV60",
    "SVRL",
    "SVR3L",
    "SVRCV50",
    "SVRCV60",
  ].includes(chung_loai);
  const base = [`Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG ${chung_loai}`];
  return isMuNuoc
    ? [...base, `Bọc trơn 0,13`, `Bọc nhãn 0,13 VRG ${chung_loai}`]
    : base;
}

function ddmmyy(dateStr: string) {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}${mm}${yy}`;
}

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function getExportOrderStatus(order?: Pick<ExportOrder, "trang_thai"> | null) {
  return order?.trang_thai || EXPORT_ORDER_STATUS_APPROVED;
}

function getExportOrderStatusLabel(status?: string | null) {
  return getExportOrderStatus({ trang_thai: status }) === EXPORT_ORDER_STATUS_PENDING
    ? "Chờ phê duyệt"
    : "Đã phê duyệt";
}

function getExportOrderStatusClasses(status?: string | null) {
  return getExportOrderStatus({ trang_thai: status }) === EXPORT_ORDER_STATUS_PENDING
    ? "bg-amber-100 text-amber-700"
    : "bg-emerald-100 text-emerald-700";
}

function getQcMetricValue(grade?: QcGrade | null) {
  if (!grade) return null;
  if (typeof grade.tb === "number" && !Number.isNaN(grade.tb)) return grade.tb;
  if (typeof grade.min === "number" && !Number.isNaN(grade.min)) return grade.min;
  if (typeof grade.max === "number" && !Number.isNaN(grade.max)) return grade.max;
  return null;
}

function getOrderAssignedCount(order: { assignments?: Assignment[] }, lotId: string) {
  return (order.assignments || [])
    .filter((a) => a.lot_id === lotId)
    .reduce(
      (sum, a) =>
        sum +
        Number(a.kien_a || 0) +
        Number(a.kien_b || 0) +
        Number(a.kien_c || 0) +
        Number(a.kien_d || 0),
      0,
    );
}

// --- Main --------------------------------------------------------------------
export default function ExportPage() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<ExportOrder[]>([]);
  const [lotsRaw, setLotsRaw] = useState<LotRaw[]>([]);
  const [qcResults, setQcResults] = useState<QcResult[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [factory, setFactory] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [currentUser, setCurrentUser] = useState<SessionUserLite | null>(null);
  const [canApproveOrders, setCanApproveOrders] = useState(false);
  const [grantModalOrder, setGrantModalOrder] = useState<ExportOrder | null>(null);
  const isNMCP = useMemo(
    () => factory?.name?.toLowerCase().includes("cuaparis") ?? false,
    [factory],
  );
  const csrOpts = useMemo(() => (isNMCP ? SVR_OPTS : CSR_OPTS), [isNMCP]);

  // Pallet xuất: base list + custom options added at runtime
  const [palletExtra, setPalletExtra] = useState<string[]>([]);
  const [newPalletInput, setNewPalletInput] = useState("");
  const palletOpts = useMemo(
    () => [...PALLET_XUAT_BASE, ...palletExtra],
    [palletExtra],
  );

  // Filters (list view)
  const [search, setSearch] = useState("");
  const [filterLoai, setFilterLoai] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Views
  const [view, setView] = useState<"list" | "add">("list");
  const [form, setForm] = useState<ExportForm>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [pendingRetestAttach, setPendingRetestAttach] =
    useState<PendingRetestAttach | null>(null);

  // Drag state
  const [draggingLotId, setDraggingLotId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null); // vehicleIdx

  // Vehicle image upload
  const [uploadingVehicleIdx, setUploadingVehicleIdx] = useState<number | null>(null);
  const [ocrLoadingVehicleIdx, setOcrLoadingVehicleIdx] = useState<number | null>(null);

  // Lot search
  const [lotSearch, setLotSearch] = useState("");

  // Customer modal
  const [custModal, setCustModal] = useState(false);
  const [custForm, setCustForm] = useState(emptyCustomerForm());
  const [custSaving, setCustSaving] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const persistExportDraft = useCallback(
    (pendingRetest: ExportDraftSnapshot["pendingRetest"]) => {
      if (typeof window === "undefined") return;
      const snapshot: ExportDraftSnapshot = {
        editId,
        form,
        pendingRetest,
      };
      window.sessionStorage.setItem(
        EXPORT_DRAFT_SESSION_KEY,
        JSON.stringify(snapshot),
      );
    },
    [editId, form],
  );

  // -- Load ------------------------------------------------------------------
  const loadData = useCallback(
    async (fid: string) => {
      setLoading(true);
      try {
        let q = supabase
          .from("export_orders")
          .select(
            "*, customers(ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he)",
          )
          .eq("factory_id", fid)
          .order("ngay", { ascending: false });
        if (filterLoai) q = q.eq("chung_loai", filterLoai);
        if (filterFrom) q = q.gte("ngay", filterFrom);
        if (filterTo) q = q.lte("ngay", filterTo);
        const { data } = await q;
        setOrders(data || []);
      } finally {
        setLoading(false);
      }
    },
    [filterLoai, filterFrom, filterTo],
  );

  const loadLots = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("lots")
      .select(
        "id,factory_id,ma_lo,loai_csr,loai_banh,boc,kien_a,kien_b,kien_c,kien_d,tong_banh,tong_kg,trang_thai,created_at,updated_at",
      )
      .eq("factory_id", fid)
      .order("num", { ascending: false });
    const filteredLots = (data || []).filter((lot) => {
      const status = normalizeLotStatus(lot.trang_thai);
      return status === "Hoàn thành" || status === "Xuất hàng";
    });
    setLotsRaw(filteredLots);
  }, []);

  const loadQcResults = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("qc_results")
      .select("id,lot_id,ma_lo,loai_csr,trang_thai,dat_hang,grade,ngay_kn,created_at")
      .eq("factory_id", fid)
      .order("ngay_kn", { ascending: false })
      .order("created_at", { ascending: false });
    setQcResults(data || []);
  }, []);

  const loadCustomers = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("customers")
      .select("id,ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he")
      .eq("factory_id", fid)
      .order("ten_kh_en");
    setCustomers(data || []);
  }, []);

  // Bootstrap: chỉ chạy 1 lần để lấy factoryId, không có loadXxx trong deps
  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null;
      if (!hasPermission(cachedUser, "export.view")) {
        setLoading(false);
        window.location.replace("/dashboard");
        return;
      }
      const fid = await getActiveFactoryId();
      if (!fid) {
        setLoading(false);
        return;
      }
      setFactoryId(fid);
      const rawUser =
        typeof window !== "undefined"
          ? window.localStorage.getItem("erp_user")
          : null;
      const parsedUser = rawUser ? (JSON.parse(rawUser) as SessionUserLite) : null;
      setCurrentUser(parsedUser);
      if (parsedUser?.role === "admin") {
        setCanApproveOrders(true);
      } else if (parsedUser?.id) {
        const fullName = parsedUser.full_name?.trim() || "";
        const [staffByProfileRes, staffByNameRes] = await Promise.all([
          supabase
            .from("maintenance_staff")
            .select("ten,chuc_vu_chinh_quyen")
            .eq("factory_id", fid)
            .eq("active", true)
            .eq("profile_id", parsedUser.id)
            .maybeSingle(),
          fullName
            ? supabase
                .from("maintenance_staff")
                .select("ten,chuc_vu_chinh_quyen")
                .eq("factory_id", fid)
                .eq("active", true)
                .eq("ten", fullName)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        const staffRow =
          (staffByProfileRes.data as MaintenanceStaffApproverRow | null) ||
          (staffByNameRes.data as MaintenanceStaffApproverRow | null);
        setCanApproveOrders(
          EXPORT_ORDER_APPROVER_TITLES.has(
            normalizeText(staffRow?.chuc_vu_chinh_quyen),
          ),
        );
      } else {
        setCanApproveOrders(false);
      }
      supabase
        .from("factories")
        .select("id,name")
        .eq("id", fid)
        .single()
        .then(({ data }) => {
          if (data) setFactory(data);
        });
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("draft") !== "restore") return;

    const raw = window.sessionStorage.getItem(EXPORT_DRAFT_SESSION_KEY);
    if (!raw) return;

    try {
      const snapshot = JSON.parse(raw) as ExportDraftSnapshot;
      setForm(snapshot.form);
      setEditId(snapshot.editId);
      setView("add");
      if (
        snapshot.form.loai_pallet &&
        !PALLET_XUAT_BASE.includes(snapshot.form.loai_pallet)
      ) {
        setPalletExtra((prev) =>
          prev.includes(snapshot.form.loai_pallet)
            ? prev
            : [...prev, snapshot.form.loai_pallet],
        );
      }
      setPendingRetestAttach({
        ...snapshot.pendingRetest,
        passed: searchParams.get("retestPassed") === "1",
      });
    } catch {
      window.sessionStorage.removeItem(EXPORT_DRAFT_SESSION_KEY);
    }

    const nextUrl = window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [searchParams]);

  // Reload khi factoryId hoặc filter thay đổi
  useEffect(() => {
    if (!factoryId) return;
    void loadData(factoryId);
    void loadLots(factoryId);
    void loadQcResults(factoryId);
    void loadCustomers(factoryId);
  }, [factoryId, loadData, loadLots, loadQcResults, loadCustomers]);

  // -- Compute remaining per lot --------------------------------------------
  const lotById = useMemo(
    () => new Map(lotsRaw.map((lot) => [lot.id, lot] as const)),
    [lotsRaw],
  );

  const canonicalLotByCode = useMemo(
    () =>
      new Map(
        dedupeLotsByMaLo(lotsRaw).map(
          (lot) => [normalizeLotCode(lot.ma_lo), lot] as const,
        ),
      ),
    [lotsRaw],
  );

  const resolveAssignmentLot = useCallback(
    (assignment: Pick<Assignment, "lot_id" | "ma_lo">) =>
      canonicalLotByCode.get(normalizeLotCode(assignment.ma_lo)) ||
      lotById.get(assignment.lot_id) ||
      null,
    [canonicalLotByCode, lotById],
  );

  const lotsExt = useMemo<LotExt[]>(() => {
    const pastAssignments = orders
      .filter((o) => o.id !== editId)
      .flatMap((o) =>
        (o.assignments || []).map((assignment) => {
          const resolvedLot = resolveAssignmentLot(assignment);
          return resolvedLot ? { ...assignment, lot_id: resolvedLot.id } : assignment;
        }),
      );
    return dedupeLotsByMaLo(lotsRaw)
      .map((lot) => {
        const expA = pastAssignments
          .filter((a) => a.lot_id === lot.id)
          .reduce((s, a) => s + (a.kien_a || 0), 0);
        const expB = pastAssignments
          .filter((a) => a.lot_id === lot.id)
          .reduce((s, a) => s + (a.kien_b || 0), 0);
        const expC = pastAssignments
          .filter((a) => a.lot_id === lot.id)
          .reduce((s, a) => s + (a.kien_c || 0), 0);
        const expD = pastAssignments
          .filter((a) => a.lot_id === lot.id)
          .reduce((s, a) => s + (a.kien_d || 0), 0);
        return {
          ...lot,
          rem_a: lot.kien_a - expA,
          rem_b: lot.kien_b - expB,
          rem_c: lot.kien_c - expC,
          rem_d: lot.kien_d - expD,
        };
      })
      .filter((l) => l.rem_a + l.rem_b + l.rem_c + l.rem_d > 0);
  }, [lotsRaw, orders, editId, resolveAssignmentLot]);

  const latestQcByLotId = useMemo(() => {
    const byId = new Map<string, QcResult>();
    const byCode = new Map<string, QcResult>();

    qcResults.forEach((result) => {
      if (result.lot_id && !byId.has(result.lot_id)) {
        byId.set(result.lot_id, result);
      }
      const lotCode = normalizeLotCode(result.ma_lo);
      if (lotCode && !byCode.has(lotCode)) {
        byCode.set(lotCode, result);
      }
    });

    const resolved = new Map<string, QcResult>();
    lotsRaw.forEach((lot) => {
      const exact = byId.get(lot.id);
      if (exact) {
        resolved.set(lot.id, exact);
        return;
      }
      const fallback = byCode.get(normalizeLotCode(lot.ma_lo));
      if (fallback) {
        resolved.set(lot.id, fallback);
      }
    });

    return resolved;
  }, [lotsRaw, qcResults]);

  // -- Vehicle history suggestions ------------------------------------------
  const vehicleSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return orders
      .flatMap((o) => o.vehicles ?? [])
      .filter((v) => {
        if (!v.bien_truoc || seen.has(v.bien_truoc)) return false;
        seen.add(v.bien_truoc);
        return true;
      });
  }, [orders]);

  // -- Filter lots for picker -----------------------------------------------
  const availLots = useMemo(() => {
    let base = lotsExt.filter((l) => {
      if (l.loai_csr !== form.chung_loai) return false;
      if (Number(l.loai_banh) !== Number(form.loai_banh)) return false;
      if (normalizeText(l.boc) !== normalizeText(form.loai_boc)) return false;
      return latestQcByLotId.has(l.id);
    });
    if (lotSearch)
      base = base.filter((l) =>
        l.ma_lo.toLowerCase().includes(lotSearch.toLowerCase()),
      );
    if (form.yeu_cau_chi_tieu.length === 0) return base;
    // Filter by QC requirements
    return base.filter((lot) => {
      const latestQc = latestQcByLotId.get(lot.id);
      if (!latestQc) return false;
      return form.yeu_cau_chi_tieu.every((req) => {
        const key = CHI_TIEU_KEY[req.ten];
        if (!key) return true;
        const g = latestQc.grade?.[key];
        if (!g) return false;
        const metric = getQcMetricValue(g);
        if (metric === null) return false;
        if (req.min !== "" && !Number.isNaN(+req.min) && metric < +req.min) {
          return false;
        }
        if (req.max !== "" && !Number.isNaN(+req.max) && metric > +req.max) {
          return false;
        }
        return true;
      });
    });
  }, [
    lotsExt,
    form.chung_loai,
    form.loai_banh,
    form.loai_boc,
    form.yeu_cau_chi_tieu,
    lotSearch,
    latestQcByLotId,
  ]);

  // -- Ma don auto -----------------------------------------------------------
  useEffect(() => {
    if (editId) return; // don't recalculate in edit mode
    if (form.customer_id && form.so_thong_bao && form.ngay) {
      const kh = customers.find((c) => c.id === form.customer_id)?.ma_kh ?? "";
      const d = ddmmyy(form.ngay);

      // Tìm các đơn xuất của cùng khách hàng trong cùng ngày
      const sameDayCustomerOrders = orders.filter(
        (o) =>
          o.customer_id === form.customer_id && o.ngay?.startsWith(form.ngay),
      );

      // Tìm số thứ tự lớn nhất hiện tại
      let maxStt = 0;
      sameDayCustomerOrders.forEach((o) => {
        if (o.ma_don && o.ma_don.includes("/")) {
          const parts = o.ma_don.split("/");
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxStt) {
            maxStt = num;
          }
        }
      });
      // Fallback nếu có đơn cũ chưa có định dạng dấu /
      if (maxStt === 0 && sameDayCustomerOrders.length > 0) {
        maxStt = sameDayCustomerOrders.length;
      }

      const stt = maxStt + 1;
      setForm((p) => ({
        ...p,
        ma_don: `XH-${kh}-${form.so_thong_bao}-${d}/${stt}`,
      }));
    } else {
      setForm((p) => ({ ...p, ma_don: "" }));
    }
  }, [
    form.customer_id,
    form.so_thong_bao,
    form.ngay,
    customers,
    editId,
    orders,
  ]);

  // -- Stats -----------------------------------------------------------------
  const stats = {
    total: orders.length,
    tongBanh: orders.reduce((s, o) => s + (o.tong_banh || 0), 0),
    tongXe: orders.reduce((s, o) => s + (o.vehicles?.length || 0), 0),
  };

  const canEditOrder = useCallback(
    (order: ExportOrder) =>
      currentUser?.role === "admin" ||
      (Boolean(currentUser?.id) &&
        order.created_by === currentUser?.id &&
        getExportOrderStatus(order) === EXPORT_ORDER_STATUS_PENDING),
    [currentUser],
  );

  const canDeleteOrder = useCallback(
    (order: ExportOrder) => {
      void order;
      return currentUser?.role === "admin";
    },
    [currentUser],
  );

  // -- Open Edit -------------------------------------------------------------
  const openEdit = (order: ExportOrder) => {
    if (!canEditOrder(order)) {
      showToast("Bạn không có quyền sửa đơn này.", "error");
      return;
    }
    setForm({
      ma_don: order.ma_don || "",
      ngay: order.ngay?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      so_thong_bao: order.so_thong_bao || "",
      so_hoa_don: order.so_hoa_don || "",
      so_hop_dong: order.so_hop_dong || "",
      customer_id: order.customer_id || "",
      chung_loai: order.chung_loai || (isNMCP ? "SVR10" : "CSR10"),
      loai_pallet: order.loai_pallet || "Rời",
      loai_banh: order.loai_banh || 35,
      loai_boc:
        order.loai_boc ||
        `Bọc nhãn 0,04 VRG ${order.chung_loai || (isNMCP ? "SVR10" : "CSR10")}`,
      vehicles: order.vehicles?.length
        ? order.vehicles.map((v) => ({
            ...v,
            image_urls: v.image_urls ?? [v.image_url_1, v.image_url_2, v.image_url_3].filter(Boolean) as string[],
          }))
        : [emptyVehicle()],
      assignments: order.assignments?.length
        ? order.assignments.map((assignment) => {
            const resolvedLot = resolveAssignmentLot(assignment);
            return resolvedLot
              ? { ...assignment, lot_id: resolvedLot.id, ma_lo: resolvedLot.ma_lo }
              : { ...assignment };
          })
        : [],
      yeu_cau_chi_tieu: order.yeu_cau_chi_tieu || [],
    });
    // Nếu loai_pallet của đơn cũ không có trong base list thì thêm vào palletExtra
    if (order.loai_pallet && !PALLET_XUAT_BASE.includes(order.loai_pallet)) {
      setPalletExtra((prev) =>
        prev.includes(order.loai_pallet) ? prev : [...prev, order.loai_pallet],
      );
    }
    setEditId(order.id);
    setView("add");
  };

  // -- Assignment helpers ----------------------------------------------------
  const updateAssignment = (
    lot_id: string,
    vehicleIdx: number,
    field: keyof Assignment,
    val: number,
  ) => {
    setForm((prev) => ({
      ...prev,
      assignments: prev.assignments.map((a) =>
        a.lot_id === lot_id && a.vehicleIdx === vehicleIdx
          ? { ...a, [field]: val }
          : a,
      ),
    }));
  };

  const removeAssignment = (lot_id: string, vehicleIdx: number) => {
    setForm((prev) => ({
      ...prev,
      assignments: prev.assignments.filter(
        (a) => !(a.lot_id === lot_id && a.vehicleIdx === vehicleIdx),
      ),
    }));
  };

  // remaining after current form assignments
  const getFormRemaining = (lot: LotExt) => {
    const cur = form.assignments.filter((a) => a.lot_id === lot.id);
    const usedA = cur.reduce((s, a) => s + (a.kien_a || 0), 0);
    const usedB = cur.reduce((s, a) => s + (a.kien_b || 0), 0);
    const usedC = cur.reduce((s, a) => s + (a.kien_c || 0), 0);
    const usedD = cur.reduce((s, a) => s + (a.kien_d || 0), 0);
    return {
      a: lot.rem_a - usedA,
      b: lot.rem_b - usedB,
      c: lot.rem_c - usedC,
      d: lot.rem_d - usedD,
    };
  };

  const totalBanh = form.assignments.reduce(
    (s, a) =>
      s + (a.kien_a || 0) + (a.kien_b || 0) + (a.kien_c || 0) + (a.kien_d || 0),
    0,
  );

  const totalTan = (totalBanh * Number(form.loai_banh)) / 1000;

  const vehicleStats = useMemo(
    () =>
      form.vehicles.map((_, idx) => {
        const assigns = form.assignments.filter((a) => a.vehicleIdx === idx);
        const banh = assigns.reduce(
          (s, a) => s + (a.kien_a || 0) + (a.kien_b || 0) + (a.kien_c || 0) + (a.kien_d || 0),
          0,
        );
        const lo = new Set(assigns.map((a) => a.lot_id)).size;
        const tan = (banh * Number(form.loai_banh)) / 1000;
        return { banh, lo, tan };
      }),
    [form.vehicles, form.assignments, form.loai_banh],
  );

  useEffect(() => {
    if (!pendingRetestAttach) return;

    if (!pendingRetestAttach.passed) {
      showToast(
        `Lô ${pendingRetestAttach.maLo} vẫn chưa đạt hạng, giữ nguyên form xuất để bạn xử lý tiếp.`,
        "error",
      );
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(EXPORT_DRAFT_SESSION_KEY);
      }
      setPendingRetestAttach(null);
      return;
    }

    const lot = lotsExt.find((entry) => entry.id === pendingRetestAttach.lotId);
    const latestQc = latestQcByLotId.get(pendingRetestAttach.lotId);
    const isFailedQc =
      latestQc?.dat_hang?.endsWith("RH") || latestQc?.trang_thai === "khong_dat";
    if (!lot || !latestQc || isFailedQc) return;

    setForm((prev) => {
      const exists = prev.assignments.some(
        (assignment) =>
          assignment.lot_id === pendingRetestAttach.lotId &&
          assignment.vehicleIdx === pendingRetestAttach.vehicleIdx,
      );
      if (exists) return prev;

      const currentAssignments = prev.assignments.filter(
        (assignment) => assignment.lot_id === pendingRetestAttach.lotId,
      );
      const usedA = currentAssignments.reduce((sum, item) => sum + (item.kien_a || 0), 0);
      const usedB = currentAssignments.reduce((sum, item) => sum + (item.kien_b || 0), 0);
      const usedC = currentAssignments.reduce((sum, item) => sum + (item.kien_c || 0), 0);
      const usedD = currentAssignments.reduce((sum, item) => sum + (item.kien_d || 0), 0);

      return {
        ...prev,
        assignments: [
          ...prev.assignments,
          {
            lot_id: lot.id,
            ma_lo: lot.ma_lo,
            vehicleIdx: pendingRetestAttach.vehicleIdx,
            kien_a: Math.max(0, lot.rem_a - usedA),
            kien_b: Math.max(0, lot.rem_b - usedB),
            kien_c: Math.max(0, lot.rem_c - usedC),
            kien_d: Math.max(0, lot.rem_d - usedD),
          },
        ],
      };
    });

    showToast(
      `Lô ${pendingRetestAttach.maLo} đã đạt kiểm nghiệm lại và nằm sẵn trên xe ${pendingRetestAttach.vehicleIdx + 1}.`,
    );
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(EXPORT_DRAFT_SESSION_KEY);
    }
    setPendingRetestAttach(null);
  }, [latestQcByLotId, lotsExt, pendingRetestAttach]);

  // -- Drag & Drop -----------------------------------------------------------
  const handleDragStart = (e: React.DragEvent, lotId: string) => {
    e.dataTransfer.setData("lot_id", lotId);
    setDraggingLotId(lotId);
  };
  const handleDragEnd = () => {
    setDraggingLotId(null);
    setDropTarget(null);
  };
  const handleDragOver = (e: React.DragEvent, vIdx: number) => {
    e.preventDefault();
    setDropTarget(vIdx);
  };
  // Gán 1 lô vào 1 xe — dùng chung cho kéo-thả (desktop) và chọn nhanh (mobile)
  // Trả về true nếu đã thêm assignment mới (dùng để hiện toast xác nhận trên mobile)
  const assignLotToVehicle = (lotId: string, vIdx: number): boolean => {
    const lot = lotsExt.find((l) => l.id === lotId);
    if (!lot) return false;
    const latestQc = latestQcByLotId.get(lot.id);
    const isFailedQc =
      latestQc?.dat_hang?.endsWith("RH") || latestQc?.trang_thai === "khong_dat";
    if (isFailedQc) {
      persistExportDraft({
        lotId: lot.id,
        maLo: lot.ma_lo,
        vehicleIdx: vIdx,
      });
      const shouldRetest = window.confirm(
        `Lô ${lot.ma_lo} rớt hạng, cần kiểm nghiệm lại. Bấm OK để chuyển sang form kiểm nghiệm lại.`,
      );
      if (shouldRetest) {
        const params = new URLSearchParams({
          mode: "retest",
          lotId: lot.id,
          maLo: lot.ma_lo,
          chungLoai: lot.loai_csr.replace(/^(CSR|SVR)/, ""),
          ngaySx: form.ngay,
          returnTo: "/dashboard/export",
        });
        window.location.assign(`/dashboard/quality?${params.toString()}`);
        return false;
      }
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(EXPORT_DRAFT_SESSION_KEY);
      }
      return false;
    }
    const alreadyInVehicle = form.assignments.some(
      (a) => a.lot_id === lotId && a.vehicleIdx === vIdx,
    );
    if (alreadyInVehicle) return false;
    const rem = getFormRemaining(lot);
    setForm((prev) => ({
      ...prev,
      assignments: [
        ...prev.assignments,
        {
          lot_id: lot.id,
          ma_lo: lot.ma_lo,
          vehicleIdx: vIdx,
          kien_a: Math.max(0, rem.a),
          kien_b: Math.max(0, rem.b),
          kien_c: Math.max(0, rem.c),
          kien_d: Math.max(0, rem.d),
        },
      ],
    }));
    return true;
  };

  const handleDrop = (e: React.DragEvent, vIdx: number) => {
    e.preventDefault();
    setDropTarget(null);
    const lotId = e.dataTransfer.getData("lot_id");
    assignLotToVehicle(lotId, vIdx);
  };

  // Chọn nhanh gán lô vào xe trên mobile (thay thế kéo-thả không hoạt động trên cảm ứng)
  const handleMobileAssign = (lot: LotExt, vIdx: number) => {
    if (assignLotToVehicle(lot.id, vIdx)) {
      showToast(`Đã gán lô ${lot.ma_lo} vào xe ${vIdx + 1}`);
    }
  };

  const reconcileLotStatuses = useCallback(
    async (
      affectedLotIds: string[],
      orderSnapshot: Array<{
        id?: string;
        assignments?: Assignment[];
        trang_thai?: string | null;
      }>,
    ) => {
      const uniqueLotIds = [...new Set(affectedLotIds)].filter(Boolean);
      if (uniqueLotIds.length === 0 || !factoryId) return;

      const { data: affectedLots, error: lotsError } = await supabase
        .from("lots")
        .select("id,tong_banh,trang_thai")
        .eq("factory_id", factoryId)
        .in("id", uniqueLotIds);

      if (lotsError) throw new Error(lotsError.message);

      for (const lot of affectedLots || []) {
        const lotId = lot.id;
        const assigned = orderSnapshot.reduce(
          (sum, order) =>
            getExportOrderStatus({ trang_thai: order.trang_thai }) ===
            EXPORT_ORDER_STATUS_APPROVED
              ? sum + getOrderAssignedCount(order, lotId)
              : sum,
          0,
        );
        const nextStatus =
          assigned > 0 && assigned >= Number(lot.tong_banh || 0)
            ? "Xuất hàng"
            : "Hoàn thành";

        if (normalizeLotStatus(lot.trang_thai) === normalizeLotStatus(nextStatus)) {
          continue;
        }

        const { error: updateError } = await supabase
          .from("lots")
          .update({ trang_thai: nextStatus })
          .eq("id", lotId);

        if (updateError) throw new Error(updateError.message);
      }
    },
    [factoryId],
  );

  // -- Vehicle image upload --------------------------------------------------
  const handleVehicleImageUpload = async (
    vehicleIdx: number,
    files: FileList | null,
  ) => {
    if (!files || !factoryId) return;
    const vehicle = form.vehicles[vehicleIdx];
    const currentUrls = vehicle.image_urls ?? [];
    const remaining = 6 - currentUrls.length;
    if (remaining <= 0) return;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploadingVehicleIdx(vehicleIdx);
    try {
      const uploaded: string[] = [];
      for (const file of toUpload) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${factoryId}/vehicles/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { error } = await supabase.storage
          .from("order-files")
          .upload(path, file, { upsert: true });
        if (error) continue;
        const { data: urlData } = supabase.storage
          .from("order-files")
          .getPublicUrl(path);
        uploaded.push(urlData.publicUrl);
      }
      if (uploaded.length > 0) {
        setForm((p) => ({
          ...p,
          vehicles: p.vehicles.map((v, i) =>
            i === vehicleIdx
              ? { ...v, image_urls: [...(v.image_urls ?? []), ...uploaded] }
              : v,
          ),
        }));
        // OCR tất cả ảnh vừa upload (tối đa 6), khử trùng và tự gán vào 2 ô
        // theo quy tắc: biển có số đầu nhỏ hơn -> Biển trước, số đầu lớn hơn -> Biển sau
        setOcrLoadingVehicleIdx(vehicleIdx);
        void Promise.all(
          uploaded.map((imageUrl) =>
            fetch("/api/export/ocr-plate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageUrl }),
            })
              .then((r) => r.json() as Promise<{ plate?: string | null }>)
              .then((d) => d.plate ?? null)
              .catch(() => null),
          ),
        )
          .then((results) => {
            const detected = results.filter((p): p is string => !!p);
            if (detected.length === 0) {
              showToast("Không đọc được biển số từ ảnh", "error");
              return;
            }
            // Đếm tần suất từng biển số (nhiều ảnh có thể chụp trùng 1 biển),
            // chỉ giữ lại tối đa 2 giá trị khác nhau xuất hiện nhiều nhất — loại nhiễu OCR
            const order: string[] = [];
            const freq = new Map<string, number>();
            for (const plate of detected) {
              if (!freq.has(plate)) order.push(plate);
              freq.set(plate, (freq.get(plate) ?? 0) + 1);
            }
            const distinct = order
              .slice()
              .sort(
                (a, b) =>
                  (freq.get(b) ?? 0) - (freq.get(a) ?? 0) ||
                  order.indexOf(a) - order.indexOf(b),
              )
              .slice(0, 2);

            const leadingDigits = (plate: string) => {
              const m = plate.match(/^\d+/);
              return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
            };

            const fill: { bien_truoc?: string; bien_sau?: string } = {};

            if (distinct.length === 1) {
              // Chỉ nhận diện được 1 biển số — điền vào ô trống đầu tiên
              if (!vehicle.bien_truoc) fill.bien_truoc = distinct[0];
              else if (!vehicle.bien_sau) fill.bien_sau = distinct[0];
            } else {
              const [a, b] = distinct;
              const front = leadingDigits(a) <= leadingDigits(b) ? a : b;
              const back = front === a ? b : a;
              if (!vehicle.bien_truoc) fill.bien_truoc = front;
              if (!vehicle.bien_sau) fill.bien_sau = back;
            }

            if (fill.bien_truoc || fill.bien_sau) {
              setForm((p) => ({
                ...p,
                vehicles: p.vehicles.map((v, i) =>
                  i === vehicleIdx ? { ...v, ...fill } : v,
                ),
              }));
              const parts = [
                fill.bien_truoc && `trước ${fill.bien_truoc}`,
                fill.bien_sau && `sau ${fill.bien_sau}`,
              ].filter(Boolean);
              showToast(`Đã tự điền biển số: ${parts.join(", ")}`, "success");
            } else {
              showToast(
                `Đã nhận diện biển số: ${distinct.join(", ")} (Biển trước/sau đã có dữ liệu)`,
                "error",
              );
            }
          })
          .finally(() => {
            setOcrLoadingVehicleIdx(null);
          });
      }
    } finally {
      setUploadingVehicleIdx(null);
    }
  };

  // -- Yeu cau chi tieu ------------------------------------------------------
  const toggleChiTieu = (ten: string) => {
    setForm((prev) => {
      const exists = prev.yeu_cau_chi_tieu.find((r) => r.ten === ten);
      if (exists)
        return {
          ...prev,
          yeu_cau_chi_tieu: prev.yeu_cau_chi_tieu.filter((r) => r.ten !== ten),
        };
      return {
        ...prev,
        yeu_cau_chi_tieu: [...prev.yeu_cau_chi_tieu, { ten, min: "", max: "" }],
      };
    });
  };
  const updateChiTieu = (ten: string, field: "min" | "max", val: string) => {
    setForm((prev) => ({
      ...prev,
      yeu_cau_chi_tieu: prev.yeu_cau_chi_tieu.map((r) =>
        r.ten === ten ? { ...r, [field]: val } : r,
      ),
    }));
  };

  // -- Save ------------------------------------------------------------------
  const handleSave = async () => {
    if (!factoryId) return;
    if (!form.ma_don) {
      showToast("Chưa có mã đơn - cần chọn KH + số thông báo + ngày", "error");
      return;
    }
    setSaving(true);
    try {
      // Server-side validation: ngăn over-commit khi nhiều đơn cùng assign một lô
      if (form.assignments.length > 0) {
        const { error: validErr } = await supabase.rpc("validate_export_assignments", {
          p_factory_id: factoryId,
          p_exclude_order_id: editId ?? null,
          p_assignments: form.assignments,
        });
        if (validErr) {
          showToast(validErr.message, "error");
          return;
        }
      }

      const payload = {
        factory_id: factoryId,
        ma_don: form.ma_don,
        ngay: form.ngay,
        so_thong_bao: form.so_thong_bao,
        so_hoa_don: form.so_hoa_don,
        so_hop_dong: form.so_hop_dong,
        customer_id: form.customer_id || null,
        chung_loai: form.chung_loai,
        loai_pallet: form.loai_pallet,
        vehicles: form.vehicles,
        assignments: form.assignments,
        yeu_cau_chi_tieu: form.yeu_cau_chi_tieu,
        tong_banh: totalBanh,
      };
      const newLotIds = [...new Set(form.assignments.map((a) => a.lot_id))];
      if (editId) {
        const oldOrder = orders.find((o) => o.id === editId);
        if (!oldOrder || !canEditOrder(oldOrder)) {
          showToast("Bạn không có quyền sửa đơn này.", "error");
          return;
        }
        const oldLotIds = oldOrder?.assignments?.length
          ? [...new Set(oldOrder.assignments.map((a: Assignment) => a.lot_id))]
          : [];
        const { error } = await supabase
          .from("export_orders")
          .update({
            ...payload,
            trang_thai: getExportOrderStatus(oldOrder),
            created_by: oldOrder.created_by || currentUser?.id || null,
            approved_by: oldOrder.approved_by || null,
            approved_at: oldOrder.approved_at || null,
          })
          .eq("id", editId);
        if (error) {
          showToast(error.message, "error");
          return;
        }
        const { data: latestOrders, error: snapshotError } = await supabase
          .from("export_orders")
          .select("id,assignments,trang_thai")
          .eq("factory_id", factoryId);
        if (snapshotError) {
          showToast(snapshotError.message, "error");
          return;
        }
        await reconcileLotStatuses(
          [...oldLotIds, ...newLotIds],
          (latestOrders || []) as Array<{ id?: string; assignments?: Assignment[] }>,
        );
        showToast("Đã cập nhật đơn xuất hàng");
      } else {
        const insertPayload = {
          ...payload,
          trang_thai: EXPORT_ORDER_STATUS_PENDING,
          created_by: currentUser?.id || null,
          approved_by: null,
          approved_at: null,
        };
        const { error } = await supabase
          .from("export_orders")
          .insert(insertPayload);
        if (error) {
          showToast(error.message, "error");
          return;
        }
        const { data: latestOrders, error: snapshotError } = await supabase
          .from("export_orders")
          .select("id,assignments,trang_thai")
          .eq("factory_id", factoryId);
        if (snapshotError) {
          showToast(snapshotError.message, "error");
          return;
        }
        await reconcileLotStatuses(
          newLotIds,
          (latestOrders || []) as Array<{ id?: string; assignments?: Assignment[] }>,
        );
        showToast("Đã tạo đơn xuất hàng mới");
      }
      setView("list");
      setEditId(null);
      setForm(emptyForm());
      void loadData(factoryId);
      void loadLots(factoryId);
      void loadQcResults(factoryId);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Lỗi không xác định",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  // -- Delete ----------------------------------------------------------------
  const handleDelete = async (id: string) => {
    if (!factoryId) return;
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    if (!canDeleteOrder(order)) {
      showToast("Bạn không có quyền xóa đơn này.", "error");
      return;
    }
    // Lấy assignments fresh từ DB trước khi xóa — tránh trường hợp state stale
    // khiến affectedLotIds = [] và reconcileLotStatuses không chạy, lô kẹt "Xuất hàng"
    const { data: freshOrder } = await supabase
      .from("export_orders")
      .select("id, assignments")
      .eq("id", id)
      .single();
    const affectedLotIds = freshOrder?.assignments?.length
      ? [
          ...new Set(
            (freshOrder.assignments as Assignment[])
              .map((a) => a.lot_id)
              .filter(Boolean),
          ),
        ]
      : [];

    const { error } = await supabase
      .from("export_orders")
      .delete()
      .eq("id", id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    if (affectedLotIds.length > 0) {
      const { data: latestOrders, error: snapshotError } = await supabase
        .from("export_orders")
        .select("id,assignments,trang_thai")
        .eq("factory_id", factoryId);
      if (snapshotError) {
        showToast(snapshotError.message, "error");
        return;
      }
      await reconcileLotStatuses(affectedLotIds, latestOrders ?? []);
    }

    setDelConfirm(null);
    showToast("Đã xóa đơn xuất hàng");
    void loadData(factoryId);
    void loadLots(factoryId);
    void loadQcResults(factoryId);
  };

  const handleApproveOrder = async (order: ExportOrder) => {
    if (!factoryId || !currentUser?.id) return;
    if (!canApproveOrders) {
      showToast("Bạn không có quyền phê duyệt đơn này.", "error");
      return;
    }
    if (getExportOrderStatus(order) !== EXPORT_ORDER_STATUS_PENDING) {
      showToast("Đơn này đã được phê duyệt.", "error");
      return;
    }

    const { error } = await supabase
      .from("export_orders")
      .update({
        trang_thai: EXPORT_ORDER_STATUS_APPROVED,
        approved_by: currentUser.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    const affectedLotIds = order.assignments?.length
      ? [...new Set(order.assignments.map((assignment) => assignment.lot_id))]
      : [];
    if (affectedLotIds.length > 0) {
      const { data: latestOrders, error: snapshotError } = await supabase
        .from("export_orders")
        .select("id,assignments,trang_thai")
        .eq("factory_id", factoryId);
      if (snapshotError) {
        showToast(snapshotError.message, "error");
        return;
      }
      await reconcileLotStatuses(
        affectedLotIds,
        (latestOrders || []) as Array<{
          id?: string;
          assignments?: Assignment[];
          trang_thai?: string | null;
        }>,
      );
    }

    showToast("Đã phê duyệt đơn xuất hàng");
    void loadData(factoryId);
    void loadLots(factoryId);
    void loadQcResults(factoryId);
  };

  // -- Create customer inline ------------------------------------------------
  const handleCreateCustomer = async () => {
    if (!factoryId) return;
    if (!custForm.ma_kh || !custForm.ten_kh_en) {
      setCustError("Cần điền Mã KH và Tên KH");
      return;
    }
    setCustSaving(true);
    setCustError(null);
    try {
      const { data, error } = await supabase
        .from("customers")
        .insert({ ...custForm, factory_id: factoryId })
        .select("id,ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he")
        .single();
      if (error) {
        setCustError(error.message);
        return;
      }
      setCustomers((prev) => [...prev, data]);
      setForm((p) => ({ ...p, customer_id: data.id }));
      setCustModal(false);
      setCustForm(emptyCustomerForm());
      showToast(`Đã tạo khách hàng ${data.ten_kh_en}`);
    } catch (err) {
      setCustError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setCustSaving(false);
    }
  };

  // -- Filtered orders -------------------------------------------------------
  const filtered = orders.filter(
    (o) =>
      !search ||
      o.ma_don?.toLowerCase().includes(search.toLowerCase()) ||
      o.customers?.ten_kh_en?.toLowerCase().includes(search.toLowerCase()) ||
      o.customers?.ma_kh?.toLowerCase().includes(search.toLowerCase()),
  );

  // -- RENDER: Toast ---------------------------------------------------------
  const Toast = () =>
    toast ? (
      <div
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-bold ${toast.type === "error" ? "bg-red-600" : "bg-emerald-600"}`}
      >
        {toast.type === "error" ? (
          <AlertTriangle size={16} />
        ) : (
          <Check size={16} />
        )}{" "}
        {toast.msg}
      </div>
    ) : null;

  // -- RENDER: LIST ----------------------------------------------------------
  if (view === "list")
    return (
      <div>
        <Toast />
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">
              Xuất hàng
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Quản lý đơn xuất hàng
            </p>
          </div>
          <button
            onClick={() => {
              setForm(emptyForm());
              setEditId(null);
              setView("add");
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Plus size={16} /> Tạo đơn xuất
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            {
              label: "Tổng đơn xuất",
              value: stats.total,
              color: "text-slate-700",
              Icon: FileOutput,
              ic: "text-slate-400",
            },
            {
              label: "Tổng bành xuất",
              value: stats.tongBanh.toLocaleString(),
              color: "text-emerald-600",
              Icon: Package,
              ic: "text-emerald-400",
            },
            {
              label: "Tổng xe",
              value: stats.tongXe,
              color: "text-blue-600",
              Icon: Truck,
              ic: "text-blue-400",
            },
          ].map((s) => (
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

        {/* Filters */}
        <FilterBar
          activeCount={[search, filterLoai, filterFrom, filterTo].filter(Boolean).length}
        >
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <Search size={15} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn, khách hàng..."
              className="flex-1 text-sm outline-none"
            />
          </div>
          <select
            value={filterLoai}
            onChange={(e) => setFilterLoai(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
          >
            <option value="">Tất cả loại</option>
            {csrOpts.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
          />
          <span className="text-slate-400 text-sm">→</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400"
          />
          {(search || filterLoai || filterFrom || filterTo) && (
            <button
              onClick={() => {
                setSearch("");
                setFilterLoai("");
                setFilterFrom("");
                setFilterTo("");
              }}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-500"
            >
              <X size={14} /> Xóa lọc
            </button>
          )}
        </FilterBar>

        {/* Table */}
        <ResponsiveTableWrapper>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FileOutput size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không có đơn xuất hàng nào</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[
                    "Mã đơn",
                    "Ngày",
                    "Khách hàng",
                    "Loại",
                    "Xe",
                    "Tổng bành",
                    "Hợp đồng",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((order) => {
                  const orderStatus = getExportOrderStatus(order);
                  const allowEdit = canEditOrder(order);
                  const allowDelete = canDeleteOrder(order);
                  const allowApprove =
                    canApproveOrders && orderStatus === EXPORT_ORDER_STATUS_PENDING;

                  return (
                  <Fragment key={order.id}>
                    <tr
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() =>
                        setExpandedId(expandedId === order.id ? null : order.id)
                      }
                    >
                      <td className="px-4 py-3 font-bold text-emerald-700">
                        {order.ma_don}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {order.ngay
                          ? new Date(order.ngay).toLocaleDateString("vi-VN")
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-700">
                          {order.customers?.ten_kh_en || "-"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {order.customers?.ma_kh}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold w-fit">
                            {order.chung_loai}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold w-fit ${getExportOrderStatusClasses(orderStatus)}`}
                          >
                            {getExportOrderStatusLabel(orderStatus)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {order.vehicles?.length || 0} xe
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {(order.tong_banh || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {order.so_hop_dong || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {allowApprove && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleApproveOrder(order);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 hover:border-emerald-300"
                              title="Phê duyệt đơn"
                            >
                              <Check size={13} />
                              <span>Duyệt</span>
                            </button>
                          )}
                          {allowEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(order);
                            }}
                            className="p-1.5 rounded-lg transition-colors hover:bg-blue-50 text-blue-500"
                            title="Sửa"
                          >
                            <Edit2 size={14} />
                          </button>
                          )}
                          {allowDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDelConfirm(order.id);
                            }}
                            className="p-1.5 rounded-lg transition-colors hover:bg-red-50 text-red-400"
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                          )}
                          {expandedId === order.id ? (
                            <ChevronUp size={16} className="text-slate-400" />
                          ) : (
                            <ChevronDown size={16} className="text-slate-400" />
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === order.id && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-4 bg-slate-50 border-t border-slate-100"
                        >
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            {/* Customer info */}
                            <div className="space-y-1">
                              <div className="font-bold text-slate-600 mb-2">
                                Khách hàng
                              </div>
                              <div className="font-bold text-slate-700 text-sm">
                                {order.customers?.ten_kh_en || "-"}
                              </div>
                              {order.customers?.dia_chi && (
                                <div className="text-slate-500 whitespace-pre-line">
                                  {order.customers.dia_chi}
                                </div>
                              )}
                              {order.customers?.nguoi_lien_he && (
                                <div className="text-slate-500">
                                  Liên hệ: {order.customers.nguoi_lien_he}
                                </div>
                              )}
                              {order.customers?.email && (
                                <div className="text-slate-500">
                                  {order.customers.email}
                                </div>
                              )}
                              {order.customers?.quoc_gia && (
                                <div className="text-slate-500">
                                  {order.customers.quoc_gia}
                                </div>
                              )}
                              <div className="pt-2 space-y-0.5 border-t border-slate-200 mt-2">
                                <div className="flex gap-2">
                                  <span className="text-slate-400 w-24">
                                    Trạng thái:
                                  </span>
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded-full font-bold ${getExportOrderStatusClasses(orderStatus)}`}
                                  >
                                    {getExportOrderStatusLabel(orderStatus)}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <span className="text-slate-400 w-24">
                                    Số thông báo:
                                  </span>
                                  <span className="font-semibold">
                                    {order.so_thong_bao || "-"}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <span className="text-slate-400 w-24">
                                    Số hóa đơn:
                                  </span>
                                  <span className="font-semibold">
                                    {order.so_hoa_don || "-"}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <span className="text-slate-400 w-24">
                                    Loại pallet:
                                  </span>
                                  <span className="font-semibold">
                                    {order.loai_pallet || "-"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* Vehicles + lots */}
                            <div>
                              <div className="font-bold text-slate-600 mb-2">
                                Xe ({order.vehicles?.length})
                              </div>
                              <div className="space-y-3">
                                {(order.vehicles || []).map((v, i) => (
                                  <div
                                    key={v.id}
                                    className="flex flex-col gap-3 bg-white rounded-lg px-3 py-3 border border-slate-200 shadow-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Truck
                                        size={14}
                                        className="text-slate-400"
                                      />
                                      <span className="font-semibold text-slate-700">
                                        {v.loai_xe}
                                      </span>
                                      <span className="text-slate-500">
                                        {v.bien_truoc}
                                      </span>
                                      {v.bien_sau && (
                                        <>
                                          <span className="text-slate-300">
                                            /
                                          </span>
                                          <span className="text-slate-500">
                                            {v.bien_sau}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    {/* Thống kê xe + ảnh thumbnail */}
                                    {(() => {
                                      const vAssignments = (order.assignments || []).filter(
                                        (a) => a.vehicleIdx === i,
                                      );
                                      const totalLots = new Set(vAssignments.map((a) => a.lot_id)).size;
                                      const totalBanh = vAssignments.reduce(
                                        (s, a) => s + (a.kien_a || 0) + (a.kien_b || 0) + (a.kien_c || 0) + (a.kien_d || 0),
                                        0,
                                      );
                                      const totalTan = totalBanh * (order.loai_banh || 0) / 1000;
                                      const imgs = [
                                        ...(v.image_urls ?? []),
                                        ...(!v.image_urls?.length
                                          ? ([v.image_url_1, v.image_url_2, v.image_url_3].filter(Boolean) as string[])
                                          : []),
                                      ];
                                      return (
                                        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
                                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg">
                                            {totalLots} lô
                                          </span>
                                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg">
                                            {totalBanh.toLocaleString("vi-VN")} bành
                                          </span>
                                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg">
                                            {totalTan.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} tấn
                                          </span>
                                          {imgs.map((url, imgIdx) => (
                                            <a
                                              key={imgIdx}
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              title="Xem ảnh lớn"
                                              className="block w-14 h-14 rounded-lg border border-slate-200 overflow-hidden hover:opacity-80 hover:ring-2 hover:ring-emerald-400 transition-all"
                                            >
                                              <Image
                                                src={url}
                                                alt=""
                                                width={56}
                                                height={56}
                                                unoptimized
                                                className="w-full h-full object-cover"
                                              />
                                            </a>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ))}
                              </div>
                              {(order.assignments || []).length > 0 && (
                                <div className="mt-2">
                                  <div className="font-bold text-slate-600 mb-1">
                                    Lô hàng
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {(order.assignments || []).map((a) => (
                                      <span
                                        key={a.lot_id + a.vehicleIdx}
                                        className="px-2 py-0.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700"
                                      >
                                        {a.ma_lo} · Xe {a.vehicleIdx + 1}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(order.yeu_cau_chi_tieu || []).length > 0 && (
                                <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                                  <div className="font-bold text-amber-700 mb-1">
                                    Yêu cầu chỉ tiêu
                                  </div>
                                  {(order.yeu_cau_chi_tieu || []).map((r) => (
                                    <div key={r.ten} className="text-amber-600">
                                      {r.ten}: {r.min ? `Min ${r.min}` : ""}
                                      {r.min && r.max ? " - " : ""}
                                      {r.max ? `Max ${r.max}` : ""}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* QR Code */}
                            <div className="flex flex-col items-center justify-start gap-2">
                              <div className="font-bold text-slate-600 mb-1 self-start">
                                Mã QR EUDR
                              </div>
                              <div className="p-2 bg-white border border-slate-200 rounded-xl">
                                <QRCode
                                  value={`https://qlsxkpt.vercel.app/dashboard/eudr?order=${order.ma_don}`}
                                  size={100}
                                  level="M"
                                />
                              </div>
                              <div className="text-[10px] text-slate-400 text-center break-all max-w-[130px]">
                                {order.ma_don}
                              </div>
                              <a
                                href={`/dashboard/eudr?order=${encodeURIComponent(order.ma_don)}`}
                                className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-bold"
                              >
                                <QrCode size={11} /> Xem EUDR
                              </a>
                              <a
                                href={`/dashboard/export/print?id=${order.id}`}
                                target="_blank"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-bold mt-1"
                              >
                                <Printer size={11} /> In Biên bản
                              </a>
                              {currentUser?.role === "admin" && (
                                <button
                                  type="button"
                                  onClick={() => setGrantModalOrder(order)}
                                  className="flex items-center gap-1 text-xs text-violet-600 hover:underline font-bold mt-1"
                                >
                                  <UserPlus size={11} /> Cấp quyền KH
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )})}
              </tbody>
            </table>
          )}
        </ResponsiveTableWrapper>

        {/* Delete confirm */}
        {delConfirm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
              <h3 className="font-extrabold text-slate-800 mb-2">
                Xác nhận xóa?
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                Đơn xuất hàng này sẽ bị xóa vĩnh viễn.
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

        {grantModalOrder && factoryId && currentUser?.id && (
          <CustomerGrantModal
            orderId={grantModalOrder.id}
            orderCode={grantModalOrder.ma_don}
            factoryId={factoryId}
            actorId={currentUser.id}
            onClose={() => setGrantModalOrder(null)}
          />
        )}
      </div>
    );

  // -- RENDER: ADD / EDIT ----------------------------------------------------
  const selCust = customers.find((c) => c.id === form.customer_id);

  return (
    <div>
      <Toast />

      {/* Customer creation modal */}
      {custModal && (
        <ModalShell
          title={
            <span className="flex items-center gap-2">
              <UserPlus size={18} /> Tạo khách hàng mới
            </span>
          }
          onClose={() => {
            setCustModal(false);
            setCustError(null);
          }}
          maxWidth="md"
          footer={
            <>
              <button
                onClick={() => {
                  setCustModal(false);
                  setCustError(null);
                }}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateCustomer}
                disabled={custSaving}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50"
              >
                {custSaving ? "Đang lưu..." : "Tạo khách hàng"}
              </button>
            </>
          }
        >
            <div className="space-y-3">
              {custError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {custError}
                </div>
              )}
              {[
                { label: "Mã KH *", field: "ma_kh", placeholder: "KUMHO" },
                {
                  label: "Tên KH *",
                  field: "ten_kh_en",
                  placeholder: "Kumho Petrochemical Co., Ltd.",
                },
                { label: "Quốc gia", field: "quoc_gia", placeholder: "Korea" },
                {
                  label: "Địa chỉ",
                  field: "dia_chi",
                  placeholder: "Economic Zone, Room 303...",
                },
                {
                  label: "Email",
                  field: "email",
                  placeholder: "purchasing@kumho.com",
                },
                {
                  label: "Người liên hệ",
                  field: "nguoi_lien_he",
                  placeholder: "Nguyễn Văn A",
                },
              ].map((f) => (
                <div key={f.field}>
                  <label className="text-xs font-bold text-slate-600 block mb-1">
                    {f.label}
                  </label>
                  {f.field === "dia_chi" ? (
                    <textarea
                      rows={2}
                      value={custForm[f.field as keyof typeof custForm]}
                      onChange={(e) =>
                        setCustForm((p) => ({
                          ...p,
                          [f.field]: e.target.value,
                        }))
                      }
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 resize-none"
                    />
                  ) : (
                    <input
                      value={custForm[f.field as keyof typeof custForm]}
                      onChange={(e) =>
                        setCustForm((p) => ({
                          ...p,
                          [f.field]: e.target.value,
                        }))
                      }
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    />
                  )}
                </div>
              ))}
            </div>
        </ModalShell>
      )}

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => {
            setView("list");
            setEditId(null);
          }}
          className="p-2 hover:bg-slate-100 rounded-xl"
        >
          <X size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {editId ? "Sửa đơn xuất hàng" : "Tạo đơn xuất hàng"}
          </h1>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:h-[calc(100vh-200px)]">
        {/* --- LEFT PANEL ------------------------------------------------- */}
        <div className="w-full space-y-4 lg:w-1/2 lg:overflow-y-auto lg:pr-2">
          {/* Thông tin đơn */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-4">Thông tin đơn</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Khách hàng */}
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Khách hàng
                </label>
                <div className="flex gap-2">
                  <select
                    value={form.customer_id}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, customer_id: e.target.value }))
                    }
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Chọn khách hàng --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ten_kh_en} ({c.ma_kh})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setCustModal(true)}
                    className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition-all whitespace-nowrap"
                  >
                    <UserPlus size={13} /> Tạo mới
                  </button>
                </div>
                {selCust && (
                  <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 space-y-0.5">
                    {selCust.dia_chi && <div>{selCust.dia_chi}</div>}
                    {selCust.nguoi_lien_he && (
                      <div>Liên hệ: {selCust.nguoi_lien_he}</div>
                    )}
                    {selCust.email && <div>{selCust.email}</div>}
                    {selCust.quoc_gia && <div>{selCust.quoc_gia}</div>}
                  </div>
                )}
              </div>

              {/* Mã đơn */}
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Mã đơn (tự động)
                </label>
                <input
                  readOnly
                  value={form.ma_don}
                  placeholder="Chọn KH + điền số thông báo + ngày để tạo tự động"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-600 font-mono cursor-default"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Ngày xuất
                </label>
                <input
                  type="date"
                  value={form.ngay}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, ngay: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Số thông báo *
                </label>
                <input
                  value={form.so_thong_bao}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, so_thong_bao: e.target.value }))
                  }
                  placeholder="VD: TB-001-2026"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Loại CSR
                </label>
                <select
                  value={form.chung_loai}
                  onChange={(e) => {
                    const cl = e.target.value;
                    const bOpts = getBocOpts(cl);
                    setForm((p) => ({
                      ...p,
                      chung_loai: cl,
                      loai_banh: getLoaiBanhOptions(cl)[0],
                      loai_boc: bOpts[1] || bOpts[0],
                      assignments: [],
                    }));
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {csrOpts.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Loại pallet xuất
                </label>
                <select
                  value={form.loai_pallet}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, loai_pallet: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {palletOpts.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <div className="flex gap-1.5 mt-1.5">
                  <input
                    value={newPalletInput}
                    onChange={(e) => setNewPalletInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newPalletInput.trim()) {
                        const v = newPalletInput.trim();
                        if (!palletOpts.includes(v))
                          setPalletExtra((p) => [...p, v]);
                        setForm((p) => ({ ...p, loai_pallet: v }));
                        setNewPalletInput("");
                      }
                    }}
                    placeholder="Thêm loại khác..."
                    className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = newPalletInput.trim();
                      if (!v) return;
                      if (!palletOpts.includes(v))
                        setPalletExtra((p) => [...p, v]);
                      setForm((p) => ({ ...p, loai_pallet: v }));
                      setNewPalletInput("");
                    }}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Số hóa đơn
                </label>
                <input
                  value={form.so_hoa_don}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, so_hoa_don: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Số hợp đồng
                </label>
                <input
                  value={form.so_hop_dong}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, so_hop_dong: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Loại bành (kg)
                </label>
                <div className="flex gap-2 flex-wrap">
                  {getLoaiBanhOptions(form.chung_loai).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, loai_banh: opt }))}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                        form.loai_banh === opt
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {opt} kg
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Loại bọc
                </label>
                <select
                  value={form.loai_boc}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, loai_boc: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  {getBocOpts(form.chung_loai).map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Yêu cầu chỉ tiêu */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-3">
              Yêu cầu chỉ tiêu KN
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              <span
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 cursor-pointer transition-all ${form.yeu_cau_chi_tieu.length === 0 ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                onClick={() => setForm((p) => ({ ...p, yeu_cau_chi_tieu: [] }))}
              >
                Không
              </span>
              {CHI_TIEU_LIST.map((ct) => {
                const active = !!form.yeu_cau_chi_tieu.find(
                  (r) => r.ten === ct,
                );
                return (
                  <span
                    key={ct}
                    onClick={() => toggleChiTieu(ct)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 cursor-pointer transition-all ${active ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                  >
                    {ct}
                  </span>
                );
              })}
            </div>
            {form.yeu_cau_chi_tieu.length > 0 && (
              <div className="space-y-2">
                {form.yeu_cau_chi_tieu.map((req) => (
                  <div
                    key={req.ten}
                    className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
                  >
                    <span className="text-xs font-bold text-amber-700 w-20 shrink-0">
                      {req.ten}
                    </span>
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-xs text-slate-500">Min</label>
                      <input
                        type="number"
                        value={req.min}
                        onChange={(e) =>
                          updateChiTieu(req.ten, "min", e.target.value)
                        }
                        placeholder="-"
                        className="w-20 px-2 py-1 border border-amber-200 rounded-lg text-xs outline-none focus:border-amber-400 text-center"
                      />
                      <label className="text-xs text-slate-500">Max</label>
                      <input
                        type="number"
                        value={req.max}
                        onChange={(e) =>
                          updateChiTieu(req.ten, "max", e.target.value)
                        }
                        placeholder="-"
                        className="w-20 px-2 py-1 border border-amber-200 rounded-lg text-xs outline-none focus:border-amber-400 text-center"
                      />
                    </div>
                    <button
                      onClick={() => toggleChiTieu(req.ten)}
                      className="text-amber-400 hover:text-red-500"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Xe */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700">
                Xe ({form.vehicles.length})
              </h3>
              <button
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    vehicles: [...p.vehicles, emptyVehicle()],
                  }))
                }
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg"
              >
                <Plus size={13} /> Thêm xe
              </button>
            </div>
            <div className="space-y-3">
              {form.vehicles.map((v, idx) => {
                const vAssigns = form.assignments.filter(
                  (a) => a.vehicleIdx === idx,
                );
                return (
                  <div
                    key={v.id}
                    className={`rounded-xl border-2 transition-all ${dropTarget === idx ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300" : "border-slate-200 bg-slate-50"}`}
                    onDragOver={(e) => !v.confirmed && handleDragOver(e, idx)}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => !v.confirmed && handleDrop(e, idx)}
                  >
                    {/* Vehicle header */}
                    <div className="grid grid-cols-2 gap-2 items-end p-3 sm:grid-cols-12">
                      <div className="col-span-2 sm:col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">
                          Xe {idx + 1}
                        </label>
                        <select
                          value={v.loai_xe}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              vehicles: p.vehicles.map((vv, i) =>
                                i === idx
                                  ? { ...vv, loai_xe: e.target.value }
                                  : vv,
                              ),
                            }))
                          }
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"
                        >
                          {LOAI_XE_OPTS.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </div>
                      <div className="relative col-span-2 sm:col-span-4 grid grid-cols-2 gap-2">
                        <div className="relative">
                          <label className="text-xs text-slate-500 block mb-1">
                            Biển trước
                          </label>
                          <input
                            value={v.bien_truoc}
                            placeholder="3E2358"
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                vehicles: p.vehicles.map((vv, i) =>
                                  i === idx
                                    ? { ...vv, bien_truoc: e.target.value }
                                    : vv,
                                ),
                              }))
                            }
                            list={`sug-truoc-${idx}`}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"
                          />
                          <datalist id={`sug-truoc-${idx}`}>
                            {vehicleSuggestions.map((vs, si) => (
                              <option key={si} value={vs.bien_truoc} />
                            ))}
                          </datalist>
                        </div>
                        <button
                          type="button"
                          title="Hoán đổi Biển trước / Biển sau"
                          onClick={() =>
                            setForm((p) => ({
                              ...p,
                              vehicles: p.vehicles.map((vv, i) =>
                                i === idx
                                  ? {
                                      ...vv,
                                      bien_truoc: vv.bien_sau,
                                      bien_sau: vv.bien_truoc,
                                    }
                                  : vv,
                              ),
                            }))
                          }
                          className="absolute left-1/2 top-[26px] -translate-x-1/2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-400 shadow-sm transition-colors hover:border-emerald-400 hover:text-emerald-600"
                        >
                          <ArrowLeftRight size={11} />
                        </button>
                        <div className="relative">
                          <label className="text-xs text-slate-500 block mb-1">
                            Biển sau
                          </label>
                          <input
                            value={v.bien_sau}
                            placeholder="4A9639"
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                vehicles: p.vehicles.map((vv, i) =>
                                  i === idx
                                    ? { ...vv, bien_sau: e.target.value }
                                    : vv,
                                ),
                              }))
                            }
                            list={`sug-sau-${idx}`}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"
                          />
                          <datalist id={`sug-sau-${idx}`}>
                            {vehicleSuggestions.map((vs, si) => (
                              <option key={si} value={vs.bien_sau} />
                            ))}
                          </datalist>
                        </div>
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <label className="text-xs text-slate-500 block mb-1">
                          Ghi chú
                        </label>
                        <input
                          value={v.ghi_chu}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              vehicles: p.vehicles.map((vv, i) =>
                                i === idx
                                  ? { ...vv, ghi_chu: e.target.value }
                                  : vv,
                              ),
                            }))
                          }
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-400"
                        />
                      </div>
                      <button
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            vehicles: p.vehicles.filter((_, i) => i !== idx),
                            assignments: p.assignments
                              .filter((a) => a.vehicleIdx !== idx)
                              .map((a) =>
                                a.vehicleIdx > idx
                                  ? { ...a, vehicleIdx: a.vehicleIdx - 1 }
                                  : a,
                              ),
                          }))
                        }
                        className="col-span-2 justify-self-end p-1.5 text-red-400 hover:bg-red-50 rounded-lg self-end sm:col-span-1"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Xác nhận đầy xe — chỉ hiện trên mobile; xe đã đầy bị loại khỏi danh sách gán lô nhanh */}
                    <button
                      type="button"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          vehicles: p.vehicles.map((vv, i) =>
                            i === idx ? { ...vv, confirmed: !vv.confirmed } : vv,
                          ),
                        }))
                      }
                      className={`mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors lg:hidden ${
                        v.confirmed
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-slate-300 bg-white text-slate-500 hover:border-emerald-400 hover:text-emerald-600"
                      }`}
                    >
                      <Check size={13} />
                      {v.confirmed ? "Đã đầy xe" : "Xác nhận đầy xe"}
                    </button>

                    {/* Per-vehicle stats */}
                    {vehicleStats[idx]?.banh > 0 && (
                      <div className="mx-3 mb-2 flex items-center gap-4 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-xs">
                        <span className="text-slate-500">Bành:</span>
                        <span className="font-bold text-emerald-700">{vehicleStats[idx].banh.toLocaleString()}</span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">Tấn:</span>
                        <span className="font-bold text-emerald-700">{vehicleStats[idx].tan.toFixed(3)}</span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">Lô:</span>
                        <span className="font-bold text-emerald-700">{vehicleStats[idx].lo}</span>
                      </div>
                    )}

                    {/* Ảnh xe */}
                    <div className="px-3 pb-3">
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        id={`veh-img-${idx}`}
                        className="hidden"
                        onChange={(e) =>
                          handleVehicleImageUpload(idx, e.target.files)
                        }
                      />
                      {(v.image_urls ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(v.image_urls ?? []).map((url, imgIdx) => (
                            <div
                              key={imgIdx}
                              className="relative group w-14 h-14"
                            >
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block w-full h-full"
                              >
                                <Image
                                  src={url}
                                  alt=""
                                  fill
                                  className="object-cover rounded-lg"
                                  unoptimized
                                />
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((p) => ({
                                    ...p,
                                    vehicles: p.vehicles.map((vv, i) =>
                                      i === idx
                                        ? {
                                            ...vv,
                                            image_urls: (
                                              vv.image_urls ?? []
                                            ).filter((_, j) => j !== imgIdx),
                                          }
                                        : vv,
                                    ),
                                  }))
                                }
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label
                        htmlFor={`veh-img-${idx}`}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                          (v.image_urls ?? []).length >= 6
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        }`}
                        onClick={(e) => {
                          if ((v.image_urls ?? []).length >= 6)
                            e.preventDefault();
                        }}
                      >
                        {uploadingVehicleIdx === idx ? (
                          <span>Đang tải...</span>
                        ) : ocrLoadingVehicleIdx === idx ? (
                          <span className="text-violet-500">Đang đọc biển số...</span>
                        ) : (
                          <>
                            <ImagePlus size={13} />
                            {(v.image_urls ?? []).length > 0
                              ? `${(v.image_urls ?? []).length}/6 ảnh • Click ảnh để xem full`
                              : "Thêm ảnh xe"}
                          </>
                        )}
                      </label>
                    </div>

                    {/* Drop hint or assigned lots */}
                    {vAssigns.length === 0 ? (
                      <div
                        className={`mx-3 mb-3 border-2 border-dashed rounded-xl p-3 text-center text-xs transition-all ${dropTarget === idx ? "border-emerald-400 text-emerald-600 bg-emerald-50" : "border-slate-300 text-slate-400"}`}
                      >
                        <GripVertical
                          size={14}
                          className="mx-auto mb-1 opacity-50 hidden lg:block"
                        />
                        <span className="hidden lg:inline">Kéo lô hàng vào đây</span>
                        <span className="lg:hidden">
                          Chọn xe ở lô bên dưới để gán vào đây
                        </span>
                      </div>
                    ) : (
                      <div className="mx-3 mb-3 space-y-1.5">
                        {vAssigns.map((a) => {
                          const lot = lotsExt.find((l) => l.id === a.lot_id);
                          return (
                            <div
                              key={a.lot_id}
                              className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 sm:grid sm:grid-cols-[16px_minmax(84px,1fr)_repeat(4,minmax(78px,92px))_16px] sm:items-center sm:gap-2"
                            >
                              <div className="flex items-center justify-between gap-2 sm:contents">
                                <div className="flex items-center gap-2 min-w-0 flex-1 sm:contents">
                                  <Package
                                    size={12}
                                    className="text-emerald-500 shrink-0"
                                  />
                                  <span className="font-bold text-emerald-700 min-w-0 truncate">
                                    {a.ma_lo}
                                  </span>
                                </div>
                                <button
                                  onClick={() => removeAssignment(a.lot_id, idx)}
                                  className="text-red-400 hover:text-red-600 sm:hidden"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                              <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:contents sm:mt-0">
                              {(
                                [
                                  "kien_a",
                                  "kien_b",
                                  "kien_c",
                                  "kien_d",
                                ] as const
                              ).map((k, ki) => {
                                const maxVal =
                                  k === "kien_a"
                                    ? (lot?.rem_a ?? 0)
                                    : k === "kien_b"
                                      ? (lot?.rem_b ?? 0)
                                      : k === "kien_c"
                                        ? (lot?.rem_c ?? 0)
                                        : (lot?.rem_d ?? 0);
                                return (
                                  <div
                                    key={k}
                                    className="flex items-center justify-end gap-0.5"
                                  >
                                    <span className="text-slate-400">
                                      {["A", "B", "C", "D"][ki]}:
                                    </span>
                                    <input
                                      type="number"
                                      value={a[k]}
                                      min={0}
                                      max={maxVal}
                                      onChange={(e) =>
                                        updateAssignment(
                                          a.lot_id,
                                          idx,
                                          k,
                                          Math.min(
                                            maxVal,
                                            Math.max(0, +e.target.value),
                                          ),
                                        )
                                      }
                                      className="w-[3.75rem] px-1.5 py-1 border border-emerald-200 rounded text-center font-mono text-xs outline-none focus:border-emerald-400"
                                    />
                                  </div>
                                );
                              })}
                              </div>
                              <button
                                onClick={() => removeAssignment(a.lot_id, idx)}
                                className="hidden text-red-400 hover:text-red-600 sm:block sm:justify-self-end"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          );
                        })}
                        {/* Still show drop zone hint */}
                        {dropTarget === idx && (
                          <div className="border-2 border-dashed border-emerald-400 rounded-xl p-2 text-center text-xs text-emerald-600 bg-emerald-50">
                            + Thả thêm lô
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* --- RIGHT PANEL: Lot picker ------------------------------------ */}
        <div className="w-full space-y-4 lg:w-1/2 lg:overflow-y-auto lg:pl-2">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 lg:sticky lg:top-0 lg:z-10">
            <h3 className="font-bold text-slate-700 mb-1">
              Lô hàng - {form.chung_loai}
              <span className="ml-2 text-xs text-slate-400 font-normal">
                {availLots.length} lô có sẵn
                {form.yeu_cau_chi_tieu.length > 0 && (
                  <span className="ml-1 text-amber-500">
                    · đang lọc theo chỉ tiêu
                  </span>
                )}
              </span>
            </h3>
            <input
              value={lotSearch}
              onChange={(e) => setLotSearch(e.target.value)}
              placeholder="Tìm mã lô..."
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:border-emerald-400"
            />
          </div>

          {/* Pill cards grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            {availLots.length === 0 ? (
              <div className="col-span-2 p-8 text-center text-slate-400">
                <Package size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Không có lô {form.chung_loai} nào</p>
                {form.yeu_cau_chi_tieu.length > 0 && (
                  <p className="text-xs mt-1">
                    Thử bỏ yêu cầu chỉ tiêu để xem thêm lô
                  </p>
                )}
              </div>
            ) : (
              availLots.map((lot) => {
                const rem = getFormRemaining(lot);
                const totalRem = rem.a + rem.b + rem.c + rem.d;
                const assignedVehicles = form.assignments.filter(
                  (a) => a.lot_id === lot.id,
                );
                const latestQc = latestQcByLotId.get(lot.id);
                const isFailedQc =
                  latestQc?.dat_hang?.endsWith("RH") ||
                  latestQc?.trang_thai === "khong_dat";
                const isPartial = assignedVehicles.length > 0 && totalRem > 0;
                const isFullyAssigned =
                  assignedVehicles.length > 0 && totalRem <= 0;
                const isDragging = draggingLotId === lot.id;

                return (
                  <div
                    key={lot.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lot.id)}
                    onDragEnd={handleDragEnd}
                    className={`rounded-2xl border-2 p-3 cursor-grab active:cursor-grabbing select-none transition-all duration-150 ${
                      isDragging
                        ? "shadow-2xl scale-105 border-emerald-400 bg-emerald-50 opacity-80"
                        : isFullyAssigned
                          ? "border-slate-200 bg-slate-50 opacity-50"
                          : isFailedQc
                            ? "border-slate-200 bg-slate-100 opacity-55"
                          : isPartial
                            ? "border-amber-300 bg-amber-50"
                            : "border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md"
                    }`}
                  >
                    {/* Lot name */}
                    <div className="text-center font-extrabold text-slate-800 mb-2 text-sm">
                      {lot.ma_lo}
                    </div>

                    <div
                      className={`mb-2 text-center text-[10px] font-bold rounded-full px-2 py-0.5 ${
                        isFailedQc
                          ? "bg-slate-200 text-slate-600"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isFailedQc
                        ? `Rớt hạng${latestQc?.dat_hang ? ` · ${latestQc.dat_hang}` : ""}`
                        : `Đạt hạng${latestQc?.dat_hang ? ` · ${latestQc.dat_hang}` : ""}`}
                    </div>

                    {/* Kiện remaining */}
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      {[
                        { k: "A", v: rem.a },
                        { k: "B", v: rem.b },
                        { k: "C", v: rem.c },
                        { k: "D", v: rem.d },
                      ].map(({ k, v }) => (
                        <div
                          key={k}
                          className={`flex items-center justify-between px-2 py-0.5 rounded-lg ${v > 0 ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300"}`}
                        >
                          <span className="font-bold">{k}</span>
                          <span className="font-mono">{v}</span>
                        </div>
                      ))}
                    </div>

                    {/* Status label */}
                    {assignedVehicles.length > 0 && (
                      <div
                        className={`mt-2 text-center text-[10px] font-bold rounded-full px-2 py-0.5 ${isFullyAssigned ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {isFullyAssigned
                          ? "✓ Đã phân đủ"
                          : `Xe ${assignedVehicles.map((a) => `${a.vehicleIdx + 1}`).join(",")}`}
                      </div>
                    )}

                    {/* Chọn nhanh gán vào xe — chỉ hiện trên mobile, thay thế kéo-thả; xe đã xác nhận đầy bị loại khỏi danh sách */}
                    {!isFullyAssigned && !isFailedQc && form.vehicles.some((v) => !v.confirmed) && (
                      <select
                        value=""
                        disabled={totalRem <= 0}
                        onChange={(e) => {
                          const vIdx = Number(e.target.value);
                          if (!Number.isNaN(vIdx)) handleMobileAssign(lot, vIdx);
                          e.target.value = "";
                        }}
                        className="mt-2 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 outline-none disabled:opacity-40 lg:hidden"
                      >
                        <option value="">+ Gán vào xe...</option>
                        {form.vehicles.map((v, i) =>
                          v.confirmed ? null : (
                            <option key={v.id} value={i}>
                              {`Xe ${i + 1}${v.bien_truoc ? ` · ${v.bien_truoc}` : ""}`}
                            </option>
                          ),
                        )}
                      </select>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Instructions */}
          <div className="text-xs text-slate-400 text-center py-2">
            <GripVertical size={14} className="mr-1 hidden lg:inline" />
            <span className="hidden lg:inline">
              Kéo thả pill vào vùng xe bên trái để phân lô
            </span>
            <span className="lg:hidden">
              Bấm &quot;+ Gán vào xe...&quot; trên mỗi lô để phân vào xe
            </span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Tổng bành</div>
            <div className="text-2xl font-extrabold text-emerald-600">
              {totalBanh.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Tổng tấn</div>
            <div className="text-2xl font-extrabold text-emerald-700">
              {totalTan.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Tổng lô</div>
            <div className="text-2xl font-extrabold text-slate-700">
              {[...new Set(form.assignments.map((a) => a.lot_id))].length}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Tổng xe</div>
            <div className="text-2xl font-extrabold text-slate-700">
              {form.vehicles.length}
            </div>
          </div>
        </div>
        {form.vehicles.length > 0 && form.assignments.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-xs font-bold text-slate-500 mb-2">Chi tiết theo xe</div>
            <ResponsiveTableWrapper>
              <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left pb-1 font-medium">Xe</th>
                  <th className="text-right pb-1 font-medium">Bành</th>
                  <th className="text-right pb-1 font-medium">Tấn</th>
                  <th className="text-right pb-1 font-medium">Lô</th>
                </tr>
              </thead>
              <tbody>
                {form.vehicles.map((v, idx) => (
                  <tr key={v.id} className="border-t border-slate-50">
                    <td className="py-0.5 text-slate-600 font-medium">
                      {v.bien_truoc || `Xe ${idx + 1}`}
                    </td>
                    <td className="text-right text-slate-700">
                      {vehicleStats[idx].banh.toLocaleString()}
                    </td>
                    <td className="text-right text-slate-700">
                      {vehicleStats[idx].tan.toFixed(3)}
                    </td>
                    <td className="text-right text-slate-700">
                      {vehicleStats[idx].lo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </ResponsiveTableWrapper>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white mt-4 pt-4 sm:flex-row sm:justify-end">
        <button
          onClick={() => {
            setView("list");
            setEditId(null);
          }}
          className="w-full px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl sm:w-auto"
        >
          Hủy
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-50 sm:w-auto"
        >
          {saving
            ? "Đang lưu..."
            : editId
              ? "Lưu thay đổi"
              : `Lưu đơn xuất (${totalBanh.toLocaleString()} bành)`}
        </button>
      </div>
    </div>
  );
}


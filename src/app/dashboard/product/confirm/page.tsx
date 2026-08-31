"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type jsPDF from "jspdf";
import {
  AlertTriangle,
  Boxes,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileDown,
  Hash,
  Inbox,
  Layers,
  Loader2,
  Lock,
  Minus,
  Package,
  Pencil,
  Plus,
  Save,
  ScanLine,
  Send,
  Sun,
  Trash2,
  User,
  Warehouse,
} from "lucide-react";
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth";
import { getTodayISODate } from "@/lib/date-utils";
import { getBocsForLoaiCSR, getLoaiBanhConfig } from "@/lib/product-lot-config";
import { KIEN_LETTERS, type KienLetter } from "@/lib/product-label";
import {
  checkIncompleteLotsForDay,
  checkOtherIncompleteLotsForCategory,
  deleteDraft,
  deleteShiftHistoryEntry,
  editShiftHistoryEntry,
  loadActiveNgansForFactory,
  loadDrafts,
  loadFactoryShiftNames,
  loadShiftHistory,
  loadShiftLockStatus,
  loadShiftReportData,
  loadUserChucVu,
  loadUserShiftAssignment,
  resolveKienForConfirm,
  saveDraftKien,
  submitConfirmDraftBatch,
  updateDraftKien,
  type ActiveNganOption,
  type ConfirmDraftRow,
  type ConfirmKienLookup,
  type LotCompletenessWarning,
  type OtherIncompleteLot,
  type ShiftHistoryEntry,
  type ShiftLockStatus,
} from "@/app/dashboard/product/confirm/actions";
import {
  buildShiftReportFileName,
  buildShiftReportPdf,
  openShiftReportPdfInNewTab,
} from "@/app/dashboard/product/confirm/shift-report-pdf";
import { ShiftReportPreviewBar } from "@/app/dashboard/product/confirm/shift-report-preview-bar";
import { loadStoredLang, storeLang, t, palletLabel, LANG_OPTIONS, type Lang } from "@/app/dashboard/product/confirm/i18n";
import { RequiredNoteSelect } from "@/app/dashboard/_components/required-note-select";
import { KpiLinkPrompt } from "@/app/dashboard/_components/kpi-link-prompt";

const LAST_CA_STORAGE_KEY = "product_confirm_last_ca";
const CA_STORAGE_VALUES = ["A", "B", "C"] as const;

// Mục 6 (2026-07-15): gợi ý "Ca sản xuất" — ưu tiên phân công trực ca cố định theo tài khoản
// (production_shift_assignments), fallback về Ca đã dùng gần nhất TRÊN CHÍNH THIẾT BỊ/trình
// duyệt này (đã chốt với người dùng — không đoán theo khung giờ), cuối cùng mới về "A".
function loadStoredCa(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(LAST_CA_STORAGE_KEY);
  return stored && (CA_STORAGE_VALUES as readonly string[]).includes(stored) ? stored : null;
}
function storeCa(ca: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_CA_STORAGE_KEY, ca);
}

const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
);

const CA_OPTS = ["A", "B", "C"] as const;
const PALLET_OPTS = ["Sắt đế gỗ", "Sắt đế nhựa", "Sắt mỏng", "MB5", "Gỗ"];

// Style dùng chung cho các trường cần "nổi bật hơn" (Ngày SX, Ca SX, Số chỉ thị, Bọc): cỡ chữ
// +10% so với chuẩn text-sm (14px -> 15.4px), viền dày 2px, nền nhấn nhẹ — tương phản rõ với các
// trường phụ (Giờ SX, Ghi chú) vẫn giữ style mặc định.
const highlightFieldClass =
  "w-full rounded-xl border-2 border-emerald-300 bg-emerald-50/50 px-3.5 py-3 text-[15.4px] font-semibold text-slate-800 outline-none transition-colors focus:border-emerald-500 focus:bg-white";
const highlightFieldClassAmber =
  "w-full rounded-xl border-2 border-amber-400 bg-amber-50 px-3.5 py-3 text-[15.4px] font-semibold text-slate-800 outline-none transition-colors focus:border-amber-500 focus:bg-white";

type ViewMode = "hub" | "scanning" | "form";

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

// "dd/mm/yyyy hh:mm:ss" — dùng riêng cho đồng hồ sống, không qua toLocaleString (locale thiết
// bị có thể trả thứ tự khác nhau).
function formatDMYHMS(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

// So khớp 2 mảng string như tập hợp (không phân biệt thứ tự) — dùng để so pallet đa chọn.
function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function formatHMS(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Ca đêm kéo dài qua nửa đêm — mặc định "Ngày sản xuất" vẫn tính là hôm qua khi đang trong
// khoảng 00:00-04:59, chỉ chuyển sang hôm nay từ 05:00 trở đi (đã chốt với người dùng).
function getDefaultNgaySx(d: Date): string {
  const base = new Date(d);
  if (base.getHours() < 5) base.setDate(base.getDate() - 1);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

// Đọc QR đã quét: nội dung là URL đầy đủ dạng ".../product-label?f=...&lo=...&kien=..." (xem
// buildProductLabelLookupUrl trong src/lib/product-label.ts) — chỉ cần phần query string, không
// cần new URL() (tránh lỗi nếu html5-qrcode trả về chuỗi không phải URL tuyệt đối hợp lệ).
function parseScannedQr(text: string): { lo: string; kien: KienLetter; f?: string } | null {
  const qIndex = text.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(text.substring(qIndex + 1));
  const lo = (params.get("lo") || "").trim();
  if (!lo) return null;
  const kienRaw = (params.get("kien") || "A").toUpperCase();
  const kien: KienLetter = (KIEN_LETTERS as string[]).includes(kienRaw) ? (kienRaw as KienLetter) : "A";
  const f = params.get("f") || undefined;
  return { lo, kien, f };
}

export default function ConfirmKienProductionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [lang, setLang] = useState<Lang>("vi");
  useEffect(() => {
    setLang(loadStoredLang());
  }, []);
  const switchLang = (l: Lang) => {
    setLang(l);
    storeLang(l);
  };
  const tt = useCallback((key: string, vars?: Record<string, string | number>) => t(lang, key, vars), [lang]);

  const [loading, setLoading] = useState(true);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [factoryMismatch, setFactoryMismatch] = useState(false);

  // "Gắn bản ghi tại chỗ" — gợi ý gắn lô vừa gửi vào công việc KPI đang mở hôm nay
  const [kpiPrompt, setKpiPrompt] = useState<null | { recordId: string; recordLabel: string }>(null);

  const [chucVu, setChucVu] = useState<string | null>(null);
  // Tên ca sản xuất theo cấu hình nhà máy (Cài đặt → Danh mục → Thông tin công ty → "Tên ca sản
  // xuất") — chỉ dùng để làm nhãn gợi ý trong 2 dropdown "Ca sản xuất" (form quét + Hub), không
  // ảnh hưởng dữ liệu lưu (vẫn lưu mã ca "A"/"B"/"C" như trước).
  const [shiftNames, setShiftNames] = useState<Record<string, string>>({});
  const caLabel = useCallback(
    (c: string) => (shiftNames[c] ? `Ca ${c} — ${shiftNames[c]}` : `Ca ${c}`),
    [shiftNames],
  );
  // Mục 6: Ca được gán sẵn cho tài khoản hiện tại qua bảng phân công trực ca cố định (Cài đặt →
  // Cấu hình nhà máy → Phân công trực ca) — ưu tiên cao nhất khi gợi ý "Ca sản xuất" lúc mở form.
  const [assignedCa, setAssignedCa] = useState<string | null>(null);
  const getDefaultCa = useCallback((): string => assignedCa || loadStoredCa() || "A", [assignedCa]);

  const [view, setView] = useState<ViewMode>("hub");
  const [endShiftConfirmOpen, setEndShiftConfirmOpen] = useState(false);
  // Mục 3: "confirm" (xác nhận ban đầu) -> "warning" (nếu phát hiện lô dở dang thiếu kiện, chờ
  // xác nhận rõ ràng) -> "preview" (PDF đã dựng xong, chờ người dùng Chia sẻ/Tải/Hoàn tất).
  const [endShiftPhase, setEndShiftPhase] = useState<"confirm" | "pendingDrafts" | "warning" | "preview">(
    "confirm",
  );
  const [endShiftIncomplete, setEndShiftIncomplete] = useState<LotCompletenessWarning[]>([]);
  const [endShiftReportPreview, setEndShiftReportPreview] = useState<{ doc: jsPDF; fileName: string } | null>(null);
  const [endShiftGenerating, setEndShiftGenerating] = useState(false);
  const [endShiftError, setEndShiftError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [maLo, setMaLo] = useState("");
  const [kien, setKien] = useState<KienLetter>("A");

  const [lookup, setLookup] = useState<ConfirmKienLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Cảnh báo (không chặn) các lô KHÁC cùng chủng loại (loai_csr) đang dở dang — tính cả nháp chưa
  // gửi của bất kỳ ai — để "ca sau" biết ngay còn lô nào cần hoàn tất, dù cùng ngày hay khác ngày.
  const [otherIncompleteLots, setOtherIncompleteLots] = useState<OtherIncompleteLot[]>([]);

  const [soBanh, setSoBanh] = useState(1);
  const [ngaySx, setNgaySx] = useState(getTodayISODate());
  const [ca, setCa] = useState<string>("A");
  const [boc, setBoc] = useState("");
  const [pallet, setPallet] = useState<string[]>([]);
  const [chiThi, setChiThi] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [manualNganId, setManualNganId] = useState("");
  const [activeNgans, setActiveNgans] = useState<ActiveNganOption[]>([]);

  // "Lưu tạm" — ghi nhanh 1 nháp, không validate tồn kho/capacity (xem saveDraftKien).
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);

  // Khối "Đang chờ gửi" trong Hub — danh sách nháp CHƯA gửi của user hiện tại + "Gửi tất cả".
  const [pendingDrafts, setPendingDrafts] = useState<ConfirmDraftRow[]>([]);
  const [pendingDraftsLoading, setPendingDraftsLoading] = useState(false);
  const [pendingDraftsError, setPendingDraftsError] = useState<string | null>(null);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [submitBatchError, setSubmitBatchError] = useState<string | null>(null);
  // Sửa 1 nháp CHƯA gửi (mục 4b rule 06-module-production.md) — chỉ áp dụng cho nhóm hiển thị
  // đúng 1 draft gốc (groupPendingDrafts có thể gộp nhiều kiện vào 1 dòng hiển thị; sửa nhiều
  // kiện cùng lúc không có ý nghĩa 1 form đơn, nên chỉ cho sửa khi nhóm không bị gộp).
  const [editingDraft, setEditingDraft] = useState<ConfirmDraftRow | null>(null);
  const [draftEditSaving, setDraftEditSaving] = useState(false);
  const [draftEditError, setDraftEditError] = useState<string | null>(null);

  // "Lịch sử ca" trong Hub — luôn truy vấn lại DB theo (Ngày SX, Ca), KHÔNG theo người nhập, vì
  // 1 ca có thể có nhiều người trực nối tiếp nhau (đã chốt với người dùng). Selector này cũng
  // được tái dùng làm tham số cho nút "Xem/Tạo lại phiếu" và cho "Kết thúc ca".
  const [historyNgay, setHistoryNgay] = useState(() => getDefaultNgaySx(new Date()));
  const [historyCa, setHistoryCa] = useState<string>("A");
  const [history, setHistory] = useState<ShiftHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // "Khóa ca sản xuất" — CHỈ hiển thị trạng thái (đọc), không có nút hành động ở Hub. Hành động
  // Duyệt/Khóa/Mở khóa đặt ở module Thành phẩm chính (product/page.tsx), xem
  // .claude/rules/06-module-production.md mục "Khóa ca sản xuất".
  const [shiftLock, setShiftLock] = useState<ShiftLockStatus | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Mục 2: sửa 1 dòng lịch sử đã gửi (thay vì phải xóa rồi quét lại)
  const [editingEntry, setEditingEntry] = useState<ShiftHistoryEntry | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // Mục 7: PDF đã dựng sẵn từ "Xem/Tạo lại phiếu" trong Hub — Chia sẻ/Tải dùng lại đúng doc này.
  const [reportPreview, setReportPreview] = useState<{ doc: jsPDF; fileName: string } | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.variant === "error" ? 4000 : 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId();
      if (!fid) {
        setLoading(false);
        return;
      }
      const { user } = await hydrateActiveSession();
      if (!user || !hasPermission(user, "product.confirm_scan")) {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }
      const paramF = searchParams.get("f") || "";
      if (paramF && paramF !== fid) {
        setFactoryMismatch(true);
        setLoading(false);
        return;
      }
      setFactoryId(fid);
      setCurrentUser(user);
      loadUserChucVu(fid, user.id).then(setChucVu).catch(() => setChucVu(null));
      loadFactoryShiftNames(fid).then(setShiftNames).catch(() => setShiftNames({}));
      loadUserShiftAssignment(fid, user.id).then(setAssignedCa).catch(() => setAssignedCa(null));

      const paramLo = (searchParams.get("lo") || "").trim();
      if (paramLo) {
        const kienParam = (searchParams.get("kien") || "").toUpperCase();
        const kienValue: KienLetter = (KIEN_LETTERS as string[]).includes(kienParam) ? (kienParam as KienLetter) : "A";
        setMaLo(paramLo);
        setKien(kienValue);
        setView("form");
      } else {
        setView("hub");
      }
      setLoading(false);
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = currentUser?.role === "admin";

  const refreshHistory = useCallback(async () => {
    if (!factoryId) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const [rows, lockStatus] = await Promise.all([
        loadShiftHistory(factoryId, historyNgay, historyCa, isAdmin),
        loadShiftLockStatus(factoryId, historyNgay, historyCa),
      ]);
      setHistory(rows);
      setShiftLock(lockStatus);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setHistoryLoading(false);
    }
  }, [factoryId, historyNgay, historyCa, isAdmin]);

  useEffect(() => {
    if (view !== "hub" || !factoryId) return;
    void refreshHistory();
  }, [view, factoryId, historyNgay, historyCa, refreshHistory]);

  const refreshPendingDrafts = useCallback(async () => {
    if (!factoryId || !currentUser) return;
    setPendingDraftsLoading(true);
    setPendingDraftsError(null);
    try {
      const rows = await loadDrafts(factoryId, currentUser.id);
      setPendingDrafts(rows);
    } catch (err) {
      setPendingDraftsError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setPendingDraftsLoading(false);
    }
  }, [factoryId, currentUser]);

  useEffect(() => {
    if (view !== "hub" || !factoryId || !currentUser) return;
    void refreshPendingDrafts();
  }, [view, factoryId, currentUser, refreshPendingDrafts]);

  useEffect(() => {
    if (!factoryId || !maLo || view !== "form") return;
    let alive = true;

    setOtherIncompleteLots([]);

    const run = async () => {
      setLookupLoading(true);
      setLookupError(null);
      setLookup(null);
      setDraftSaveError(null);
      setManualNganId("");
      try {
        const result = await resolveKienForConfirm(factoryId, maLo, kien);
        if (!alive) return;
        setLookup(result);
        if (result.status === "predicted" || result.status === "partial" || result.status === "partial_kien") {
          setSoBanh(result.status === "partial_kien" ? Math.max(1, result.remainingBanh || 1) : result.maxPerKien || 36);
          setNgaySx(getDefaultNgaySx(new Date()));
          setCa(getDefaultCa());
          setBoc(result.boc || "");
          setPallet(result.pallet || []);
          setChiThi(result.chiThi || "");
          setGhiChu("");
          if (!result.nganId) {
            const ngans = await loadActiveNgansForFactory(factoryId);
            if (alive) setActiveNgans(ngans);
          }
        }
        // Cảnh báo lô khác cùng chủng loại còn dở dang — không chặn thao tác, không đợi trước khi
        // hạ lookupLoading (chạy độc lập, có thể trễ hơn 1 nhịp so với form chính).
        if (result.status !== "not_found" && result.loaiCsr) {
          checkOtherIncompleteLotsForCategory(factoryId, result.loaiCsr, maLo)
            .then((rows) => {
              if (alive) setOtherIncompleteLots(rows);
            })
            .catch(() => {});
        }
      } catch (err) {
        if (alive) setLookupError(err instanceof Error ? err.message : "Lỗi không xác định");
      } finally {
        if (alive) setLookupLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, maLo, kien, view]);

  const bocOptions = useMemo(() => {
    if (!lookup?.loaiCsr) return [];
    return getBocsForLoaiCSR(lookup.dayChuyen || "Mủ tạp", lookup.loaiCsr);
  }, [lookup?.dayChuyen, lookup?.loaiCsr]);

  const effectiveNganId = lookup?.nganId || manualNganId || "";
  const maxPerKien = lookup?.maxPerKien || 36;
  const stepperMax = lookup?.status === "partial_kien" ? Math.max(1, lookup.remainingBanh ?? maxPerKien) : maxPerKien;

  // Kiện đang nhập là lần thứ 2+ (top-up dở dang) — Ca SX/Số chỉ thị/Ngày SX được phép khác lần
  // trước, nhưng Bọc/Loại pallet BẮT BUỘC đồng nhất với chính kiện đó (không phải toàn lô — xem
  // ConfirmKienLookup trong confirm/actions.ts). So khớp bằng tập hợp, không phân biệt thứ tự.
  const bocMismatch =
    lookup?.status === "partial_kien" && !!lookup.existingKienBoc && boc !== lookup.existingKienBoc;
  const palletMismatch =
    lookup?.status === "partial_kien" &&
    !!lookup.existingKienPallet &&
    lookup.existingKienPallet.length > 0 &&
    !sameStringSet(pallet, lookup.existingKienPallet);
  const kienMismatch = bocMismatch || palletMismatch;

  const resetToKienValue = () => {
    if (!lookup) return;
    if (lookup.existingKienBoc) setBoc(lookup.existingKienBoc);
    if (lookup.existingKienPallet) setPallet(lookup.existingKienPallet);
  };

  // Điều kiện cho phép "Lưu tạm" — chỉ check field bắt buộc + !kienMismatch, KHÔNG check tồn
  // kho/capacity (110% ngăn) vì đó là validate atomic dành riêng cho lúc "Gửi tất cả" qua RPC
  // submit_confirm_draft_batch (xem confirm/actions.ts). stepperMax vẫn giữ vì nó là clamp
  // max_per_kien phía client, không phải capacity check.
  const canSaveDraft =
    !!lookup &&
    (lookup.status === "predicted" || lookup.status === "partial" || lookup.status === "partial_kien") &&
    !!effectiveNganId &&
    soBanh > 0 &&
    soBanh <= stepperMax &&
    !!ngaySx &&
    !!ca &&
    !!boc &&
    pallet.length > 0 &&
    !kienMismatch;

  const handleDecoded = useCallback(
    (text: string) => {
      const parsed = parseScannedQr(text);
      if (!parsed) {
        setScanError(tt("scanInvalid"));
        return;
      }
      if (parsed.f && factoryId && parsed.f !== factoryId) {
        setScanError(tt("saiNhaMayMsg"));
        return;
      }
      setScanError(null);
      setMaLo(parsed.lo);
      setKien(parsed.kien);
      setView("form");
    },
    [factoryId, tt],
  );

  // "Lưu tạm" — thay cho gửi ngay: ghi 1 nháp rẻ (không validate tồn kho/capacity), cho phép quét
  // liên tục nhiều kiện rồi mới "Gửi tất cả" 1 lần từ Hub (xem saveDraftKien, submitConfirmDraftBatch).
  const handleSaveDraft = async () => {
    if (!factoryId || !lookup || !currentUser) return;
    setSavingDraft(true);
    setDraftSaveError(null);
    try {
      const result = await saveDraftKien({
        factoryId,
        maLo,
        kien,
        isNewLot: lookup.isNewLot,
        nganId: effectiveNganId,
        loaiCsr: lookup.loaiCsr || "",
        loaiBanh: Number(lookup.loaiBanh) || 35,
        dayChuyen: lookup.dayChuyen,
        soBanh,
        ngaySx,
        ca,
        // Bọc/Pallet/Số chỉ thị giờ luôn cho sửa và luôn gửi lên, kể cả kiện 2-4 của lô đã tồn
        // tại — mỗi kiện tự ghi lại lựa chọn của mình (xem mục 1 rule 06-module-production.md).
        boc,
        pallet,
        chiThi,
        tham: lookup.tham,
        ghiChu: lookup.isNewLot ? (ghiChu || null) : null,
        userId: currentUser.id,
      });
      if (!result.success) {
        setDraftSaveError(result.error);
        return;
      }
      setToast({ message: tt("daLuuTamThanhCong"), variant: "success" });
      // Mục 6: nhớ Ca vừa dùng trên chính thiết bị này làm gợi ý mặc định cho lần quét sau (chỉ
      // khi tài khoản chưa được gán cứng qua bảng phân công — không ghi đè gợi ý ưu tiên cao hơn).
      if (!assignedCa) storeCa(ca);
      setView("hub");
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSavingDraft(false);
    }
  };

  // Nhận cả 1 hoặc nhiều draftId cùng lúc — dòng đã gộp trong "Đang chờ gửi" (cùng lô + pallet +
  // loại bành + chủng loại + bọc) xóa nguyên nhóm chỉ bằng 1 lần bấm.
  const handleDeleteDraft = async (draftIds: string[]) => {
    if (!currentUser || draftIds.length === 0) return;
    setDeletingDraftId(draftIds[0]);
    try {
      for (const draftId of draftIds) {
        const result = await deleteDraft(draftId, currentUser.id);
        if (!result.success) {
          setPendingDraftsError(result.error);
          return;
        }
      }
      await refreshPendingDrafts();
    } catch (err) {
      setPendingDraftsError(err instanceof Error ? err.message : "Lỗi không xác định khi xóa nháp.");
    } finally {
      setDeletingDraftId(null);
    }
  };

  const openEditDraft = (draft: ConfirmDraftRow) => {
    setDraftEditError(null);
    setEditingDraft(draft);
  };

  const handleSaveEditDraft = async (input: {
    nganId: string;
    ca: string;
    ngaySx: string;
    soBanh: number;
    boc: string;
    pallet: string[];
    chiThi: string;
  }) => {
    if (!factoryId || !currentUser || !editingDraft) return;
    setDraftEditSaving(true);
    setDraftEditError(null);
    try {
      const result = await updateDraftKien({
        draftId: editingDraft.id,
        factoryId,
        userId: currentUser.id,
        nganId: input.nganId,
        soBanh: input.soBanh,
        ngaySx: input.ngaySx,
        ca: input.ca,
        boc: input.boc,
        pallet: input.pallet,
        chiThi: input.chiThi || null,
        tham: editingDraft.tham,
        ghiChu: editingDraft.ghiChu,
      });
      if (!result.success) {
        setDraftEditError(result.error);
        return;
      }
      setEditingDraft(null);
      setToast({ message: tt("editSave"), variant: "success" });
      await refreshPendingDrafts();
    } catch (err) {
      setDraftEditError(err instanceof Error ? err.message : tt("editSaveError"));
    } finally {
      setDraftEditSaving(false);
    }
  };

  // "Gửi tất cả" — validate + ghi atomic toàn bộ nháp qua submitConfirmDraftBatch. All-or-nothing:
  // 1 nháp lỗi thì hiện đúng 1 message lỗi, giữ nguyên toàn bộ danh sách nháp để sửa/xóa rồi thử lại.
  const handleSubmitAllDrafts = async () => {
    if (!factoryId || !currentUser || pendingDrafts.length === 0) return;
    setSubmittingBatch(true);
    setSubmitBatchError(null);
    try {
      const result = await submitConfirmDraftBatch(
        factoryId,
        currentUser.id,
        pendingDrafts.map((d) => d.id),
      );
      if (!result.success) {
        setSubmitBatchError(result.error);
        return;
      }
      setToast({ message: tt("submitAllSuccess", { count: result.count }), variant: "success" });
      if (result.touchedLots.length > 0) {
        const first = result.touchedLots[0];
        const extra = result.touchedLots.length > 1 ? ` (+${result.touchedLots.length - 1} lô khác)` : "";
        setKpiPrompt({ recordId: first.lotId, recordLabel: `Lô thành phẩm ${first.maLo}${extra}` });
      }
      await Promise.all([refreshPendingDrafts(), refreshHistory()]);
    } catch (err) {
      setSubmitBatchError(err instanceof Error ? err.message : "Lỗi không xác định khi gửi nháp.");
    } finally {
      setSubmittingBatch(false);
    }
  };

  const userDisplayName = currentUser?.full_name || currentUser?.username || "";

  const handleDeleteEntry = async (entry: ShiftHistoryEntry) => {
    setDeletingId(entry.transactionId);
    try {
      const result = await deleteShiftHistoryEntry(entry.transactionId, currentUser?.id ?? null);
      if (!result.success) {
        setHistoryError(result.error);
        setToast({ message: result.error, variant: "error" });
        return;
      }
      setDeleteConfirmId(null);
      await refreshHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi không xác định khi xóa giao dịch.";
      setHistoryError(message);
      setToast({ message, variant: "error" });
    } finally {
      setDeletingId(null);
    }
  };

  // Mục 2: sửa 1 dòng lịch sử đã gửi. openEditEntry chỉ pre-fill state của modal Sửa (component
  // EditEntryModal quản lý state form riêng, xem bên dưới) — không đụng tới state của form quét.
  const openEditEntry = (entry: ShiftHistoryEntry) => {
    setEditError(null);
    setEditingEntry(entry);
  };

  const handleSaveEdit = async (input: {
    nganId: string;
    ca: string;
    ngaySx: string;
    soBanh: number;
    boc: string;
    pallet: string[];
    chiThi: string;
  }) => {
    if (!factoryId || !editingEntry) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await editShiftHistoryEntry({
        transactionId: editingEntry.transactionId,
        factoryId,
        isAdmin,
        nganId: input.nganId,
        ca: input.ca,
        ngaySx: input.ngaySx,
        soBanh: input.soBanh,
        boc: input.boc || null,
        pallet: input.pallet,
        chiThi: input.chiThi || null,
        actorUserId: currentUser?.id ?? null,
      });
      if (!result.success) {
        setEditError(result.error);
        return;
      }
      setEditingEntry(null);
      setToast({ message: tt("editSave"), variant: "success" });
      await refreshHistory();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : tt("editSaveError"));
    } finally {
      setEditSaving(false);
    }
  };

  const handleGenerateReportNow = async () => {
    if (!factoryId) return;
    setReportGenerating(true);
    setReportError(null);
    setReportPreview(null);
    try {
      const data = await loadShiftReportData(factoryId, historyNgay);
      if (data.sections.length === 0) {
        setReportError(tt("endShiftNoData"));
        return;
      }
      const doc = await buildShiftReportPdf(data);
      const fileName = buildShiftReportFileName(data);
      openShiftReportPdfInNewTab(doc);
      setReportPreview({ doc, fileName });
    } catch (err) {
      setReportError(err instanceof Error ? err.message : tt("endShiftReportError"));
    } finally {
      setReportGenerating(false);
    }
  };

  // Mục 3 + 7: "Kết thúc ca" giờ có 4 giai đoạn — xem khai báo endShiftPhase ở trên. Bước 1 (bấm
  // "Xác nhận" lần đầu) kiểm tra còn nháp CHƯA gửi trước, rồi mới tới lô dở dang thiếu kiện, trước
  // khi cho phép xuất phiếu.
  const openEndShiftModal = () => {
    setEndShiftPhase("confirm");
    setEndShiftIncomplete([]);
    setEndShiftReportPreview(null);
    setEndShiftError(null);
    setEndShiftConfirmOpen(true);
  };

  const proceedGenerateEndShiftReport = async () => {
    if (!factoryId) return;
    setEndShiftGenerating(true);
    setEndShiftError(null);
    try {
      const data = await loadShiftReportData(factoryId, historyNgay);
      if (data.sections.length === 0) {
        setEndShiftError(tt("endShiftNoData"));
        setEndShiftPhase("confirm");
        return;
      }
      const doc = await buildShiftReportPdf(data);
      const fileName = buildShiftReportFileName(data);
      openShiftReportPdfInNewTab(doc);
      setEndShiftReportPreview({ doc, fileName });
      setEndShiftPhase("preview");
    } catch (err) {
      setEndShiftError(err instanceof Error ? err.message : tt("endShiftReportError"));
      setEndShiftPhase("confirm");
    } finally {
      setEndShiftGenerating(false);
    }
  };

  // Tiếp tục luồng Kết thúc ca SAU KHI đã xử lý xong phần nháp (gửi hết hoặc người dùng chủ động bỏ
  // qua) — kiểm tra lô dở dang thiếu kiện như cũ rồi mới xuất phiếu.
  const continueEndShiftAfterDrafts = async () => {
    if (!factoryId) return;
    setEndShiftGenerating(true);
    setEndShiftError(null);
    try {
      const incomplete = await checkIncompleteLotsForDay(factoryId, historyNgay);
      if (incomplete.length > 0) {
        setEndShiftIncomplete(incomplete);
        setEndShiftPhase("warning");
        setEndShiftGenerating(false);
        return;
      }
      await proceedGenerateEndShiftReport();
    } catch (err) {
      setEndShiftError(err instanceof Error ? err.message : tt("endShiftReportError"));
      setEndShiftGenerating(false);
    }
  };

  const handleEndShiftFirstConfirm = async () => {
    if (!factoryId) {
      setEndShiftConfirmOpen(false);
      router.push("/dashboard/product");
      return;
    }
    // Mục "Kết thúc ca nên cảnh báo còn nháp chưa gửi": dùng lại state pendingDrafts đã được Hub
    // tự tải (view vẫn là "hub" trong lúc modal này mở) — nếu còn nháp, chặn lại ở giai đoạn riêng
    // trước khi kiểm tra lô dở dang, để tránh xuất phiếu thiếu dữ liệu do quên gửi.
    if (pendingDrafts.length > 0) {
      setEndShiftPhase("pendingDrafts");
      return;
    }
    await continueEndShiftAfterDrafts();
  };

  // "Gửi nháp ngay" từ giai đoạn cảnh báo còn nháp — gửi xong mới tiếp tục kiểm tra lô dở dang.
  const handleEndShiftSendDraftsAndContinue = async () => {
    if (!factoryId || !currentUser) return;
    setEndShiftGenerating(true);
    setEndShiftError(null);
    try {
      const result = await submitConfirmDraftBatch(
        factoryId,
        currentUser.id,
        pendingDrafts.map((d) => d.id),
      );
      if (!result.success) {
        setEndShiftError(result.error);
        setEndShiftGenerating(false);
        return;
      }
      await Promise.all([refreshPendingDrafts(), refreshHistory()]);
      await continueEndShiftAfterDrafts();
    } catch (err) {
      setEndShiftError(err instanceof Error ? err.message : tt("endShiftReportError"));
      setEndShiftGenerating(false);
    }
  };

  // "Bỏ qua, vẫn kết thúc ca" từ giai đoạn cảnh báo còn nháp — không gửi nháp, tiếp tục như bình
  // thường (dữ liệu trong các nháp bị bỏ qua này sẽ KHÔNG có trong phiếu vì chưa từng ghi vào DB).
  const handleEndShiftIgnoreDraftsAndContinue = async () => {
    await continueEndShiftAfterDrafts();
  };

  const handleFinishEndShift = () => {
    setEndShiftConfirmOpen(false);
    setEndShiftPhase("confirm");
    setEndShiftReportPreview(null);
    router.push("/dashboard/product");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  if (permissionDenied) {
    return <CenteredMessage icon={<AlertTriangle size={28} />} title={tt("khongCoQuyen")} message={tt("khongCoQuyenMsg")} />;
  }

  if (factoryMismatch) {
    return <CenteredMessage icon={<AlertTriangle size={28} />} title={tt("saiNhaMay")} message={tt("saiNhaMayMsg")} />;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {toast && (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-lg ${
            toast.variant === "error" ? "bg-red-600" : "bg-emerald-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      {view === "scanning" ? (
        <QrScanner
          onDecoded={handleDecoded}
          onCancel={() => {
            setScanError(null);
            setView("hub");
          }}
          hintText={tt("scanningHint")}
          cancelText={tt("scanCancel")}
          cameraErrorText={tt("cameraError")}
          uploadButtonText={tt("uploadQrImage")}
          uploadScanningText={tt("uploadQrImageScanning")}
          uploadNotFoundText={tt("uploadQrImageNotFound")}
          orDividerText={tt("orDivider")}
          scanError={scanError}
        />
      ) : (
        <>
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="mb-2 flex justify-end">
              <LangToggle lang={lang} onChange={switchLang} />
            </div>
            <div className="flex items-center gap-3">
              {view === "form" && (
                <button
                  type="button"
                  onClick={() => setView("hub")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"
                >
                  <ChevronLeft size={22} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-extrabold text-emerald-700">
                  {view === "form" ? tt("formTitle") : tt("appTitle")}
                </h1>
                <p className="truncate text-xs text-slate-500">
                  {view === "form" ? tt("formSubtitle") : tt("appSubtitle")}
                </p>
              </div>
              {currentUser && (
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-sm font-extrabold leading-tight text-slate-700">{userDisplayName}</div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
                      {chucVu || tt("shiftLabel")}
                    </div>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <User size={18} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-xl px-4 py-5">
            {/* Cảnh báo (không chặn) các lô KHÁC cùng chủng loại còn dở dang — kể cả nháp chưa gửi
                của bất kỳ ai đều được tính, để "ca sau" luôn thấy đúng tiến độ dù cùng ngày hay khác
                ngày với lô đang quét. Hiện xuyên suốt mọi trạng thái của kiện đang quét. */}
            {view === "form" && otherIncompleteLots.length > 0 && (
              <div className="mb-4 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-sky-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold text-sky-800">{tt("otherIncompleteLotsTitle")}</div>
                    <div className="mt-1 space-y-0.5">
                      {otherIncompleteLots.map((lot) => (
                        <div key={lot.maLo} className="text-xs font-semibold text-sky-700">
                          {lot.maLo}:{" "}
                          {lot.missing
                            .map((m) => `${tt("kienLabel")} ${m.kien} (${tt("missingBanhLabel", { missingBanh: m.missingBanh })})`)
                            .join(", ")}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "hub" ? (
              <HubView
                tt={tt}
                caLabel={caLabel}
                historyNgay={historyNgay}
                historyCa={historyCa}
                onChangeNgay={setHistoryNgay}
                onChangeCa={setHistoryCa}
                history={history}
                historyLoading={historyLoading}
                historyError={historyError}
                shiftLock={shiftLock}
                deleteConfirmId={deleteConfirmId}
                deletingId={deletingId}
                onAskDelete={setDeleteConfirmId}
                onCancelDelete={() => setDeleteConfirmId(null)}
                onConfirmDelete={handleDeleteEntry}
                onEdit={openEditEntry}
                reportGenerating={reportGenerating}
                reportError={reportError}
                reportPreview={reportPreview}
                onGenerateReport={handleGenerateReportNow}
                onScan={() => {
                  setScanError(null);
                  setView("scanning");
                }}
                onEndShift={openEndShiftModal}
                pendingDrafts={pendingDrafts}
                pendingDraftsLoading={pendingDraftsLoading}
                pendingDraftsError={pendingDraftsError}
                deletingDraftId={deletingDraftId}
                onDeleteDraft={handleDeleteDraft}
                onEditDraft={openEditDraft}
                submittingBatch={submittingBatch}
                submitBatchError={submitBatchError}
                onSubmitAllDrafts={handleSubmitAllDrafts}
                factoryId={factoryId}
                kpiPrompt={kpiPrompt}
                onKpiPromptDone={() => setKpiPrompt(null)}
              />
            ) : lookupLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                {tt("dangTai")}
              </div>
            ) : lookupError || !lookup ? (
              <CardMessage icon={<AlertTriangle size={24} className="text-amber-500" />} text={lookupError || "—"} />
            ) : lookup.status === "not_found" ? (
              <CardMessage icon={<AlertTriangle size={24} className="text-red-500" />} text={tt("khongTimThay")} />
            ) : lookup.status === "produced" ? (
              <div className="space-y-4">
                <CardMessage
                  icon={<CheckCircle2 size={24} className="text-emerald-600" />}
                  text={tt("daSanXuatRoi", { kien: lookup.kien, maLo: lookup.maLo })}
                />
                <button
                  type="button"
                  onClick={() => {
                    setScanError(null);
                    setView("scanning");
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
                >
                  <ScanLine size={20} />
                  {tt("scanAnotherKien")}
                </button>
              </div>
            ) : lookup.status === "drafted_full" ? (
              <div className="space-y-4">
                <CardMessage
                  icon={<Inbox size={24} className="text-amber-500" />}
                  text={tt("kienDaDuNhap", {
                    kien: lookup.kien,
                    maLo: lookup.maLo,
                    max: lookup.maxPerKien ?? 0,
                    by: lookup.pendingDraftBy.join(", ") || "—",
                  })}
                />
                <button
                  type="button"
                  onClick={() => {
                    setScanError(null);
                    setView("scanning");
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
                >
                  <ScanLine size={20} />
                  {tt("scanAnotherKien")}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label={tt("ngaySanXuat")} icon={<Calendar size={13} />}>
                  <input
                    type="date"
                    value={ngaySx}
                    onChange={(e) => setNgaySx(e.target.value)}
                    className={highlightFieldClass}
                  />
                </Field>
                <Field label={tt("gioSanXuat")} icon={<Clock size={13} />}>
                  <div className="flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">
                    {formatDMYHMS(now)}
                  </div>
                </Field>

                <div className="grid grid-cols-5 gap-3">
                  <div className="col-span-3">
                    <Field label={tt("caSanXuat")} icon={<Sun size={13} />}>
                      <select
                        value={ca}
                        onChange={(e) => setCa(e.target.value)}
                        className={highlightFieldClass}
                      >
                        {CA_OPTS.map((c) => (
                          <option key={c} value={c}>
                            {caLabel(c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label={tt("chiThi")} icon={<Hash size={13} />}>
                      <input
                        type="text"
                        value={chiThi}
                        onChange={(e) => setChiThi(e.target.value)}
                        className={highlightFieldClass}
                      />
                    </Field>
                  </div>
                </div>

                {/* Thẻ gộp Mã lô + Kiện + Số bành — số bành nhập tay được (xóa/gõ số khác), không
                    chỉ tăng giảm bằng nút +/-. */}
                <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-md">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-emerald-100">{tt("soLo")}</div>
                      <div className="text-2xl font-extrabold">{lookup.maLo}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-emerald-100">
                        {tt("kienLabel")}
                      </div>
                      <div className="text-2xl font-extrabold">{lookup.kien}</div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-white/20 pt-4">
                    <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-emerald-100">
                      <Package size={12} /> {tt("soBanh")}
                    </div>
                    <div className="mt-1.5 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSoBanh((v) => Math.max(0, v - 1))}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <Minus size={18} />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={stepperMax}
                        value={soBanh === 0 ? "" : soBanh}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setSoBanh(0);
                            return;
                          }
                          const parsed = Math.floor(Number(raw));
                          if (!Number.isFinite(parsed)) return;
                          setSoBanh(Math.max(0, Math.min(stepperMax, parsed)));
                        }}
                        className="w-20 rounded-xl border border-white/30 bg-white/10 py-1.5 text-center text-3xl font-extrabold text-white outline-none focus:border-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => setSoBanh((v) => Math.min(stepperMax, v + 1))}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <div className="mt-1 text-center text-[11px] text-emerald-100">
                      {tt("stepperHint", { max: stepperMax })}
                    </div>
                  </div>
                </div>

                {lookup.status === "partial_kien" && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
                    {lookup.pendingDraftBanh > 0
                      ? tt("kienDaCoMotPhanWithPending", {
                          kien: lookup.kien,
                          existingBanh: lookup.existingBanh,
                          pendingBanh: lookup.pendingDraftBanh,
                          by: lookup.pendingDraftBy.join(", ") || "—",
                          max: lookup.remainingBanh ?? 0,
                        })
                      : tt("kienDaCoMotPhan", {
                          kien: lookup.kien,
                          existingBanh: lookup.existingBanh,
                          max: lookup.remainingBanh ?? 0,
                        })}
                  </div>
                )}

                {kienMismatch && (
                  <div className="rounded-xl border-2 border-red-300 bg-red-50 px-3.5 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-red-700">
                          {tt("kienBocPalletMismatchTitle")}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-red-600">
                          {tt("kienBocPalletMismatchBody", {
                            kien: lookup.kien,
                            boc: lookup.existingKienBoc || "—",
                            pallet: (lookup.existingKienPallet || []).join(", ") || "—",
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={resetToKienValue}
                          className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                        >
                          {tt("resetToKienValue")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {!lookup.nganId && (
                  <Field label={tt("chonNganNguon")} icon={<Warehouse size={13} />}>
                    <select
                      value={manualNganId}
                      onChange={(e) => setManualNganId(e.target.value)}
                      className={highlightFieldClassAmber}
                    >
                      <option value="">{tt("chonNgan")}</option>
                      {activeNgans.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.ma_ngan} — {n.ten_ngan}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {lookup.nganId && (
                  <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 px-3.5 py-3">
                    <Warehouse size={16} className="shrink-0 text-emerald-500" />
                    <span className="text-[15.4px] font-bold text-slate-500">{tt("nganNguon")}: </span>
                    <span className="text-[15.4px] font-extrabold text-slate-800">
                      {lookup.nganMa || "—"} {lookup.nganTen ? `— ${lookup.nganTen}` : ""}
                    </span>
                  </div>
                )}

                <Field label={tt("boc")} icon={<Layers size={13} />}>
                  <select
                    value={boc}
                    onChange={(e) => setBoc(e.target.value)}
                    className={highlightFieldClass}
                  >
                    <option value="">{tt("chonBoc")}</option>
                    {bocOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                    {boc && !bocOptions.includes(boc) && <option value={boc}>{boc}</option>}
                  </select>
                </Field>

                {/* Loại pallet: chọn 1, không phải chọn nhiều — click lại pallet đang chọn để bỏ
                    chọn, click pallet khác thì thay thế hoàn toàn lựa chọn cũ. Kiểu dữ liệu vẫn
                    giữ string[] (khớp cột DB TEXT[] và logic so khớp kienMismatch dùng chung với
                    modal sửa lô ở product/page.tsx cho phép nhiều pallet) — chỉ ràng buộc UI ở màn
                    quét QR này còn tối đa 1 phần tử. */}
                <Field label={tt("loaiPallet")} icon={<Boxes size={13} />}>
                  <div className="flex flex-wrap gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-2.5">
                    {PALLET_OPTS.map((p) => {
                      const checked = pallet.length === 1 && pallet[0] === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPallet(checked ? [] : [p])}
                          className={`rounded-full px-3.5 py-2 text-[13.2px] font-bold transition-colors ${
                            checked
                              ? "bg-emerald-600 text-white shadow-sm"
                              : "bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {palletLabel(lang, p)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {!lookup.isNewLot && (
                  <div className="text-xs text-slate-400">{tt("lotExistsNote")}</div>
                )}

                {lookup.isNewLot && (
                  <Field label={tt("ghiChu")}>
                    <RequiredNoteSelect
                      factoryId={factoryId}
                      value={ghiChu}
                      onChange={setGhiChu}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                      onError={setDraftSaveError}
                    />
                  </Field>
                )}

                {draftSaveError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600">
                    {draftSaveError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canSaveDraft || savingDraft}
                  onClick={handleSaveDraft}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-extrabold text-white shadow-md transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save size={20} />
                  {savingDraft ? tt("dangLuu") : tt("luuTam")}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {endShiftConfirmOpen && (
        <EndShiftConfirmModal
          tt={tt}
          phase={endShiftPhase}
          generating={endShiftGenerating}
          error={endShiftError}
          incomplete={endShiftIncomplete}
          pendingDrafts={pendingDrafts}
          reportPreview={endShiftReportPreview}
          onCancel={() => {
            if (endShiftGenerating) return;
            setEndShiftConfirmOpen(false);
            setEndShiftError(null);
          }}
          onConfirm={handleEndShiftFirstConfirm}
          onSendDraftsAndContinue={handleEndShiftSendDraftsAndContinue}
          onIgnoreDraftsAndContinue={handleEndShiftIgnoreDraftsAndContinue}
          onProceedAnyway={proceedGenerateEndShiftReport}
          onFinish={handleFinishEndShift}
        />
      )}

      {editingEntry && factoryId && (
        <EditEntryModal
          tt={tt}
          lang={lang}
          caLabel={caLabel}
          factoryId={factoryId}
          entry={editingEntry}
          saving={editSaving}
          error={editError}
          onCancel={() => {
            if (editSaving) return;
            setEditingEntry(null);
            setEditError(null);
          }}
          onSave={handleSaveEdit}
        />
      )}

      {editingDraft && factoryId && (
        <EditDraftModal
          tt={tt}
          lang={lang}
          caLabel={caLabel}
          factoryId={factoryId}
          draft={editingDraft}
          saving={draftEditSaving}
          error={draftEditError}
          onCancel={() => {
            if (draftEditSaving) return;
            setEditingDraft(null);
            setDraftEditError(null);
          }}
          onSave={handleSaveEditDraft}
        />
      )}
    </div>
  );
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-slate-300 text-xs font-bold">
      {LANG_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => onChange(opt.code)}
          className={`px-3 py-1 transition-colors ${
            lang === opt.code ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-500">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function CenteredMessage({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-md">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          {icon}
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function CardMessage({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">{icon}</div>
      <p className="text-sm font-semibold leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}

type PendingDraftGroup = {
  key: string;
  draftIds: string[];
  maLo: string;
  kienLetters: string;
  totalSoBanh: number;
  nganLabel: string;
  caLetters: string;
};

// Dồn các nháp CHƯA gửi cùng lô + pallet + loại bành + chủng loại (CSR) + bọc thành 1 dòng hiển
// thị — mỗi kiện vẫn là 1 draft riêng trong DB (không đổi cách lưu/gửi), chỉ gộp ở tầng hiển thị.
// Ca sản xuất được PHÉP khác nhau giữa các kiện cùng nhóm (đúng rule top-up), nên không nằm trong
// khóa gộp — hiển thị gộp lại dạng "A/B" nếu có nhiều giá trị.
function groupPendingDrafts(drafts: ConfirmDraftRow[]): PendingDraftGroup[] {
  const map = new Map<
    string,
    { maLo: string; draftIds: string[]; kienSet: Set<string>; totalSoBanh: number; nganSet: Set<string>; caSet: Set<string> }
  >();
  for (const d of drafts) {
    const palletKey = [...(d.pallet || [])].sort().join(",");
    const key = `${d.maLo}||${d.loaiCsr}||${d.loaiBanh}||${d.boc || ""}||${palletKey}||${d.nganId || d.nganMa || ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.draftIds.push(d.id);
      existing.totalSoBanh += d.soBanh;
      existing.kienSet.add(d.kien);
      if (d.nganMa) existing.nganSet.add(d.nganMa);
      existing.caSet.add(d.ca);
    } else {
      map.set(key, {
        maLo: d.maLo,
        draftIds: [d.id],
        kienSet: new Set([d.kien]),
        totalSoBanh: d.soBanh,
        nganSet: new Set(d.nganMa ? [d.nganMa] : []),
        caSet: new Set([d.ca]),
      });
    }
  }
  return [...map.entries()].map(([key, g]) => ({
    key,
    draftIds: g.draftIds,
    maLo: g.maLo,
    kienLetters: [...g.kienSet].sort().join(", "),
    totalSoBanh: g.totalSoBanh,
    nganLabel: g.nganSet.size > 0 ? [...g.nganSet].join(", ") : "—",
    caLetters: [...g.caSet].sort().join("/"),
  }));
}

function HubView({
  tt,
  caLabel,
  historyNgay,
  historyCa,
  onChangeNgay,
  onChangeCa,
  history,
  historyLoading,
  historyError,
  shiftLock,
  deleteConfirmId,
  deletingId,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onEdit,
  reportGenerating,
  reportError,
  reportPreview,
  onGenerateReport,
  onScan,
  onEndShift,
  pendingDrafts,
  pendingDraftsLoading,
  pendingDraftsError,
  deletingDraftId,
  onDeleteDraft,
  onEditDraft,
  submittingBatch,
  submitBatchError,
  onSubmitAllDrafts,
  factoryId,
  kpiPrompt,
  onKpiPromptDone,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  caLabel: (c: string) => string;
  historyNgay: string;
  historyCa: string;
  onChangeNgay: (v: string) => void;
  onChangeCa: (v: string) => void;
  history: ShiftHistoryEntry[];
  historyLoading: boolean;
  historyError: string | null;
  shiftLock: ShiftLockStatus | null;
  deleteConfirmId: string | null;
  deletingId: string | null;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (entry: ShiftHistoryEntry) => void;
  onEdit: (entry: ShiftHistoryEntry) => void;
  reportGenerating: boolean;
  reportError: string | null;
  reportPreview: { doc: jsPDF; fileName: string } | null;
  onGenerateReport: () => void;
  onScan: () => void;
  onEndShift: () => void;
  pendingDrafts: ConfirmDraftRow[];
  pendingDraftsLoading: boolean;
  pendingDraftsError: string | null;
  deletingDraftId: string | null;
  onDeleteDraft: (draftIds: string[]) => void;
  onEditDraft: (draft: ConfirmDraftRow) => void;
  submittingBatch: boolean;
  submitBatchError: string | null;
  onSubmitAllDrafts: () => void;
  factoryId: string | null;
  kpiPrompt: { recordId: string; recordLabel: string } | null;
  onKpiPromptDone: () => void;
}) {
  const pendingDraftGroups = useMemo(() => groupPendingDrafts(pendingDrafts), [pendingDrafts]);
  return (
    <div className="space-y-4">
      {kpiPrompt && (
        <KpiLinkPrompt
          factoryId={factoryId}
          moduleCode="product:create"
          recordId={kpiPrompt.recordId}
          recordLabel={kpiPrompt.recordLabel}
          recordUrl="/dashboard/product"
          onDone={onKpiPromptDone}
        />
      )}
      <button
        type="button"
        onClick={onScan}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-6 text-lg font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
      >
        <ScanLine size={26} />
        {tt("scanQr")}
      </button>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-amber-800">
          <Inbox size={16} />
          {tt("pendingDraftsTitle", { count: pendingDrafts.length })}
        </div>

        {pendingDraftsLoading ? (
          <p className="py-3 text-center text-xs text-amber-700">{tt("dangTai")}</p>
        ) : pendingDraftsError ? (
          <p className="py-2 text-center text-xs font-semibold text-red-600">{pendingDraftsError}</p>
        ) : pendingDrafts.length === 0 ? (
          <p className="py-3 text-center text-xs text-amber-700">{tt("noPendingDrafts")}</p>
        ) : (
          <div className="space-y-2">
            {pendingDraftGroups.map((g) => (
              <div
                key={g.key}
                className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-800">
                    {g.maLo} - {tt("kienLabel")} {g.kienLetters}
                  </div>
                  <div className="text-xs text-slate-500">
                    {g.totalSoBanh} bành · {g.nganLabel} · {tt("caSanXuat")} {g.caLetters}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Sửa chỉ khả dụng khi nhóm hiển thị đúng 1 draft gốc — 1 nhóm gộp nhiều kiện
                      không có ý nghĩa 1 form sửa đơn (mỗi kiện có ngăn/số bành/ca riêng). */}
                  {g.draftIds.length === 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const draft = pendingDrafts.find((d) => d.id === g.draftIds[0]);
                        if (draft) onEditDraft(draft);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-amber-600 hover:bg-amber-100"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!!deletingDraftId && g.draftIds.includes(deletingDraftId)}
                    onClick={() => onDeleteDraft(g.draftIds)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-red-500 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {submitBatchError && (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
            {submitBatchError}
          </div>
        )}

        <button
          type="button"
          disabled={pendingDrafts.length === 0 || submittingBatch}
          onClick={onSubmitAllDrafts}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submittingBatch ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {submittingBatch ? tt("submittingAllDrafts") : tt("submitAllDrafts", { count: pendingDrafts.length })}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-emerald-700">
          <Package size={16} />
          {tt("sessionLogTitle")}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <Calendar size={11} /> {tt("ngaySanXuat")}
            </div>
            <input
              type="date"
              value={historyNgay}
              onChange={(e) => onChangeNgay(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <Sun size={11} /> {tt("caSanXuat")}
            </div>
            <select
              value={historyCa}
              onChange={(e) => onChangeCa(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
            >
              {CA_OPTS.map((c) => (
                <option key={c} value={c}>
                  {caLabel(c)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {shiftLock?.isActive && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <Lock size={14} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-xs font-semibold text-red-700">
              Ca này đã được duyệt & khóa bởi {shiftLock.lockedByName} · {formatDMYHMS(new Date(shiftLock.lockedAt))}.
              Liên hệ quản trị viên (module Thành phẩm) để mở khóa.
            </p>
          </div>
        )}

        {historyLoading ? (
          <p className="py-4 text-center text-xs text-slate-400">{tt("dangTai")}</p>
        ) : historyError ? (
          <p className="py-2 text-center text-xs font-semibold text-red-500">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">{tt("noLogYet")}</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.transactionId}
                className="rounded-xl border-l-4 border-emerald-500 bg-slate-50 px-3 py-2 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-800">
                      {h.maLo} - {tt("kienLabel")} {h.kienLetters || "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {h.soBanh} bành · {h.nguoiNhap} · {formatHMS(h.createdAt)}
                    </div>
                  </div>
                  {deleteConfirmId === h.transactionId ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={deletingId === h.transactionId}
                        onClick={() => onConfirmDelete(h)}
                        className="rounded-lg bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {deletingId === h.transactionId ? "..." : tt("confirmAction")}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelDelete}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
                      >
                        {tt("cancel")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      {h.canEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(h)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-blue-500 hover:bg-blue-50"
                          title={tt("editEntry")}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {h.canDelete && (
                        <button
                          type="button"
                          onClick={() => onAskDelete(h.transactionId)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-red-500 hover:bg-red-50"
                          title={tt("deleteEntry")}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={reportGenerating}
          onClick={onGenerateReport}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {reportGenerating ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
          {tt("viewOrRegenerateReport")}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">{tt("reportCoversWholeDayHint")}</p>
        {reportError && <p className="mt-2 text-center text-xs font-semibold text-red-500">{reportError}</p>}
        {reportPreview && (
          <div className="mt-2">
            <ShiftReportPreviewBar doc={reportPreview.doc} fileName={reportPreview.fileName} />
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-slate-300 pt-4">
        <button
          type="button"
          onClick={onEndShift}
          className="w-full rounded-2xl bg-red-600 py-3.5 text-base font-extrabold text-white shadow-md transition-all hover:bg-red-700"
        >
          {tt("endShift")}
        </button>
      </div>
    </div>
  );
}

// Mục 3 + 7: 3 giai đoạn — "confirm" (xác nhận ban đầu), "warning" (lô dở dang thiếu kiện, chờ
// xác nhận rõ ràng "Vẫn kết thúc ca"), "preview" (PDF đã dựng + mở tab xem trước, chờ Chia sẻ/
// Tải/Hoàn tất).
function EndShiftConfirmModal({
  tt,
  phase,
  generating,
  error,
  incomplete,
  pendingDrafts,
  reportPreview,
  onCancel,
  onConfirm,
  onSendDraftsAndContinue,
  onIgnoreDraftsAndContinue,
  onProceedAnyway,
  onFinish,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  phase: "confirm" | "pendingDrafts" | "warning" | "preview";
  generating: boolean;
  error: string | null;
  incomplete: LotCompletenessWarning[];
  pendingDrafts: ConfirmDraftRow[];
  reportPreview: { doc: jsPDF; fileName: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
  onSendDraftsAndContinue: () => void;
  onIgnoreDraftsAndContinue: () => void;
  onProceedAnyway: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        {phase === "confirm" && (
          <>
            <h3 className="text-base font-extrabold text-slate-800">{tt("confirmEndShiftTitle")}</h3>
            <p className="mt-2 text-sm text-slate-500">{tt("confirmEndShiftMessage")}</p>
            {error && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={generating}
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tt("cancel")}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={generating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating && <Loader2 size={16} className="animate-spin" />}
                {generating ? tt("endShiftGenerating") : tt("confirmAction")}
              </button>
            </div>
          </>
        )}

        {phase === "pendingDrafts" && (
          <>
            <div className="flex items-start gap-2">
              <Inbox size={20} className="mt-0.5 shrink-0 text-amber-500" />
              <h3 className="text-base font-extrabold text-slate-800">
                {tt("pendingDraftsBlockingTitle", { count: pendingDrafts.length })}
              </h3>
            </div>
            <p className="mt-2 text-sm text-slate-500">{tt("pendingDraftsBlockingBody")}</p>
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-2.5">
              {pendingDrafts.map((d) => (
                <div key={d.id} className="text-xs font-semibold text-amber-800">
                  {d.maLo} — {tt("kienLabel")} {d.kien} ({d.soBanh} bành)
                </div>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onSendDraftsAndContinue}
                disabled={generating}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating && <Loader2 size={16} className="animate-spin" />}
                {generating ? tt("endShiftGenerating") : tt("sendDraftsNow")}
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={generating}
                  className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tt("cancel")}
                </button>
                <button
                  type="button"
                  onClick={onIgnoreDraftsAndContinue}
                  disabled={generating}
                  className="flex-1 rounded-xl border border-red-300 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tt("endShiftIgnorePending")}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "warning" && (
          <>
            <div className="flex items-start gap-2">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-500" />
              <h3 className="text-base font-extrabold text-slate-800">
                {tt("endShiftIncompleteTitle", { count: incomplete.length })}
              </h3>
            </div>
            <p className="mt-2 text-sm text-slate-500">{tt("endShiftIncompleteBody")}</p>
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-2.5">
              {incomplete.map((w) => (
                <div key={w.maLo} className="text-xs font-semibold text-amber-800">
                  {w.maLo} — {tt("kienLabel")} {w.missingKien.join(", ")}
                </div>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={generating}
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tt("cancel")}
              </button>
              <button
                type="button"
                onClick={onProceedAnyway}
                disabled={generating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating && <Loader2 size={16} className="animate-spin" />}
                {generating ? tt("endShiftGenerating") : tt("endShiftProceedAnyway")}
              </button>
            </div>
          </>
        )}

        {phase === "preview" && reportPreview && (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" />
              <h3 className="text-base font-extrabold text-slate-800">{tt("endShiftReportReady")}</h3>
            </div>
            <div className="mt-3">
              <ShiftReportPreviewBar doc={reportPreview.doc} fileName={reportPreview.fileName} />
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                {tt("endShiftStayHere")}
              </button>
              <button
                type="button"
                onClick={onFinish}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
              >
                {tt("endShiftFinish")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditEntryModal({
  tt,
  lang,
  caLabel,
  factoryId,
  entry,
  saving,
  error,
  onCancel,
  onSave,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
  caLabel: (c: string) => string;
  factoryId: string;
  entry: ShiftHistoryEntry;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: {
    nganId: string;
    ca: string;
    ngaySx: string;
    soBanh: number;
    boc: string;
    pallet: string[];
    chiThi: string;
  }) => void;
}) {
  const [nganId, setNganId] = useState(entry.nganId || "");
  const [ca, setCa] = useState(entry.ca);
  const [ngaySx, setNgaySx] = useState(entry.ngaySx);
  const [soBanh, setSoBanh] = useState(entry.soBanh);
  const [boc, setBoc] = useState(entry.boc || "");
  const [pallet, setPallet] = useState<string[]>(entry.pallet || []);
  const [chiThi, setChiThi] = useState(entry.chiThi || "");
  // Danh sách ngăn đang hoạt động để đổi ngăn nguồn — ngăn hiện tại của giao dịch (entry.nganId)
  // luôn được thêm vào đầu danh sách kể cả khi nó không còn "Chờ sản xuất/Đang sản xuất" (đã
  // chuyển "Đã sản xuất"), để không mất lựa chọn hiện tại khi mở modal.
  const [nganOptions, setNganOptions] = useState<ActiveNganOption[]>(
    entry.nganId
      ? [{ id: entry.nganId, ma_ngan: entry.nganMa || "—", ten_ngan: entry.nganTen || "", loai_nl: "" }]
      : [],
  );
  useEffect(() => {
    let alive = true;
    loadActiveNgansForFactory(factoryId)
      .then((list) => {
        if (!alive) return;
        setNganOptions((prev) => {
          const merged = [...list];
          if (entry.nganId && !merged.some((n) => n.id === entry.nganId)) {
            merged.unshift(prev[0] || { id: entry.nganId, ma_ngan: entry.nganMa || "—", ten_ngan: entry.nganTen || "", loai_nl: "" });
          }
          return merged;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  const bocOptions = useMemo(
    () => getBocsForLoaiCSR(entry.dayChuyen || "Mủ tạp", entry.loaiCsr),
    [entry.dayChuyen, entry.loaiCsr],
  );
  const maxPerKien = useMemo(
    () => getLoaiBanhConfig(entry.loaiCsr, entry.loaiBanh).max_per_kien,
    [entry.loaiCsr, entry.loaiBanh],
  );

  const canSave = !!nganId && soBanh > 0 && soBanh <= maxPerKien;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-extrabold text-slate-800">
          {tt("editEntryTitle")} — {entry.maLo} {entry.kienLetters}
        </h3>

        <div className="mt-4 space-y-3">
          <Field label={tt("ngaySanXuat")} icon={<Calendar size={13} />}>
            <input
              type="date"
              value={ngaySx}
              onChange={(e) => setNgaySx(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </Field>
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-3">
              <Field label={tt("caSanXuat")} icon={<Sun size={13} />}>
                <select
                  value={ca}
                  onChange={(e) => setCa(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  {CA_OPTS.map((c) => (
                    <option key={c} value={c}>
                      {caLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="col-span-2">
              <Field label={tt("chiThi")} icon={<Hash size={13} />}>
                <input
                  type="text"
                  value={chiThi}
                  onChange={(e) => setChiThi(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
          </div>
          <Field label={tt("soBanh")} icon={<Package size={13} />}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxPerKien}
              value={soBanh}
              onChange={(e) => {
                const parsed = Math.floor(Number(e.target.value));
                if (Number.isFinite(parsed)) setSoBanh(Math.max(0, Math.min(maxPerKien, parsed)));
              }}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </Field>
          <Field label={tt("boc")} icon={<Layers size={13} />}>
            <select
              value={boc}
              onChange={(e) => setBoc(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">{tt("chonBoc")}</option>
              {bocOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {boc && !bocOptions.includes(boc) && <option value={boc}>{boc}</option>}
            </select>
          </Field>
          <Field label={tt("loaiPallet")} icon={<Boxes size={13} />}>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              {PALLET_OPTS.map((p) => {
                const checked = pallet.length === 1 && pallet[0] === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPallet(checked ? [] : [p])}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                      checked ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {palletLabel(lang, p)}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={tt("nganNguon")} icon={<Warehouse size={13} />}>
            <select
              value={nganId}
              onChange={(e) => setNganId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">{tt("chonNgan")}</option>
              {nganOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.ma_ngan} {n.ten_ngan ? `— ${n.ten_ngan}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {tt("cancel")}
          </button>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={() => onSave({ nganId, ca, ngaySx, soBanh, boc, pallet, chiThi })}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? tt("editSaving") : tt("editSave")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mục 4b (rule 06-module-production.md): sửa 1 nháp CHƯA gửi — mirror gần như y hệt
// EditEntryModal (giao dịch đã gửi thật), chỉ khác nguồn dữ liệu (ConfirmDraftRow thay
// ShiftHistoryEntry) và action gọi (updateDraftKien thay editShiftHistoryEntry).
function EditDraftModal({
  tt,
  lang,
  caLabel,
  factoryId,
  draft,
  saving,
  error,
  onCancel,
  onSave,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
  caLabel: (c: string) => string;
  factoryId: string;
  draft: ConfirmDraftRow;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: {
    nganId: string;
    ca: string;
    ngaySx: string;
    soBanh: number;
    boc: string;
    pallet: string[];
    chiThi: string;
  }) => void;
}) {
  const [nganId, setNganId] = useState(draft.nganId || "");
  const [ca, setCa] = useState(draft.ca);
  const [ngaySx, setNgaySx] = useState(draft.ngaySx);
  const [soBanh, setSoBanh] = useState(draft.soBanh);
  const [boc, setBoc] = useState(draft.boc || "");
  const [pallet, setPallet] = useState<string[]>(draft.pallet || []);
  const [chiThi, setChiThi] = useState(draft.chiThi || "");
  const [nganOptions, setNganOptions] = useState<ActiveNganOption[]>(
    draft.nganId
      ? [{ id: draft.nganId, ma_ngan: draft.nganMa || "—", ten_ngan: draft.nganTen || "", loai_nl: "" }]
      : [],
  );
  useEffect(() => {
    let alive = true;
    loadActiveNgansForFactory(factoryId)
      .then((list) => {
        if (!alive) return;
        setNganOptions((prev) => {
          const merged = [...list];
          if (draft.nganId && !merged.some((n) => n.id === draft.nganId)) {
            merged.unshift(prev[0] || { id: draft.nganId, ma_ngan: draft.nganMa || "—", ten_ngan: draft.nganTen || "", loai_nl: "" });
          }
          return merged;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  const bocOptions = useMemo(
    () => getBocsForLoaiCSR(draft.dayChuyen || "Mủ tạp", draft.loaiCsr),
    [draft.dayChuyen, draft.loaiCsr],
  );
  const maxPerKien = useMemo(
    () => getLoaiBanhConfig(draft.loaiCsr, draft.loaiBanh).max_per_kien,
    [draft.loaiCsr, draft.loaiBanh],
  );

  const canSave = !!nganId && soBanh > 0 && soBanh <= maxPerKien && !!boc && pallet.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-extrabold text-slate-800">
          {tt("editEntryTitle")} — {draft.maLo} {draft.kien}
        </h3>

        <div className="mt-4 space-y-3">
          <Field label={tt("ngaySanXuat")} icon={<Calendar size={13} />}>
            <input
              type="date"
              value={ngaySx}
              onChange={(e) => setNgaySx(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </Field>
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-3">
              <Field label={tt("caSanXuat")} icon={<Sun size={13} />}>
                <select
                  value={ca}
                  onChange={(e) => setCa(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  {CA_OPTS.map((c) => (
                    <option key={c} value={c}>
                      {caLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="col-span-2">
              <Field label={tt("chiThi")} icon={<Hash size={13} />}>
                <input
                  type="text"
                  value={chiThi}
                  onChange={(e) => setChiThi(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
          </div>
          <Field label={tt("soBanh")} icon={<Package size={13} />}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxPerKien}
              value={soBanh}
              onChange={(e) => {
                const parsed = Math.floor(Number(e.target.value));
                if (Number.isFinite(parsed)) setSoBanh(Math.max(0, Math.min(maxPerKien, parsed)));
              }}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </Field>
          <Field label={tt("boc")} icon={<Layers size={13} />}>
            <select
              value={boc}
              onChange={(e) => setBoc(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">{tt("chonBoc")}</option>
              {bocOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {boc && !bocOptions.includes(boc) && <option value={boc}>{boc}</option>}
            </select>
          </Field>
          <Field label={tt("loaiPallet")} icon={<Boxes size={13} />}>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              {PALLET_OPTS.map((p) => {
                const checked = pallet.length === 1 && pallet[0] === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPallet(checked ? [] : [p])}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                      checked ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {palletLabel(lang, p)}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={tt("nganNguon")} icon={<Warehouse size={13} />}>
            <select
              value={nganId}
              onChange={(e) => setNganId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">{tt("chonNgan")}</option>
              {nganOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.ma_ngan} {n.ten_ngan ? `— ${n.ten_ngan}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {tt("cancel")}
          </button>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={() => onSave({ nganId, ca, ngaySx, soBanh, boc, pallet, chiThi })}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? tt("editSaving") : tt("editSave")}
          </button>
        </div>
      </div>
    </div>
  );
}

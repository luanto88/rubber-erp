"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Minus,
  Package,
  Plus,
  ScanLine,
  User,
} from "lucide-react";
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth";
import { getTodayISODate } from "@/lib/date-utils";
import { getBocsForLoaiCSR } from "@/lib/product-lot-config";
import { KIEN_LETTERS, type KienLetter } from "@/lib/product-label";
import {
  confirmKienProduction,
  loadActiveNgansForFactory,
  loadShiftReportData,
  loadUserChucVu,
  resolveKienForConfirm,
  type ActiveNganOption,
  type ConfirmKienLookup,
} from "@/app/dashboard/product/confirm/actions";
import { shareOrDownloadShiftReportPdf } from "@/app/dashboard/product/confirm/shift-report-pdf";
import { loadStoredLang, storeLang, t, LANG_OPTIONS, type Lang } from "@/app/dashboard/product/confirm/i18n";

const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
);

const CA_OPTS = ["A", "B", "C"] as const;
const PALLET_OPTS = ["Sắt đế gỗ", "Sắt đế nhựa", "Sắt mỏng", "MB5", "Gỗ"];

type ViewMode = "hub" | "scanning" | "form";

type SessionLogEntry = {
  id: string;
  maLo: string;
  kien: KienLetter;
  soBanh: number;
  ca: string;
  nguoiGui: string;
  sentAt: Date;
};

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

function formatHMS(d: Date) {
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

  const [chucVu, setChucVu] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>("hub");
  const [sessionStartAt, setSessionStartAt] = useState<Date | null>(null);
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const [endShiftConfirmOpen, setEndShiftConfirmOpen] = useState(false);
  const [endShiftGenerating, setEndShiftGenerating] = useState(false);
  const [endShiftError, setEndShiftError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [maLo, setMaLo] = useState("");
  const [kien, setKien] = useState<KienLetter>("A");

  const [lookup, setLookup] = useState<ConfirmKienLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [soBanh, setSoBanh] = useState(1);
  const [ngaySx, setNgaySx] = useState(getTodayISODate());
  const [ca, setCa] = useState<string>("A");
  const [boc, setBoc] = useState("");
  const [pallet, setPallet] = useState<string[]>([]);
  const [chiThi, setChiThi] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [manualNganId, setManualNganId] = useState("");
  const [activeNgans, setActiveNgans] = useState<ActiveNganOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
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
      setSessionStartAt(new Date());
      loadUserChucVu(fid, user.id).then(setChucVu).catch(() => setChucVu(null));

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

  useEffect(() => {
    if (!factoryId || !maLo || view !== "form") return;
    let alive = true;
    const run = async () => {
      setLookupLoading(true);
      setLookupError(null);
      setLookup(null);
      setSubmitError(null);
      setManualNganId("");
      try {
        const result = await resolveKienForConfirm(factoryId, maLo, kien);
        if (!alive) return;
        setLookup(result);
        if (result.status === "predicted" || result.status === "partial" || result.status === "partial_kien") {
          setSoBanh(result.status === "partial_kien" ? Math.max(1, result.remainingBanh || 1) : result.maxPerKien || 36);
          setNgaySx(getDefaultNgaySx(new Date()));
          setCa("A");
          setBoc(result.boc || "");
          setPallet(result.pallet || []);
          setChiThi(result.chiThi || "");
          setGhiChu("");
          if (!result.nganId) {
            const ngans = await loadActiveNgansForFactory(factoryId);
            if (alive) setActiveNgans(ngans);
          }
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
  }, [factoryId, maLo, kien, view]);

  const bocOptions = useMemo(() => {
    if (!lookup?.loaiCsr) return [];
    return getBocsForLoaiCSR(lookup.dayChuyen || "Mủ tạp", lookup.loaiCsr);
  }, [lookup?.dayChuyen, lookup?.loaiCsr]);

  const effectiveNganId = lookup?.nganId || manualNganId || "";
  const maxPerKien = lookup?.maxPerKien || 36;
  const stepperMax = lookup?.status === "partial_kien" ? Math.max(1, lookup.remainingBanh ?? maxPerKien) : maxPerKien;

  const canSubmit =
    !!lookup &&
    (lookup.status === "predicted" || lookup.status === "partial" || lookup.status === "partial_kien") &&
    !!effectiveNganId &&
    soBanh > 0 &&
    soBanh <= stepperMax &&
    !!ngaySx &&
    !!ca &&
    !!boc &&
    pallet.length > 0;

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

  const handleSubmit = async () => {
    if (!factoryId || !lookup) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await confirmKienProduction({
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
        ghiChu: lookup.isNewLot ? (ghiChu || null) : undefined,
        userId: currentUser?.id ?? null,
      });
      if (!result.success) {
        setSubmitError(result.error);
        return;
      }
      const entry: SessionLogEntry = {
        id: `${maLo}-${kien}-${Date.now()}`,
        maLo,
        kien,
        soBanh,
        ca,
        nguoiGui: currentUser?.full_name || currentUser?.username || "",
        sentAt: new Date(),
      };
      setSessionLog((prev) => [entry, ...prev]);
      setToast(tt("daGuiThanhCong"));
      setView("hub");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSubmitting(false);
    }
  };

  const userDisplayName = currentUser?.full_name || currentUser?.username || "";

  const handleConfirmEndShift = async () => {
    if (!factoryId || !currentUser?.id || !sessionStartAt) {
      setEndShiftConfirmOpen(false);
      router.push("/dashboard/product");
      return;
    }
    setEndShiftGenerating(true);
    setEndShiftError(null);
    try {
      const data = await loadShiftReportData(
        factoryId,
        currentUser.id,
        sessionStartAt.toISOString(),
        userDisplayName,
        chucVu || tt("shiftLabel"),
      );
      if (data.rows.length === 0) {
        setEndShiftError(tt("endShiftNoData"));
        return;
      }
      await shareOrDownloadShiftReportPdf(data);
      setEndShiftConfirmOpen(false);
      router.push("/dashboard/product");
    } catch (err) {
      setEndShiftError(err instanceof Error ? err.message : tt("endShiftReportError"));
    } finally {
      setEndShiftGenerating(false);
    }
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
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
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
            {view === "hub" ? (
              <HubView
                tt={tt}
                sessionStartAt={sessionStartAt}
                sessionLog={sessionLog}
                onScan={() => {
                  setScanError(null);
                  setView("scanning");
                }}
                onEndShift={() => setEndShiftConfirmOpen(true)}
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
            ) : (
              <div className="space-y-4">
                <Field label={tt("ngaySanXuat")}>
                  <input
                    type="date"
                    value={ngaySx}
                    onChange={(e) => setNgaySx(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                  />
                </Field>
                <Field label={tt("gioSanXuat")}>
                  <div className="flex h-[42px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">
                    {formatDMYHMS(now)}
                  </div>
                </Field>

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
                </div>

                {lookup.status === "partial_kien" && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
                    {tt("kienDaCoMotPhan", {
                      kien: lookup.kien,
                      existingBanh: lookup.existingBanh,
                      max: lookup.remainingBanh ?? 0,
                    })}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label={tt("caSanXuat")}>
                    <select
                      value={ca}
                      onChange={(e) => setCa(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                    >
                      {CA_OPTS.map((c) => (
                        <option key={c} value={c}>
                          Ca {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tt("chiThi")}>
                    <input
                      type="text"
                      value={chiThi}
                      onChange={(e) => setChiThi(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                    />
                  </Field>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{tt("soBanh")}</div>
                  <div className="mt-1 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSoBanh((v) => Math.max(1, v - 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      <Minus size={18} />
                    </button>
                    <span className="w-16 text-center text-3xl font-extrabold text-slate-800">{soBanh}</span>
                    <button
                      type="button"
                      onClick={() => setSoBanh((v) => Math.min(stepperMax, v + 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="mt-1 text-center text-[11px] text-slate-400">
                    {tt("stepperHint", { max: stepperMax })}
                  </div>
                </div>

                {!lookup.nganId && (
                  <Field label={tt("chonNganNguon")}>
                    <select
                      value={manualNganId}
                      onChange={(e) => setManualNganId(e.target.value)}
                      className="w-full rounded-xl border border-amber-400 bg-amber-50 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
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
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                    <span className="font-bold text-slate-500">{tt("nganNguon")}: </span>
                    <span className="font-semibold text-slate-800">
                      {lookup.nganMa || "—"} {lookup.nganTen ? `— ${lookup.nganTen}` : ""}
                    </span>
                  </div>
                )}

                <Field label={tt("boc")}>
                  <select
                    value={boc}
                    onChange={(e) => setBoc(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
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

                <Field label={tt("loaiPallet")}>
                  <div className="flex flex-wrap gap-2">
                    {PALLET_OPTS.map((p) => {
                      const checked = pallet.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            setPallet((prev) => (checked ? prev.filter((x) => x !== p) : [...prev, p]))
                          }
                          className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                            checked
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {p}
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
                    <textarea
                      value={ghiChu}
                      onChange={(e) => setGhiChu(e.target.value)}
                      rows={2}
                      placeholder={tt("ghiChuPlaceholder")}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                    />
                  </Field>
                )}

                {submitError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600">
                    {submitError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canSubmit || submitting}
                  onClick={handleSubmit}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-extrabold text-white shadow-md transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <CheckCircle2 size={20} />
                  {submitting ? tt("dangGui") : tt("guiDuLieu")}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {endShiftConfirmOpen && (
        <EndShiftConfirmModal
          tt={tt}
          generating={endShiftGenerating}
          error={endShiftError}
          onCancel={() => {
            if (endShiftGenerating) return;
            setEndShiftConfirmOpen(false);
            setEndShiftError(null);
          }}
          onConfirm={handleConfirmEndShift}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold text-slate-500">{label}</div>
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

function HubView({
  tt,
  sessionStartAt,
  sessionLog,
  onScan,
  onEndShift,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  sessionStartAt: Date | null;
  sessionLog: SessionLogEntry[];
  onScan: () => void;
  onEndShift: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onScan}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-6 text-lg font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
      >
        <ScanLine size={26} />
        {tt("scanQr")}
      </button>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-emerald-700">
          <Package size={16} />
          {tt("sessionLogTitle")}
        </div>
        {sessionLog.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">{tt("noLogYet")}</p>
        ) : (
          <div className="space-y-2">
            {sessionLog.map((h) => (
              <div
                key={h.id}
                className="rounded-xl border-l-4 border-emerald-500 bg-slate-50 px-3 py-2 text-sm shadow-sm"
              >
                <div className="font-bold text-slate-800">
                  {h.maLo} - {tt("kienLabel")} {h.kien}
                </div>
                <div className="text-xs text-slate-500">
                  {h.soBanh} · Ca {h.ca} · {h.nguoiGui} · {formatDMYHMS(h.sentAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-slate-300 pt-4 text-center">
        {sessionStartAt && (
          <p className="mb-3 text-sm font-bold text-emerald-700">
            {tt("shiftStartedAt")}: {formatHMS(sessionStartAt)}
          </p>
        )}
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

function EndShiftConfirmModal({
  tt,
  generating,
  error,
  onCancel,
  onConfirm,
}: {
  tt: (key: string) => string;
  generating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
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
      </div>
    </div>
  );
}

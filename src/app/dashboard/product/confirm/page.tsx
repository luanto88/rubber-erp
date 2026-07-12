"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Minus, Package, Plus } from "lucide-react";
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth";
import { getTodayISODate } from "@/lib/date-utils";
import { getBocsForLoaiCSR } from "@/lib/product-lot-config";
import { KIEN_LETTERS, type KienLetter } from "@/lib/product-label";
import {
  confirmKienProduction,
  loadActiveNgansForFactory,
  loadRecentConfirmations,
  resolveKienForConfirm,
  type ActiveNganOption,
  type ConfirmKienLookup,
  type RecentConfirmation,
} from "@/app/dashboard/product/confirm/actions";

const CA_OPTS = ["A", "B", "C"] as const;
const PALLET_OPTS = ["Sắt đế gỗ", "Sắt đế nhựa", "Sắt mỏng", "MB5", "Gỗ"];

function formatDateTimeVN(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ConfirmKienProductionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [factoryMismatch, setFactoryMismatch] = useState(false);

  const paramFactoryId = searchParams.get("f") || "";
  const maLo = (searchParams.get("lo") || "").trim();
  const kienParam = (searchParams.get("kien") || "").toUpperCase();
  const kien: KienLetter = (KIEN_LETTERS as string[]).includes(kienParam) ? (kienParam as KienLetter) : "A";

  const [lookup, setLookup] = useState<ConfirmKienLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [soBanh, setSoBanh] = useState(1);
  const [ngaySx, setNgaySx] = useState(getTodayISODate());
  const [ca, setCa] = useState<string>("A");
  const [boc, setBoc] = useState("");
  const [pallet, setPallet] = useState<string[]>([]);
  const [ghiChu, setGhiChu] = useState("");
  const [manualNganId, setManualNganId] = useState("");
  const [activeNgans, setActiveNgans] = useState<ActiveNganOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ soKg: number; createdAt: string | null } | null>(null);
  const [history, setHistory] = useState<RecentConfirmation[]>([]);
  const [shiftEnded, setShiftEnded] = useState(false);

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
      if (paramFactoryId && paramFactoryId !== fid) {
        setFactoryMismatch(true);
        setLoading(false);
        return;
      }
      setFactoryId(fid);
      setCurrentUser(user);
      setLoading(false);
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = useCallback(async (fid: string) => {
    try {
      const rows = await loadRecentConfirmations(fid, 10);
      setHistory(rows);
    } catch {
      // lịch sử chỉ mang tính tham khảo, không chặn luồng chính nếu lỗi
    }
  }, []);

  useEffect(() => {
    if (!factoryId || !maLo) {
      if (factoryId) {
        setLookupLoading(false);
        setLookupError("Thiếu thông tin mã lô trong đường dẫn.");
      }
      return;
    }
    let alive = true;
    const run = async () => {
      setLookupLoading(true);
      setLookupError(null);
      try {
        const result = await resolveKienForConfirm(factoryId, maLo, kien);
        if (!alive) return;
        setLookup(result);
        if (result.status === "predicted" || result.status === "partial") {
          setSoBanh(result.maxPerKien || 36);
          setBoc(result.boc || "");
          setPallet(result.pallet || []);
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
    void loadHistory(factoryId);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, maLo, kien]);

  const bocOptions = useMemo(() => {
    if (!lookup?.loaiCsr) return [];
    return getBocsForLoaiCSR(lookup.dayChuyen || "Mủ tạp", lookup.loaiCsr);
  }, [lookup?.dayChuyen, lookup?.loaiCsr]);

  const effectiveNganId = lookup?.nganId || manualNganId || "";
  const maxPerKien = lookup?.maxPerKien || 36;

  const canSubmit =
    !!lookup &&
    (lookup.status === "predicted" || lookup.status === "partial") &&
    !!effectiveNganId &&
    soBanh > 0 &&
    !!ngaySx &&
    !!ca &&
    (!lookup.isNewLot || (!!boc && pallet.length > 0));

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
        boc: lookup.isNewLot ? boc : undefined,
        pallet: lookup.isNewLot ? pallet : undefined,
        tham: lookup.tham,
        ghiChu: lookup.isNewLot ? (ghiChu || null) : undefined,
        userId: currentUser?.id ?? null,
      });
      if (!result.success) {
        setSubmitError(result.error);
        return;
      }
      setSubmitResult({ soKg: result.soKg, createdAt: result.createdAt });
      void loadHistory(factoryId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSubmitting(false);
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
    return (
      <CenteredMessage
        icon={<AlertTriangle size={28} />}
        title="Không có quyền truy cập"
        message="Tài khoản của bạn chưa được cấp quyền xác nhận sản xuất. Vui lòng liên hệ quản trị viên."
      />
    );
  }

  if (factoryMismatch) {
    return (
      <CenteredMessage
        icon={<AlertTriangle size={28} />}
        title="Mã QR không khớp nhà máy"
        message="QR này không thuộc nhà máy bạn đang đăng nhập. Vui lòng kiểm tra lại tài khoản hoặc nhãn quét."
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 shadow-sm">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-extrabold text-emerald-700">Nhập dữ liệu sản xuất</h1>
          <p className="text-xs text-slate-500">Xác nhận kiện thành phẩm từ QR nhãn dán</p>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 py-5">
        {shiftEnded ? (
          <ShiftEndSummary history={history} onBack={() => router.push("/dashboard/product")} />
        ) : lookupLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Đang tải thông tin kiện...
          </div>
        ) : lookupError || !lookup ? (
          <CardMessage
            icon={<AlertTriangle size={24} className="text-amber-500" />}
            text={lookupError || "Không tìm thấy dữ liệu."}
          />
        ) : lookup.status === "not_found" ? (
          <CardMessage
            icon={<AlertTriangle size={24} className="text-red-500" />}
            text="Không tìm thấy lô hoặc dự đoán khớp với mã QR này. Vui lòng kiểm tra lại nhãn."
          />
        ) : lookup.status === "produced" ? (
          <CardMessage
            icon={<CheckCircle2 size={24} className="text-emerald-600" />}
            text={`Kiện ${lookup.kien} của lô ${lookup.maLo} đã được ghi nhận sản xuất trước đó. Không cần gửi lại.`}
          />
        ) : submitResult ? (
          <SuccessCard
            lookup={lookup}
            soBanh={soBanh}
            soKg={submitResult.soKg}
            createdAt={submitResult.createdAt}
            history={history}
            onEndShift={() => setShiftEnded(true)}
          />
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-100">Số lô</div>
                  <div className="text-2xl font-extrabold">{lookup.maLo}</div>
                  <div className="mt-2 text-xs font-bold uppercase tracking-wide text-emerald-100">Kiện</div>
                  <div className="text-xl font-extrabold">{lookup.kien}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-100">Số bành</div>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSoBanh((v) => Math.max(1, v - 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                    >
                      <Minus size={18} />
                    </button>
                    <span className="w-14 text-center text-2xl font-extrabold">{soBanh}</span>
                    <button
                      type="button"
                      onClick={() => setSoBanh((v) => Math.min(maxPerKien, v + 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-100">Chạm +/- để tăng giảm (tối đa {maxPerKien})</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ngày sản xuất">
                <input
                  type="date"
                  value={ngaySx}
                  onChange={(e) => setNgaySx(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Ca sản xuất">
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
            </div>

            {!lookup.nganId && (
              <Field label="Chọn ngăn nguồn (chưa xác định tự động)">
                <select
                  value={manualNganId}
                  onChange={(e) => setManualNganId(e.target.value)}
                  className="w-full rounded-xl border border-amber-400 bg-amber-50 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
                >
                  <option value="">-- Chọn ngăn --</option>
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
                <span className="font-bold text-slate-500">Ngăn nguồn: </span>
                <span className="font-semibold text-slate-800">
                  {lookup.nganMa || "—"} {lookup.nganTen ? `— ${lookup.nganTen}` : ""}
                </span>
              </div>
            )}

            {lookup.isNewLot ? (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <Field label="Bọc">
                    <select
                      value={boc}
                      onChange={(e) => setBoc(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Chọn bọc --</option>
                      {bocOptions.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Loại pallet">
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
                </div>
                <Field label="Ghi chú (nếu có)">
                  <textarea
                    value={ghiChu}
                    onChange={(e) => setGhiChu(e.target.value)}
                    rows={2}
                    placeholder="Nhập ghi chú..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                  />
                </Field>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm space-y-1">
                <div>
                  <span className="font-bold text-slate-500">Bọc: </span>
                  <span className="font-semibold text-slate-800">{lookup.boc || "—"}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500">Loại pallet: </span>
                  <span className="font-semibold text-slate-800">
                    {lookup.pallet && lookup.pallet.length > 0 ? lookup.pallet.join(", ") : "—"}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Lô đã tồn tại — bọc/pallet giữ nguyên theo lô, chỉ ghi nhận thêm số bành kiện này.
                </div>
              </div>
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
              {submitting ? "Đang gửi..." : "GỬI DỮ LIỆU"}
            </button>

            {history.length > 0 && (
              <RecentHistoryPanel history={history} />
            )}
          </div>
        )}
      </div>
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

function CenteredMessage({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
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

function SuccessCard({
  lookup,
  soBanh,
  soKg,
  createdAt,
  history,
  onEndShift,
}: {
  lookup: ConfirmKienLookup;
  soBanh: number;
  soKg: number;
  createdAt: string | null;
  history: RecentConfirmation[];
  onEndShift: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="text-lg font-extrabold text-emerald-800">Đã gửi dữ liệu thành công</h2>
        <p className="mt-1 text-sm text-emerald-700">
          {lookup.maLo} · Kiện {lookup.kien} · {soBanh} bành ({soKg.toLocaleString("vi-VN")} kg)
        </p>
        <p className="mt-1 text-xs text-emerald-600">Thời điểm gửi: {formatDateTimeVN(createdAt)}</p>
      </div>

      <p className="text-center text-sm font-semibold text-slate-500">
        Quét nhãn kiện kế tiếp bằng camera để tiếp tục.
      </p>

      {history.length > 0 && <RecentHistoryPanel history={history} />}

      <button
        type="button"
        onClick={onEndShift}
        className="w-full rounded-2xl border-2 border-slate-300 py-3 text-sm font-extrabold text-slate-600 hover:bg-slate-50"
      >
        Kết thúc ca
      </button>
    </div>
  );
}

function RecentHistoryPanel({ history }: { history: RecentConfirmation[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-emerald-700">
        <Package size={16} />
        Lịch sử đã gửi hôm nay
      </div>
      <div className="space-y-2">
        {history.slice(0, 5).map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <div>
              <div className="font-bold text-slate-800">{h.maLo}</div>
              <div className="text-xs text-slate-500">
                {h.soBanh} bành · Ca {h.ca} · {formatDateTimeVN(h.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftEndSummary({ history, onBack }: { history: RecentConfirmation[]; onBack: () => void }) {
  const totalBanh = history.reduce((sum, h) => sum + h.soBanh, 0);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h2 className="text-lg font-extrabold text-slate-800">Đã kết thúc ca sản xuất</h2>
        <p className="mt-2 text-sm text-slate-500">
          Tổng cộng {history.length} kiện · {totalBanh} bành đã được xác nhận hôm nay.
        </p>
      </div>
      <RecentHistoryPanel history={history} />
      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white hover:bg-emerald-700"
      >
        Quay lại Thành phẩm
      </button>
    </div>
  );
}

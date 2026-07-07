"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  getActiveFactoryId,
  hasPermission,
  hydrateActiveSession,
  type SessionUser,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { ModalShell } from "@/app/dashboard/_components/modal-shell";
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper";
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select";
import {
  getLoaiBanhOptions,
  getLoaiCSRByDayChuyen,
  getBocsForLoaiCSR,
} from "@/lib/product-lot-config";
import { downloadProductLabelPdf, type ProductLabelItem } from "@/lib/product-label-pdf";
import { KIEN_LETTERS, type KienLetter } from "@/lib/product-label";
import {
  loadPredictAvailableNgans,
  previewLotPrediction,
  findPendingCarryLot,
  createLotPredictionBatchMulti,
  loadPredictionBatches,
  loadPredictionLotsForBatch,
  loadNganCumulativeBaselines,
  loadNgansByIdsRaw,
  updatePredictionLot,
  cancelPredictionLot,
  deletePredictionBatch,
  loadClosedNgans,
  reopenNganPrediction,
  type PredictAvailableNgan,
  type PredictionBatchRow,
  type PredictionLotRow,
  type PendingCarryLot,
  type ClosedNgan,
} from "@/app/dashboard/product/predict/actions";

const KIEN_COLS: { key: "kien_a_ngan_id" | "kien_b_ngan_id" | "kien_c_ngan_id" | "kien_d_ngan_id"; letter: KienLetter }[] = [
  { key: "kien_a_ngan_id", letter: "A" },
  { key: "kien_b_ngan_id", letter: "B" },
  { key: "kien_c_ngan_id", letter: "C" },
  { key: "kien_d_ngan_id", letter: "D" },
];

type SuffixOption = { code: string; name: string };

function normalizeDayChuyenFromLoaiNl(loaiNl: string) {
  return (loaiNl || "").toLowerCase().includes("nước") || (loaiNl || "").toLowerCase().includes("nuoc")
    ? "Mủ nước"
    : "Mủ tạp";
}

function currentYear2() {
  return new Date().getFullYear().toString().slice(-2);
}

// Mục tiêu mặc định nhắm 100-105% (nghiệp vụ chốt) — dùng 102% làm điểm giữa. Chỉ áp dụng khi
// chọn đúng 1 ngăn (xem canCreate/preview effect); chọn nhiều ngăn vẫn auto-max 110%/ngăn như cũ.
const TARGET_FILL_RATIO = 1.02;

export default function ProductPredictPage() {
  const [loading, setLoading] = useState(true);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [factoryPrefix, setFactoryPrefix] = useState<"CSR" | "SVR">("CSR");

  const [tab, setTab] = useState<"create" | "history">("create");
  const [ngans, setNgans] = useState<PredictAvailableNgan[]>([]);
  // Thứ tự trong mảng = thứ tự người dùng bấm chọn (FilterMultiSelect luôn append vào cuối)
  const [selectedNganIds, setSelectedNganIds] = useState<string[]>([]);
  const [loaiCsr, setLoaiCsr] = useState("");
  const [loaiBanh, setLoaiBanh] = useState(35);
  const [boc, setBoc] = useState("");
  const [tham, setTham] = useState("");
  const [suffix, setSuffix] = useState("");
  const [suffixOptions, setSuffixOptions] = useState<SuffixOption[]>([]);
  const [requestedLotCount, setRequestedLotCount] = useState<number | "">("");
  // Số kiện lẻ (0-3) của lô "đuôi" — chỉ có ý nghĩa/hiển thị khi chọn đúng 1 ngăn; multi-ngăn
  // luôn giữ "" (null khi gửi server → RPC tự auto-max như hành vi cũ).
  const [trailingKienCount, setTrailingKienCount] = useState<number | "">("");
  // Checkbox "đánh dấu ngăn đã dự kiến xong" — mặc định tick theo yêu cầu nghiệp vụ.
  const [closesNganChecked, setClosesNganChecked] = useState(true);
  const [preview, setPreview] = useState<{ kienWeightKg: number; lotWeightKg: number; availableKg: number; suggestedLotCount: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingCarry, setPendingCarry] = useState<PendingCarryLot | null>(null);
  const [carryResolution, setCarryResolution] = useState<"continue" | "skip" | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdBatchIds, setCreatedBatchIds] = useState<string[] | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const [batches, setBatches] = useState<PredictionBatchRow[]>([]);
  const [closedNgans, setClosedNgans] = useState<ClosedNgan[]>([]);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [batchLots, setBatchLots] = useState<Record<string, PredictionLotRow[]>>({});
  const [editingLot, setEditingLot] = useState<PredictionLotRow | null>(null);
  const [editKienAssign, setEditKienAssign] = useState<Record<string, string>>({});
  // Danh sách ngăn hiển thị trong dropdown sửa — mở rộng thêm ngăn ĐANG được gán cho lô này
  // dù ngăn đó không còn nằm trong `ngans` (đã đóng dự kiến/hết dung lượng), để không hiển
  // thị sai thành "-- Chưa gán --" khi thực ra đã có ngăn.
  const [editNganOptions, setEditNganOptions] = useState<PredictAvailableNgan[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmBatch, setDeleteConfirmBatch] = useState<PredictionBatchRow | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ngansById = useMemo(() => new Map(ngans.map((n) => [n.id, n])), [ngans]);
  const selectedNgans = useMemo(
    () => selectedNganIds.map((id) => ngansById.get(id)).filter((n): n is PredictAvailableNgan => !!n),
    [selectedNganIds, ngansById],
  );
  // Thứ tự tiêu thụ thực tế: ngăn "Đang sản xuất" trước, sau đó theo đúng thứ tự đã bấm chọn
  // (Array.prototype.sort ổn định trong V8/Node — giữ nguyên thứ tự tương đối khi cùng ưu tiên)
  const orderedNganIds = useMemo(() => {
    return [...selectedNganIds].sort((a, b) => {
      const prioA = ngansById.get(a)?.trang_thai === "Đang sản xuất" ? 0 : 1;
      const prioB = ngansById.get(b)?.trang_thai === "Đang sản xuất" ? 0 : 1;
      return prioA - prioB;
    });
  }, [selectedNganIds, ngansById]);

  const nganLabels = useMemo(() => {
    const map: Record<string, string> = {};
    ngans.forEach((n) => {
      map[n.id] = `${n.ma_ngan} — ${n.ten_ngan} (${n.trang_thai} · còn ${Math.round(n.tong_kho)} kg)`;
    });
    return map;
  }, [ngans]);

  // day_chuyen dùng chung cho cả nhóm ngăn đã chọn — lấy theo ngăn đầu tiên (đã đảm bảo
  // cùng loại nguyên liệu ở bước chọn, vì UI không cho trộn Mủ tạp/Mủ nước — xem canCreate)
  const dayChuyen = selectedNgans[0] ? normalizeDayChuyenFromLoaiNl(selectedNgans[0].loai_nl) : "Mủ tạp";
  const mixedDayChuyen = useMemo(
    () => new Set(selectedNgans.map((n) => normalizeDayChuyenFromLoaiNl(n.loai_nl))).size > 1,
    [selectedNgans],
  );
  const csrOptions = useMemo(() => getLoaiCSRByDayChuyen(dayChuyen, factoryPrefix), [dayChuyen, factoryPrefix]);
  const banhOptions = useMemo(() => (loaiCsr ? getLoaiBanhOptions(loaiCsr) : []), [loaiCsr]);
  const bocOptions = useMemo(() => (loaiCsr ? getBocsForLoaiCSR(dayChuyen, loaiCsr) : []), [dayChuyen, loaiCsr]);
  const canManage = hasPermission(currentUser, "product.predict_manage");
  const isAdmin = currentUser?.role === "admin";

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId();
      if (!fid) {
        setLoading(false);
        return;
      }
      const { user } = await hydrateActiveSession();
      if (!user || !hasPermission(user, "product.predict_view")) {
        setLoading(false);
        window.location.replace("/dashboard");
        return;
      }
      setFactoryId(fid);
      setCurrentUser(user);
      const { data: factory } = await supabase.from("factories").select("name").eq("id", fid).single();
      setFactoryPrefix(factory?.name?.toLowerCase().includes("cuaparis") ? "SVR" : "CSR");
      const { data: suffixRows } = await supabase
        .from("suffixes")
        .select("code,name")
        .eq("factory_id", fid)
        .order("code");
      setSuffixOptions((suffixRows as SuffixOption[]) || []);
      setLoading(false);
    };
    void bootstrap();
  }, []);

  const loadNgans = useCallback(async (fid: string) => {
    const data = await loadPredictAvailableNgans(fid);
    setNgans(data);
  }, []);

  const loadHistory = useCallback(async (fid: string) => {
    const data = await loadPredictionBatches(fid);
    setBatches(data);
  }, []);

  const loadClosed = useCallback(async (fid: string) => {
    const data = await loadClosedNgans(fid);
    setClosedNgans(data);
  }, []);

  useEffect(() => {
    if (!factoryId) return;
    void loadNgans(factoryId);
    void loadHistory(factoryId);
    void loadClosed(factoryId);
  }, [factoryId, loadNgans, loadHistory, loadClosed]);

  // Bước 2 → tính preview N_max (ước tính: tổng dung lượng khả dụng của TẤT CẢ ngăn đã
  // chọn / KL 1 lô — kết quả thật có thể lệch chút do làm tròn từng ranh giới ngăn, nhưng
  // đủ để tham khảo trước khi tạo dự đoán thật)
  useEffect(() => {
    if (!factoryId || selectedNgans.length === 0 || !loaiCsr || !loaiBanh) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreviewLoading(true);
    Promise.all(
      selectedNgans.map((n) =>
        previewLotPrediction({ factoryId, nganId: n.id, tongKho: n.tong_kho, loaiCsr, loaiBanh }),
      ),
    )
      .then((results) => {
        if (!alive || results.length === 0) return;
        const totalAvailableKg = results.reduce((sum, r) => sum + r.availableKg, 0);
        const { kienWeightKg, lotWeightKg } = results[0];
        setPreview({
          kienWeightKg,
          lotWeightKg,
          availableKg: totalAvailableKg,
          suggestedLotCount: Math.floor(totalAvailableKg / lotWeightKg),
        });
        // Mặc định nhắm ~102% (giữa khoảng 100-105% nghiệp vụ yêu cầu) — chỉ tính khi chọn
        // đúng 1 ngăn; multi-ngăn giữ "" (auto-max 110%/ngăn như hành vi cũ, không đổi).
        if (selectedNgans.length === 1) {
          const tongKho = selectedNgans[0].tong_kho;
          const capKg = tongKho * 1.1;
          const usedKg = capKg - totalAvailableKg;
          const targetRemainingKg = Math.max(0, Math.min(totalAvailableKg, tongKho * TARGET_FILL_RATIO - usedKg));
          const targetFullLots = Math.floor(targetRemainingKg / lotWeightKg);
          const remainderKg = targetRemainingKg - targetFullLots * lotWeightKg;
          const targetTrailingKien = Math.min(3, Math.max(0, Math.floor(remainderKg / kienWeightKg)));
          setRequestedLotCount(targetFullLots);
          setTrailingKienCount(targetTrailingKien);
        } else {
          setRequestedLotCount("");
          setTrailingKienCount("");
        }
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, selectedNganIds, loaiCsr, loaiBanh]);

  // Kiểm tra carry-over pending mỗi khi đổi series (CSR + bành)
  useEffect(() => {
    if (!factoryId || !loaiCsr || !loaiBanh) {
      setPendingCarry(null);
      setCarryResolution(null);
      return;
    }
    const year = currentYear2();
    void findPendingCarryLot(factoryId, loaiCsr, loaiBanh, year).then((row) => {
      setPendingCarry(row);
      setCarryResolution(row ? null : "skip");
    });
  }, [factoryId, loaiCsr, loaiBanh]);

  // "Hết dung lượng" nghĩa là không còn đủ chỗ cho dù chỉ 1 KIỆN (kienWeightKg) — không phải
  // không còn đủ cho 1 LÔ đầy đủ (4 kiện). RPC vẫn có thể tạo hợp lệ 1 lô "dở dang" chỉ 1-3
  // kiện khi dung lượng còn giữa 1 và 4 kienWeight (suggestedLotCount lúc đó = 0 nhưng vẫn
  // tạo được — không được chặn nhầm case này, đúng nguyên nhân gây bug "Đề xuất 0 lô" rỗng
  // là khi dung lượng còn LẠI KHÔNG ĐỦ CHO CẢ 1 KIỆN).
  const outOfCapacity = !previewLoading && !!preview && preview.availableKg < preview.kienWeightKg;

  // Tính live % + kẹp số kiện lẻ cuối theo trần 110% — chỉ có ý nghĩa khi chọn đúng 1 ngăn.
  // Tính trực tiếp trong render (không useMemo) vì chỉ là vài phép toán đơn giản.
  const singleNgan = selectedNgans.length === 1 ? selectedNgans[0] : null;
  let liveCalc: { fullLots: number; maxTrailingKien: number; trailingKienClamped: number; livePct: number } | null = null;
  if (singleNgan && preview) {
    const capKg = singleNgan.tong_kho * 1.1;
    const usedKg = capKg - preview.availableKg;
    const fullLots = requestedLotCount === "" ? 0 : Number(requestedLotCount);
    const kgAfterFullLots = usedKg + fullLots * preview.lotWeightKg;
    const remainingCapKg = capKg - kgAfterFullLots;
    const maxTrailingKien = Math.min(3, Math.max(0, Math.floor(remainingCapKg / preview.kienWeightKg)));
    const trailingKienRaw = trailingKienCount === "" ? 0 : Number(trailingKienCount);
    const trailingKienClamped = Math.min(Math.max(trailingKienRaw, 0), maxTrailingKien);
    const livePct =
      singleNgan.tong_kho > 0 ? ((kgAfterFullLots + trailingKienClamped * preview.kienWeightKg) / singleNgan.tong_kho) * 100 : 0;
    liveCalc = { fullLots, maxTrailingKien, trailingKienClamped, livePct };
  }
  // Người dùng tự chỉnh về 0 lô đầy đủ + 0 kiện lẻ — chặn sớm với message rõ ràng thay vì để
  // lọt xuống lỗi "hết dung lượng" chung chung của createLotPredictionBatchMulti.
  const singleNganZeroZero = !!liveCalc && liveCalc.fullLots === 0 && liveCalc.trailingKienClamped === 0;

  const canCreate =
    !!factoryId &&
    selectedNgans.length > 0 &&
    !mixedDayChuyen &&
    !!loaiCsr &&
    !!loaiBanh &&
    !!boc &&
    !outOfCapacity &&
    !singleNganZeroZero &&
    (!pendingCarry || carryResolution !== null);

  const handleCreate = async () => {
    if (!factoryId || selectedNgans.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createLotPredictionBatchMulti({
        factoryId,
        nganIds: orderedNganIds,
        dayChuyen,
        loaiCsr,
        loaiBanh,
        boc,
        tham,
        suffix,
        year: currentYear2(),
        requestedLotCount: requestedLotCount === "" ? null : Number(requestedLotCount),
        carryResolution: pendingCarry ? carryResolution : null,
        createdBy: currentUser?.id || null,
        trailingKienCount: singleNgan && trailingKienCount !== "" ? Number(trailingKienCount) : null,
        closesNgan: closesNganChecked,
      });
      if (!result.ok) {
        if ("emptyResult" in result) {
          setCreateError(result.message);
          void loadNgans(factoryId);
          return;
        }
        const err = result.error;
        if (err.needsCarryDecision) {
          setPendingCarry({
            id: err.pendingId,
            ma_lo: err.pendingMaLo,
            num: 0,
            kien_a_ngan_id: null,
            kien_b_ngan_id: null,
            kien_c_ngan_id: null,
            kien_d_ngan_id: null,
          });
          setCarryResolution(null);
        } else {
          setCreateError(err.message);
        }
        return;
      }
      setCreatedBatchIds(result.results.map((r) => r.batchId));
      void loadHistory(factoryId);
      void loadNgans(factoryId);
      void loadClosed(factoryId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setCreating(false);
    }
  };

  const buildLabelItemsFromLots = async (lots: PredictionLotRow[]): Promise<ProductLabelItem[]> => {
    if (!factoryId) return [];
    type RawItem = ProductLabelItem & { nganId: string; kienWeightKg: number };
    const rawItems: RawItem[] = [];
    lots.forEach((lot) => {
      KIEN_COLS.forEach(({ key, letter }) => {
        const nganId = lot[key];
        if (!nganId) return;
        rawItems.push({
          factoryId,
          maLo: lot.ma_lo,
          num: lot.num,
          suffix: lot.suffix,
          kien: letter,
          loaiCsr: lot.loai_csr,
          loaiBanh: lot.loai_banh,
          boc: lot.boc || "",
          nganId,
          kienWeightKg: lot.kien_weight_kg,
        });
      });
    });
    // Loại trừ chính các lô đang in khỏi phần "predicted" của baseline — nếu không, KL của
    // chính các kiện đang in sẽ bị tính TRÙNG vào baseline lẫn vào phần cộng dồn bên dưới.
    const lotIds = Array.from(new Set(lots.map((l) => l.id)));
    const baselineMap = await loadNganCumulativeBaselines(factoryId, rawItems.map((i) => i.nganId), lotIds);

    // Group theo ngăn, sort theo đúng thứ tự sản xuất (num tăng dần, rồi A→B→C→D), rồi cộng
    // dồn từ baseline để mỗi kiện hiện đúng tỷ lệ LŨY KẾ tại vị trí của chính nó — khớp cách
    // tính trong cung_cap_dl/goi_y.pdf (không phải 1 số cào bằng cho mọi kiện như bản cũ).
    const byNgan = new Map<string, RawItem[]>();
    rawItems.forEach((item) => {
      const arr = byNgan.get(item.nganId);
      if (arr) arr.push(item);
      else byNgan.set(item.nganId, [item]);
    });
    byNgan.forEach((items, nganId) => {
      const baseline = baselineMap[nganId];
      let cumulativeKg = baseline?.baselineKg || 0;
      [...items]
        .sort((a, b) => a.num - b.num || KIEN_LETTERS.indexOf(a.kien) - KIEN_LETTERS.indexOf(b.kien))
        .forEach((item) => {
          cumulativeKg += item.kienWeightKg;
          item.nganFillPercent = baseline && baseline.tongKho > 0 ? (cumulativeKg / baseline.tongKho) * 100 : undefined;
          item.nganMa = baseline?.ma_ngan;
          item.nganTen = baseline?.ten_ngan;
        });
    });

    return rawItems.map((item) => ({
      factoryId: item.factoryId,
      maLo: item.maLo,
      num: item.num,
      suffix: item.suffix,
      kien: item.kien,
      loaiCsr: item.loaiCsr,
      loaiBanh: item.loaiBanh,
      boc: item.boc,
      nganMa: item.nganMa,
      nganTen: item.nganTen,
      nganFillPercent: item.nganFillPercent,
    }));
  };

  const handlePrintAfterCreate = async () => {
    if (!createdBatchIds || createdBatchIds.length === 0) return;
    setPrintError(null);
    const allLots = (
      await Promise.all(createdBatchIds.map((id) => loadPredictionLotsForBatch(id)))
    ).flat();
    const items = await buildLabelItemsFromLots(allLots);
    if (items.length === 0) {
      setPrintError("Đợt này chưa có kiện nào để in nhãn (có thể chỉ vừa nối tiếp lô dở dang của đợt trước — vào Lịch sử dự đoán để in lại đợt gốc).");
      return;
    }
    await downloadProductLabelPdf(items);
  };

  const toggleExpandBatch = async (batchId: string) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(batchId);
    if (!batchLots[batchId]) {
      const lots = await loadPredictionLotsForBatch(batchId);
      setBatchLots((prev) => ({ ...prev, [batchId]: lots }));
    }
  };

  const handleReprintBatch = async (batchId: string) => {
    setPrintError(null);
    const lots = batchLots[batchId] || (await loadPredictionLotsForBatch(batchId));
    const items = await buildLabelItemsFromLots(lots);
    if (items.length === 0) {
      setPrintError("Đợt này chưa có kiện nào để in nhãn.");
      return;
    }
    await downloadProductLabelPdf(items);
  };

  const openEditLot = async (lot: PredictionLotRow) => {
    setEditingLot(lot);
    setEditKienAssign({
      kien_a_ngan_id: lot.kien_a_ngan_id || "",
      kien_b_ngan_id: lot.kien_b_ngan_id || "",
      kien_c_ngan_id: lot.kien_c_ngan_id || "",
      kien_d_ngan_id: lot.kien_d_ngan_id || "",
    });
    setEditError(null);
    // Bổ sung ngăn ĐANG được gán cho lô này vào danh sách dropdown nếu ngăn đó không còn nằm
    // trong `ngans` (đã đóng dự kiến hoặc hết dung lượng) — nếu không, <select> sẽ không tìm
    // thấy option khớp với value hiện tại và hiển thị sai thành "-- Chưa gán --".
    const assignedIds = Array.from(
      new Set(
        [lot.kien_a_ngan_id, lot.kien_b_ngan_id, lot.kien_c_ngan_id, lot.kien_d_ngan_id].filter(
          (id): id is string => !!id,
        ),
      ),
    );
    const missingIds = assignedIds.filter((id) => !ngansById.has(id));
    if (missingIds.length === 0) {
      setEditNganOptions(ngans);
      return;
    }
    const extra = await loadNgansByIdsRaw(missingIds);
    setEditNganOptions([...ngans, ...extra]);
  };

  const handleSaveEdit = async () => {
    if (!factoryId || !editingLot) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const assignments: Record<string, string | null> = {};
      KIEN_COLS.forEach(({ key }) => {
        const value = editKienAssign[key] || "";
        const original = editingLot[key] || "";
        // "" nghĩa là bỏ gán (chọn "-- Chưa gán --") — phải gửi null xuống DB, không được bỏ
        // qua như trước (bug cũ: `if (value && ...)` khiến không bao giờ lưu được việc bỏ gán).
        if (value !== original) assignments[key] = value === "" ? null : value;
      });
      const result = await updatePredictionLot({
        factoryId,
        predictionLotId: editingLot.id,
        kienAssignments: assignments,
        isAdmin,
      });
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      setEditingLot(null);
      if (editingLot.origin_batch_id) {
        const lots = await loadPredictionLotsForBatch(editingLot.origin_batch_id);
        setBatchLots((prev) => ({ ...prev, [editingLot.origin_batch_id]: lots }));
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelLot = async (lot: PredictionLotRow) => {
    if (!factoryId) return;
    await cancelPredictionLot(factoryId, lot.id, isAdmin);
    const lots = await loadPredictionLotsForBatch(lot.origin_batch_id);
    setBatchLots((prev) => ({ ...prev, [lot.origin_batch_id]: lots }));
  };

  const handleConfirmDeleteBatch = async () => {
    if (!factoryId || !deleteConfirmBatch) return;
    setDeletingBatch(true);
    setDeleteError(null);
    try {
      const result = await deletePredictionBatch(factoryId, deleteConfirmBatch.id, isAdmin);
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      setBatches((prev) => prev.filter((b) => b.id !== deleteConfirmBatch.id));
      setBatchLots((prev) => {
        const next = { ...prev };
        delete next[deleteConfirmBatch.id];
        return next;
      });
      if (expandedBatchId === deleteConfirmBatch.id) setExpandedBatchId(null);
      setDeleteConfirmBatch(null);
    } finally {
      setDeletingBatch(false);
    }
  };

  const handleReopenNgan = async (nganId: string) => {
    if (!factoryId) return;
    setReopeningId(nganId);
    try {
      await reopenNganPrediction(factoryId, nganId);
      void loadClosed(factoryId);
      void loadNgans(factoryId);
    } finally {
      setReopeningId(null);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-400">Đang tải...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 sm:text-2xl">Dự đoán số lô thành phẩm</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Chọn (1 hoặc nhiều) ngăn sẽ sản xuất tiếp theo, hệ thống tự đề xuất dãy số lô và in nhãn QR theo kiện.
          </p>
        </div>
        <Link
          href="/dashboard/product"
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-center text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          ← Quay lại Thành phẩm
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab("create")}
          className={`min-h-[40px] flex-1 rounded-xl px-4 py-2.5 text-sm font-bold sm:flex-none ${tab === "create" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Tạo dự đoán
        </button>
        <button
          onClick={() => setTab("history")}
          className={`min-h-[40px] flex-1 rounded-xl px-4 py-2.5 text-sm font-bold sm:flex-none ${tab === "history" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Lịch sử dự đoán
        </button>
      </div>

      {tab === "create" && (
        <>
          {!canManage ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-400 shadow-sm">
              Bạn không có quyền tạo dự đoán.
            </div>
          ) : createdBatchIds ? (
            <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <div className="text-lg font-bold text-emerald-700">Đã tạo dự đoán thành công!</div>
              {printError && (
                <div className="rounded-xl bg-amber-50 p-3 text-left text-sm font-bold text-amber-700">{printError}</div>
              )}
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  onClick={() => void handlePrintAfterCreate()}
                  className="min-h-[44px] rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white hover:bg-emerald-700"
                >
                  In nhãn QR
                </button>
                <button
                  onClick={() => {
                    setCreatedBatchIds(null);
                    setPrintError(null);
                    setSelectedNganIds([]);
                    setLoaiCsr("");
                    setBoc("");
                    setRequestedLotCount("");
                    setTrailingKienCount("");
                    setClosesNganChecked(true);
                  }}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Tạo dự đoán khác
                </button>
              </div>
            </div>
          ) : (
            <div className="lg:grid lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-6">
              {/* Cột trái (PC) / trên cùng (mobile): chọn ngăn + thông số lô */}
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">1. Chọn ngăn (được chọn nhiều)</label>
                  <FilterMultiSelect
                    options={ngans.map((n) => n.id)}
                    selected={selectedNganIds}
                    onChange={setSelectedNganIds}
                    labels={nganLabels}
                    placeholder="-- Chọn ngăn --"
                    searchPlaceholder="Tìm ngăn..."
                    className="min-w-0"
                  />
                  {selectedNgans.length > 1 && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      <span className="font-bold">Thứ tự tiêu thụ:</span>{" "}
                      {orderedNganIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && " → "}
                          {ngansById.get(id)?.ma_ngan}
                        </span>
                      ))}
                    </div>
                  )}
                  {mixedDayChuyen && (
                    <div className="mt-2 text-xs font-bold text-red-600">
                      Các ngăn đã chọn khác loại nguyên liệu (Mủ tạp/Mủ nước) — chỉ chọn ngăn cùng loại.
                    </div>
                  )}
                </div>

                {selectedNgans.length > 0 && !mixedDayChuyen && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">2. Loại CSR</label>
                      <select
                        value={loaiCsr}
                        onChange={(e) => {
                          setLoaiCsr(e.target.value);
                          setLoaiBanh(getLoaiBanhOptions(e.target.value)[0] || 35);
                          setBoc("");
                        }}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      >
                        <option value="">-- Chọn --</option>
                        {csrOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Loại bành</label>
                      <select
                        value={loaiBanh}
                        onChange={(e) => setLoaiBanh(Number(e.target.value))}
                        disabled={!loaiCsr}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      >
                        {banhOptions.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Loại bọc</label>
                      <select
                        value={boc}
                        onChange={(e) => setBoc(e.target.value)}
                        disabled={!loaiCsr}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      >
                        <option value="">-- Chọn --</option>
                        {bocOptions.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Thảm (tuỳ chọn)</label>
                      <input
                        value={tham}
                        onChange={(e) => setTham(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Hậu tố mã lô (tuỳ chọn)</label>
                      <input
                        value={suffix}
                        onChange={(e) => setSuffix(e.target.value)}
                        placeholder="vd: cs"
                        list="predict-suffix-options"
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                      <datalist id="predict-suffix-options">
                        {suffixOptions.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </datalist>
                      {suffixOptions.length === 0 && (
                        <p className="mt-1 text-xs text-slate-400">
                          Chưa có hậu tố nào trong danh mục — nhập tự do hoặc thêm ở Cài đặt → Danh mục → Hậu tố lô.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Cột phải (PC, sticky) / dưới cùng (mobile): carry-over + preview + tạo */}
              <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:sticky lg:top-6 lg:mt-0">
                {selectedNgans.length === 0 || mixedDayChuyen || !loaiCsr ? (
                  <div className="p-4 text-center text-sm text-slate-400">
                    Chọn ngăn và loại CSR bên trái để xem đề xuất số lô.
                  </div>
                ) : (
                  <>
                    {pendingCarry && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                        <div className="mb-2 text-sm font-bold text-amber-800">
                          Có lô dở dang <span className="font-mono">{pendingCarry.ma_lo}</span> đang chờ nối tiếp cùng CSR/bành/năm này.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setCarryResolution("continue")}
                            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-bold ${carryResolution === "continue" ? "bg-amber-600 text-white" : "border border-amber-300 bg-white text-amber-700"}`}
                          >
                            Tiếp tục lô dở dang {pendingCarry.ma_lo}
                          </button>
                          <button
                            onClick={() => setCarryResolution("skip")}
                            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-bold ${carryResolution === "skip" ? "bg-slate-700 text-white" : "border border-slate-300 bg-white text-slate-600"}`}
                          >
                            Bỏ qua, bắt đầu lô mới
                          </button>
                        </div>
                      </div>
                    )}

                    {previewLoading ? (
                      <div className="text-sm text-slate-400">Đang tính toán...</div>
                    ) : preview ? (
                      <div
                        className={`rounded-xl border p-4 text-sm ${outOfCapacity ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}
                      >
                        <div className={`font-bold ${outOfCapacity ? "text-red-700" : "text-emerald-800"}`}>
                          {outOfCapacity
                            ? `Ngăn đã chọn không còn đủ dung lượng để tạo thêm dù chỉ 1 kiện (còn khả dụng ~${Math.round(preview.availableKg)} kg, cần tối thiểu ~${Math.round(preview.kienWeightKg)} kg/kiện).`
                            : preview.suggestedLotCount > 0
                              ? `Đề xuất tối đa (ước tính): ${preview.suggestedLotCount} lô (KL kiện ~${Math.round(preview.kienWeightKg)} kg, tổng khả dụng ~${Math.round(preview.availableKg)} kg qua ${selectedNgans.length} ngăn)`
                              : `Chưa đủ dung lượng cho 1 lô đầy đủ (4 kiện), nhưng vẫn có thể tạo lô lẻ dưới 4 kiện (khả dụng ~${Math.round(preview.availableKg)} kg, ~${Math.round(preview.availableKg / preview.kienWeightKg)} kiện).`}
                        </div>
                        {!outOfCapacity && singleNgan && liveCalc && (
                          <div className="mt-1 text-xs font-bold text-emerald-700">
                            Tỷ lệ ngăn sau khi tạo: ~{liveCalc.livePct.toFixed(1)}% (mục tiêu 100-105%)
                          </div>
                        )}
                        {!outOfCapacity && (
                          <div className="mt-2 flex flex-wrap gap-4">
                            <div>
                              <label className="mb-1 block text-xs font-bold text-emerald-700">
                                Số lô muốn in (để trống = dùng tối đa)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={preview.suggestedLotCount}
                                value={requestedLotCount}
                                onChange={(e) =>
                                  setRequestedLotCount(e.target.value === "" ? "" : Number(e.target.value))
                                }
                                className="w-32 min-h-[38px] rounded-lg border border-emerald-300 px-3 py-1.5 text-sm outline-none"
                              />
                            </div>
                            {singleNgan && liveCalc && (
                              <div>
                                <label className="mb-1 block text-xs font-bold text-emerald-700">Kiện lẻ cuối (0-3)</label>
                                <div className="flex min-h-[38px] items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setTrailingKienCount(Math.max(0, liveCalc!.trailingKienClamped - 1))}
                                    disabled={liveCalc.trailingKienClamped <= 0}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-300 bg-white font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                  <span className="w-5 text-center font-mono font-bold">{liveCalc.trailingKienClamped}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setTrailingKienCount(Math.min(liveCalc!.maxTrailingKien, liveCalc!.trailingKienClamped + 1))
                                    }
                                    disabled={liveCalc.trailingKienClamped >= liveCalc.maxTrailingKien}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-300 bg-white font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {singleNganZeroZero && (
                          <div className="mt-2 text-xs font-bold text-red-600">
                            0 lô đầy đủ và 0 kiện lẻ — không có gì để tạo. Tăng &quot;Số lô muốn in&quot; hoặc &quot;Kiện lẻ cuối&quot;.
                          </div>
                        )}
                      </div>
                    ) : null}

                    {createError && (
                      <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{createError}</div>
                    )}

                    <label className="flex items-start gap-2 text-xs font-bold text-slate-600">
                      <input
                        type="checkbox"
                        checked={closesNganChecked}
                        onChange={(e) => setClosesNganChecked(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      Đánh dấu (các) ngăn đã chọn là đã dự kiến xong (không gợi ý lại)
                    </label>

                    <button
                      onClick={() => void handleCreate()}
                      disabled={!canCreate || creating}
                      className="min-h-[46px] w-full rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {creating ? "Đang tạo..." : "Tạo dự đoán"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          {printError && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">{printError}</div>
          )}
          {closedNgans.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-bold text-slate-600">Ngăn đã đóng dự kiến</div>
              <div className="flex flex-wrap gap-2">
                {closedNgans.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600"
                  >
                    <span>{n.ma_ngan}</span>
                    <button
                      onClick={() => void handleReopenNgan(n.id)}
                      disabled={reopeningId === n.id}
                      className="font-bold text-emerald-600 hover:underline disabled:opacity-50"
                    >
                      {reopeningId === n.id ? "Đang mở..." : "Mở lại"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {batches.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
              Chưa có dự đoán nào.
            </div>
          ) : (
            batches.map((batch) => (
              <div key={batch.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  onClick={() => void toggleExpandBatch(batch.id)}
                  className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5 sm:py-4"
                >
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-800">
                      {batch.ngans?.ma_ngan || "—"} — {batch.loai_csr} / {batch.loai_banh}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(batch.created_at).toLocaleString("vi-VN")} · Đề xuất {batch.suggested_lot_count} lô
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-emerald-600">
                    {expandedBatchId === batch.id ? "Thu gọn ▲" : "Xem chi tiết ▼"}
                  </span>
                </button>

                {expandedBatchId === batch.id && (
                  <div className="border-t border-slate-100 p-4">
                    <div className="mb-3 flex flex-wrap justify-end gap-2">
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteConfirmBatch(batch);
                          }}
                          className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                        >
                          <Trash2 size={13} /> Xóa đợt
                        </button>
                      )}
                      <button
                        onClick={() => void handleReprintBatch(batch.id)}
                        className="min-h-[36px] rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                      >
                        In lại nhãn cả batch
                      </button>
                    </div>
                    <ResponsiveTableWrapper>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                            <th className="p-2">Mã lô</th>
                            <th className="p-2">Trạng thái</th>
                            <th className="p-2">Carry-over</th>
                            <th className="p-2">Hành động</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(batchLots[batch.id] || []).length === 0 && (
                            <tr>
                              <td colSpan={4} className="p-4 text-center text-xs text-slate-400">
                                Đợt này chưa có lô nào (có thể chỉ nối tiếp lô dở dang của đợt khác).
                              </td>
                            </tr>
                          )}
                          {(batchLots[batch.id] || []).map((lot) => (
                            <tr key={lot.id} className="border-t border-slate-100">
                              <td className="p-2 font-mono">{lot.ma_lo}</td>
                              <td className="p-2">{lot.trang_thai}</td>
                              <td className="p-2 text-xs text-slate-500">{lot.carry_over_status}</td>
                              <td className="p-2">
                                <div className="flex gap-2">
                                  {canManage && (
                                    <button
                                      onClick={() => void openEditLot(lot)}
                                      className="text-xs font-bold text-emerald-600 hover:underline"
                                    >
                                      Sửa
                                    </button>
                                  )}
                                  {isAdmin && !lot.real_lot_id && (
                                    <button
                                      onClick={() => void handleCancelLot(lot)}
                                      className="text-xs font-bold text-red-600 hover:underline"
                                    >
                                      Hủy
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ResponsiveTableWrapper>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {editingLot && (
        <ModalShell title={`Sửa lô ${editingLot.ma_lo}`} onClose={() => setEditingLot(null)} maxWidth="md">
          <div className="space-y-3">
            {KIEN_COLS.map(({ key, letter }) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-bold text-slate-600">Kiện {letter} — ngăn nguồn</label>
                <select
                  value={editKienAssign[key] || ""}
                  onChange={(e) => setEditKienAssign((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">-- Chưa gán --</option>
                  {editNganOptions.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.ma_ngan} — {n.ten_ngan}
                      {!ngansById.has(n.id) ? " (đã đóng/hết dung lượng)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {editError && <div className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-600">{editError}</div>}
            <button
              onClick={() => void handleSaveEdit()}
              disabled={editSaving}
              className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700"
            >
              {editSaving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </ModalShell>
      )}

      {deleteConfirmBatch && (
        <ModalShell
          title="Xóa đợt dự đoán"
          onClose={() => (deletingBatch ? null : setDeleteConfirmBatch(null))}
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Xóa đợt dự đoán <span className="font-mono font-bold">{deleteConfirmBatch.ngans?.ma_ngan || "—"} — {deleteConfirmBatch.loai_csr}/{deleteConfirmBatch.loai_banh}</span> tạo lúc{" "}
              {new Date(deleteConfirmBatch.created_at).toLocaleString("vi-VN")}? Chỉ xóa được khi chưa có lô nào trong đợt được dùng thực tế.
            </p>
            {deleteError && <div className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-600">{deleteError}</div>}
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmBatch(null)}
                disabled={deletingBatch}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={() => void handleConfirmDeleteBatch()}
                disabled={deletingBatch}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingBatch ? "Đang xóa..." : "Xóa đợt"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

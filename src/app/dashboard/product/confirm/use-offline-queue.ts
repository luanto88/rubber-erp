"use client";

// Hàng đợi "Lưu tạm" trên máy + gói tra cứu tải sẵn cho màn quét QR khi MẤT MẠNG (GĐ-A,
// .claude/plans/quet-qr-offline.md). Server luôn là nơi quyết định cuối: hàng đợi chỉ giữ dữ liệu,
// mỗi mục được gửi lại bằng saveDraftKien với draftId cố định (gửi trùng ⇒ server trả alreadySaved).

import { useCallback, useEffect, useRef, useState } from "react";
import { getFreshAuthSession } from "@/lib/auth";
import {
  confirmQueueOwner,
  deleteConfirmQueueItem,
  isConfirmOfflineStoreAvailable,
  listConfirmQueue,
  loadConfirmPack,
  putConfirmQueueItem,
  saveConfirmPack,
  type ConfirmQueueItem,
  type ConfirmQueueStatus,
} from "@/lib/confirm-offline-store";
import {
  loadConfirmOfflinePack,
  saveDraftKien,
  type ConfirmOfflinePack,
} from "@/app/dashboard/product/confirm/actions";

const PACK_REFRESH_MIN_MS = 2 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;
export const PACK_STALE_MS = 12 * 60 * 60 * 1000;

export type SendOutcome =
  | { kind: "ok"; alreadySaved: boolean }
  | { kind: "error"; error: string }
  | { kind: "network" }
  | { kind: "auth" };

export type NewQueueItem = Omit<ConfirmQueueItem, "owner" | "status" | "error" | "scannedAt">;

function readOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOfflineQueue(params: {
  factoryId: string | null;
  userId: string | null;
  /** Gọi sau mỗi lượt có mục gửi thành công (để tải lại "Đang chờ gửi"). */
  onSynced?: () => void;
}) {
  const { factoryId, userId, onSynced } = params;
  const owner = factoryId && userId ? confirmQueueOwner(factoryId, userId) : null;

  const [online, setOnline] = useState(readOnline);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<ConfirmQueueItem[]>([]);
  const [pack, setPack] = useState<ConfirmOfflinePack | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  const syncingRef = useRef(false);
  const inFlightRef = useRef(new Set<string>());
  const packLoadedAtRef = useRef(0);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const reloadQueue = useCallback(async () => {
    if (!owner) return [] as ConfirmQueueItem[];
    const rows = await listConfirmQueue(owner);
    setQueue(rows);
    return rows;
  }, [owner]);

  const setStatus = useCallback(async (item: ConfirmQueueItem, status: ConfirmQueueStatus, error: string | null = null) => {
    await putConfirmQueueItem({ ...item, status, error });
  }, []);

  // Gửi 1 mục lên server. Không throw — luôn trả kết quả để caller quyết định UX.
  const sendItem = useCallback(
    async (item: ConfirmQueueItem): Promise<SendOutcome> => {
      if (inFlightRef.current.has(item.id)) return { kind: "network" };
      inFlightRef.current.add(item.id);
      try {
        let session: Awaited<ReturnType<typeof getFreshAuthSession>>;
        try {
          session = await getFreshAuthSession();
        } catch {
          return { kind: "network" };
        }
        if (!session?.access_token) {
          setAuthExpired(true);
          return { kind: "auth" };
        }
        setAuthExpired(false);
        await setStatus(item, "dang_gui");
        let result: Awaited<ReturnType<typeof saveDraftKien>>;
        try {
          result = await saveDraftKien({
            draftId: item.id,
            accessToken: session.access_token,
            factoryId: item.factoryId,
            maLo: item.maLo,
            kien: item.kien,
            isNewLot: item.isNewLot,
            nganId: item.nganId,
            loaiCsr: item.loaiCsr,
            loaiBanh: item.loaiBanh,
            dayChuyen: item.dayChuyen,
            soBanh: item.soBanh,
            ngaySx: item.ngaySx,
            ca: item.ca,
            boc: item.boc,
            pallet: item.pallet,
            chiThi: item.chiThi,
            tham: item.tham,
            ghiChu: item.ghiChu,
            unverified: item.unverified,
          });
        } catch {
          // Server action ném lỗi = không tới được server (mạng). Lỗi nghiệp vụ luôn là success:false.
          await setStatus(item, "cho_dong_bo");
          return { kind: "network" };
        }
        if (result.success) {
          await deleteConfirmQueueItem(item.id);
          return { kind: "ok", alreadySaved: !!result.alreadySaved };
        }
        await setStatus(item, "loi", result.error);
        return { kind: "error", error: result.error };
      } finally {
        inFlightRef.current.delete(item.id);
      }
    },
    [setStatus],
  );

  /** Đồng bộ TUẦN TỰ mọi mục chưa lỗi. Dừng ngay khi mất mạng / phiên hết hạn. */
  const syncNow = useCallback(async () => {
    if (!owner || syncingRef.current || !readOnline()) return;
    syncingRef.current = true;
    let anyOk = false;
    try {
      const items = (await listConfirmQueue(owner)).filter((i) => i.status !== "loi");
      if (items.length === 0) return;
      for (const item of items) {
        if (item.status !== "cho_dong_bo") await setStatus(item, "cho_dong_bo");
      }
      setSyncProgress({ done: 0, total: items.length });
      await reloadQueue();
      for (let i = 0; i < items.length; i++) {
        const outcome = await sendItem({ ...items[i], status: "cho_dong_bo", error: null });
        await reloadQueue();
        if (outcome.kind === "ok") anyOk = true;
        if (outcome.kind === "network" || outcome.kind === "auth") break;
        setSyncProgress({ done: i + 1, total: items.length });
      }
    } finally {
      syncingRef.current = false;
      setSyncProgress(null);
      await reloadQueue();
      if (anyOk) onSyncedRef.current?.();
    }
  }, [owner, reloadQueue, sendItem, setStatus]);

  const refreshPack = useCallback(
    async (force = false) => {
      if (!factoryId || !owner || !readOnline()) return;
      if (!force && Date.now() - packLoadedAtRef.current < PACK_REFRESH_MIN_MS) return;
      packLoadedAtRef.current = Date.now();
      try {
        const session = await getFreshAuthSession();
        if (!session?.access_token) return;
        const res = await loadConfirmOfflinePack(factoryId, session.access_token);
        if (!res.success) return;
        setPack(res.pack);
        await saveConfirmPack(owner, res.pack);
      } catch {
        packLoadedAtRef.current = 0; // mạng chập chờn — cho thử lại sớm
      }
    },
    [factoryId, owner],
  );

  // Khởi động: kiểm IndexedDB, nạp hàng đợi + gói cũ, rồi làm mới gói và đồng bộ mục còn tồn.
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void (async () => {
      const ok = await isConfirmOfflineStoreAvailable();
      if (!alive) return;
      setAvailable(ok);
      if (!ok) return;
      const [rows, stored] = await Promise.all([listConfirmQueue(owner), loadConfirmPack<ConfirmOfflinePack>(owner)]);
      if (!alive) return;
      setQueue(rows);
      if (stored) setPack(stored);
      void refreshPack(true);
      if (rows.some((r) => r.status !== "loi")) void syncNow();
    })();
    return () => {
      alive = false;
    };
  }, [owner, refreshPack, syncNow]);

  // Có mạng lại ⇒ đồng bộ + làm mới gói. Còn mục chờ ⇒ thử lại định kỳ (onLine có thể báo "có mạng"
  // trong khi server không tới được). Đọc hàng đợi qua ref để effect KHÔNG chạy lại mỗi lần hàng đợi
  // đổi — nếu không, mỗi lượt đồng bộ thất bại sẽ tự kích lượt mới ⇒ vòng lặp gọi server liên tục.
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    if (!online || !available) return;
    void syncNow();
    void refreshPack();
    const timer = window.setInterval(() => {
      if (queueRef.current.some((q) => q.status === "cho_dong_bo" || q.status === "tren_may")) void syncNow();
    }, RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [online, available, syncNow, refreshPack]);

  /** Ghi 1 mục mới vào máy. Trả mục đã ghi, hoặc null nếu IndexedDB không ghi được. */
  const enqueue = useCallback(
    async (input: NewQueueItem): Promise<ConfirmQueueItem | null> => {
      if (!owner || !available) return null;
      const item: ConfirmQueueItem = {
        ...input,
        owner,
        status: readOnline() ? "cho_dong_bo" : "tren_may",
        error: null,
        scannedAt: new Date().toISOString(),
      };
      const ok = await putConfirmQueueItem(item);
      await reloadQueue();
      return ok ? item : null;
    },
    [owner, available, reloadQueue],
  );

  const sendNow = useCallback(
    async (item: ConfirmQueueItem) => {
      const outcome = await sendItem(item);
      await reloadQueue();
      if (outcome.kind === "ok") onSyncedRef.current?.();
      return outcome;
    },
    [sendItem, reloadQueue],
  );

  const updateItem = useCallback(
    async (item: ConfirmQueueItem) => {
      await putConfirmQueueItem({ ...item, status: readOnline() ? "cho_dong_bo" : "tren_may", error: null });
      await reloadQueue();
      if (readOnline()) void syncNow();
    },
    [reloadQueue, syncNow],
  );

  const removeItem = useCallback(
    async (id: string) => {
      await deleteConfirmQueueItem(id);
      await reloadQueue();
    },
    [reloadQueue],
  );

  return {
    online,
    available,
    queue,
    pack,
    syncProgress,
    authExpired,
    enqueue,
    sendNow,
    syncNow,
    updateItem,
    removeItem,
    refreshPack,
  };
}

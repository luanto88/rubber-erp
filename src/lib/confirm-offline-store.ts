// Kho trên máy (IndexedDB) cho màn quét QR xác nhận sản xuất khi MẤT MẠNG — xem
// .claude/plans/quet-qr-offline.md (GĐ-A). Không dùng localStorage: giới hạn ~5MB, đồng bộ chặn luồng,
// và WebView Telegram/Zalo có thể chặn. Mọi hàm nuốt lỗi và trả giá trị an toàn — IndexedDB hỏng
// thì màn quét vẫn chạy như cũ (chỉ online), không được làm vỡ trang.

const DB_NAME = "rubber-erp-confirm";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const PACK_STORE = "pack";

export type ConfirmQueueStatus = "tren_may" | "cho_dong_bo" | "dang_gui" | "loi";

/** 1 kiện đã "Lưu tạm" trên máy, chờ gửi lên server bằng saveDraftKien (id = draftId). */
export type ConfirmQueueItem = {
  id: string;
  /** `${factoryId}:${userId}` — mỗi tài khoản chỉ thấy hàng đợi của mình. */
  owner: string;
  factoryId: string;
  maLo: string;
  kien: "A" | "B" | "C" | "D";
  isNewLot: boolean;
  nganId: string;
  nganMa: string | null;
  nganTen: string | null;
  loaiCsr: string;
  loaiBanh: number;
  dayChuyen: string | null;
  soBanh: number;
  ngaySx: string;
  ca: string;
  boc: string;
  pallet: string[];
  chiThi: string | null;
  tham: string | null;
  ghiChu: string | null;
  /** Mã không có trong gói tải sẵn — người dùng tự chọn ngăn/CSR/bành, server đối chiếu lại. */
  unverified: boolean;
  scannedAt: string;
  status: ConfirmQueueStatus;
  error?: string | null;
};

export function confirmQueueOwner(factoryId: string, userId: string): string {
  return `${factoryId}:${userId}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          store.createIndex("owner", "owner", { unique: false });
        }
        if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Trang khác (đăng xuất) xoá DB ⇒ đóng kết nối để lệnh xoá không bị treo.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(storeName, mode);
          const req = work(tx.objectStore(storeName));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** IndexedDB dùng được trên trình duyệt này không (false ⇒ màn quét chỉ chạy online). */
export async function isConfirmOfflineStoreAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function listConfirmQueue(owner: string): Promise<ConfirmQueueItem[]> {
  const rows = await run<ConfirmQueueItem[]>(QUEUE_STORE, "readonly", (s) => s.index("owner").getAll(owner));
  return (rows || []).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

/** Ghi (thêm/sửa) 1 mục — trả false nếu không ghi được (IndexedDB hỏng / bị chặn). */
export async function putConfirmQueueItem(item: ConfirmQueueItem): Promise<boolean> {
  const res = await run<IDBValidKey>(QUEUE_STORE, "readwrite", (s) => s.put(item));
  return res !== null;
}

export async function deleteConfirmQueueItem(id: string): Promise<void> {
  await run<undefined>(QUEUE_STORE, "readwrite", (s) => s.delete(id));
}

export async function countConfirmQueue(owner: string): Promise<number> {
  const n = await run<number>(QUEUE_STORE, "readonly", (s) => s.index("owner").count(owner));
  return n ?? 0;
}

export async function saveConfirmPack(owner: string, pack: unknown): Promise<void> {
  await run<IDBValidKey>(PACK_STORE, "readwrite", (s) => s.put(pack, owner));
}

export async function loadConfirmPack<T>(owner: string): Promise<T | null> {
  return (await run<T>(PACK_STORE, "readonly", (s) => s.get(owner) as IDBRequest<T>)) ?? null;
}

/**
 * Xoá hàng đợi + gói của MỘT tài khoản — gọi khi người dùng chủ động đăng xuất và đã xác nhận.
 * Không đụng dữ liệu tài khoản khác dùng chung máy (họ chưa xác nhận bỏ dữ liệu của mình).
 */
export async function clearConfirmOwnerData(owner: string): Promise<void> {
  const items = await listConfirmQueue(owner);
  for (const item of items) await deleteConfirmQueueItem(item.id);
  await run<undefined>(PACK_STORE, "readwrite", (s) => s.delete(owner));
}

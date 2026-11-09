"use client";

import { CloudUpload, HardDrive, Loader2, Pencil, Sun, Trash2, Warehouse, Weight } from "lucide-react";
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge";
import type { ConfirmQueueItem } from "@/lib/confirm-offline-store";

// Thẻ "Hàng đợi trên máy" ở Hub màn quét QR — chỉ hiện khi còn mục chưa đồng bộ. Đặt TRÊN thẻ
// "Đang chờ gửi" (nháp đã nằm trên server). Giao diện đơn sắc (2026-11-09): icon xám, nút Sửa/Xoá
// nền slate; màu chỉ ở chip đếm, badge trạng thái và nút Đồng bộ.
const ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

function shortNganCode(code: string | null | undefined): string {
  const trimmed = (code || "").trim();
  if (!trimmed) return "—";
  return trimmed.split("-")[0] || trimmed;
}

export function OfflineQueueCard({
  tt,
  caLabel,
  queue,
  online,
  syncing,
  onSyncNow,
  onEdit,
  onDelete,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  caLabel: (c: string) => string;
  queue: ConfirmQueueItem[];
  online: boolean;
  syncing: boolean;
  onSyncNow: () => void;
  onEdit: (item: ConfirmQueueItem) => void;
  onDelete: (item: ConfirmQueueItem) => void;
}) {
  if (queue.length === 0) return null;
  return (
    <section
      aria-label={tt("queueTitle", { count: queue.length })}
      className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm"
    >
      <div className="mb-1 flex items-center gap-2" title={tt("queueTitle", { count: queue.length })}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <HardDrive size={16} />
        </span>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800">
          {tt("queueTitle", { count: queue.length })}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{tt("queueHint")}</p>
      <div className="space-y-2">
        {queue.map((item) => (
          <div key={item.id} className="rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-800">
                  {item.maLo} · {tt("kienLabel")} {item.kien}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1" title={tt("soBanh")}>
                    <Weight size={13} className="shrink-0 text-slate-400" />
                    {item.soBanh} {tt("banhUnit")}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1" title={item.nganMa || ""}>
                    <Warehouse size={13} className="shrink-0 text-slate-400" />
                    <span className="truncate">{shortNganCode(item.nganMa)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1" title={tt("caSanXuat")}>
                    <Sun size={13} className="shrink-0 text-slate-400" />
                    {caLabel(item.ca)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <StatusBadge domain="confirm_queue" status={item.status} size="xs" />
                  {item.unverified && <StatusBadge tone="warn" label={tt("queueUnverified")} size="xs" />}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={item.status === "dang_gui"}
                  onClick={() => onEdit(item)}
                  title={tt("editEntry")}
                  aria-label={tt("editEntry")}
                  className={ICON_BTN}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  disabled={item.status === "dang_gui"}
                  onClick={() => onDelete(item)}
                  title={tt("deleteEntry")}
                  aria-label={tt("deleteEntry")}
                  className={ICON_BTN}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            {item.status === "loi" && item.error && (
              <div className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">{item.error}</div>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!online || syncing}
        onClick={onSyncNow}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {syncing ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
        {tt("queueSyncNow")}
      </button>
    </section>
  );
}

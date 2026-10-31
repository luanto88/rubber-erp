"use client";

import { CloudUpload, HardDrive, Loader2 } from "lucide-react";
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge";
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action";
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action";
import type { ConfirmQueueItem } from "@/lib/confirm-offline-store";

// Thẻ "Hàng đợi trên máy" ở Hub màn quét QR — chỉ hiện khi còn mục chưa đồng bộ. Đặt TRÊN thẻ
// "Đang chờ gửi" (nháp đã nằm trên server).
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
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold text-sky-800">
        <HardDrive size={16} />
        {tt("queueTitle", { count: queue.length })}
      </div>
      <p className="mb-3 text-[11px] text-sky-700">{tt("queueHint")}</p>
      <div className="space-y-2">
        {queue.map((item) => (
          <div key={item.id} className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-800">
                  {item.maLo} - {tt("kienLabel")} {item.kien}
                </div>
                <div className="text-xs text-slate-500">
                  {item.soBanh} bành · {item.nganMa || "—"} · {caLabel(item.ca)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <StatusBadge domain="confirm_queue" status={item.status} size="xs" />
                  {item.unverified && <StatusBadge tone="warn" label={tt("queueUnverified")} size="xs" />}
                </div>
              </div>
              <IconActionGroup>
                <RowAction kind="edit" disabled={item.status === "dang_gui"} onClick={() => onEdit(item)} />
                <RowAction kind="delete" disabled={item.status === "dang_gui"} onClick={() => onDelete(item)} />
              </IconActionGroup>
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
    </div>
  );
}

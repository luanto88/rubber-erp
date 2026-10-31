"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, ShieldAlert, Wifi } from "lucide-react";

// Thanh trạng thái mạng dính dưới header màn quét QR: đỏ khi mất mạng, vàng khi đang đồng bộ, xanh
// "Đã kết nối" hiện 3 giây khi vừa có mạng lại / vừa đồng bộ xong rồi tự ẩn.
export function NetworkStatusBar({
  tt,
  online,
  queueCount,
  syncProgress,
  authExpired,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  online: boolean;
  queueCount: number;
  syncProgress: { done: number; total: number } | null;
  authExpired: boolean;
}) {
  const [showConnected, setShowConnected] = useState(false);
  const wasBusyRef = useRef(false);
  const busy = !online || !!syncProgress;

  // Khi đang bận, 2 nhánh đỏ/vàng bên dưới render trước nên không cần tắt cờ "Đã kết nối" ở đây.
  useEffect(() => {
    if (busy) {
      wasBusyRef.current = true;
      return;
    }
    if (!wasBusyRef.current) return;
    wasBusyRef.current = false;
    const show = window.setTimeout(() => setShowConnected(true), 0);
    const hide = window.setTimeout(() => setShowConnected(false), 3000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [busy]);

  if (!online) {
    return (
      <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-xs font-bold text-white">
        <CloudOff size={15} className="shrink-0" />
        {tt("netOffline", { count: queueCount })}
      </div>
    );
  }
  if (authExpired && queueCount > 0) {
    return (
      <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-xs font-bold text-white">
        <ShieldAlert size={15} className="shrink-0" />
        {tt("netAuthExpired", { count: queueCount })}
      </div>
    );
  }
  if (syncProgress) {
    return (
      <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-bold text-white">
        <Loader2 size={15} className="shrink-0 animate-spin" />
        {tt("netSyncing", { done: syncProgress.done, total: syncProgress.total })}
      </div>
    );
  }
  if (showConnected) {
    return (
      <div className="flex items-center gap-2 bg-emerald-600 px-4 py-2 text-xs font-bold text-white">
        <Wifi size={15} className="shrink-0" />
        {tt("netOnline")}
      </div>
    );
  }
  return null;
}

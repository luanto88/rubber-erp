"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, X } from "lucide-react";

const REGION_ID = "product-confirm-qr-reader";

type QrScannerProps = {
  onDecoded: (text: string) => void;
  onCancel: () => void;
  hintText: string;
  cancelText: string;
  cameraErrorText: string;
  scanError?: string | null;
};

// Camera QR reader trong app — dùng camera sau của thiết bị, quét liên tục cho tới khi decode
// được 1 mã hoặc người dùng bấm Hủy. Tách riêng component vì html5-qrcode chỉ được phép chạy
// ở client (đụng trực tiếp `navigator.mediaDevices`) — page.tsx phải import component này qua
// next/dynamic({ ssr: false }), mirror đúng cách xử lý leaflet đã áp dụng cho bản đồ kho.
export function QrScanner({
  onDecoded,
  onCancel,
  hintText,
  cancelText,
  cameraErrorText,
  scanError,
}: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const decodedRef = useRef(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const instance = new Html5Qrcode(REGION_ID);
    scannerRef.current = instance;

    instance
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (decodedRef.current || cancelled) return;
          decodedRef.current = true;
          onDecoded(decodedText);
          // Nếu mã không hợp lệ, page.tsx không đổi view (vẫn ở màn quét) — mở lại khoá sau
          // 1.5s để camera tiếp tục thử quét thay vì đứng im vĩnh viễn. Nếu mã hợp lệ, page.tsx
          // đổi sang view="form" → component này unmount, timeout này trở thành vô hại.
          setTimeout(() => {
            decodedRef.current = false;
          }, 1500);
        },
        () => {
          // lỗi decode từng khung hình — bỏ qua, chỉ là chưa thấy QR trong khung
        },
      )
      .catch(() => {
        if (!cancelled) setCameraError(true);
      });

    return () => {
      cancelled = true;
      const current = scannerRef.current;
      scannerRef.current = null;
      if (current) {
        current
          .stop()
          .then(() => current.clear())
          .catch(() => {
            /* camera có thể đã dừng sẵn, bỏ qua lỗi cleanup */
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-sm font-bold text-white">{hintText}</span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X size={20} />
        </button>
      </div>

      {cameraError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <AlertTriangle size={32} className="text-amber-400" />
          <p className="text-sm font-semibold text-white">{cameraErrorText}</p>
          <button
            type="button"
            onClick={onCancel}
            className="mt-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/20"
          >
            {cancelText}
          </button>
        </div>
      ) : (
        <>
          {scanError && (
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-red-600/90 px-3 py-2 text-sm font-bold text-white">
              <AlertTriangle size={16} />
              {scanError}
            </div>
          )}
          <div id={REGION_ID} className="mx-auto w-full max-w-md flex-1" />
        </>
      )}

      <div className="px-4 pb-8 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-2xl border-2 border-white/30 py-3 text-sm font-extrabold text-white hover:bg-white/10"
        >
          {cancelText}
        </button>
      </div>
    </div>
  );
}

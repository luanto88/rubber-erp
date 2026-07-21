"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, ImageUp, X } from "lucide-react";

const REGION_ID = "product-confirm-qr-reader";
// Vùng riêng cho scanFile() — Html5Qrcode constructor bắt buộc phải có 1 element DOM tồn tại
// sẵn (kể cả khi showImage=false, không thực sự render ảnh lên màn hình), tách hẳn khỏi
// REGION_ID (đang được camera dùng) để 2 luồng decode không tranh chấp cùng 1 canvas nội bộ.
const FILE_REGION_ID = "product-confirm-qr-file-reader";

type QrScannerProps = {
  onDecoded: (text: string) => void;
  onCancel: () => void;
  hintText: string;
  cancelText: string;
  cameraErrorText: string;
  uploadButtonText: string;
  uploadScanningText: string;
  uploadNotFoundText: string;
  orDividerText: string;
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
  uploadButtonText,
  uploadScanningText,
  uploadNotFoundText,
  orDividerText,
  scanError,
}: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const decodedRef = useRef(false);
  const [cameraError, setCameraError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileScanning, setFileScanning] = useState(false);
  const [fileScanError, setFileScanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const instance = new Html5Qrcode(REGION_ID);
    scannerRef.current = instance;

    instance
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
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

  // "Tải ảnh chứa QR" — công nhân đôi khi đã chụp sẵn ảnh nhãn (QR) trước đó, muốn giải mã trực
  // tiếp từ ảnh có sẵn trong máy thay vì phải đưa camera lại đúng vị trí nhãn thật. Dùng instance
  // Html5Qrcode RIÊNG (không phải scannerRef đang chạy camera) để tránh tranh chấp canvas nội bộ
  // — decode xong gọi chung onDecoded() như luồng camera, để mọi validate (mã hợp lệ/đúng nhà máy)
  // ở page.tsx áp dụng đồng nhất cho cả 2 nguồn ảnh.
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileScanError(null);
    setFileScanning(true);
    try {
      const fileScanner = new Html5Qrcode(FILE_REGION_ID, false);
      const decodedText = await fileScanner.scanFile(file, false);
      if (decodedRef.current) return;
      decodedRef.current = true;
      onDecoded(decodedText);
      setTimeout(() => {
        decodedRef.current = false;
      }, 1500);
    } catch {
      setFileScanError(uploadNotFoundText);
    } finally {
      setFileScanning(false);
    }
  };

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
        </div>
      ) : (
        <>
          {scanError && (
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-red-600/90 px-3 py-2 text-sm font-bold text-white">
              <AlertTriangle size={16} />
              {scanError}
            </div>
          )}
          {/* Container vuông (aspect-square) — trước đây flex-1 kéo dài theo chiều cao màn
              hình dọc khiến khung quét bị bóp méo thành hình chữ nhật dù qrbox cấu hình vuông. */}
          <div className="flex flex-1 items-center justify-center px-4">
            <div id={REGION_ID} className="aspect-square w-full max-w-md" />
          </div>
        </>
      )}

      {/* "Tải ảnh chứa QR" luôn hiển thị bất kể camera có mở được hay không — vừa là lối vào thay
          thế khi công nhân đã chụp sẵn ảnh nhãn, vừa là lối thoát khi camera bị từ chối quyền. */}
      <div className="space-y-3 px-4 pb-8 pt-4">
        {fileScanError && (
          <div className="flex items-center gap-2 rounded-xl bg-red-600/90 px-3 py-2 text-sm font-bold text-white">
            <AlertTriangle size={16} />
            {fileScanError}
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
          <span className="h-px flex-1 bg-white/15" />
          {orDividerText}
          <span className="h-px flex-1 bg-white/15" />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
        />
        <div id={FILE_REGION_ID} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={fileScanning}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-white/30 py-3 text-sm font-extrabold text-white hover:bg-white/10 disabled:opacity-60"
        >
          <ImageUp size={18} />
          {fileScanning ? uploadScanningText : uploadButtonText}
        </button>
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

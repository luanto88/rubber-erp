"use client"

/**
 * Núm co giãn NHÌN THẤY ĐƯỢC cho các khối kéo-thả trên canvas PDF (khung chữ ký, tên, chức vụ,
 * tiền tố, ghi chú, QR).
 *
 * Vì sao cần: `re-resizable` mặc định chỉ render một vùng trong suốt ~10px ở mép — người dùng
 * không thấy chỗ nào để kéo, phải rê chuột mò. Module ISO đã tự vẽ núm tròn có icon mũi tên chéo
 * (`iso-batch-sign-modal.tsx`); component này gom lại để Văn bản và màn "Cài đặt vị trí ký" dùng
 * chung đúng một hình dạng.
 *
 * Cách dùng với `re-resizable` — phải đủ CẢ BA prop, nếu thiếu `handleClasses` thì kéo núm sẽ
 * kéo trôi cả khối (xem `cancel=".resize-handle"` của Draggable bọc ngoài):
 *
 *   <Resizable
 *     handleComponent={{ bottomRight: <ResizeHandleIcon color="#0284c7" /> }}
 *     handleClasses={{ bottomRight: RESIZE_HANDLE_CLASS }}
 *     handleStyles={{ bottomRight: RESIZE_HANDLE_STYLE }}
 *   />
 *
 * Với khối tự viết drag/resize bằng Pointer Events (màn "Cài đặt vị trí ký") thì nhúng thẳng
 * component vào ô núm sẵn có, không cần 3 prop trên.
 */

/** Class để `cancel` của react-draggable loại núm ra khỏi vùng kéo. */
export const RESIZE_HANDLE_CLASS = "resize-handle"

/**
 * Ghi đè style mặc định của `re-resizable` cho góc dưới-phải: nới vùng bấm lên 28px và dịch ra
 * ngoài mép để núm không đè lên nội dung bên trong khối.
 */
export const RESIZE_HANDLE_STYLE: React.CSSProperties = {
  width: 28,
  height: 28,
  right: -14,
  bottom: -14,
  zIndex: 20,
}

export function ResizeHandleIcon({
  color = "#d97706",
  title = "Kéo để co giãn kích thước",
}: {
  /** Màu nền núm — truyền màu của vai trò/khối để nhìn là biết núm thuộc khối nào. */
  color?: string
  title?: string
}) {
  return (
    <div
      title={title}
      className="w-full h-full flex items-center justify-center touch-none"
      style={{ cursor: "nwse-resize" }}
    >
      <div
        className="w-7 h-7 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-white shadow-md hover:scale-110 transition-transform"
        style={{ backgroundColor: color }}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5 sm:w-2.5 sm:h-2.5"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 3 3 3 3 9" />
          <polyline points="15 21 21 21 21 15" />
          <line x1="3" y1="3" x2="10" y2="10" />
          <line x1="21" y1="21" x2="14" y2="14" />
        </svg>
      </div>
    </div>
  )
}

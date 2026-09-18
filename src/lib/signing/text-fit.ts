/**
 * Helper tính toán kích thước khung bao tự co giãn vừa khít (Auto-Fit Snug Box)
 * cho khối Họ tên và Chức vụ trong canvas đặt vị trí chữ ký.
 */

let sharedCanvasContext: CanvasRenderingContext2D | null = null

/**
 * Đo bề rộng chuỗi văn bản theo font chữ và kích thước (pixel).
 * Kết hợp đo trên Canvas 2D thật (khi ở browser) và công thức xấp xỉ dự phòng khi SSR.
 */
export function measureTextWidth(
  text: string,
  fontSizePx: number,
  fontWeight: "normal" | "bold" = "normal",
  fontFamily = '"Times New Roman", Times, serif',
): number {
  if (!text) return 0
  if (typeof document !== "undefined") {
    if (!sharedCanvasContext) {
      const c = document.createElement("canvas")
      sharedCanvasContext = c.getContext("2d")
    }
    if (sharedCanvasContext) {
      sharedCanvasContext.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`
      return sharedCanvasContext.measureText(text).width
    }
  }
  // Công thức dự phòng: Times New Roman trung bình ~0.52em đối với chữ thường, ~0.65em chữ hoa
  const avgCharWidth = fontWeight === "bold" ? fontSizePx * 0.58 : fontSizePx * 0.52
  return Math.ceil(text.length * avgCharWidth)
}

export type SnugBoxSize = {
  w: number
  h: number
}

/**
 * Tính toán kích thước w, h vừa khít text (canvas pixel).
 *
 * @param text - Nội dung chữ (họ tên hoặc chức vụ)
 * @param type - "name" (chữ đậm) hoặc "chuc_vu" (chữ thường)
 * @param scale - Tỉ lệ phóng đại canvas so với khổ PDF (thường là 1.5)
 * @param fontSizePt - Cỡ font point chuẩn (mặc định 13pt)
 */
export function computeSnugBoxSize(
  text: string | null | undefined,
  type: "name" | "chuc_vu",
  scale = 1.5,
  fontSizePt = 13,
): SnugBoxSize {
  const content = (text || (type === "name" ? "Người ký" : "Chức vụ")).trim()
  const fontSizePx = fontSizePt * scale
  const isBold = type === "name"

  const measuredWidth = measureTextWidth(
    content,
    fontSizePx,
    isBold ? "bold" : "normal",
    '"Times New Roman", Times, serif',
  )

  // Padding:
  // - Bên trái: 8px
  // - Bên phải: 28px (chừa chỗ cho nút icon mắt ở góc trên-phải và nút kéo ở góc dưới-phải)
  const padX = 36
  const minW = type === "name" ? 75 : 65
  const snugW = Math.max(minW, Math.ceil(measuredWidth + padX))

  // Chiều cao: fontSize * line-height (1.15) + padding viền trên/dưới
  const snugH = Math.max(
    type === "name" ? 22 : 20,
    Math.ceil(fontSizePx * 1.25 + 5),
  )

  return { w: snugW, h: snugH }
}

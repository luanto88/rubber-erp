import type { ChucVuKey, SignTemplateAnchor, SignTemplateSignAsKey } from "@/lib/signing/templates"

// Bố cục các khối con BÊN TRONG một khung mẫu `mau_vi_tri`.
//
// File này CỐ Ý không import pdf-lib hay bất kỳ thư viện server nào — nó được dùng chung bởi:
//   - UI người ký (`documents/[id]/page.tsx`) để vẽ khối kéo-thả trên canvas pdfjs;
//   - route ký thật (`api/documents/sign/route.ts` → `apply-template.ts`) để kẹp toạ độ và đóng dấu.
// Nhờ dùng CHUNG một công thức, bản xem trước lúc ký và bản PDF sau khi ký không bao giờ lệch nhau.
//
// Hệ toạ độ: point, gốc dưới-trái (trùng pdf-lib) — giống hệt `x_pt/y_pt/w_pt/h_pt` của mẫu.
//
// NGUYÊN TẮC XUYÊN SUỐT: mọi thứ hệ thống đóng dấu lên PDF đều phải cho người ký NHÌN THẤY và
// XÊ DỊCH được, nhưng chỉ TRONG khung người soạn thảo đã cài đặt. Khung mẫu
// (`x/y/width/height`) là bất biến — client chỉ gửi được `layout` bên trong.

/**
 * Key riêng trong `van_ban_documents.placement_ky` chứa metadata mẫu đã chốt
 * (`{loai_tai_lieu, phien_ban, chot_luc}`) — KHÔNG phải một khung ký, mọi nơi duyệt qua các key
 * của `placement_ky` đều phải bỏ qua nó.
 *
 * Hằng số này thuộc về file THUẦN này (không phải `apply-template.ts`) vì cả phía client
 * (`placement-preview.ts` → `documents/[id]/page.tsx`) lẫn phía server đều cần. `apply-template.ts`
 * kéo theo `stamp-pdf.ts` vốn `import fs`/`path` (đọc file font) — client import nhầm vào đó sẽ
 * làm build hỏng với "Module not found: Can't resolve 'fs'".
 */
export const MAU_META_KEY = "_mau"

/**
 * Kiểu chữ dùng cho tên người ký + chức vụ khi đóng dấu lên PDF.
 *
 * Đặt ở file THUẦN này (không phải `stamp-pdf.ts` — file đó `import fs`) để 3 nơi dùng CHUNG một
 * nguồn, nhờ vậy chữ xem trước và chữ sau khi ký không lệch nhau:
 *   - màn "Cài đặt vị trí ký" (`ky/mau-vi-tri/page.tsx`) — người soạn thảo vẽ mẫu;
 *   - màn ký (`documents/[id]/page.tsx`) — người ký xê dịch trong khung;
 *   - route đóng dấu thật (`apply-template.ts`).
 *
 * PDF vẽ bằng `public/fonts/TimesNewRoman.ttf`, nét thường (không đậm, không nghiêng) — bản xem
 * trước phải khai đúng họ font này, đừng để rơi về font hệ thống.
 */
export const SIGN_TEXT_FONT_FAMILY = "'Times New Roman', Times, serif"

/** Cỡ mặc định (pt) của tên + chức vụ. */
export const SIGN_TEXT_FONT_SIZE_PT = 13

/** Sàn khi thu nhỏ: tên/chức vụ quá dài so với bề rộng khối thì giảm dần tới mức này. */
export const SIGN_TEXT_MIN_FONT_SIZE_PT = 9

/** Tiền tố ký thay (KT./TM./TL./TUQ.) — nhỏ hơn tên, giữ nguyên cỡ đã chạy thật. */
export const SIGN_PREFIX_FONT_SIZE_PT = 10

export type LayoutRect = { x: number; y: number; width: number; height: number }

/**
 * Lựa chọn thực tế của NGƯỜI KÝ trong khung ký đã chốt (4 khối con).
 *
 * Quy tắc 2 TẦNG: `show_name`/`show_chuc_vu` của MẪU nghĩa là "có CHO PHÉP hiển thị hay không"
 * (người soạn thảo quyết định); còn các cờ trong đây là "người ký có bật hay không". Mẫu tắt →
 * người ký không thấy khối đó và không có cách nào bật lên. Tương tự, khối tiền tố chỉ tồn tại
 * khi mẫu có chọn `sign_as` cho bước đó.
 */
export type SignerSubLayout = {
  sig: LayoutRect
  name: LayoutRect | null
  chuc_vu: LayoutRect | null
  /** Tiền tố ký thay (KT./TM./TL./TUQ.) — từ 2026-09-05 nằm TRONG khung, kéo và tắt được. */
  prefix: LayoutRect | null
  show_name: boolean
  show_chuc_vu: boolean
  show_prefix: boolean
}

/** Bố cục 2 khối con của khung "Ghi chú" (ý kiến chỉ đạo + chữ ký nháy). */
export type NoteSubLayout = {
  text: LayoutRect
  ky_nhay: LayoutRect | null
}

export type TemplateAnchorBox = {
  neo_trang: SignTemplateAnchor
  so_trang: number
  x: number
  y: number
  width: number
  height: number
}

export type TemplateSignBox = TemplateAnchorBox & {
  show_name: boolean
  show_chuc_vu: boolean
  chuc_vu_key: ChucVuKey | null
  /** Người ký tự xê dịch trong khung. Không có = dùng bố cục mặc định (văn bản ký trước 2026-09-05). */
  layout?: SignerSubLayout | null
}

/** Khung "Ghi chú" — lãnh đạo xê dịch ô text + chữ ký nháy bên trong. */
export type TemplateNoteBox = TemplateAnchorBox & { layout?: NoteSubLayout | null }

/** Khung QR — người ký ĐẦU TIÊN xê dịch, các bước sau dùng lại (QR là dữ liệu cấp văn bản). */
export type TemplateQrBox = TemplateAnchorBox & { layout?: LayoutRect | null }

export type TemplateStepPlacement = {
  tu_mau: true
  sign_as?: SignTemplateSignAsKey | null
  boxes: TemplateSignBox[]
}

export type TemplateBoxesPlacement = {
  tu_mau: true
  boxes: TemplateAnchorBox[]
}

export type TemplateNotePlacement = {
  tu_mau: true
  boxes: TemplateNoteBox[]
}

export type TemplateQrPlacement = {
  tu_mau: true
  boxes: TemplateQrBox[]
}

// ── Neo trang ─────────────────────────────────────────────────────────────────

/**
 * `dau` → đúng trang `so_trang` (clamp trong khoảng hợp lệ);
 * `cuoi` → trang cuối cùng (payload luôn ghi `so_trang = 0` cho neo này);
 * `moi_trang` → mọi trang (vd ký nháy từng trang).
 */
export function resolveAnchorPages(box: TemplateAnchorBox, pageCount: number): number[] {
  if (pageCount <= 0) return []
  if (box.neo_trang === "moi_trang") {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  if (box.neo_trang === "cuoi") {
    const n = box.so_trang > 0 ? pageCount - box.so_trang + 1 : pageCount
    return [Math.min(Math.max(n, 1), pageCount)]
  }
  return [Math.min(Math.max(box.so_trang || 1, 1), pageCount)]
}

// ── Kẹp toạ độ vào trong khung mẫu ────────────────────────────────────────────

/** Kích thước tối thiểu (pt) để khối không bị kéo teo thành vô hình. */
const MIN_W = 18
const MIN_H = 8

/**
 * Ép 1 khối con nằm TRỌN trong khung mẫu. Đây là hàng rào an toàn cuối cùng — server BẮT BUỘC
 * gọi lại hàm này trên dữ liệu client gửi lên, không được tin UI đã chặn biên.
 */
export function clampRectToBox(
  rect: LayoutRect,
  box: { x: number; y: number; width: number; height: number },
): LayoutRect {
  const width = Math.min(Math.max(rect.width, Math.min(MIN_W, box.width)), box.width)
  const height = Math.min(Math.max(rect.height, Math.min(MIN_H, box.height)), box.height)
  const x = Math.min(Math.max(rect.x, box.x), box.x + box.width - width)
  const y = Math.min(Math.max(rect.y, box.y), box.y + box.height - height)
  return { x, y, width, height }
}

function readRect(value: unknown): LayoutRect | null {
  if (!value || typeof value !== "object") return null
  const r = value as Record<string, unknown>
  const nums = [r.x, r.y, r.width, r.height]
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null
  return { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
}

// ── Bố cục mặc định cho khung KÝ ──────────────────────────────────────────────

/** Dải trên cùng dành cho tiền tố ký thay, tính theo chiều cao khung. */
const PREFIX_RATIO = 0.16

/**
 * Chia khung ký thành các dải.
 *
 * Phần sig/name/chức danh giữ NGUYÊN công thức đã chạy thật từ 2026-09-04 (tỉ lệ 0.55 / 0.72 /
 * 1.0) — chỉ khác là khi có tiền tố, chúng chia trên phần chiều cao CÒN LẠI sau khi trừ dải
 * tiền tố. Khung không có tiền tố ⇒ `innerH === box.height` ⇒ kết quả y hệt trước, không đổi 1
 * pixel với văn bản đang dở dang.
 */
export function computeDefaultSubLayout(
  box: { x: number; y: number; width: number; height: number },
  opts: { withName: boolean; withChucVu: boolean; withPrefix?: boolean },
): { sig: LayoutRect; name: LayoutRect | null; chuc_vu: LayoutRect | null; prefix: LayoutRect | null } {
  const { withName, withChucVu } = opts
  const withPrefix = !!opts.withPrefix

  const prefixH = withPrefix ? box.height * PREFIX_RATIO : 0
  const innerH = box.height - prefixH

  const prefix: LayoutRect | null = withPrefix
    ? { x: box.x, y: box.y + innerH, width: box.width, height: prefixH }
    : null

  const sigRatio = withName && withChucVu ? 0.55 : withName || withChucVu ? 0.72 : 1
  const sigH = innerH * sigRatio

  const sig: LayoutRect = {
    x: box.x,
    y: box.y + innerH - sigH,
    width: box.width,
    height: sigH,
  }

  const name: LayoutRect | null = withName
    ? {
        x: box.x,
        y: box.y,
        width: box.width,
        height: withChucVu ? innerH * 0.22 : innerH * 0.26,
      }
    : null

  const chuc_vu: LayoutRect | null = withChucVu
    ? {
        x: box.x,
        y: withName ? box.y + innerH * 0.22 : box.y,
        width: box.width,
        height: withName ? innerH * 0.23 : innerH * 0.26,
      }
    : null

  return { sig, name, chuc_vu, prefix }
}

/**
 * Chuẩn hoá bố cục người ký gửi lên: bỏ khối mà MẪU không cho phép, kẹp mọi toạ độ vào khung,
 * và điền bố cục mặc định cho khối thiếu dữ liệu. Trả `null` nếu client không gửi gì hợp lệ.
 */
export function sanitizeSignerSubLayout(
  incoming: unknown,
  box: TemplateSignBox,
  opts: { chucVuAvailable: boolean; prefixAvailable: boolean },
): SignerSubLayout | null {
  if (!incoming || typeof incoming !== "object") return null
  const raw = incoming as Record<string, unknown>

  const allowName = box.show_name
  const allowChucVu = box.show_chuc_vu && opts.chucVuAvailable
  const allowPrefix = opts.prefixAvailable

  // Tầng 2: người ký chỉ tắt/bật được trong phạm vi mẫu đã cho phép.
  const showName = allowName && raw.show_name !== false
  const showChucVu = allowChucVu && raw.show_chuc_vu !== false
  const showPrefix = allowPrefix && raw.show_prefix !== false

  const fallback = computeDefaultSubLayout(box, {
    withName: showName,
    withChucVu: showChucVu,
    withPrefix: showPrefix,
  })

  const sig = clampRectToBox(readRect(raw.sig) ?? fallback.sig, box)
  const name = showName ? clampRectToBox(readRect(raw.name) ?? fallback.name ?? fallback.sig, box) : null
  const chucVu = showChucVu
    ? clampRectToBox(readRect(raw.chuc_vu) ?? fallback.chuc_vu ?? fallback.sig, box)
    : null
  const prefix = showPrefix
    ? clampRectToBox(readRect(raw.prefix) ?? fallback.prefix ?? fallback.sig, box)
    : null

  return {
    sig,
    name,
    chuc_vu: chucVu,
    prefix,
    show_name: showName,
    show_chuc_vu: showChucVu,
    show_prefix: showPrefix,
  }
}

/**
 * Ghép bố cục người ký vào entry của bước ký. `incoming` là mảng THEO ĐÚNG THỨ TỰ `entry.boxes`;
 * phần tử thiếu/không hợp lệ → giữ nguyên khung đó ở bố cục mặc định.
 */
export function applySignerLayoutToEntry(
  entry: TemplateStepPlacement,
  incoming: unknown,
  opts: { chucVuAvailable: boolean; prefixAvailable: boolean },
): TemplateStepPlacement {
  const list = Array.isArray(incoming) ? incoming : []
  return {
    ...entry,
    boxes: entry.boxes.map((box, i) => {
      const layout = sanitizeSignerSubLayout(list[i], box, opts)
      return layout ? { ...box, layout } : box
    }),
  }
}

/**
 * Bố cục hiệu lực khi ĐÓNG DẤU: ưu tiên lựa chọn đã lưu của người ký, ngược lại tính mặc định.
 * `chucVuAvailable` = có chuỗi chức vụ thật để vẽ hay không; `prefixAvailable` = mẫu có chọn
 * `sign_as` cho bước này hay không.
 */
export function resolveEffectiveSubLayout(
  box: TemplateSignBox,
  opts: { chucVuAvailable: boolean; prefixAvailable: boolean },
): SignerSubLayout {
  const allowName = box.show_name
  const allowChucVu = box.show_chuc_vu && opts.chucVuAvailable
  const allowPrefix = opts.prefixAvailable

  const stored = box.layout
  if (stored && stored.sig) {
    const showName = allowName && stored.show_name !== false
    const showChucVu = allowChucVu && stored.show_chuc_vu !== false
    const showPrefix = allowPrefix && stored.show_prefix !== false
    return {
      sig: clampRectToBox(stored.sig, box),
      name: showName && stored.name ? clampRectToBox(stored.name, box) : null,
      chuc_vu: showChucVu && stored.chuc_vu ? clampRectToBox(stored.chuc_vu, box) : null,
      prefix: showPrefix && stored.prefix ? clampRectToBox(stored.prefix, box) : null,
      show_name: showName && !!stored.name,
      show_chuc_vu: showChucVu && !!stored.chuc_vu,
      show_prefix: showPrefix && !!stored.prefix,
    }
  }

  const fallback = computeDefaultSubLayout(box, {
    withName: allowName,
    withChucVu: allowChucVu,
    withPrefix: allowPrefix,
  })
  return {
    sig: fallback.sig,
    name: fallback.name,
    chuc_vu: fallback.chuc_vu,
    prefix: fallback.prefix,
    show_name: allowName,
    show_chuc_vu: allowChucVu,
    show_prefix: allowPrefix,
  }
}

// ── Khung "Ghi chú": ô ý kiến chỉ đạo + chữ ký nháy ──────────────────────────

/** Trần tuyệt đối (pt) của khối chữ ký nháy — khung Ghi chú thường rất rộng, không để ảnh to. */
const KY_NHAY_MAX_W = 64
const KY_NHAY_MAX_H = 26

/** Vị trí mặc định của chữ ký nháy: góc trên-phải khung Ghi chú. */
export function defaultKyNhayRect(box: { x: number; y: number; width: number; height: number }): LayoutRect {
  const width = Math.min(box.width * 0.32, KY_NHAY_MAX_W)
  const height = Math.min(box.height * 0.4, KY_NHAY_MAX_H)
  return { x: box.x + box.width - width, y: box.y + box.height - height, width, height }
}

/**
 * Bố cục mặc định khung Ghi chú — giữ ĐÚNG hành vi trước 2026-09-05: ký nháy góc trên-phải, ô
 * text chiếm phần còn lại (khung trừ dải trên) để chữ không đè lên ảnh.
 */
export function computeDefaultNoteLayout(
  box: { x: number; y: number; width: number; height: number },
  opts: { withKyNhay: boolean },
): NoteSubLayout {
  if (!opts.withKyNhay) {
    return {
      text: { x: box.x, y: box.y, width: box.width, height: box.height },
      ky_nhay: null,
    }
  }
  const kyNhay = defaultKyNhayRect(box)
  const reserveTop = kyNhay.height + 2
  return {
    text: { x: box.x, y: box.y, width: box.width, height: Math.max(box.height - reserveTop, MIN_H) },
    ky_nhay: kyNhay,
  }
}

export function sanitizeNoteSubLayout(
  incoming: unknown,
  box: TemplateNoteBox,
  opts: { kyNhayAvailable: boolean },
): NoteSubLayout | null {
  if (!incoming || typeof incoming !== "object") return null
  const raw = incoming as Record<string, unknown>
  const fallback = computeDefaultNoteLayout(box, { withKyNhay: opts.kyNhayAvailable })
  return {
    text: clampRectToBox(readRect(raw.text) ?? fallback.text, box),
    ky_nhay: opts.kyNhayAvailable
      ? clampRectToBox(readRect(raw.ky_nhay) ?? fallback.ky_nhay ?? fallback.text, box)
      : null,
  }
}

/** Ghép bố cục Ghi chú vào entry `placement_ky.ghi_chu` (mảng theo đúng thứ tự `boxes`). */
export function applyNoteLayoutToEntry(
  entry: TemplateNotePlacement,
  incoming: unknown,
  opts: { kyNhayAvailable: boolean },
): TemplateNotePlacement {
  const list = Array.isArray(incoming) ? incoming : []
  return {
    ...entry,
    boxes: entry.boxes.map((box, i) => {
      const layout = sanitizeNoteSubLayout(list[i], box, opts)
      return layout ? { ...box, layout } : box
    }),
  }
}

export function resolveEffectiveNoteLayout(
  box: TemplateNoteBox,
  opts: { kyNhayAvailable: boolean },
): NoteSubLayout {
  const stored = box.layout
  if (stored && stored.text) {
    return {
      text: clampRectToBox(stored.text, box),
      ky_nhay: opts.kyNhayAvailable && stored.ky_nhay ? clampRectToBox(stored.ky_nhay, box) : null,
    }
  }
  return computeDefaultNoteLayout(box, { withKyNhay: opts.kyNhayAvailable })
}

// ── Khung QR ─────────────────────────────────────────────────────────────────

/**
 * QR là dữ liệu CẤP VĂN BẢN (vẽ trên mọi trang theo neo) — chỉ người ký ĐẦU TIÊN được xê dịch,
 * các bước sau dùng lại đúng vị trí đó. Mirror `mergeQrBox()` của luồng cũ ("đã có thì thôi"),
 * tránh mỗi lượt ký một vị trí QR khác nhau.
 */
export function qrLayoutAlreadySet(entry: TemplateQrPlacement | null | undefined): boolean {
  return !!entry?.boxes?.some((b) => !!b.layout)
}

export function sanitizeQrRect(incoming: unknown, box: TemplateQrBox): LayoutRect | null {
  const rect = readRect(incoming)
  if (!rect) return null
  return clampRectToBox(rect, box)
}

export function applyQrLayoutToEntry(entry: TemplateQrPlacement, incoming: unknown): TemplateQrPlacement {
  const list = Array.isArray(incoming) ? incoming : []
  return {
    ...entry,
    boxes: entry.boxes.map((box, i) => {
      const rect = sanitizeQrRect(list[i], box)
      return rect ? { ...box, layout: rect } : box
    }),
  }
}

/** Không có layout → QR chiếm trọn khung mẫu (hành vi trước 2026-09-05). */
export function resolveEffectiveQrRect(box: TemplateQrBox): LayoutRect {
  if (box.layout) return clampRectToBox(box.layout, box)
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/**
 * Tìm khung mẫu (`mau_vi_tri.khung`) tương ứng với bước ký hiện tại.
 * Dùng chung giữa frontend (`SignPlacementModal`) và backend (`api/iso/forms/[id]/finalize`).
 *
 * Quy tắc khớp:
 * 1. Bước đầu (Soạn thảo): `nhan` khớp `stepName`, hoặc `vai_tro` là `soan_thao`/`ky_buoc`/`buoc_0`.
 * 2. Bước cuối (Phê duyệt): `nhan` khớp `stepName`, hoặc `vai_tro` là `phe_duyet`/`stepKey`.
 * 3. Bước trung gian (N bước):
 *    - Lọc các khung trung gian (loại bỏ `soan_thao`, `phe_duyet`, `qr`, `ngay_ky`, `ghi_chu`).
 *    - Sắp xếp thứ tự: theo số trang -> clone index (`__banX`) -> tọa độ X (trái sang phải) -> Y.
 *    - Ưu tiên 1: `nhan` khớp `stepName` (vd nhan: "Giám sát" khớp stepName: "Giám sát").
 *    - Ưu tiên 2: `vai_tro` khớp `targetRoleKeys` (vd `xem_xet__ban2`, `ky_buoc__ban2`, `buoc_2`).
 *    - Ưu tiên 3: Vị trí tương ứng trong danh sách đã sắp xếp `intermediateBoxes[intermediateIdx]`.
 */
export function findRoleBoxForStep(
  khung: Array<Record<string, unknown>>,
  opts: {
    stepIndex: number
    totalSteps: number
    stepName?: string | null
    stepKey?: string | null
    action?: string | null
  }
): Record<string, unknown> | null {
  if (!Array.isArray(khung) || khung.length === 0) return null

  const { stepIndex, totalSteps, stepName, stepKey, action } = opts
  const isFirstStep = stepIndex === 0
  const isFinalStep = totalSteps > 0 && stepIndex + 1 >= totalSteps

  const isNonSig = (vt: string, loai?: unknown) => {
    const l = String(loai || "")
    return l === "qr" || l === "ngay_ky" || l === "ghi_chu" || vt === "qr" || vt === "ngay_ky" || vt === "ghi_chu"
  }

  const getRoleCloneIndex = (vaiTro: string): number => {
    if (vaiTro === "xem_xet" || vaiTro === "ky_buoc" || vaiTro === "soan_thao" || vaiTro === "phe_duyet") return 1
    const m = /__ban(\d+)$/.exec(vaiTro)
    if (m) return parseInt(m[1], 10)
    const b = /buoc_(\d+)$/.exec(vaiTro)
    if (b) return parseInt(b[1], 10)
    return 1
  }

  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb)

  if (isFirstStep) {
    const firstStepBoxes = khung.filter((k) => {
      const vt = String(k.vai_tro || "")
      const cloneOf = String(k.clone_of || "")
      if (isNonSig(vt, k.loai)) return false
      if (vt === "soan_thao" || vt.startsWith("soan_thao") || cloneOf === "soan_thao") return true
      if (vt === "buoc_0" || (stepKey && vt === stepKey)) return true
      if (vt === "ky_buoc" || vt.startsWith("ky_buoc") || cloneOf === "ky_buoc") return true
      return false
    })
    return (stepName ? firstStepBoxes.find((k) => k.nhan && String(k.nhan).trim().toLowerCase() === stepName.trim().toLowerCase()) : null)
      || firstStepBoxes.find((k) => k.vai_tro === "soan_thao")
      || firstStepBoxes.find((k) => (stepKey && k.vai_tro === stepKey) || (action && k.vai_tro === action))
      || firstStepBoxes[0]
      || null
  }

  if (isFinalStep) {
    const finalStepBoxes = khung.filter((k) => {
      const vt = String(k.vai_tro || "")
      const cloneOf = String(k.clone_of || "")
      if (isNonSig(vt, k.loai)) return false
      if (vt === "phe_duyet" || vt.startsWith("phe_duyet") || cloneOf === "phe_duyet") return true
      if ((stepKey && vt === stepKey) || (action && vt === action)) return true
      return false
    })
    return (stepName ? finalStepBoxes.find((k) => k.nhan && String(k.nhan).trim().toLowerCase() === stepName.trim().toLowerCase()) : null)
      || finalStepBoxes.find((k) => k.vai_tro === "phe_duyet")
      || finalStepBoxes.find((k) => (stepKey && k.vai_tro === stepKey) || (action && k.vai_tro === action))
      || finalStepBoxes[0]
      || null
  }

  // Intermediate steps: Thực hiện (idx 0), Giám sát (idx 1), etc.
  const intermediateIdx = Math.max(0, stepIndex - 1)
  const intermediateBoxes = khung.filter((k) => {
    const vt = String(k.vai_tro || "")
    const cloneOf = String(k.clone_of || "")
    if (isNonSig(vt, k.loai)) return false
    if (vt === "soan_thao" || vt.startsWith("soan_thao") || cloneOf === "soan_thao") return false
    if (vt === "phe_duyet" || vt.startsWith("phe_duyet") || cloneOf === "phe_duyet") return false
    if (vt === "xem_xet" || vt.startsWith("xem_xet") || cloneOf === "xem_xet") return true
    if (vt === "ky_buoc" || vt.startsWith("ky_buoc") || cloneOf === "ky_buoc") return true
    if ((stepKey && vt === stepKey) || (action && vt === action)) return true
    if (vt.startsWith("buoc_")) return true
    return false
  })

  // Sắp xếp: trang -> clone index -> tọa độ X (trái qua phải) -> tọa độ Y
  intermediateBoxes.sort((a, b) => {
    const pA = num(a.so_trang, 1)
    const pB = num(b.so_trang, 1)
    if (pA !== pB) return pA - pB
    const cA = getRoleCloneIndex(String(a.vai_tro || ""))
    const cB = getRoleCloneIndex(String(b.vai_tro || ""))
    if (cA !== cB) return cA - cB
    const xA = num(a.x_pt, 0)
    const xB = num(b.x_pt, 0)
    if (Math.abs(xA - xB) > 1) return xA - xB
    return num(a.y_pt, 0) - num(b.y_pt, 0)
  })

  const targetRoleKeys: string[] = []
  if (stepIndex === 1 || intermediateIdx === 0) {
    targetRoleKeys.push("xem_xet", "xem_xet__ban1", "ky_buoc", "ky_buoc__ban1", "buoc_1")
  } else {
    targetRoleKeys.push(`xem_xet__ban${stepIndex}`, `ky_buoc__ban${stepIndex}`, `buoc_${stepIndex}`)
    targetRoleKeys.push(`xem_xet__ban${intermediateIdx + 1}`, `ky_buoc__ban${intermediateIdx + 1}`)
  }
  if (stepKey) targetRoleKeys.push(stepKey)

  return (stepName ? intermediateBoxes.find((k) => k.nhan && String(k.nhan).trim().toLowerCase() === stepName.trim().toLowerCase()) : null)
    || intermediateBoxes.find((k) => targetRoleKeys.includes(String(k.vai_tro || "")))
    || intermediateBoxes[intermediateIdx]
    || intermediateBoxes[intermediateBoxes.length - 1]
    || null
}


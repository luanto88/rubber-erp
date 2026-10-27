# UI Components & Design System (bản rút gọn 2026-10-27)

Chuẩn bố cục module (danh sách / dòng xổ / chi tiết 70/30 / thao tác / bàn giao) nằm ở
`.claude/rules/29-ui-standard.md` — file này chỉ liệt kê token, component và landmine kỹ thuật.
Lịch sử đầy đủ (GĐ0–6 Doc-UI, U0–U4, Pastel Rừng Cao Su, ảnh login/sidebar):
`.claude/history/05-ui-components-history.md`.

## Nguyên tắc
- Chỉ Tailwind CSS + lucide-react, không UI library ngoài. Nội dung tiếng Việt có dấu.
- Font Plus Jakarta Sans toàn dashboard (`font-doc` ở div gốc `dashboard/layout.tsx`); mã dùng `font-code`.
- Không dùng `scroll-reveal` trên bảng/card dữ liệu/filter bar re-render (mất class `revealed`).
- Header có nhiều nút ⇒ cụm nút `flex-wrap`; mobile ≤430px không tràn ngang.

## Màu — phương án C "lai"
- Token trong `src/app/globals.css` (`@theme`): `app-bg`, thang `brand-50…900` (600 = #2f5d52, 800 = #1c3a32),
  họ `ocean-*`, `mint-*`, `moss-*`.
- **Banner** mỗi module giữ màu riêng: `PageHeaderBanner theme=…` (forest · ocean · mint · moss · amber · slate ·
  violet · rose · orange · teal · rubber).
- **Điều hướng** (tab chọn, focus ô nhập, icon thẻ số, viền dòng xổ) dùng utility `*-mod-50/200/600/800`; bọc vùng
  module bằng `moduleThemeClass(theme)` / `<ModuleThemeScope>` (`doc-ui/module-theme.tsx`, `.mod-theme-*` cuối
  globals.css, khai báo `@theme inline`). Thêm theme mới ⇒ thêm `.mod-theme-<x>` + 1 dòng `THEME_CLASS`.
- **Hành động** (nút chính, Ký ngay, link mã) LUÔN `brand-*`.
- **Trạng thái** CHỈ qua `StatusBadge` — 7 tông: valid · pending (chấm nhấp nháy) · warn · draft · danger ·
  returned · info (xanh dương).
- Nút trên banner màu đậm: nền trắng chữ `text-{theme}-700` (chính) hoặc `bg-white/15 border-white/40 text-white`.
- Không `var(--color-x)` trong style inline — literal hex hoặc class Tailwind.

## Component dùng chung (`src/app/dashboard/_components/`)
| Component | Ghi chú |
|---|---|
| `PageHeaderBanner` | `title`, `subtitle`, `theme`, `icon` (LucideIcon), `action` (JSX, tự giữ logic quyền) — render `<h1>` |
| `FilterBar` | `layout="grid"` cho mọi module mới; mobile thu gọn thành nút "Bộ lọc" + badge `activeCount` |
| `ResponsiveTableWrapper` | Bọc bảng, cuộn ngang; lồng trong card thì `className="rounded-none border-0 shadow-none"` |
| `ModalShell` | Full-screen mobile; `maxWidth`, `zIndexClassName` (modal lồng `z-[60]`), stack Escape chỉ đóng modal trên cùng |
| `FilterMultiSelect` | `fullWidth`, `searchPlaceholder` |
| `RequiredNoteSelect` | Ô ghi chú chỉ chọn từ danh mục `required_notes` (portal + fixed) |
| `QrScanButton` / `QrScanPortal` | Quét QR ở ô tìm; portal ra `document.body`; `scanKey`/`header` để quét liên tục |
| `SignStatusBadge` | Badge ký duyệt dùng chung (`continueRule`, `showProgress`, `chipOnly`, `blockedReason`) |
| `resize-handle-icon.tsx` | `ResizeHandleIcon` + `RESIZE_HANDLE_CLASS/STYLE` cho `re-resizable` |

### `doc-ui/` (`src/app/dashboard/_components/doc-ui/`)
- `status-registry.ts` — nguồn DUY NHẤT nhãn + tông trạng thái theo domain (doc, iso, form, maintenance,
  dispatch_progress, quality, purchase, inventory, export, lot, storage). Không viết span trạng thái tay.
- `action-registry.ts` + `RowAction` / `IconActionGroup` — một icon = một nghĩa (view `Eye` · signed `FileCheck2` ·
  download · draft `FileText` · print · edit `Pencil` · copy · delete; approve/cancel dạng chữ). Thứ tự xem rule 29.
- `StatGrid` / `StatCard`, `ListState` (loading/empty/error + onRetry), `SegmentedTabs`, `DocCodePill`,
  `TimelineSteps` + `TimelineProgress`, `InspectorCard` / `MetaRow` / `MetaList` / `StatusSummaryBar`.
- `ExpandableRow` (mũi tên ô cuối, `endCell`), `ExpandHeaderCell`, `ExpandAllToggle`, `DateGroupRow` / `DateGroupHead`.
- Trang chi tiết: `DetailPageHeader` + `HeaderButton`, `DetailSplitLayout` (70/30, tab mobile "Tài liệu / Ký duyệt"),
  `SignActionBox` (primary duy nhất + phụ + nguy hiểm), `HeaderQr`.
- `DocViewer` — PDF nhúng: `endpoint` (route `/file-url`, Signed URL) hoặc `loadBytes` + `sourceKey` (bản chưa ký dựng
  trong trình duyệt); `active=false` khi modal ký đang mở; pdfjs nạp `next/dynamic ssr:false`.
- `PinDialog` (chỉ trình bày, không gọi API), `SignWorkspaceShell` + `SignRail` + `SignCanvasArea` (vỏ màn ký).
- `use-is-desktop.ts`, `pdfjs-worker.ts` (`ensurePdfjsWorker` — worker local, KHÔNG CDN).
- Bảng: `<table className="enterprise-table dense min-w-[…]">` (CSS ở globals.css), `<th>` không cần class.

## Landmine kỹ thuật
- Không `filter/backdrop-filter/transform/perspective/will-change/contain` trên ancestor của overlay `position:fixed`
  (header, sidebar) — biến ancestor thành containing block, mobile sheet lệch khỏi màn hình.
- `re-resizable` phải đủ `handleComponent` + `handleClasses` + `handleStyles`; `cancel` của `<Draggable>` là
  `.resize-handle,.resize-handle *` (không phải `.react-resizable-handle`). React 19: `Draggable` dùng `nodeRef`.
- `QRCodeCanvas` tự gắn inline width/height ⇒ ghi đè `style={{width:"100%",height:"100%"}}` trong khung `aspect-square`.
- html5-qrcode: chờ `start()` xong mới `stop()`, bọc try/catch (ném chuỗi đồng bộ).
- Đọc `localStorage/sessionStorage` lúc khởi động luôn try/catch (WebView chặn). `error.tsx`/`global-error.tsx` có sẵn.
- Edit modal JSX lớn (>45 dòng, nhiều tiếng Việt) bằng Edit có thể hỏng âm thầm — tách 2 lần edit (mở tag / đóng tag).
- Tailwind JIT: class màu động `bg-${c}-100` chỉ chạy nếu tổ hợp đó đã xuất hiện literal ở nơi khác.

## Chưa quyết định
- Kéo-thả mobile: sơ đồ Kho thành phẩm, đặt chữ ký ISO (react-draggable) — hỏi người dùng hướng xử lý trước khi làm.

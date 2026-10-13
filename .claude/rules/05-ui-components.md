---
description: UI components, mau sac, animation
---

# UI Components & Design System

## Nguyen tac

- Chi dung Tailwind CSS + lucide-react
- Khong import UI library ngoai
- Component tu viet, uu tien don gian va dong nhat
- Tren web, luon dam bao noi dung hien thi bang tieng Viet co dau, dung chinh ta, ngoai tru khi nguoi dung yeu cau khac ro rang

## Component classes chuan

### Layout

```text
Filter bar:       bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center
Table container:  bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden
Card:             bg-white rounded-xl border border-slate-200 shadow-md p-4
```

### Buttons

```text
Primary:   px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all
Secondary: px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl
Danger:    bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md
Small add: flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg
```

### Inputs

```text
Input:  w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500
Select: w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500
Label:  text-xs font-bold text-slate-600 block mb-1.5
```

## Mau trang thai

- Hoan thanh / Dat: `bg-emerald-100 text-emerald-700`
- Do dang / Warning: `bg-amber-100 text-amber-700`
- Khong dat / Error: `bg-red-100 text-red-600`
- Xuat hang / Info: `bg-blue-100 text-blue-700`
- Neutral: `bg-slate-100 text-slate-600`

## Scroll reveal

`scroll-reveal` chi duoc dung tren container tinh.

Khong dung `scroll-reveal` tren:

- bang du lieu
- card list du lieu
- stats card phu thuoc state
- filter bar re-render lien tuc
- page co state dong nhieu nhu `quality`, `product`, `storage`

Ly do: React re-render de lam mat class `revealed`, gay an du lieu.

## Hover

- Row: `row-hover` hoac `transition-colors duration-200 hover:bg-gray-50`
- Card: `hover-lift` hoac `hover:shadow-md hover:scale-[1.02] transition-all duration-200`
- Button: `btn-press` hoac `active:scale-95 transition-all`

## Header page pattern

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
  <div>
    <h1 className="text-2xl font-extrabold text-slate-800">Ten Module</h1>
    <p className="text-sm text-slate-500 mt-0.5">Mo ta ngan</p>
  </div>
  <button className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
    <Plus size={16} /> Them moi
  </button>
</div>
```

Header co nhieu nut hanh dong ben phai (khong chi 1 nut) phai them `flex-wrap` cho cum nut do, tranh tran ngang tren man hinh hep.

## Component dung chung cho mobile responsive (`src/app/dashboard/_components/`)

Ba component nay da duoc ap dung xuyen suot toan bo cac module trong app (Dieu xe, Kiem nghiem, San luong, Thanh pham, Xuat hang, Bao tri, Process, Documents, Storage, Inventory, Dashboard, Chat luong, ISO, Cai dat, Kho Thanh pham...). Khi tao moi hoac sua page co bang/modal/filter bar, **uu tien dung 3 component nay thay vi tu dung lai tu dau**.

### `FilterBar`

Boc quanh cum filter (search/select/input) o dau danh sach. Tren `md:` tro len hien day du nhu filter bar cu (khong doi hanh vi desktop); duoi `md:` thu gon thanh 1 nut toggle "Bo loc" kem badge so luong filter dang active.

```tsx
import { FilterBar } from "@/app/dashboard/_components/filter-bar"

<FilterBar activeCount={[search, filterA, filterB].filter(Boolean).length}>
  <input ... />
  <select ... />
</FilterBar>
```

Props: `children`, `activeCount?` (number), `defaultOpen?` (bool, mac dinh false), `className?`.

### `ResponsiveTableWrapper`

Boc quanh `<table>` de cuon ngang an toan tren mobile thay vi vo layout, tu them gradient mo 2 ben khi con noi dung de cuon. Khong doi cau truc ben trong `<table>`.

```tsx
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"

<ResponsiveTableWrapper>
  <table className="w-full text-sm">...</table>
</ResponsiveTableWrapper>
```

Neu bang da nam san trong 1 card co border/shadow rieng (vd `bg-white rounded-xl border ... overflow-hidden`), dung `className="rounded-none border-0 shadow-none"` de tranh double-border khi long ben trong.

### `ModalShell`

Chuan hoa modal: full-screen tren mobile (khong bo goc, header/footer sticky), card giua man hinh tu `sm:` tro len.

```tsx
import { ModalShell } from "@/app/dashboard/_components/modal-shell"

<ModalShell
  title="Tieu de"
  onClose={() => setModal(null)}
  maxWidth="lg" // sm | md | lg | xl | 2xl | 3xl | 4xl | 5xl | 6xl
  footer={<><button>Huy</button><button>Luu</button></>}
>
  {/* noi dung form */}
</ModalShell>
```

Props khac: `closeOnBackdrop?` (mac dinh true), `bodyClassName?`, `zIndexClassName?` (mac dinh `"z-50"` — dung khi can modal long, vd `"z-[60]"` cho modal mo tren 1 modal khac dang mo), `backdropClassName?` (mac dinh `"bg-black/50"` — dung khi can nhan manh thao tac nhay cam nhu xac thuc mat khau/PIN/OTP, vd `"bg-slate-950/50"`).

**Da fix (2026-07-04)**: `ModalShell` dung `useId()` + mot module-level stack (`modalStack`, mang thu tu mount, phan tu cuoi = modal tren cung) de chi modal tren cung phan hoi phim Escape. Moi instance dang ky vao stack luc mount, go khoi stack luc unmount (effect rieng, chi phu thuoc `id` nen khong chay lai moi lan `onClose` doi identity). Listener Escape chi goi `onClose` neu `modalStack[modalStack.length - 1] === id`. Da verify thuc te: modal A mo modal B long ben tren (vd cau hinh xe -> "+ Them tai xe"), nhan Escape lan 1 chi dong B, lan 2 moi dong A; truong hop 1 modal don van dong binh thuong o lan Escape dau (khong regressions). Khong can sua o tung noi goi `<ModalShell>`.

### Ky thuat chuyen doi modal cu sang `ModalShell` an toan voi file lon

Voi modal co noi dung than (giua header va footer) vuot qua ~45 dong, KHONG thay the toan bo block bang 1 lan `Edit` — Edit tool co the fail silently tren block JSX lon (~45+ dong, nhieu tieng Viet) ma van bao "thanh cong". Chia thanh 2 lan edit rieng:

1. Edit dau: thay doan mo dau (tu `{flag && (` den het header) bang tag mo `<ModalShell title=... onClose=... footer={...}>`. Neu footer o qua xa (vai tram dong), khai bao truoc noi dung footer thanh 1 bien const `const xFooter = (...)` dat ngay truoc `return (` chinh cua component, roi tham chieu `footer={xFooter}`.
2. Edit sau: xoa doan footer/dong cu (da duoc chuyen vao footer prop hoac bien const o buoc 1), dong lai bang `</ModalShell>`.

Phan noi dung than (giua 2 edit nay) khong bi dung tay vao, du dai bao nhieu.

## Pastel Rừng Cao Su (design tokens + banner theme cho Dashboard)

Token khai báo trong `src/app/globals.css` (khối `@theme`, Tailwind v4 CSS-first — không có
`tailwind.config.*`, mỗi `--color-X` tự sinh class `bg-X`/`text-X`/`border-X`...):

- `--color-app-bg` (`#f2f8f5`) — nền trang, dùng ở `<body>` (`src/app/layout.tsx`).
- `--color-brand` (`#2f5d52`) / `--color-brand-deep` (`#1c3a32`) — "forest", dùng cho sidebar
  (`bg-brand` trong `dashboard/layout.tsx`) và widget Sản lượng trên Dashboard.
- `--color-ocean-50/100/500/600/700` (`#e3f0fb`→`#144171`) — dùng cho widget Xuất hàng + Điều
  xe trên Dashboard (2 widget riêng, chỉ dùng chung tông màu để đọc như 1 cặp, không gộp DOM).
- `--color-mint-50/100/500/600/700` (`#eafbf5`→`#1f6a58`) — dùng cho widget Chất lượng trên
  Dashboard.

**Phạm vi áp dụng hiện tại** (đã triển khai thật, không phải dự kiến): khung sườn (sidebar/
header, luôn `bg-brand`) + đúng 3/8 khu vực của `src/app/dashboard/page.tsx` (Sản lượng, Xuất
hàng + Điều xe, Chất lượng) qua `WidgetCard`'s `theme` prop, **cộng thêm** banner header đầu
trang (chỉ `<h1>`/subtitle/action, không đụng phần còn lại của trang) của 4 trang module thật —
`dispatch/page.tsx` (ocean), `export/page.tsx` (ocean), `quality/page.tsx` (mint),
`eudr/EudrClient.tsx` (moss) — qua component riêng `PageHeaderBanner` (xem mục ngay dưới). Các
khu vực còn lại của Dashboard (Kho & Thành phẩm, Cảnh báo, Việc cần làm, Ghi chú), phần thân
của 4 trang module trên (nút chính/filter/bảng bên dưới header), và mọi trang module khác
(ISO, Bảo trì, KPI, Cài đặt...) cố ý giữ nguyên màu cũ.

### `WidgetCard` theme convention (`src/app/dashboard/_components/widgets/widget-shared.tsx`)

Muốn 1 widget Dashboard mới có banner màu theo theme, truyền thêm 2 prop:

```tsx
<WidgetCard title="..." subtitle="..." theme="forest" icon={Droplet}>
```

`theme` nhận `"forest" | "ocean" | "mint"`; `icon` là 1 component `LucideIcon` (không phải
element đã render) — component tự vẽ icon nhỏ trong vòng tròn cạnh tiêu đề lẫn icon lớn mờ làm
hoa văn nền, không cần truyền 2 icon riêng. Không truyền `theme` → giữ nguyên header trắng
phẳng như cũ, không ảnh hưởng các widget hiện có.

Nếu 1 widget có tile/stat-box muốn thêm hoa văn nhẹ khớp theme (không phải banner), dùng hằng
số className dùng chung `TILE_PATTERN_FOREST`/`TILE_PATTERN_OCEAN` export từ cùng file — tự
chứa trong Tailwind arbitrary-value (`before:[background-image:...]`), không cần thêm CSS toàn
cục. Chỉ cộng thêm vào className hiện có của tile, không thay `bg-*-50` gốc của tile đó.

### `PageHeaderBanner` — banner header cấp trang (khác `WidgetCard`)

`src/app/dashboard/_components/page-header-banner.tsx` — dùng cho header đầu các **trang
module thật** (không phải widget Dashboard). Tách file riêng khỏi `WidgetCard` có chủ đích
(file đó tự ghi rõ "chỉ dùng cho widget Dashboard") — không import chéo.

```tsx
<PageHeaderBanner
  title="Điều xe"
  subtitle="Bảng phân xe thu mủ hằng ngày"
  theme="ocean" // "ocean" | "mint" | "moss"
  icon={Truck}
  action={<button ...>...</button>}
/>
```

- Render `<h1>` (không phải `<h2>` như `WidgetCard`) — đúng ngữ nghĩa heading cấp trang.
- `action` nhận nguyên khối JSX (kể cả logic `hasPermission(...)` ẩn/hiện có sẵn) — component
  không tự quyết định hiện nút nào, chỉ định vị trí render bên phải.
- 3 theme hiện có: `ocean` (Điều xe, Xuất hàng), `mint` (Chất lượng), `moss` (EUDR — dùng
  `--color-moss-*`, giá trị đúng theo mockup, không có bản `earth` vì banner luôn chữ trắng
  trên nền màu, không cần token cho chữ-trên-nền-sáng).
- Nút bên trong banner (action) phải tự đổi màu cho hợp nền màu — nút nền trắng dùng
  `text-{theme}-700` (vd `text-ocean-700`), nút phụ dùng kiểu trong suốt
  `bg-white/15 hover:bg-white/25 border-white/40 text-white`. Không giữ nguyên màu nút gốc
  (`border-slate-300`, `bg-emerald-600`...) vì sẽ chìm/lệch tông trên nền banner màu.
- Phạm vi cố ý dừng ở header — không lan xuống nút chính/filter bar/bảng dữ liệu bên dưới của
  trang (xem "Phạm vi áp dụng hiện tại" phía trên). Muốn mở rộng thêm phải hỏi lại người dùng.

### Ảnh thật + hiệu ứng mờ dần (2026-08-24, tiếp) — nền tảng cho `/login` và sidebar dashboard

Đã thay thế minh hoạ SVG rừng cao su vẽ tay bằng **ảnh chụp thật** (chủ đề cạo mủ cao su) ở 2
nơi mang tính "khung sườn" của toàn app — trang đăng nhập (`src/app/login/page.tsx`) và sidebar
dashboard (`src/app/dashboard/layout.tsx`). Quy trình bắt buộc đã áp dụng và nên lặp lại cho các
lần thêm ảnh thật tương tự sau này: dựng file HTML tĩnh tham khảo trong `cung_cap_dl/` trước
(`thiet_ke_dang_nhap_moi.html`, `thiet_ke_sidebar_moi.html`), lặp chụp screenshot bằng
`npx playwright screenshot` để tự đối chiếu với ảnh mockup gốc, người dùng duyệt xong mới áp
dụng vào code thật.

**Asset gốc**: `public/login-bg-forest.jpg`, `public/sidebar-bg-forest.jpg` (copy từ
`cung_cap_dl/r1.jpg`/`r2.jpg`), `public/badges/iso-9001.png`, `iso-14001.png`, `iso-14067.png`
(logo chứng nhận thật, copy từ `cung_cap_dl/9001_2015.png`/`14001_2015.png`/`14067_2018.png`).

**Kỹ thuật "ảnh lấn dần rồi mờ vào nền"** — kỹ thuật chính, dùng `mask-image`/`-webkit-mask-image`
với `linear-gradient` để ảnh chụp thật hoà dần vào nền pastel thay vì cắt bằng cạnh cứng
(border-radius/clip-path đã thử và bị loại vì trông giả tạo — xem lịch sử quyết định ở
`.claude/plans/xem-logic-c-i-ti-n-rustling-avalanche.md` nếu cần đối chiếu). Áp dụng khác nhau
theo hướng:

- **Ngang** (trang đăng nhập, cột trái lấn sang phải): `mask-image: linear-gradient(to right,
  #000 0%, #000 52%, rgba(0,0,0,.55) 68%, transparent 92%)` trên 1 wrapper riêng chứa
  `<Image fill>` + lớp scrim gradient màu `--color-brand-deep` + hoa văn rãnh cạo mủ hiện có.
  Container ảnh rộng hơn hẳn phần nội dung text hiển thị (`w-[58%]` chứa ảnh, nhưng
  `.left-content`/text bên trong chỉ giới hạn `max-width` nhỏ hơn, vd `540px`) — để vùng mờ dần
  luôn nằm ở khoảng trống giữa 2 cột, không đè lên chữ.
- **Dọc** (sidebar, ảnh bám đáy mờ dần lên trên): `mask-image: linear-gradient(to top,
  rgba(0,0,0,.95) 0%, rgba(0,0,0,.85) 28%, rgba(0,0,0,.35) 62%, transparent 100%)` trên 1 wrapper
  `absolute inset-x-0 bottom-0 h-[52%]` (không phải `fixed` — tránh landmine containing-block đã
  ghi ở `.claude/rules/24-notification-bell-module-tasks.md`), đặt sau lớp hoa văn hiện có, dùng
  chung `-z-10` để nằm sau `<nav>`.
- Luôn kèm 1 lớp scrim gradient màu thương hiệu (`linear-gradient(...)` với giá trị **literal
  rgba**, không dùng `var(--color-x)` trong style — bài học 2026-08-24 mục 6) phía trên ảnh để
  chữ trắng vẫn đọc rõ trên vùng ảnh còn đậm.

**Card đăng nhập** — các yếu tố mới đã trở thành pattern chuẩn cho form card kiểu này: avatar
tròn nổi lên mép trên card (`-top-8`, gradient `linear-gradient(135deg,#3fae66,#1f8a4c)` literal
hex), divider ngắn có icon `Leaf` ở giữa, input nền kem (`border-[#f0e2b8] bg-[#fdf3d9]`) kèm
icon prefix bên trái (`User`/`Lock`/`Building2` từ lucide-react, `absolute left-3.5`), toggle
ẩn/hiện mật khẩu (`Eye`/`EyeOff`), hàng "Ghi nhớ đăng nhập"/"Quên mật khẩu?" **chỉ là UI tĩnh**
(không có logic auth thật — nếu module khác cần bật thật, đó là quyết định nghiệp vụ riêng, hỏi
lại người dùng), 3 badge chứng nhận ISO dùng ảnh logo thật (không phải icon generic) crop bằng
`backgroundSize`/`backgroundPosition` để chỉ lộ phần dấu hiệu tròn, và hàng cam kết thương hiệu 4
mục cuối trang.

**Mobile giữ nguyên, không đụng**: `src/app/login/page.tsx` cố ý giữ handbrake nguyên bản thiết
kế gradient + SVG cũ ở `<lg` (class `lg:hidden` trên block cũ, `hidden lg:block` trên block ảnh
mới) — chỉ desktop (`lg:` trở lên) dùng ảnh thật + mask fade. Lý do: kỹ thuật overlap-mask dùng
`position: absolute` cho toàn bộ layout 2 cột, không tương thích tự nhiên với flex-col stacking
trên mobile; tách nhánh theo breakpoint an toàn hơn là viết lại toàn bộ responsive logic. Card
form (avatar/divider/input kem/badge/cam kết) là markup DÙNG CHUNG cho cả mobile và desktop —
chỉ phần nền/branding bên trái khác nhau theo breakpoint.

**Khi mở rộng "ảnh thật + mờ dần" sang module khác**: tái dùng đúng công thức mask-image ở trên,
không tự nghĩ lại cạnh cong/clip-path mới. Luôn dựng HTML tham khảo trong `cung_cap_dl/` trước,
duyệt bằng screenshot rồi mới sửa code — quy trình này giờ là chuẩn cho mọi thay đổi UI lớn có
ảnh thật, không riêng gì 2 màn hình này.

### Con lai chua lam (kho khan-tha kien va dat chu ky/QR ISO)

Hai khu vuc dung ky thuat drag-and-drop HTML5 chua duoc lam mobile-friendly, theo dung quyet dinh cua nguoi dung ("de sau, chua quyet dinh huong xu ly"):

- So do Kho Thanh pham (keo kien vao o luu, keo lo vao khung) — `src/app/dashboard/warehouse/_components/warehouse-floor-plan.tsx`, `warehouse-frame.tsx`, `warehouse-slot-cell.tsx`, va cac drag handler trong `lot-panel.tsx`/`warehouse/page.tsx`.
- Dat chu ky/QR tren PDF cho ISO — `SignPlacementModal` trong `iso/forms/[id]/page.tsx` va inline tuong duong trong `iso/documents/[id]/page.tsx` (dung `react-draggable` + `re-resizable` + pdfjs canvas).

Khong tu y dung guard "chi desktop" hay dau tu touch-drag khi chua hoi lai nguoi dung huong xu ly cu the.

## Doc-UI (ISO + Văn bản + màn ký số) — 2026-10-13

Kế hoạch đầy đủ 7 giai đoạn: `C:\Users\Software\.claude\plans\nh-gi-k-ho-ch-scalable-dahl.md`.
Bố cục theo mẫu `previews/enterprise-iso-vanban-unified-preview.html`, **màu theo token brand**
(không dùng thang xanh Tailwind của mẫu). Đã xong GĐ0 (nền tảng) + GĐ1 (shell + trang danh sách).

- Token: thang `brand-50…900` trong `@theme` (600 = brand #2f5d52, 800 = brand-deep #1c3a32),
  `--font-doc` (Plus Jakarta Sans) / `--font-code` (JetBrains Mono). Font chỉ áp qua class
  `font-doc` ở `documents-shell.tsx` / `iso-shell.tsx`, không đổi `body`.
- Banner 2 module: `PageHeaderBanner theme="rubber"`. **Không** sửa theme `forest`
  (#093719→#166534, Sản lượng/Thành phẩm đang dùng).
- Bảng: `<table className="enterprise-table">` (CSS ở globals.css) — `<thead>`/`<th>` không cần class.
- Component dùng chung `src/app/dashboard/_components/doc-ui/`:
  - `status-registry.ts` — nguồn DUY NHẤT nhãn + tông trạng thái (`DOC_STATUS`, `ISO_STATUS`,
    `FORM_STATUS`). `TRANG_THAI_LABEL/COLOR` (documents-types, iso-types) và
    `FORM_INSTANCE_STATUS_*` giờ là alias đọc từ đây — sửa nhãn/màu ở registry.
  - `StatusBadge` (`domain`+`status` hoặc `tone`+`label`), `DocCodePill`, `SegmentedTabs`
    (tab module dạng link, tab lọc, bộ chọn), `IconAction`/`IconActionGroup` (32px, xám khi
    nghỉ, màu theo tone khi hover, luôn có `aria-label`), `TimelineSteps` + `TimelineProgress`,
    `InspectorCard` / `MetaRow` / `MetaList` / `StatusSummaryBar`.
  - Hồ sơ thực hiện ISO: `iso/_components/form-status-badge.tsx` (`FormStatusBadge`, nhãn động
    theo luồng N bước) — thay 3 bản `StatusBadge` copy cũ.
- Màu trạng thái giữ đúng mẫu (valid xanh lá, pending amber có chấm nhấp nháy, draft xám, danger
  đỏ, returned hồng). Mọi chỗ còn lại của 2 module dùng `brand-*`, không dùng `emerald-*`.
- Code mới ở 2 module: không viết span trạng thái tay, không tô màu nút icon khi nghỉ.
### GĐ2 — trang chi tiết 70/30 (2026-10-13, đã xong)

- Component mới trong `doc-ui/`:
  - `DetailSplitLayout({ header, banners, document, inspector })` — cột tài liệu ~70% + bảng điều
    khiển ~30% (`lg:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]`, inspector sticky). Dưới `lg`
    là tab "Tài liệu / Thông tin" (mặc định Thông tin), ẩn bằng `hidden`, KHÔNG unmount.
  - `DetailPageHeader` + `HeaderButton` — nút quay lại, tiêu đề, `DocCodePill`, chip phụ, nút file.
    Cố ý không có badge trạng thái: trạng thái chỉ hiện 1 lần ở `StatusSummaryBar`.
  - `SignActionBox({ primary, secondary, danger })` — nút chính gradient brand, nút phụ, nút đỏ;
    mobile thêm thanh cố định ở đáy (nút chính + "…" mở bottom-sheet các nút còn lại).
- Áp dụng: `documents/[id]`, `iso/forms/[id]` dùng `DetailSplitLayout`. `iso/documents/[id]` CHỈ
  chế độ xem (`!isNew && !isEditMode`) dùng 70/30 (tự dựng tab mobile bằng state `mobilePane`
  vì cột phải còn nhiều khối nhập liệu); tạo mới / chỉnh sửa giữ bố cục `lg:grid-cols-3` cũ và
  hành động ký hiện trên header.
- Hành động ký được gom thành mảng `SignAction` ngay trước `return` của từng trang — **giữ nguyên
  onClick và cờ quyền cũ**. Thêm nút mới thì thêm vào mảng, không viết nút tay.
- Timeline: cả 3 trang dùng `TimelineSteps` + `TimelineProgress` (đã xoá 2 bản `TimelineStep`,
  `InfoRow`, `WorkflowStepper` local). Màu bước: Văn bản / hồ sơ thực hiện dùng `getKyBuocColor`
  + `ROLE_COLORS.phe_duyet`; tài liệu ISO dùng `ISO_STEP_COLORS` (`template-colors.ts`, bản sao có
  chủ đích của `ISO_ROLE_COLORS` trong `templates.ts` — file đó không import được ở client).
- `detail-view-ui.tsx`: tone `emerald` giờ hiển thị theo brand (giữ làm alias), thêm tone `brand`;
  highlight `rose`/`violet` đã ra đúng màu. File này chỉ 3 trang chi tiết dùng.
- Thân 3 trang đã đổi `emerald-*` → `brand-*`. Còn lại có chủ đích: các modal ký / đặt vị trí
  (GĐ5), icon file Excel, màu trạng thái.
- Kho của tôi: route `api/iso/distribute/track` nhận `itemType` ("document"|"form"), trả mốc
  `first_viewed_at`/`first_downloaded_at`; trang cập nhật ngay dòng đó. Mục do chính người xem
  tạo/ký (`recipientId` bắt đầu `owner-`) hiện chip "Tài liệu của bạn", không gọi track.
- Chưa làm: GĐ3 khung xem PDF nhúng, GĐ4 hộp PIN chung, GĐ5 vỏ màn ký chung, GĐ6 trang xác
  thực + mobile.

### GĐ3 — khung xem PDF nhúng + sửa bố cục sau test tay (2026-10-13, chưa test tay)

- `doc-ui/doc-viewer.tsx` (`DocViewer`, vỏ) nạp `doc-viewer-impl.tsx` bằng `next/dynamic` +
  `ssr:false` — pdfjs chỉ có ở client. Props: `endpoint` (route `/file-url`), `kind`
  (`pdf`|`office`|`none`), `label` (nhãn file, KHÔNG lặp tên tài liệu), `fileExt`, `variants`/
  `variant`/`onVariantChange`, `active`.
- `active=false` → chỉ khung giữ chỗ, KHÔNG mount phần thân. Trang tính
  `active = (useIsDesktop() || tabMobile === "doc") && !<modal ký đang mở>` ⇒ không render pdfjs
  2 lần cùng modal ký; ký xong khung tự nạp lại (thêm `key={fileUrl}`).
- Phần thân tải TRỌN file 1 lần (`fetchSecureUrl` → `fetch` → `arrayBuffer` →
  `getDocument({data})`) để Signed URL hết hạn không làm hỏng trang render sau; 400/401/403 → xin
  URL mới đúng 1 lần. Worker local (`new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url)`).
  Render dần bằng IntersectionObserver, hủy `RenderTask` khi đổi zoom. Toàn màn hình dùng
  Fullscreen API, không có thì lớp phủ `fixed inset-0 z-[60]` (Esc đóng). DOCX/XLSX → thẻ "Mở file".
- `doc-ui/use-is-desktop.ts` (`useIsDesktop`, ≥1024px). `DetailSplitLayout` nhận thêm
  `mobileTab`/`onMobileTabChange` (tuỳ chọn).
- Quy ước bố cục 3 trang chi tiết: Xem/Tải/Phân phối/QR CHỈ ở header (thanh công cụ khung xem không
  có nút tải); `DetailFileCard` không còn dùng ở chế độ xem; inspector = thanh Trạng thái (không
  `meta`, trừ "Văn bản ký tay") → Hành động ký → Tiến trình; thẻ Thông tin bỏ Số hiệu/Mã (đã ở
  header) và chip "✓ Đã duyệt". Hồ sơ thực hiện: "Thay file" chuyển vào Hành động ký, ô "Tự chuyển
  PDF" nằm dưới khung xem; bỏ thêm "Biểu mẫu gốc" (trùng dòng phụ header).
- ISO tài liệu: state `viewVariant`; tab variant trên thanh công cụ; nút mắt ở thẻ "Tài liệu soát
  xét" (chế độ xem) đổi file trong khung thay vì mở tab; Xem/Tải ở header theo variant đang xem.
- `SignActionBox`: nút phụ + nút nguy hiểm chung 1 lưới 2 cột, số lẻ → nút cuối trải cả hàng.
- Còn lại: modal đặt vị trí `iso/documents/[id]` nạp worker từ CDN (GĐ5); khung xem chưa xem trước DOCX.
- QR header đồng bộ 3 trang: `doc-ui/header-qr.tsx` (`HeaderQr value code title`) — bấm phóng to,
  tải PNG/JPG (QR nền trắng + mã tài liệu bên dưới). URL: Văn bản `/dashboard/documents/{id}`,
  ISO tài liệu `recordUrl`, Hồ sơ `/dashboard/iso/forms/{id}` (khớp QR in trên PDF). Bỏ nút
  "Làm mới" ở header Hồ sơ thực hiện (trang tự nạp lại sau mỗi thao tác).

### Sửa sau test bản 18304ec (2026-10-13)

- `HeaderQr`: `QRCodeCanvas` tự gắn inline `width/height = size` (thắng mọi class) ⇒ phải ghi đè bằng
  `style={{ width: "100%", height: "100%" }}` trong khung `aspect-square`. Canvas gốc vẫn 512px cho ảnh tải về.
  Trên mobile nút QR là nút đầy đủ "Mã QR" (từ `sm:` là ô vuông 36px).
- `DetailPageHeader`: cụm actions mobile = lưới 2 cột đều, số nút lẻ thì nút cuối trải 2 cột; từ `sm:` 1 hàng
  căn phải. Nút tự viết đặt trong `actions` phải có `w-full justify-center sm:w-auto` (như `HeaderButton`).
- `SignActionBox`: **đã bỏ thanh cố định ở đáy mobile** (trùng nút + spacer `h-16` để lại khoảng trống giữa
  các thẻ inspector). Thẻ "Hành động ký" là nơi duy nhất có nút ký. Prop `mobileBar` không còn.
- `StatusSummaryBar` có prop `badge` thay badge mặc định — hồ sơ thực hiện truyền `FormStatusBadge` (nhãn động
  N bước), không dùng thêm `headline` cùng ý (từng ra "Bản nháp" + "Nháp").
- Tab mobile của trang chi tiết: **"Tài liệu / Ký duyệt"** (không còn "Thông tin" — trùng chữ với thẻ
  "Thông tin hồ sơ/văn bản" nằm ở tab Tài liệu).
- `iso/documents/[id]` chế độ XEM: đã bỏ 3 thẻ "Thông tin Phê duyệt & Nhân sự", "Ghi chú & Chi tiết bổ sung",
  "Thông tin hiệu lực" (trùng Tiến trình ký / thẻ Trạng thái). `renderValidityInfoCard` vẫn dùng ở sidebar
  tạo mới/chỉnh sửa. Thẻ thông tin đổi tên "Thông tin tài liệu" / "Thông tin hồ sơ" (trước ghi nhầm "văn bản").

### GĐ4 — hộp nhập PIN dùng chung (2026-10-13)

- `doc-ui/pin-dialog.tsx` (`PinDialog`) — CHỈ trình bày: không gọi API, không giữ PIN. Trang gọi giữ
  `pin`/`pinError`/cờ bận và truyền `onConfirm` (logic xác thực/ký không đổi). Ô PIN tự lọc chữ số,
  tối đa 6, nút ẩn/hiện (state nội bộ), Enter = xác nhận; `busy` khoá nút và chặn đóng hộp.
  `children` = nội dung TRÊN ô PIN (vd ô lý do), `after` = DƯỚI ô PIN (ghi chú, tiến độ ký).
- 4 nơi đã chuyển: Văn bản (bước 1 `SignPlacementModal`), Tài liệu ISO (`pinModal` + ô lý do trả
  về/từ chối), Hồ sơ thực hiện (bước 1 `SignPlacementModal`), ký hàng loạt ISO
  (`iso-batch-sign-modal.tsx`, `zIndexClassName="z-[60]"` vì nằm trên overlay z-50).
- Code mới cần nhập PIN ở 2 module này dùng `PinDialog`, không tự dựng ô PIN.

### Sửa sau test GĐ4 + GĐ5 vỏ màn ký chung (2026-10-13)

- **Trả về / Từ chối / Không phê duyệt KHÔNG cần PIN, lý do BẮT BUỘC** ở cả 3 nơi (ISO tài liệu dùng
  `ModalShell` riêng `returnModal` + `handleReturnConfirm`, Văn bản server trả 400 khi `ly_do` rỗng,
  Hồ sơ thực hiện vốn đã bắt buộc). `doTransition(action, null, ...)` bỏ qua ký Office khi token null.
- **Chức vụ LUÔN trên Tên**: `template-layout.ts` ép `chucVuPosition = "above"` (bỏ qua dữ liệu
  `below` cũ); đã gỡ công tắc thứ tự ở `ky/mau-vi-tri` và modal ISO tài liệu. Mẫu tắt Tên/Chức vụ ⇒
  khối mất hẳn trên màn ký (ISO tài liệu thêm `allowName/allowChucVu` vào `placementModal`).
- **QR luôn vuông**: UI khoá tỉ lệ (`lockAspectRatio` + chỉ góc chéo; mau-vi-tri tính theo px trang),
  server vẽ qua `squareRect()` (template-layout.ts) — khung cũ hình chữ nhật cũng in vuông, canh giữa.
- **Đóng dấu PDF trước khi đổi trạng thái** (ISO `gui_xem_xet`/`gui_phe_duyet`/`gui_lai_phe_duyet`):
  `generateSignedPdfs()` lỗi ⇒ dừng, không chuyển "chờ xem xét". Nguyên nhân bug NMCB-QT77: lượt ký của
  Nguyễn Hữu Thọ ghi log `gui_xem_xet` nhưng KHÔNG có dòng `generate_pdf` (ảnh chữ ký vẫn đúng chỗ).
  generate-pdf trả thêm `sigImgMissingNames` / `pageOutOfRangeNames` (trước đây bỏ qua im lặng).
- **Khung xem tài liệu ISO** có tab cho từng hồ sơ con (`viewVariant = "child:<id>"`, endpoint theo id con).
- **Không còn trang công khai khi chưa đăng nhập**: `dashboard/layout.tsx` luôn `/login?next=<path+query>`
  (bỏ `isoPublicFallbackFor`). QR đã in vẫn chạy (URL không đổi) nhưng phải đăng nhập. `/iso-doc/[id]`
  còn file nhưng không còn được chuyển hướng tới.
- **GĐ5 — `doc-ui/sign-workspace-shell.tsx`**: `SignWorkspaceShell` (topbar brand + Đóng, `notice`,
  `rail`, children, `footer`), `SignToolbarButton`, `SignPageNav`, `SignRail`, `SignRailThumb`
  (`accentColor` = màu vai trò), `SignCanvasArea` (khung trang dùng `relative w-max mx-auto`, KHÔNG flex
  căn giữa), `SignFooterActions`. Áp cho cả 4 màn: SignPlacementModal Văn bản + Hồ sơ thực hiện, modal
  đặt vị trí ISO tài liệu (giờ có nút Đóng/Hủy, Xác nhận ở footer), màn ký hàng loạt ISO (rail nhóm theo
  tài liệu + drawer mobile giữ nguyên bên trong). Chỉ đổi vỏ — toạ độ/kẹp khung/payload không đổi.
- **`doc-ui/pdfjs-worker.ts` `ensurePdfjsWorker(pdfjsLib)`** — worker luôn từ gói đã cài; đã bỏ worker
  CDN ở modal ISO tài liệu. (Màn ký hàng loạt còn `cMapUrl` CDN — chưa đổi.)

### Vá sau test GĐ5 + GĐ6 (2026-10-13)

- **Bước Soạn thảo ISO dùng `IsoBatchSignModal`** (cùng màn với Xem xét/Phê duyệt): rail trái liệt kê
  cả bộ, thumbnail có khung, chức vụ trên tên, 1 lần PIN. Helper `openSignStep()` ở
  `iso/documents/[id]`: bộ có PDF → màn ký tập trung; bộ chỉ DOCX/XLSX → `PinDialog` (handlePinConfirm
  tự chuyển trạng thái). Modal đặt vị trí cũ chỉ còn là nhánh dự phòng `fallbackTask`.
  Ở bước Soạn thảo modal đọc file GỐC (`file-url?source=original`), không hiện chữ ký vòng trước.
- `IsoBatchSignModal` bỏ `cMapUrl` CDN (từng ghim pdfjs 5.4.449, lệch bản cài 5.7.284) — như DocViewer.
- **Chống màn trắng**: `src/app/error.tsx` + `global-error.tsx` (`AppErrorView`: thông điệp lỗi, Tải
  lại, Mở bằng trình duyệt ngoài). Mọi truy cập `localStorage/sessionStorage` lúc khởi động bọc
  try/catch (`supabase.ts` rơi về bộ nhớ RAM; `auth.ts`, `customer-portal-i18n.ts`, layout). Code mới
  đọc storage ở luồng khởi động PHẢI bọc try/catch — WebView Telegram/Zalo có thể ném SecurityError.
- `OpenExternalBrowser` (`src/app/_components/`, `src/lib/in-app-browser.ts`): banner ở /login khi mở
  trong Telegram/Zalo/Facebook/WebView — "Mở bằng Chrome" (intent:// Android) + Sao chép link.
- **GĐ6 trang công khai**: `PublicDocShell` (`src/app/_components/public-doc-shell.tsx`, dải brand +
  `font-doc` + `bg-app-bg`) cho `/van-ban-verify/[logId]` (GIỮ CÔNG KHAI — người dùng chốt) và
  `/iso-doc/[id]`; nội dung dùng `StatusBadge` / `DocCodePill` / `InspectorCard` + `MetaRow`.
  Link "Đăng nhập" ở `/iso-doc` → `/login?next=/dashboard/iso/documents/{id}`.

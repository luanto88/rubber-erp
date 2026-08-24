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

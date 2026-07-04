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

### Con lai chua lam (kho khan-tha kien va dat chu ky/QR ISO)

Hai khu vuc dung ky thuat drag-and-drop HTML5 chua duoc lam mobile-friendly, theo dung quyet dinh cua nguoi dung ("de sau, chua quyet dinh huong xu ly"):

- So do Kho Thanh pham (keo kien vao o luu, keo lo vao khung) — `src/app/dashboard/warehouse/_components/warehouse-floor-plan.tsx`, `warehouse-frame.tsx`, `warehouse-slot-cell.tsx`, va cac drag handler trong `lot-panel.tsx`/`warehouse/page.tsx`.
- Dat chu ky/QR tren PDF cho ISO — `SignPlacementModal` trong `iso/forms/[id]/page.tsx` va inline tuong duong trong `iso/documents/[id]/page.tsx` (dung `react-draggable` + `re-resizable` + pdfjs canvas).

Khong tu y dung guard "chi desktop" hay dau tu touch-drag khi chua hoi lai nguoi dung huong xu ly cu the.

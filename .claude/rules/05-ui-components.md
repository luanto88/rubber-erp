---
description: UI components, màu sắc, animation — dùng khi thiết kế hoặc sửa giao diện
---

# UI Components & Design System

## Nguyên tắc

- Chỉ dùng **Tailwind CSS** + **lucide-react**
- Không import thư viện UI ngoài (shadcn, MUI, Antd...)
- Tất cả component tự viết inline

## Component classes chuẩn

### Layout containers
```
Page wrapper:     (div, không cần wrapper đặc biệt)
Stats grid:       grid grid-cols-N gap-3 mb-6
Filter bar:       bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center
Table container:  bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden
Card grid:        grid grid-cols-3 gap-4
```

### Cards

**Chuẩn card:** `bg-white rounded-xl border border-slate-200 shadow-md p-4`

```
Stats card:   bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center
Content card: bg-white rounded-xl border border-slate-200 shadow-md p-4
```

**Quy tắc bắt buộc trong card:**
1. **Header gradient nhẹ** — dùng `bg-gradient-to-r` để phân biệt header với body
2. **Icon + label** — mỗi trường thông tin phải có icon lucide-react kèm label
3. **Value đậm hơn label** — label: `text-xs text-slate-500`, value: `text-sm font-semibold text-slate-800`
4. **Phân cách hàng bằng border-dashed** — dùng `border-b border-dashed border-slate-200` giữa các hàng

**Pattern chuẩn cho content card:**
```tsx
<div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden hover-lift">
  {/* Header gradient */}
  <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
    <IconName size={16} className="text-emerald-600" />
    <span className="font-bold text-slate-700 text-sm">Tiêu đề card</span>
  </div>
  {/* Body */}
  <div className="p-4 space-y-0">
    <div className="flex items-center gap-2 py-2 border-b border-dashed border-slate-200">
      <IconField size={14} className="text-slate-400 shrink-0" />
      <span className="text-xs text-slate-500 w-28 shrink-0">Label</span>
      <span className="text-sm font-semibold text-slate-800">Value</span>
    </div>
    {/* last row: không có border-b */}
    <div className="flex items-center gap-2 py-2">
      <IconField size={14} className="text-slate-400 shrink-0" />
      <span className="text-xs text-slate-500 w-28 shrink-0">Label</span>
      <span className="text-sm font-semibold text-slate-800">Value</span>
    </div>
  </div>
</div>
```

**Gradient header theo màu module:**
```
Mặc định / Thành phẩm:  from-emerald-50 to-teal-50    / icon text-emerald-600
Ngăn lưu:               from-blue-50 to-cyan-50        / icon text-blue-600
Kiểm nghiệm:            from-violet-50 to-purple-50    / icon text-violet-600
Xuất hàng:              from-amber-50 to-orange-50     / icon text-amber-600
Điều xe:                from-slate-50 to-gray-100      / icon text-slate-600
```

### Buttons
```
Primary:   px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all
Secondary: px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl
Danger:    bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md
Icon btn:  p-1.5 hover:bg-slate-100 rounded-lg transition-colors
Small add: flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg
```

### Form inputs
```
Input:    w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500
Select:   w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500
Label:    text-xs font-bold text-slate-600 block mb-1.5
```

### Modal
```
Overlay:  fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4
Box:      bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto
Header:   sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl
Footer:   sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl
```

### Badges / Tags
```
Base:         px-2 py-0.5 rounded-full text-xs font-bold
Hoàn thành:  bg-emerald-100 text-emerald-700
Dở dang:     bg-amber-100 text-amber-700
Không đạt:   bg-red-100 text-red-600
Xuất hàng:   bg-blue-100 text-blue-700
Mặc định:    bg-slate-100 text-slate-600
```

### Table
```
thead:  bg-slate-50 border-b border-slate-200
th:     px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide
tbody:  divide-y divide-slate-100
tr:     hover:bg-slate-50 transition-colors
td:     px-4 py-3
```

## Màu sắc trạng thái

| Trạng thái | Background | Text |
|---|---|---|
| Hoàn thành / Đạt / Active | `bg-emerald-100` | `text-emerald-700` |
| Dở dang / Warning | `bg-amber-100` | `text-amber-700` |
| Không đạt / Error | `bg-red-100` | `text-red-600` |
| Xuất hàng / Info | `bg-blue-100` | `text-blue-700` |
| Neutral | `bg-slate-100` | `text-slate-600` |

## Scroll Animation (Bắt buộc)

Tất cả CRUD components (bảng, card list, form) phải dùng scroll reveal:

```tsx
import { useScrollReveal } from "@/lib/useScrollReveal"

export default function Page() {
  useScrollReveal() // gọi ở đầu component

  return (
    <div className="scroll-reveal">  {/* wrap content chính */}
      {/* ... */}
    </div>
  )
}
```

CSS đã có trong `globals.css`:
- `.scroll-reveal` → ẩn ban đầu (opacity 0, translateY 20px)
- `.scroll-reveal.revealed` → hiện (opacity 1, translateY 0)

## Hover Animation (Bắt buộc)

Tất cả thành phần tương tác phải có hover effect:

| Thành phần | Class dùng |
|---|---|
| Hàng bảng | `row-hover` |
| Card | `hover-lift` |
| Nút bấm | `btn-press` |
| Glow effect | `hover-glow` |

Các class này đã định nghĩa trong `globals.css`.

Fallback nếu chưa có trong globals:
```
Card:  hover:shadow-md hover:scale-[1.02] transition-all duration-200
Row:   transition-colors duration-200 hover:bg-gray-50
Btn:   active:scale-95 transition-all
```

## Page header pattern

```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-2xl font-extrabold text-slate-800">Tên Module</h1>
    <p className="text-sm text-slate-500 mt-0.5">Mô tả ngắn</p>
  </div>
  <button onClick={openAdd}
    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
    <Plus size={16}/> Thêm mới
  </button>
</div>
```

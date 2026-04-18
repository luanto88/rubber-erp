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
```
Stats card:   bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center
Content card: bg-white rounded-xl border border-slate-200 shadow-sm p-5
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

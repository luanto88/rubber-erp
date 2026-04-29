---
description: UI components, mau sac, animation
---

# UI Components & Design System

## Nguyen tac

- Chi dung Tailwind CSS + lucide-react
- Khong import UI library ngoai
- Component tu viet, uu tien don gian va dong nhat

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
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-2xl font-extrabold text-slate-800">Ten Module</h1>
    <p className="text-sm text-slate-500 mt-0.5">Mo ta ngan</p>
  </div>
  <button className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
    <Plus size={16} /> Them moi
  </button>
</div>
```

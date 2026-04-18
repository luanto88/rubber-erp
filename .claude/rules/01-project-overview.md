---
description: Tổng quan dự án Rubber ERP — đọc file này đầu tiên khi bắt đầu bất kỳ task nào
---

# Rubber ERP — PTCS Phước Hòa

## Thông tin dự án

- **Tên:** Hệ thống Quản lý Sản xuất Cao su
- **Công ty:** CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM
- **Deploy:** https://rubber-erp.vercel.app
- **GitHub:** https://github.com/luanto88/rubber-erp
- **Supabase:** https://kaoeenrewvltnrbxmjfe.supabase.co

## Stack

- **Framework:** Next.js 14 App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Icons:** lucide-react (thư viện icon duy nhất được dùng)
- **UI:** Tự viết, không dùng component library ngoài

## Cấu trúc thư mục

```
rubber-erp/
├── CLAUDE.md                     ← Context chính cho AI
├── .claude/rules/                ← Rules chi tiết (file này)
├── src/
│   ├── app/
│   │   ├── page.tsx              ← Login page
│   │   └── dashboard/
│   │       ├── layout.tsx        ← Sidebar + nav layout
│   │       ├── page.tsx          ← Dashboard (stats cards)
│   │       ├── dispatch/page.tsx ← Điều xe
│   │       ├── storage/page.tsx  ← Ngăn lưu
│   │       ├── product/page.tsx  ← Thành phẩm
│   │       ├── quality/page.tsx  ← Kiểm nghiệm
│   │       ├── export/page.tsx   ← Xuất hàng
│   │       └── settings/page.tsx ← Cài đặt
│   └── lib/
│       ├── supabase.ts           ← Supabase client
│       └── useScrollReveal.ts    ← Hook scroll animation
└── public/

## Nhà máy (multi-tenant)

| Code | Tên | Sản phẩm |
|---|---|---|
| `phuochoa_kt` | Phước Hòa Kampong Thom | CSR series |
| `cuaparis` | Cuaparis HCM | SVR series |

Mọi query Supabase **bắt buộc** filter theo `factory_id`.

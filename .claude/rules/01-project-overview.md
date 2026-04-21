---
description: Tổng quan dự án Rubber ERP — đọc file này đầu tiên khi bắt đầu bất kỳ task nào
---

# Rubber ERP — PTCS Phước Hòa Kampong Thom

## Thông tin dự án

- **Tên:** Hệ thống Quản lý Sản xuất Cao su
- **Công ty:** CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM
- **Deploy:** https://qlsxkpt.vercel.app
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

| Field | NMPHK (`phuochoa_kt`) | NMCP (`cuaparis`) |
|---|---|---|
| Tên | Phước Hòa Kampong Thom | Cuaparis |
| Quốc gia | Campuchia | Việt Nam |
| Tọa độ | 12.581870, 105.497249 | 11.178232, 106.680421 |
| Sản phẩm | CSR series | SVR series |
| Chứng nhận NL | PEFC CS; Không | PEFC FM; PEFC CS; Không |
| Pallet riêng | Sắt đế gỗ; Sắt mỏng; MB5; Gỗ | + Sắt đế nhựa |
| Loại NL thêm | — | + Mủ dơ (dây chuyền Mủ tạp) |

**Hierarchy thiết kế module:** Nhà máy → Dây chuyền (`"Mủ tạp"` / `"Mủ nước"`) → Loại SP → Bành → Bọc → Pallet

Mọi query Supabase **bắt buộc** filter theo `factory_id`.
```

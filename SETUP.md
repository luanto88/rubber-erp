# 🏭 Rubber Factory ERP - Setup Guide

## Bước 1: Tạo Database

1. Mở Supabase → **SQL Editor** (menu trái)
2. Bấm **+ New query**
3. Copy toàn bộ nội dung file `supabase/schema.sql` → Paste vào editor
4. Bấm **Run** (Ctrl+Enter)
5. Kiểm tra: vào **Table Editor** → phải thấy 10 bảng:
   - factories, users, suffixes, dispatch_entries, ngans
   - lots, qc_results, customers, export_orders, sk_history

## Bước 2: Lấy API Key đúng

1. Supabase → **Settings** → **API**
2. Copy **Project URL**: `https://xxx.supabase.co`
3. Copy **anon public** key (bắt đầu bằng `eyJ...`)
4. Paste vào file `.env.local`

## Bước 3: Chạy project

```bash
cd rubber-erp
npm run dev
```

Mở http://localhost:3000

## Bước 4: Deploy lên Vercel

```bash
npm i -g vercel
vercel
```

Làm theo hướng dẫn, nhập Environment Variables khi được hỏi.

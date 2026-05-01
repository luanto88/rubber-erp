# Rubber Factory ERP - Setup Guide

## Buoc 1: Tao Database

1. Mo Supabase -> `SQL Editor`
2. Bam `+ New query`
3. Copy toan bo noi dung file `supabase/schema.sql` vao editor
4. Bam `Run`
5. Kiem tra cac bang chinh da duoc tao

## Buoc 2: Cau hinh bien moi truong

1. Mo Supabase -> `Settings` -> `API`
2. Copy `Project URL`
3. Copy `anon public key`
4. Paste vao file `.env.local`

## Buoc 3: Chay project

```bash
cd rubber-erp
npm run dev
```

Mo `http://localhost:3000`

## Auth note

- He thong dang nhap bang `username`, khong bat nguoi dung nhap email thuc.
- Ung dung tu sinh email noi bo cho `Supabase Auth` theo dang `username@auth.rubber-erp.example.com`.
- Khong dung domain `.local` cho tai khoan auth moi.

## Buoc 4: Deploy len Vercel

```bash
npm i -g vercel
vercel
```

Nhap cac environment variables khi duoc hoi.

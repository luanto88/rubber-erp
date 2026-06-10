---
description: Module Văn bản Nội bộ — workflow ký duyệt theo phòng ban, phân loại Thường/Mật, stamp file
---

# Module Văn bản Nội bộ (`/dashboard/documents/`)

## Phạm vi

Module quản lý văn bản nội bộ (đề nghị, tờ trình, báo cáo, kế hoạch, biên bản) với vòng ký tuần tự theo phòng ban hoặc cá nhân.

Route: `/dashboard/documents/`
Permissions: `documents.view`, `documents.create`, `documents.edit`, `documents.delete`, `documents.ky_phong_ban`, `documents.phe_duyet`, `documents.print`, `documents.upload_signed`, `documents.distribute`

---

## Migrations đã tạo (cần chạy thủ công theo thứ tự)

| File | Nội dung | Trạng thái |
|---|---|---|
| `20260610_van_ban_types_sequences.sql` | Bảng `van_ban_document_types`, `van_ban_sequences`, function `get_next_van_ban_so` | Cần chạy |
| `20260610_van_ban_documents_extend.sql` | Mở rộng `van_ban_documents` — workflow columns, file columns, embedding | Cần chạy |
| `20260610_van_ban_phan_loai.sql` | Thêm cột `phan_loai TEXT DEFAULT 'Thuong'` | Cần chạy |

**Lỗi đã biết khi chạy `types_sequences`**: `policy "van_ban_sequences_factory_read" already exists` → đã sửa bằng `DROP POLICY IF EXISTS` trước `CREATE POLICY`.

---

## Bảng chính `van_ban_documents`

Cột quan trọng (thêm vào schema gốc từ 20260522):

```sql
loai_van_ban TEXT,              -- DN | TTR | BC | KH | BB
so_van_ban TEXT,                -- "01" — text
nam INTEGER,
phan_loai TEXT DEFAULT 'Thuong',  -- 'Thuong' | 'Mat'
thu_tu_ky_json JSONB DEFAULT '[]',
buoc_hien_tai INTEGER DEFAULT 0,
so_buoc_tong INTEGER DEFAULT 0,
nguoi_ky JSONB DEFAULT '{}',
placement_ky JSONB DEFAULT '{}',
tra_ve_step INTEGER,
tra_ve_ly_do TEXT,
tra_ve_nguoi TEXT,
tra_ve_at TIMESTAMPTZ,
ngay_phe_duyet DATE,
file_signed_office_url TEXT,
file_signed_office_type TEXT,
auto_convert_pdf BOOLEAN DEFAULT false,
is_uploaded BOOLEAN DEFAULT false,
phong_ban_ky_display TEXT[],
nguoi_soan_thao_display TEXT,
embedding vector(768),
mo_ta_tim_kiem TEXT
```

---

## Phân loại Thường/Mật

### Cột DB
```sql
phan_loai TEXT NOT NULL DEFAULT 'Thuong'  -- 'Thuong' | 'Mat'
```

### ThuTuKyStep
```typescript
type ThuTuKyStep = {
  step: number
  type: "phong_ban" | "ca_nhan"
  phong_ban_code?: string
  phong_ban_name?: string
  user_id?: string           // chỉ ca_nhan
  ten?: string
  chuc_vu?: string
  mat_recipient_user_id?: string  // chỉ khi phan_loai = 'Mat'
}
```

### Luồng thông báo

**Thường** (`phan_loai = 'Thuong'`):
- `getNextRecipients()` trong `sign/route.ts`: `targetDeptCode = step.phong_ban_code`
- `notify/route.ts` `resolveDeptLeaderIds(factoryId, deptCode)`: query `profiles` WHERE `role IN ('admin','manager')` AND `department` match (case-insensitive)
- Gửi đến **tất cả** trưởng/phó phòng ban đó

**Mật** (`phan_loai = 'Mat'`):
- Mỗi bước `phong_ban` phải chọn `mat_recipient_user_id` đích danh
- `getNextRecipients()`: `recipientUserIds = [step.mat_recipient_user_id]`
- Chỉ gửi đến 1 người đó

---

## API Routes

| Route | Method | Mô tả |
|---|---|---|
| `/api/documents/number` | POST | Lấy số VB tiếp theo (gọi PostgreSQL function) |
| `/api/documents/sign` | POST | Workflow ký: `gui_ky`, `ky_buoc`, `phe_duyet`, `tra_ve` |
| `/api/documents/notify` | POST | 3 kênh thông báo: in-app + Telegram + Email |
| `/api/documents/dept-code` | GET | Resolve dept code của user (bypass RLS) |
| `/api/documents/approvers` | GET | Danh sách users có quyền `documents.phe_duyet` |
| `/api/documents/dept-users` | GET | Trưởng/phó phòng ban (leadership=true) hoặc tất cả |

Tất cả routes dùng `supabaseAdmin` để bypass RLS khi cần list users.

---

## Workflow

### Cấp 1 (có vòng ký phòng ban)
```
draft → cho_ky_phong_ban → cho_phe_duyet → da_phe_duyet
                        ↘ tra_ve
```

### Cấp 2 (gửi thẳng phê duyệt)
```
draft → cho_phe_duyet → da_phe_duyet
     ↘ tra_ve
```

### Số văn bản
Format: `{SO}/{KY_HIEU}-{PHONG_BAN}` — VD: `01/BC-NMCB`
Atomic qua function `get_next_van_ban_so(factory_id, loai, phong_ban, nam)`.

---

## Email lookup
Luôn dùng `maintenance_staff.email` theo `profile_id` — **KHÔNG** dùng `profiles.auth_email` (email auth có dạng nội bộ `username@auth.rubber-erp.example.com`).

---

## Tags template Office

| Tag | Nội dung |
|---|---|
| `{{CHU_KY_BUOC_N}}` | Ảnh chữ ký bước N |
| `{{TEN_BUOC_N}}` | Tên người ký bước N |
| `{{CHUC_VU_BUOC_N}}` | Chức vụ bước N |
| `{{NGAY_KY_BUOC_N}}` | Ngày ký bước N |
| `{{CHU_KY_PHE_DUYET}}`, `{{TEN_PHE_DUYET}}`, `{{NGAY_BAN_HANH}}` | Phê duyệt cuối |
| `{{SO_VAN_BAN}}`, `{{MA_VAN_BAN}}`, `{{LOAI_VAN_BAN}}`, `{{QR}}` | Metadata |

---

## Cấu trúc file

```
src/app/dashboard/documents/
  page.tsx                    -- danh sách + filter
  new/page.tsx                -- form soạn thảo (Thường/Mật, dropdown approver, steps builder)
  new/upload/page.tsx         -- upload văn bản ký tay
  [id]/page.tsx               -- chi tiết + badge Mật + PIN modal + ký duyệt
  my-tasks/page.tsx           -- việc cần xử lý
  _components/
    documents-shell.tsx
    documents-types.ts

src/app/api/documents/
  number/route.ts
  sign/route.ts
  notify/route.ts
  dept-code/route.ts
  approvers/route.ts
  dept-users/route.ts
```

---

## Trạng thái deploy

**Toàn bộ code là untracked files, chưa commit/push → 404 trên production.**

Xem deploy checklist trong memory `project_documents_module.md`.

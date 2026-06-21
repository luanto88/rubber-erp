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
| `20260610_van_ban_documents_extend.sql` | Mở rộng `van_ban_documents` — workflow columns, file columns, `embedding vector(768)`, `mo_ta_tim_kiem` | Cần chạy |
| `20260610_van_ban_phan_loai.sql` | Thêm cột `phan_loai TEXT NOT NULL DEFAULT 'Thuong'` | Cần chạy |
| `20260610_van_ban_search_rpc.sql` | Function `match_van_ban_documents` (pgvector semantic search) | Cần chạy sau khi `extend` đã chạy |
| `20260611_van_ban_distribution.sql` | Bảng `van_ban_distribution_batches`, `van_ban_distribution_recipients`; RLS; seed permission `documents.distribute` cho admin/manager | Cần chạy |
| `20260621_van_ban_pham_vi.sql` | Thêm `pham_vi TEXT DEFAULT 'Cong_ty'` và `phe_duyet_is_kt BOOLEAN DEFAULT false` vào `van_ban_documents` | Cần chạy |

**Lỗi đã biết khi chạy `types_sequences`**: `policy "van_ban_sequences_factory_read" already exists` → đã sửa bằng `DROP POLICY IF EXISTS` trước `CREATE POLICY`.

---

## Bảng chính `van_ban_documents`

Cột quan trọng (thêm vào schema gốc từ 20260522):

```sql
loai_van_ban TEXT,              -- DN | TTR | BC | KH | BB
so_van_ban TEXT,                -- "01" — text
nam INTEGER,
phan_loai TEXT NOT NULL DEFAULT 'Thuong',  -- 'Thuong' | 'Mat'
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
embedding vector(768),     -- pgvector; NULL = chưa index AI
mo_ta_tim_kiem TEXT,       -- mô tả bổ sung để tăng độ chính xác tìm kiếm AI
pham_vi TEXT DEFAULT 'Cong_ty',       -- 'Cong_ty' | 'Don_vi' (migration 20260621)
phe_duyet_is_kt BOOLEAN DEFAULT false -- true → thêm "KT." trước tên người phê duyệt (migration 20260621)
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

### Dropdown người nhận Mật

- `loadDeptLeaders(factoryId, phong_ban_code)` gọi `GET /api/documents/dept-users?leadership=false` — trả về **tất cả** user active trong phòng ban (không lọc chỉ admin/manager), để Phó GĐ và các chức danh khác cũng xuất hiện.
- Không dùng `leadership=true` cho dropdown Mật.

---

## Mã văn bản

### Format
`{SO}/{KY_HIEU}-{PHONG_BAN}` — VD: `01/BC-NMCB`

### Quy tắc mã editable
- Mã VB được **tự sinh** khi chọn loại + phòng ban, nhưng user **có thể sửa trực tiếp** (input không read-only).
- Khi user chưa sửa (`maVanBanEdited = false`): lưu gọi API atomic `number` để lấy số tiếp theo.
- Khi user đã sửa (`maVanBanEdited = true`): parse `so` từ mã user nhập rồi dùng trực tiếp, không gọi API.
- **Banner cảnh báo nhảy số** (amber): hiện khi số trong mã ≠ số tiếp theo từ DB preview (`nextSoPreview`).
- **Banner trùng mã** (đỏ): hiện khi query Supabase phát hiện mã đã tồn tại trong factory. Check debounced 300ms sau khi user ngừng gõ.
- Nút `Lưu` bị `disabled` khi `maVanBanExists = true` (mã trùng đang xác nhận).

### Peek số tiếp theo
- `loadNextSo` đọc `van_van_sequences.last_so + 1` trực tiếp để preview — **không gọi** `get_next_van_ban_so` ở bước peek (tránh tiêu thụ số).

---

## Phạm vi văn bản — `pham_vi`

Cột `pham_vi TEXT DEFAULT 'Cong_ty'` phân biệt 2 luồng vòng ký khác nhau trong form soạn thảo.

| Giá trị | Tên hiển thị | Đặc điểm |
|---------|-------------|----------|
| `Cong_ty` | Nội bộ công ty | Step builder theo phòng ban, mỗi bước là `type: "phong_ban"` |
| `Don_vi` | Nội bộ đơn vị | Chọn cá nhân trong một phòng ban, mỗi bước là `type: "ca_nhan"` |

### `pham_vi = "Don_vi"` — Luồng ký xác nhận nội bộ đơn vị

- User chọn phòng ban → UI gọi `GET /api/documents/dept-users?factoryId=...&dept={phong_ban}&leadership=false&permission=documents.ky_phong_ban`
- Kết quả là danh sách tất cả user active trong phòng ban đó có quyền ký (không chỉ admin/manager)
- User tick chọn nhiều người → thứ tự chọn = thứ tự ký
- `thu_tu_ky_json` lưu mảng step với `type: "ca_nhan"`, `user_id`, `ten`
- `sign/route.ts` đã hỗ trợ `ca_nhan` type: kiểm tra `step.user_id !== userId` để xác thực quyền ký, thông báo đến `step.user_id` đích danh

### `phe_duyet_is_kt`

- `true` khi Phó Giám đốc ký thay Giám đốc (Ký thừa uỷ quyền)
- UI trang chi tiết thêm "KT. " prefix trước tên phê duyệt: `${doc.phe_duyet_is_kt ? "KT. " : ""}${doc.phe_duyet}`
- Checkbox "Phó ký thay (thêm 'KT.' trước chức danh)" nằm ngay sau dropdown chọn người phê duyệt trong form soạn thảo

### PIN modal title phân biệt step type

Trong `[id]/page.tsx`, tiêu đề PIN modal phải phân nhánh theo `currentStep.type`:
```tsx
{pinModal === "ky_buoc"
  ? currentStep?.type === "ca_nhan" ? "Ký xác nhận" : "Ký phòng ban"
  : "Phê duyệt văn bản"}
```
Tương tự, description bên dưới tiêu đề cũng phân nhánh:
```tsx
{currentStep.type === "ca_nhan"
  ? <>Bước {doc.buoc_hien_tai + 1}: Ký xác nhận — <strong>{currentStep.ten}</strong></>
  : <>Bước {doc.buoc_hien_tai + 1}: Ký cho phòng ban <strong>{currentStep.phong_ban_code}</strong></>}
```

---

## Người phê duyệt và bước ký phòng ban

- `GET /api/documents/approvers` trả về danh sách users có quyền `documents.phe_duyet`, kèm field `department`.
- Khi đã chọn `phe_duyet_user_id`, hệ thống tính `approverDept = approvers.find(a => a.id === phe_duyet_user_id)?.department`.
- Dropdown chọn phòng ban trong step builder filter: `PHONG_BAN_VAN_BAN_OPTIONS.filter(pb => pb !== approverDept)` — áp dụng cho **cả Thường lẫn Mật**.
- Lý do: tránh văn bản đi qua phòng ban của người phê duyệt hai lần (bước ký + phê duyệt cuối).
- Nếu bước đã chọn phòng ban đó trước khi chọn approver: hiển thị warning inline.

---

## AI Semantic Search

### Kiến trúc
- Model embed: `gemini-embedding-001` (768 dimensions) — REST fetch, không dùng SDK `@google/generative-ai`
- Embed text = `[ma_van_ban, ten_van_ban, loai_van_ban, phong_ban, mo_ta_tim_kiem].filter(Boolean).join(" ")`
- RPC: `match_van_ban_documents(query_embedding, match_threshold, match_count, p_factory_id)`
- Chỉ tìm trong văn bản `trang_thai = 'da_phe_duyet'` có `embedding IS NOT NULL`

### Trigger embed
Sau khi action `phe_duyet` thành công trong `[id]/page.tsx` → fire-and-forget `POST /api/documents/embed-doc`. Lỗi embed không block workflow.

### API Routes
| Route | Mô tả |
|---|---|
| `POST /api/documents/embed-doc` | Embed 1 văn bản sau khi phê duyệt |
| `POST /api/documents/search` | Semantic search qua RPC |

### UI (`page.tsx`)
- Nút toggle "Tìm AI" / "AI đang bật" (violet) cạnh filter bar.
- Khi bật: ẩn filter thường, hiển thị input AI + nút "Tìm kiếm".
- Kết quả hiện trong bảng riêng với cột "Độ phù hợp" (badge màu: emerald ≥75%, blue ≥60%, amber dưới đó).
- Thông báo: AI chỉ tìm văn bản đã phê duyệt; văn bản draft không được index.

### Biến môi trường
```
GEMINI_API_KEY=<Google AI Studio key>  # đã có trong .env.local từ ISO forms module
```

---

## API Routes

| Route | Method | Mô tả |
|---|---|---|
| `/api/documents/number` | POST | Lấy số VB tiếp theo (gọi PostgreSQL function) |
| `/api/documents/sign` | POST | Workflow ký: `gui_ky`, `ky_buoc`, `phe_duyet`, `tra_ve` |
| `/api/documents/notify` | POST | 3 kênh thông báo: in-app + Telegram + Email |
| `/api/documents/dept-code` | GET | Resolve dept code của user (bypass RLS) |
| `/api/documents/approvers` | GET | Danh sách users có quyền `documents.phe_duyet` + trả `department` |
| `/api/documents/dept-users` | GET | Tất cả user active theo phòng ban (`leadership=false`) hoặc chỉ admin/manager (`leadership=true`) |
| `/api/documents/embed-doc` | POST | Embed 1 văn bản vào `embedding` sau phe_duyet |
| `/api/documents/search` | POST | Semantic search `{ query, factoryId }` → kết quả + similarity |
| `/api/documents/distribute` | GET | Danh sách user active trong factory kèm `alreadyReceived[]` per doc |
| `/api/documents/distribute` | POST | Tạo batch phân phối + 3-channel notify (in-app, Telegram, Email) |

Tất cả routes dùng `supabaseAdmin` để bypass RLS khi cần list users.

---

## Workflow

### Cấp 1 — Nội bộ công ty (`pham_vi = "Cong_ty"`)
```
draft → cho_ky_phong_ban (steps type "phong_ban") → cho_phe_duyet → da_phe_duyet
                                                 ↘ tra_ve
```

### Cấp 1 — Nội bộ đơn vị (`pham_vi = "Don_vi"`)
```
draft → cho_ky_phong_ban (steps type "ca_nhan") → cho_phe_duyet → da_phe_duyet
                                               ↘ tra_ve
```

### Cấp 2 (gửi thẳng phê duyệt)
```
draft → cho_phe_duyet → da_phe_duyet
     ↘ tra_ve
```

---

## Email lookup
Luôn dùng `maintenance_staff.email` theo `profile_id` — **KHÔNG** dùng `profiles.auth_email` (email auth có dạng nội bộ `username@auth.rubber-erp.example.com`).

---

## Trang in văn bản

Route: `/dashboard/documents/print/?docId={uuid}`

- Layout bypass sidebar: `dashboard/layout.tsx` kiểm tra `pathname.includes("/print")` → render `{children}` trực tiếp, không có sidebar.
- Load `van_ban_documents` theo `docId` từ query param.
- Nội dung trang in:
  - Header "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
  - QRCodeSVG (size=80), URL: `{APP_URL}/dashboard/documents/{docId}`
  - Số văn bản, tên văn bản
  - Bảng metadata: Loại, Phòng ban, Ngày phê duyệt, Người phê duyệt, Phân loại (Thường/Mật)
  - Bảng tiến trình ký: các bước đã ký kèm tên + ngày
- **Watermark Mật**: khi `phan_loai = 'Mat'` — `position: fixed`, `opacity: 0.07`, `transform: rotate(-45deg)`, `font-size: 120px`, `color: #dc2626`, centered trên toàn trang
- Auto-print: `setTimeout(() => window.print(), 800)` sau khi doc load
- CSS in: `@page { size: A4; margin: 20mm 15mm; }`
- Nút In trên `[id]/page.tsx`: thẻ `<a>` mở `_blank`, luôn hiển thị khi doc đã load, không phụ thuộc trạng thái

---

## Phân phối văn bản

### Bảng dữ liệu

- `van_ban_distribution_batches`: mỗi lần bấm "Phân phối" tạo 1 batch — `id`, `factory_id`, `distributed_by` (UUID auth.users), `distributed_at`, `ghi_chu`, `created_at`
- `van_ban_distribution_recipients`: mỗi row = 1 văn bản × 1 người nhận — `id`, `batch_id`, `van_ban_document_id`, `factory_id`, `recipient_user_id`, `first_viewed_at`, `first_downloaded_at`, `created_at`

### Permission

- `documents.distribute` — cấp mặc định cho `admin` và `manager`
- Guard tại UI (nút Phân phối chỉ hiện khi `trang_thai = 'da_phe_duyet'` và `canDistribute`) và API route

### API GET `/api/documents/distribute`

Query params: `factoryId`, `docIds` (comma-separated)

- Query `profiles` active trong factory qua `supabaseAdmin` (bypass RLS)
- Tính `alreadyReceived: string[]` per user = danh sách docId user đã nhận
- Trả về `{ users: DistUser[] }` — `DistUser: { id, full_name, department, role, alreadyReceived }`

### API POST `/api/documents/distribute`

Body: `{ factoryId, distributedBy, docIds[], recipientUserIds[], ghiChu? }`

1. Insert `van_ban_distribution_batches` → lấy `batchId`
2. Insert `van_ban_distribution_recipients` (docId × userId cross-product)
3. **In-app**: insert vào `notifications` với `doc_type: "van_ban"`, `type: "van_ban_phan_phoi"`
4. **Telegram**: gửi đến `ISO_TELEGRAM_BOT_TOKEN` + `ISO_TELEGRAM_CHAT_ID` (group chung với ISO)
5. **Email**: tra `maintenance_staff.email` theo `profile_id` — gửi qua Gmail SMTP
6. HTTP 207 khi có lỗi một phần, kèm `errors[]`. Các kênh độc lập nhau.

### Modal phân phối trong `[id]/page.tsx`

- Nút "Phân phối" (indigo) chỉ hiện khi `canDistribute = trang_thai === 'da_phe_duyet' && hasPermission(user, 'documents.distribute')`
- `openDistModal` async: gọi `GET /api/documents/distribute?factoryId=...&docIds=...`, load danh sách users
- Danh sách user: người đã nhận văn bản này (`alreadyReceived.includes(docId)`) hiển thị mờ + badge "Đã nhận", checkbox disabled
- Nút "Chọn tất cả" chỉ chọn người chưa nhận
- Textarea ghi chú (optional)
- Nút "Phân phối (N người)" với spinner khi đang gửi
- Sau thành công: đóng modal + toast xanh "Đã phân phối đến N người nhận!"

---

## Thống kê văn bản

Tab "Thống kê" trong `page.tsx`, component `VanBanStats`:

- **5 KPI cards**: Tổng số (slate), Đã phê duyệt (emerald), Đang xử lý (amber), Nháp (slate mờ), Trả về (rose)
- **Bar chart theo tháng**: 6 tháng gần nhất, tính client-side từ dữ liệu đã load, thanh width normalize theo max
- **Bảng phân loại theo `loai_van_ban`**: Loại | Tổng | Đã PD | Đang xử lý
- **Bảng phân loại theo `phong_ban`**: Phòng ban | Tổng | Đã PD | Đang xử lý
- **Bảng trạng thái đầy đủ**: Trạng thái | Số lượng | Tỉ lệ %

Dữ liệu dùng lại từ `docs` state đã load trong `page.tsx` — không có query riêng cho stats.

---

## Hướng dẫn tag Office

Component `TagGuidePanel` trong `new/page.tsx`:

- Đặt **trước** section nút Lưu (cuối form)
- Toggle collapse: "▼ Xem hướng dẫn tag" / "▲ Thu gọn"
- 3 nhóm tag:
  1. **Metadata văn bản**: `{{SO_VAN_BAN}}`, `{{MA_VAN_BAN}}`, `{{LOAI_VAN_BAN}}`, `{{QR}}`
  2. **Chữ ký từng bước** (N = số thứ tự bước): `{{TEN_BUOC_N}}`, `{{CHU_KY_BUOC_N}}`, `{{CHUC_VU_BUOC_N}}`, `{{NGAY_KY_BUOC_N}}`
  3. **Phê duyệt cuối**: `{{TEN_PHE_DUYET}}`, `{{CHU_KY_PHE_DUYET}}`, `{{CHUC_VU_PHE_DUYET}}`, `{{NGAY_BAN_HANH}}`
- Tag sai/gần giống dạng `{{...}}` trong file template → chặn và báo lỗi yêu cầu sửa file

---

## Form soạn thảo (`new/page.tsx`)

### Thứ tự các section (từ trên xuống dưới)
1. **Phân loại** (Thường/Mật) — nút to, icon Shield/Lock, border nổi bật
2. Loại văn bản
3. Phòng ban
4. Năm, Mã văn bản (editable + banner cảnh báo)
5. Tên / Trích yếu nội dung
6. Cấp tài liệu
7. Người phê duyệt
8. Các bước ký (step builder — phòng ban của approver bị loại)
9. File đính kèm
10. Mô tả tìm kiếm AI (`mo_ta_tim_kiem`) — optional
11. Ghi chú

### Auto-fill từ tên file
Khi upload file, nếu `form.ten_van_ban` đang trống → auto-fill từ tên file (bỏ extension, thay `_-` thành dấu cách).

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
  page.tsx                    -- danh sách + filter + AI search toggle + tab Thống kê (VanBanStats)
  new/page.tsx                -- form soạn thảo (phân loại, mã editable, TagGuidePanel, AI desc)
  new/upload/page.tsx         -- upload văn bản ký tay
  [id]/page.tsx               -- chi tiết + badge Mật + PIN modal + ký duyệt + nút In + nút Phân phối + DistModal
  my-tasks/page.tsx           -- việc cần xử lý
  print/page.tsx              -- trang in (bypass sidebar, A4, QR, watermark Mật, auto-print)
  _components/
    documents-shell.tsx
    documents-types.ts

src/app/api/documents/
  number/route.ts
  sign/route.ts
  notify/route.ts
  dept-code/route.ts
  approvers/route.ts             (trả về department)
  dept-users/route.ts            (hỗ trợ leadership=false)
  embed-doc/route.ts             (POST: embed 1 văn bản sau phe_duyet)
  search/route.ts                (POST: semantic search)
  distribute/route.ts            (GET: danh sách users+alreadyReceived; POST: tạo batch + 3-channel notify)
```

---

## Trạng thái deploy

**Toàn bộ code là untracked files, chưa commit/push → 404 trên production.**

Chi tiết deploy checklist xem memory `project_documents_module.md`.

---

## Ghi chú kỹ thuật quan trọng

### Supabase `.catch()` không tồn tại trên `PostgrestFilterBuilder`

Khi dùng Supabase JS v2, không được chain `.catch()` trực tiếp sau `insert()` / `update()` / `select()`:

```typescript
// SAI — PostgrestFilterBuilder không có .catch()
await supabaseAdmin.from("notifications").insert(rows).catch(...)

// ĐÚNG — destructure error
const { error } = await supabaseAdmin.from("notifications").insert(rows)
if (error) handleError(error.message)
```

### Bug đã fix: `dept-users/route.ts` — danh sách ký xác nhận luôn rỗng (2026-06-21)

Hai lỗi trong `dept-users/route.ts` gây danh sách user trả về rỗng khi có `permission=` query param:

**Lỗi 1 — Tên cột sai**: `role_permissions` bảng có cột `"role"` nhưng code query `.select("role_code")` → `rolesWithPerm` luôn là Set rỗng → mọi user bị filter out.
```typescript
// SAI
const { data: rolePermRows } = await supabaseAdmin.from("role_permissions").select("role_code")...
const rolesWithPerm = new Set((rolePermRows || []).map((r: { role_code: string }) => r.role_code))

// ĐÚNG — cột thật là "role"
const { data: rolePermRows } = await supabaseAdmin.from("role_permissions").select("role")...
const rolesWithPerm = new Set((rolePermRows || []).map((r: { role: string }) => r.role))
```

**Lỗi 2 — Thiếu `.eq("granted", true)`**: `user_permissions` có thể có dòng `granted = false` (quyền bị thu hồi) nhưng code không lọc → user bị thu hồi quyền vẫn được trả về.
```typescript
// SAI
.from("user_permissions").select("user_id").eq("permission_code", permissionCode)

// ĐÚNG
.from("user_permissions").select("user_id").eq("permission_code", permissionCode).eq("granted", true)
```

### Bug đã fix: `approvers/route.ts` — thiếu `.eq("granted", true)` (2026-06-21)

`approvers/route.ts` query `user_permissions` để lấy users có explicit `documents.phe_duyet` permission cũng thiếu `.eq("granted", true)` — dẫn đến user bị thu hồi quyền vẫn xuất hiện trong dropdown phê duyệt:
```typescript
// ĐÚNG — phải có granted = true
const { data: permRows } = await supabaseAdmin
  .from("user_permissions")
  .select("user_id")
  .eq("permission_code", "documents.phe_duyet")
  .eq("granted", true)
```

### Bug đã fix: `new/page.tsx` — approver dropdown chỉ hiện admin (2026-06-21)

`new/page.tsx` có đoạn filter thừa `filteredApprovers` cho luồng `Don_vi` lọc lại chỉ `role === "admin" || role === "manager"` — loại mất users có explicit permission nhưng role khác:
```typescript
// SAI — filter thừa, loại user có explicit perm nhưng role khác admin/manager
const filteredApprovers =
  form.pham_vi === "Don_vi"
    ? approvers.filter((a) => a.role === "admin" || a.role === "manager")
    : approvers

// ĐÚNG — API /approvers đã filter đúng rồi, không cần filter lại
const filteredApprovers = approvers
```

### `DistUser` type phải khai báo ở module level

Không khai báo type bên trong React component function — sẽ gây lỗi khi dùng trong `useCallback` deps hoặc rebuild mỗi render:

```typescript
// Khai báo trước component function
type DistUser = { id: string; full_name: string; department: string; role: string; alreadyReceived: string[] }

export default function DocumentDetailPage() { ... }
```

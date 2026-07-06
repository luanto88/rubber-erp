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

## Bảng `van_ban_document_types`

**Xác nhận 2026-07-04**: bảng này **KHÔNG có cột `factory_id`** — là danh mục loại văn bản dùng chung toàn hệ thống (`UNIQUE(code)`, không phân biệt nhà máy), đúng theo migration gốc `20260610_van_ban_types_sequences.sql`. Seed mặc định 5 loại: `DN`, `TTR`, `BC`, `KH`, `BB`; có thể thêm loại mới qua `Cài đặt → Danh mục → Loại văn bản` (ví dụ đã thêm `CV` — Công văn).

**Bug đã fix**: `settings/page.tsx` (`loadVanBanTypes`/`saveVanBanType`/`deleteVanBanType`) trước đây query bảng này với `.eq("factory_id", fid)` và insert kèm `factory_id` trong payload — gây lỗi PostgREST `Could not find the 'factory_id' column ... in the schema cache` khi thêm loại văn bản mới. Đã xác nhận bằng script test trực tiếp qua `SUPABASE_SERVICE_ROLE_KEY` (không đoán). Đã sửa: bỏ hẳn `factory_id` khỏi filter/payload của cả 3 hàm — khớp đúng cách `new/page.tsx` và `new/upload/page.tsx` vẫn luôn query bảng này (không filter theo factory).

**Quy tắc cho code mới**: mọi truy vấn `van_ban_document_types` KHÔNG được thêm `.eq("factory_id", ...)` hay `factory_id` vào payload — khác với hầu hết bảng khác trong app (đây là ngoại lệ có chủ đích, một danh mục toàn hệ thống, không phải lỗi thiếu multi-tenant).

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

**Cập nhật 2026-07-04**: Người phê duyệt cuối cho `Don_vi` không còn chọn tay từ dropdown toàn nhà máy — hệ thống **tự động xác định "lãnh đạo phòng ban"** qua API mới `GET /api/documents/dept-leader?factoryId=...&dept={phong_ban}`.

- Logic xác định lãnh đạo (`dept-leader/route.ts`):
  1. Lọc `profiles` active theo phòng ban đã chọn (3-way match: `department_id`, `department` theo tên, hoặc so khớp code — giống cách `dept-users/route.ts` đang làm).
  2. Với từng profile, tra `maintenance_staff` (liên kết qua `profile_id`) — lấy `chuc_vu` hoặc `chuc_vu_chinh_quyen`, so khớp substring (không phân biệt hoa/thường) với từ khóa lãnh đạo: `"trưởng phòng"`, `"phó phòng"`, `"giám đốc"` (`"phó giám đốc"` đã được bao phủ bởi substring `"giám đốc"`, không cần pattern riêng).
  3. Lọc tiếp: chỉ giữ người có quyền `documents.phe_duyet` (explicit `user_permissions.granted=true` hoặc qua `role_permissions`).
- UI (`documents/new/page.tsx`) gọi API này mỗi khi đổi `phong_ban` hoặc chuyển `pham_vi` sang `Don_vi` (qua `useEffect` phụ thuộc `[factoryId, form.phong_ban, form.pham_vi]`):
  - **0 kết quả**: chặn lưu (nút Lưu `disabled`), hiện banner đỏ hướng dẫn cụ thể 3 điều cần kiểm tra (Chức vụ trong Nhân sự bảo trì, đã "Liên kết tài khoản", đã được cấp quyền `documents.phe_duyet`).
  - **Đúng 1 kết quả**: tự động gán `form.phe_duyet_user_id`, hiển thị badge "Tự động xác định" (không cho đổi tay).
  - **≥2 kết quả**: hiện `<select>` chỉ trong số các lãnh đạo hợp lệ đó (không phải toàn nhà máy).
- **`cap_tl` và `phan_loai` bị khóa cứng cho `Don_vi`**: `cap_tl` luôn là `"Cấp 1"` (không còn lựa chọn Cấp 2), `phan_loai` luôn `"Thuong"` — UI ẩn hẳn khối chọn "Phân loại Thường/Mật" khi `pham_vi === "Don_vi"` (chỉ hiện cho `Cong_ty`).
- Bước "Ký xác nhận" (chọn người ký theo thứ tự, `type: "ca_nhan"`) giờ là **tùy chọn, có thể để trống** cho `Don_vi` — không còn bắt buộc ≥1 step như trước; validate save chỉ còn bắt buộc với `Cấp 1` + `Cong_ty` (≥1 step phòng ban).
- Danh sách ứng viên cho bước "Ký xác nhận" (khác với người phê duyệt cuối) vẫn dùng `GET /api/documents/dept-users?...&permission=documents.create,documents.ky_phong_ban,documents.phe_duyet` — `dept-users/route.ts` giờ hỗ trợ **nhiều permission code phân tách bằng dấu phẩy (OR-match)** thay vì chỉ 1 code như trước.
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
| `/api/documents/dept-users` | GET | Tất cả user active theo phòng ban (`leadership=false`) hoặc chỉ admin/manager (`leadership=true`); `permission=` hỗ trợ nhiều code phân tách dấu phẩy (OR-match) |
| `/api/documents/dept-leader` | GET | Tự động xác định "lãnh đạo phòng ban" (Trưởng/Phó phòng, Giám đốc/Phó giám đốc qua từ khóa chức vụ trong `maintenance_staff`) có quyền `documents.phe_duyet` — dùng làm người phê duyệt cuối cho luồng `Don_vi` |
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
Khi upload file, nếu `form.ten_van_ban` đang trống → auto-fill từ tên file (bỏ extension, thay `_-` thành dấu cách). Đây là fallback đơn giản của `new/page.tsx` — khác với parser đầy đủ của `new/upload/page.tsx` (xem mục "Upload văn bản ký tay" bên dưới).

---

## Upload văn bản ký tay (`new/upload/page.tsx`)

Ghi lại 1 văn bản **đã ký tay trên giấy** vào hệ thống — bỏ qua toàn bộ workflow ký số, lưu thẳng `trang_thai = "da_phe_duyet"`, `is_uploaded = true`. Đã rework hoàn toàn 2026-07-04 (2 phiên liên tiếp) sau khi user test trên `npm run dev` và phản hồi các vấn đề bên dưới — mô tả sau đây là logic **hiện hành**, thay thế hoàn toàn bản mô tả cũ (checkbox tự do + free text đã bị loại bỏ).

### Thứ tự section trên UI (đã đổi 2026-07-04)

Cột trái (`lg:col-span-2`), 1 card "Thông tin văn bản":
1. **File văn bản đã ký** — đặt lên **đầu tiên** (trước đây ở cuối) vì các trường bên dưới phụ thuộc auto-fill từ file; đặt file trước giúp user thấy ngay các trường tự điền.
2. Loại văn bản, Phòng ban, Mã văn bản (editable + banner), Tên/Trích yếu
3. Phạm vi lưu hành (toggle `Cong_ty`/`Don_vi`)
4. Ngày ký/phê duyệt, Ghi chú

Cột phải: Card "Người phê duyệt" rồi Card "Phòng ban đã ký" (`Cong_ty`) hoặc "Người lập" (`Don_vi`), rồi nút Lưu/Hủy. Layout `grid grid-cols-1 lg:grid-cols-3 gap-6`, mirror đúng cấu trúc `new/page.tsx` — không còn dùng layout 1 card đơn `max-w-2xl` như bản cũ.

### Auto-fill từ tên file — `parseVanBanFileName()`

Windows không cho phép ký tự `/` trong tên file, nên **không thể** dùng nguyên định dạng mã chuẩn `"01/ĐN-NMCB Tên..."` làm tên file thật. Parser phải chịu được các biến thể thực tế, tất cả đều tương đương và đều parse đúng:

- `"01/ĐN-NMCB Tên văn bản.pdf"` (dấu gạch chéo — hiếm gặp trên Windows nhưng vẫn hỗ trợ)
- `"01 ĐN-NMCB Tên văn bản.pdf"` (dấu cách thay `/`)
- `"01ĐN-NMCB Tên văn bản.pdf"` (dính liền số + ký hiệu, giữ gạch ngang)
- `"01ĐNNMCB Tên văn bản.pdf"` (dính liền hoàn toàn, không dấu phân cách nào)

Thuật toán tách tuần tự (không dùng 1 regex cứng duy nhất):
1. Tách số thứ tự bằng `/^(\d{1,4})/` ở đầu chuỗi (bỏ extension trước).
2. Bỏ qua 0+ ký tự phân cách tùy chọn `[\s\-/]+` ngay sau số.
3. Khớp ký hiệu loại văn bản ở đầu phần còn lại — `matchPrefix()`: so khớp không phân biệt hoa/thường, chuẩn hóa NFC, ưu tiên candidate dài hơn trước; nguồn candidate ưu tiên `docTypes` (runtime, từ DB), fallback `LOAI_VAN_BAN_KY_HIEU` tĩnh.
4. Bỏ qua tiếp phân cách tùy chọn, rồi khớp mã phòng ban — `matchPhongBanPrefix()`: bắt buộc có ranh giới sau khi khớp (hết chuỗi hoặc theo sau là khoảng trắng), tránh khớp nhầm khi 1 mã là tiền tố của mã khác.
5. Phần còn lại (sau khi bỏ phân cách) là Tên/Trích yếu.

Nếu bất kỳ bước nào thất bại (tên file không theo quy ước nào cả) → fallback về hành vi cũ: chỉ set `ten_van_ban` từ tên file (bỏ extension, thay `_`/`-` bằng dấu cách), không ép các trường khác. Chỉ fill field đang trống, không ghi đè giá trị user đã tự nhập. Khi auto-fill được mã, bắt buộc `setMaVanBanEdited(true)` — nếu không, effect peek số tiếp theo sẽ ghi đè lại mã vừa parse.

### Người phê duyệt — chặt chẽ như `new/page.tsx`

Không còn free text. Mirror đúng logic: `Don_vi` auto-detect lãnh đạo phòng ban qua `/api/documents/dept-leader` (banner đỏ nếu 0 candidate, badge "Tự động xác định" nếu 1, select nếu ≥2); `Cong_ty` chọn từ `/api/documents/approvers`. Lưu `phe_duyet_user_id` (FK thật) + `phe_duyet` (tên snapshot derive lúc save) + `phe_duyet_is_kt`.

### Phòng ban đã ký (`Cong_ty`) — CHẶT HƠN cả `new/page.tsx` gốc, có chủ đích

Đây là điểm khác biệt quan trọng cần nhớ: bước `type: "phong_ban"` trong luồng ký số thật (`new/page.tsx`) **không bao giờ** gắn người ký cụ thể lúc tạo — chỉ lưu `phong_ban_code` (người ký thật resolve sau, lúc ký thật qua `/api/documents/sign`). Nhưng với văn bản **đã ký xong trên giấy**, user đã xác nhận (2026-07-04) muốn ghi nhận chặt hơn: mỗi bước phải chọn **cả phòng ban lẫn 1 người ký thật** (dropdown load từ `/api/documents/dept-users?dept=<code>`, không filter permission vì đây là "ai đã ký trên giấy" chứ không phải "ai có quyền ký số"). Step builder có thứ tự, loại trừ phòng ban của người phê duyệt (`approverDept`) và loại trừ phòng ban đã dùng ở step khác; **chặn trùng phòng ban giữa các step lúc save** (rule tự thêm, không có trong `new/page.tsx` gốc). Không bắt buộc tối thiểu 1 step — văn bản giấy có thể chỉ có chữ ký phê duyệt.

### Người lập (`Don_vi`) — bắt buộc chọn user thật

Không còn free text. Dropdown bắt buộc chọn từ `donViUsers` (load qua `/api/documents/dept-users?dept=<form.phong_ban>`, không filter permission), loại trừ người đã là `phe_duyet_user_id` khỏi danh sách. Lưu `soan_thao_user_id` (FK thật) + `nguoi_soan_thao_display` (tên snapshot).

### Tái sử dụng nguyên vẹn data model ký số thật — không cần sửa `[id]/page.tsx`

Thay vì tạo cấu trúc riêng, `handleSave` populate `thu_tu_ky_json` (mỗi step `{step, type:"phong_ban", phong_ban_code, phong_ban_name}`) và `nguoi_ky` (keyed theo step number, `{ten: tên người ký thật, chuc_vu:"", ky_at}`) — y hệt cấu trúc luồng ký số đang chạy, cộng `buoc_hien_tai = so_buoc_tong = steps.length` (đánh dấu tất cả đã xong). Vòng lặp timeline trong `[id]/page.tsx` (đọc `thu_tu_ky_json`/`nguoi_ky`) **tự động hiển thị đúng** tên người ký thật + ngày ký cho văn bản upload, không cần code riêng. Vẫn giữ song song cột `phong_ban_ky_display` (chip tóm tắt nhanh ở khối "Thông tin văn bản" trang chi tiết) — không thay thế, chỉ bổ sung.

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
  new/upload/page.tsx         -- upload văn bản ký tay (xem mục "Upload văn bản ký tay" — layout 2 cột, parser tên file Windows-safe, người ký thật per phòng ban)
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
  dept-users/route.ts            (hỗ trợ leadership=false; permission= nhiều code phân tách dấu phẩy)
  dept-leader/route.ts           (GET: tự động xác định lãnh đạo phòng ban cho luồng Don_vi)
  embed-doc/route.ts             (POST: embed 1 văn bản sau phe_duyet)
  search/route.ts                (POST: semantic search)
  distribute/route.ts            (GET: danh sách users+alreadyReceived; POST: tạo batch + 3-channel notify)
```

---

## Trạng thái deploy

**Cập nhật 2026-07-04**: Toàn bộ code module Văn bản đã được commit và push lên `origin/main` (gộp chung trong commit "Cải tiến giao diện mobile GD8" cùng đợt responsive hoá Cài đặt/ISO/Kho Thành phẩm) — không còn ở trạng thái untracked/404 như ghi chú cũ. Tính năng "lãnh đạo phòng ban tự động" (`dept-leader/route.ts`) nằm trong cùng đợt commit này.

Chi tiết deploy checklist cũ (lịch sử trước 2026-07-04) xem memory `project_documents_module.md` — cần đối chiếu lại vì có thể đã lỗi thời sau commit này.

**Cập nhật 2026-07-04 (sau commit trên, CHƯA commit/push)**: `new/upload/page.tsx` (rework toàn bộ — xem mục "Upload văn bản ký tay"), `[id]/page.tsx` (thêm chip "Phòng ban đã ký", tiêu đề timeline 3 nhánh), `settings/page.tsx` (fix bug schema `van_ban_document_types.factory_id`) đang là **thay đổi chưa commit** trong working tree — không giả định các file này đã lên production chỉ vì phần "Trạng thái deploy" ở trên nói code cũ đã push.

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

---

## Handoff cho session sau (2026-07-04) — "Lãnh đạo phòng ban tự động" chưa test tay

Tính năng auto-detect lãnh đạo phòng ban cho luồng `Don_vi` (`dept-leader/route.ts` + `new/page.tsx`) đã code xong, build/tsc/eslint pass, đã commit + push, nhưng **chưa được xác nhận hoạt động đúng trên dữ liệu thật**. Việc cần làm session sau nếu user báo lỗi liên quan:

- Test tay tạo văn bản `Nội bộ đơn vị` với 1 phòng ban có đúng 1 người khớp từ khóa lãnh đạo (`trưởng phòng`/`phó phòng`/`giám đốc`) trong `maintenance_staff.chuc_vu`/`chuc_vu_chinh_quyen` — xác nhận tự động chọn đúng người, badge "Tự động xác định" hiện đúng.
- Test tay trường hợp phòng ban có ≥2 người khớp — xác nhận dropdown chỉ liệt kê đúng nhóm lãnh đạo hợp lệ (không lẫn người khác trong phòng ban).
- Test tay trường hợp phòng ban chưa gán ai đủ điều kiện (thiếu Chức vụ, chưa liên kết tài khoản, hoặc chưa có quyền `documents.phe_duyet`) — xác nhận banner lỗi hiện đúng, nút Lưu bị khóa đúng như thiết kế.
- Đối chiếu lại toàn bộ phòng ban thực tế đang có trong `maintenance_staff` xem có Chức vụ nào viết khác cách (không chứa nguyên văn `"trưởng phòng"`/`"phó phòng"`/`"giám đốc"`) mà đáng lẽ phải được nhận diện là lãnh đạo — `LEADER_KEYWORDS` hiện là danh sách cứng trong code (`dept-leader/route.ts`), không phải cấu hình DB, nên nếu cách gọi chức danh thực tế khác đi sẽ cần sửa code, không sửa được qua UI.

---

## Cập nhật 2026-07-06 — Chuẩn hóa tên file, fix bug xác định phòng ban, modal ký PDF kéo-thả, reorder form

### 1. Chuẩn hóa tên file tiếng Việt khi upload

`sanitizeStorageFileName()` được thêm vào `documents-types.ts` (export dùng chung), mirror đúng logic của ISO (`iso/documents/[id]/page.tsx`) — bỏ dấu tiếng Việt qua `normalize("NFD") + replace(/\p{M}/gu, "")`, đổi `đ/Đ` thủ công, chỉ giữ `[a-zA-Z0-9._-]`. Áp dụng khi build storage path ở `new/page.tsx` (`file_goc_url`) và `new/upload/page.tsx` (file ký tay) — trước đó cả 2 nơi chỉ `file.name.replace(/\s+/g, "_")` (chỉ thay khoảng trắng, giữ nguyên dấu), khiến `supabase.storage.upload()` lỗi hoặc sinh URL không truy cập được với tên file có dấu.

**Không sanitize trước khi parse**: `new/upload/page.tsx`'s `parseVanBanFileName()` vẫn nhận `file.name` gốc (có dấu) để tách số/ký hiệu/phòng ban/tên — chỉ sanitize tại bước tạo `filePath` lúc upload, tách biệt hoàn toàn 2 việc.

### 2. Fix bug "thấy Trả về nhưng không thấy Ký" — dept-code 2-way match thiếu nhánh code trực tiếp

Root cause: `dept-code/route.ts` (dùng bởi UI `[id]/page.tsx` để tính `userDeptCode` cho `canKyBuoc`) và `getUserDeptCode()` trong `sign/route.ts` (dùng để validate quyền ký ở server) chỉ resolve phòng ban qua **2 nhánh**: `department_id → departments.id` hoặc `department (tên) → departments.name`. Thiếu nhánh thứ 3 mà `dept-users/route.ts` đã có từ trước: `department` chính là **code** (`profiles.department` lưu trực tiếp `"NMCB"` thay vì tên đầy đủ) → so khớp `departments.code` trực tiếp. User có `department_id` chưa gán và `profiles.department` lưu thẳng code sẽ resolve ra `null`, khiến `canKyBuoc` sai dù đúng là người phải ký bước đó — chỉ còn thấy "Trả về" vì điều kiện đó còn có nhánh `hasPermission(user, "documents.phe_duyet")` (thường đúng với BGĐ).

**Fix**: tạo `src/lib/documents-dept.ts` xuất `resolveUserDeptCode(supabaseAdmin, profile)` — 3-way match giống `dept-users/route.ts`. Cả `dept-code/route.ts` và `sign/route.ts`'s `getUserDeptCode()` giờ gọi chung hàm này — không còn 2 bản logic lệch nhau.

### 3. Modal ký PDF kéo-thả chữ ký (SignPlacementModal) — thay PIN-only modal cũ

Trước đây **toàn bộ** luồng ký văn bản (`ky_buoc` phòng ban/cá nhân, `phe_duyet`) chỉ có modal nhập PIN, không có bước xem/đặt vị trí chữ ký trên file — hệ thống luôn tự chèn chữ ký vào tọa độ mặc định cố định trong PDF, bất kể `pham_vi` là `Cong_ty` hay `Don_vi`. Đã xây `SignPlacementModal` trong `[id]/page.tsx`, mirror đúng kiến trúc `SignPlacementModal` của `iso/forms/[id]/page.tsx`:

- File nguồn là PDF (`docExt === "pdf"` hoặc URL đuôi `.pdf`): render canvas qua `pdfjs-dist` (worker local, không CDN), 2 phần tử kéo-thả độc lập bằng `react-draggable` + `re-resizable` — khung "Chữ ký" (ảnh PNG từ `signatures/{factory_id}/{user_id}/chu_ky.png`) và khung "Tên người ký", mỗi khung có nút ẩn/hiện riêng (`showSignature`/`showSignerName`).
- File nguồn là Office (DOCX/XLSX): không có canvas, chỉ hiện info box liệt kê 2 tag sẽ được thay (`{{CHU_KY_BUOC_N}}`/`{{TEN_BUOC_N}}` hoặc `{{CHU_KY_PHE_DUYET}}`/`{{TEN_PHE_DUYET}}`).
- PIN nhập ngay trong modal này (không còn `ModalShell` PIN-only riêng) — `onConfirm(pin, placement)` gọi `handleSignConfirm` (hàm dùng chung thay cho `handleKyBuoc`/`handlePheDuyet` cũ) POST `/api/documents/sign` kèm `placement`.
- **Nguồn file để xác định canvas/office** (`docSourceUrl`) phải dùng đúng thứ tự ưu tiên `file_signed_office_url || file_signed_pdf_url || file_goc_url` — **giống hệt** `sourceUrl` trong `performFileStamp()` của `sign/route.ts` (khác với `fileUrl` hiển thị ở nút "Xem file" trên header, vốn ưu tiên `file_signed_pdf_url` trước — 2 biến tách riêng, không dùng chung).
- Áp dụng đồng nhất cho cả 2 `pham_vi` (`Cong_ty`/`Don_vi`) và mọi bước ký (phòng ban/cá nhân/phê duyệt) — không có nhánh code riêng theo `pham_vi`.

### 4. Backend `sign/route.ts` — mở rộng `placement_ky` hỗ trợ khung tên riêng

- `SignPlacement` type mở rộng thêm `showSignature?`, `showSignerName?`, `nameX/nameY/nameWidth/nameHeight?` — khớp `FullPlacement` của ISO forms.
- `stampPdfStep()` thêm hàm `buildSignerNamePlacement(p)` (mirror `finalize/route.ts` của ISO forms) để vẽ tên tại khung riêng nếu có, fallback về căn giữa dưới chữ ký như hành vi cũ khi không có `nameX/nameY`.
- `ky_buoc`/`phe_duyet` handler: khi request có `placement`, merge vào `placement_ky[stepKey]` (stepKey là số thứ tự bước hoặc `"phe_duyet"`), lưu DB **và** gán vào `d.placement_ky` trong bộ nhớ trước khi gọi `performFileStamp` — tránh đọc giá trị `placement_ky` cũ (stale) từ lúc đầu request.
- `placement` trong body request là optional — action `gui_ky`/`tra_ve` không cần, và Office file (docx/xlsx) truyền `null` (không dùng tọa độ, chỉ thay tag).

### 5. Reorder form soạn thảo (`new/page.tsx`)

Thứ tự section mới trong card "Thông tin văn bản": **File đính kèm** → **Phạm vi lưu hành** → Phân loại (Thường/Mật, chỉ Cong_ty) → Loại văn bản + Phòng ban → Mã văn bản → Tên/Trích yếu → Cấp văn bản (chỉ Cong_ty) → Ghi chú → Mô tả tìm kiếm AI. Lý do đưa 2 trường này lên đầu: File giúp auto-fill `ten_van_ban` sớm (hành vi `handleFileChange` không đổi); Phạm vi lưu hành quyết định nhánh hiển thị của nhiều section phía dưới (ẩn/hiện Phân loại, khóa cứng Cấp văn bản) nên cần chọn trước. Thay thế mô tả thứ tự cũ ("1. Phân loại... 9. File đính kèm... 11. Ghi chú") ở phần "Form soạn thảo (`new/page.tsx`)" phía trên nếu có mâu thuẫn.

### Việc chưa test tay (session sau nếu có báo lỗi)

- Test tay ký 1 văn bản PDF thật (cả `Cong_ty` lẫn `Don_vi`, cả bước phòng ban/cá nhân lẫn phê duyệt cuối) — xác nhận canvas hiển thị đúng trang PDF, kéo/resize khung chữ ký + tên hoạt động, PDF sau ký có chữ ký/tên đúng vị trí đã đặt.
- Test tay ký 1 văn bản DOCX/XLSX — xác nhận modal hiện đúng info box tag, không có canvas, file sau ký vẫn thay tag đúng như trước (không regression so với hành vi cũ).
- Test tay lại đúng case người dùng báo cáo: Phó giám đốc nhà máy soạn thảo + được gán ký bước 1 (`phong_ban_code` khớp phòng ban của họ) — xác nhận sau fix 3-way match, nút "Ký phòng ban" hiện đúng thay vì chỉ thấy "Trả về". Nếu vẫn sai, kiểm tra trực tiếp `profiles.department`/`department_id` của tài khoản đó và `departments` table để xác định nhánh nào trong 3-way match đang khớp/không khớp.
- Test tay upload file tên có dấu tiếng Việt (cả `new/page.tsx` và `new/upload/page.tsx`) — xác nhận không còn lỗi upload, file mở được bình thường sau khi lưu.

---

## Cập nhật 2026-07-06 (bổ sung sau test tay lần 1) — fix bug canKyBuoc thật, PDF nhiều trang, KT phòng ban, Sửa/Xóa danh sách

Sau khi bản "Cập nhật 2026-07-06" ở trên được test tay trên `npm run dev`, người dùng phát hiện bug "chỉ thấy Trả về" **vẫn còn** (fix 3-way match ở bản trước không đủ) cùng 3 vấn đề khác. Đã điều tra bằng 3 Explore agent song song và fix toàn bộ.

### Root cause thật của bug "chỉ thấy Trả về" — thiếu Authorization header, không phải data mismatch

`resolveUserDeptCode()` cục bộ trong `[id]/page.tsx` gọi `fetch(\`/api/documents/dept-code?userId=${uid}\`)` **không có header `Authorization`**. `dept-code/route.ts` gọi `requireAuthUser(req)` đầu tiên — hàm này throw khi thiếu token, nhưng route có `try/catch` bao ngoài nuốt lỗi và trả `{ code: null }` với **status 200** → `res.ok = true` phía client → `userDeptCode` luôn là `null` cho **mọi người dùng, mọi lúc**, bất kể 3-way match ở `src/lib/documents-dept.ts` (bản fix trước) có đúng hay không — logic đó không bao giờ được chạy tới vì request auth thất bại trước khi tới đó.

**Fix**: `resolveUserDeptCode` giờ lấy token qua `supabase.auth.getSession()` tại chỗ và gắn `Authorization: Bearer <token>` vào fetch, cùng pattern với `getAuthToken()`/`doAction` đã có trong file. Không cần sửa gì thêm ở `dept-code/route.ts` hay `documents-dept.ts`.

### PDF nhiều trang trong SignPlacementModal

`SignPlacementModal` (`[id]/page.tsx`) trước đây luôn `pdf.getPage(1)` và luôn ghi `page: 1` cứng khi ký — không đặt được chữ ký ở trang 2+ của văn bản dài. Backend (`stampPdfStep` trong `sign/route.ts`) đã hỗ trợ sẵn `placement.page` bất kỳ từ trước, không cần sửa. Đã thêm vào modal:
- `pdfDocRef` giữ document đã load, `currentPage`/`numPages` state.
- Hàm `renderPdfPage(pdf, pageNum)` tách riêng (tính lại viewport/scale mỗi lần đổi trang).
- UI điều hướng "Trang X / Y" + nút `ChevronLeft`/`ChevronRight`, chỉ hiện khi `numPages > 1`.
- `handleConfirm` dùng `page: currentPage` thay vì `1` cứng.
- Không tự động di chuyển lại khung chữ ký/tên khi đổi trang (giữ tọa độ cũ, `Draggable bounds="parent"` tự kẹp trong khung nhìn) — đơn giản hóa có chủ đích.
- Pattern tham khảo lấy từ modal đặt chữ ký cũ hơn trong `iso/documents/[id]/page.tsx` (không phải `SignPlacementModal` của ISO forms — modal đó cũng có cùng giới hạn 1 trang, không đụng tới, ngoài phạm vi).

### Chữ "KT." cho bước ký phòng ban — chọn lúc ký, in vào file đã ký

Trước đây "KT." (Phó ký thay) chỉ có ở bước Phê duyệt cuối (`phe_duyet_is_kt`, chọn lúc soạn thảo) và chỉ là UI-only (không in vào file đã ký). Đã bổ sung:
- Checkbox "Ký thừa ủy quyền — Phó ký thay, thêm KT. trước chức danh" **trong `SignPlacementModal`**, chỉ hiện khi `allowKt = signModal === "ky_buoc" && currentStep?.type === "phong_ban"` (không áp dụng bước `ca_nhan` hay `phe_duyet` — 2 case đó có cơ chế riêng).
- `onConfirm` đổi signature thành `(pin, placement, isKt)`. `nguoi_ky[stepIndex+1]` lưu thêm `is_kt?: boolean` (đã thêm field này vào cả 3 nơi định nghĩa type trùng nhau: `VanBanDocument.nguoi_ky` trong `documents-types.ts`, `NguoiKyEntry` cục bộ trong `[id]/page.tsx`, `VanBanRow.nguoi_ky` trong `sign/route.ts`).
- Server double-check `isKt = !!body.is_kt && step.type === "phong_ban"` (không tin client hoàn toàn).
- **Retrofit `phe_duyet_is_kt`**: trước đây chỉ hiển thị "KT. " trên UI timeline, không in vào file. Giờ `sign/route.ts` đã thêm `phe_duyet_is_kt` vào `DOC_SELECT`/`VanBanRow` type; cả 2 nhánh `ky_buoc` và `phe_duyet` đều tính `displayName = isKt/doc.phe_duyet_is_kt ? \`KT. ${userName}\` : userName` rồi truyền `displayName` (không phải `userName` gốc) vào `performFileStamp(...)` — chữ "KT." giờ xuất hiện cả trong PDF vẽ trực tiếp lẫn tag DOCX/XLSX (`buildStepTags` nhận nguyên `signerName` nên chỉ cần đổi giá trị truyền vào, không cần đổi signature hàm nào khác).
- **Quan trọng**: giá trị lưu vào cột `phe_duyet` trong DB (tên người phê duyệt) vẫn giữ nguyên KHÔNG có tiền tố "KT." — chỉ giá trị truyền vào `performFileStamp` mới có prefix. Tránh double-prefix vì UI `[id]/page.tsx` tự thêm "KT. " lúc hiển thị dựa vào `doc.phe_duyet_is_kt`.
- Timeline UI (`[id]/page.tsx`) bước phòng ban: `sublabel` giờ thêm tiền tố `${nguoiKyEntry.is_kt ? "KT. " : ""}${nguoiKyEntry.ten}`.

### Trang danh sách văn bản — nút Sửa/Xóa, đổi hành vi icon Xem

`src/app/dashboard/documents/page.tsx` trước đây **không load user/permission nào cả** — đã thêm bootstrap `hydrateActiveSession()` để có `user` + `isAdmin`.

- **Icon "Xem"**: đổi từ mở file thô (`<a href={doc.file_signed_pdf_url} target="_blank">`, chỉ hiện khi có file) sang `<Link href={/dashboard/documents/${doc.id}}>` — luôn hiện, mở đúng trang chi tiết phản ánh trạng thái hiện tại của văn bản.
- **Nút "Sửa"** (Pencil, amber): hiện khi `(doc.soan_thao_user_id === user?.id || isAdmin) && (trang_thai === "draft" || "tra_ve")`. Click gọi `openEdit(docId)` — fetch **fresh full row** (`select("*")`, không dùng row rút gọn của list) rồi mở `EditDocModal`.
- **`EditDocModal`** (component mới cuối `page.tsx`): sửa nhanh — chỉ `ten_van_ban`, `ghi_chu`, `mo_ta_tim_kiem`, và danh sách bước ký (`thu_tu_ky_json`): step builder phòng ban (loại trừ `approverDept`, kèm dropdown đích danh nếu `phan_loai === "Mat"`) cho `pham_vi = "Cong_ty"`, hoặc chọn người ký xác nhận tuần tự cho `Don_vi` — mirror rút gọn đúng logic step builder của `new/page.tsx`. **Không** cho sửa loại VB, phòng ban soạn thảo, mã VB, cấp VB, phạm vi, người phê duyệt, file.
- **Nút "Xóa"** (Trash2, đỏ): hiện khi `hasPermission(user, "documents.delete")` **và** (`isAdmin` hoặc `trang_thai` là `draft`/`tra_ve`) — permission `documents.delete` đã seed sẵn cho admin (không có cho manager/user, xem `20260522_iso_vanban_module.sql`). Click mở `ModalShell` xác nhận, confirm gọi `.delete().eq("id", docId)` rồi reload danh sách. Đây là lần đầu module Văn bản có delete cho `van_ban_documents` — trước đây hoàn toàn chưa có.

### Việc chưa test tay (session sau nếu có báo lỗi)

Tất cả các thay đổi trên mới qua `npx tsc --noEmit` + `npx eslint` (đều sạch), **chưa test tay trên trình duyệt thật**:
- Đăng nhập lại đúng tài khoản Tô Thành Luân, mở văn bản Cong_ty có bước ký gán đúng phòng ban của tài khoản — xác nhận nút "Ký phòng ban" hiện đúng lần này.
- Ký 1 PDF ≥2 trang, đặt chữ ký ở trang 2+ — xác nhận chuyển trang trong modal hoạt động và file sau ký có chữ ký đúng vị trí/trang.
- Tick "KT." khi ký 1 bước phòng ban — xác nhận file PDF/Word sau ký có "KT. <tên>", và timeline trang chi tiết cũng hiện đúng.
- Tick "Phó ký thay" lúc soạn thảo rồi phê duyệt — xác nhận file đã ký giờ cũng có "KT. " (trước đây chỉ UI có).
- Test nút Sửa (đổi tên/ghi chú/bước ký) với tài khoản là người soạn thảo lúc draft; xác nhận nút ẩn đúng khi đã chờ ký; test nút Xóa theo đúng quyền + trạng thái; test icon mắt mở đúng trang chi tiết ở mọi trạng thái.

## Cập nhật 2026-07-06 (phiên 2) — Fix bug phân quyền Phê duyệt/Trả về, tổng quát hóa KT. thành KT./TM./TL./TUQ.

### 1. Bug đã fix: bất kỳ ai có quyền `documents.phe_duyet` đều thấy nút Phê duyệt/Trả về, không chỉ người được chỉ định

**Root cause**: `canPheDuyet`/`canTraVe` (`[id]/page.tsx`), nhánh `cho_phe_duyet` trong `my-tasks/page.tsx`, và `getDocumentsTasks()` (`module-tasks.ts`, feed chuông "Việc cần làm") đều gate theo `hasPermission(user, "documents.phe_duyet")` — quyền này thường cấp rộng cho nhiều lãnh đạo/trưởng phòng, không phải chỉ người được chỉ định `phe_duyet_user_id` trên chính văn bản đó. Hệ quả quan sát được: 2 người khác nhau (Phó GĐ và 1 trưởng phòng) cùng thấy nút Phê duyệt trên cùng 1 văn bản.

**Nghiêm trọng hơn UI**: server-side `sign/route.ts` (`action === "phe_duyet"` và `action === "tra_ve"`) **cũng dùng cùng kiểu gate** `hasPermission("documents.phe_duyet")` — nghĩa là bug không chỉ hiện sai nút, mà API thật sự cho phép bất kỳ ai có quyền chung này phê duyệt/trả về thay người được chỉ định.

**Fix — cả 2 tầng, đồng bộ theo `doc.phe_duyet_user_id === user.id` (hoặc admin)**:
- `[id]/page.tsx`: `isPheDuyetNguoi = isAdmin || doc.phe_duyet_user_id === user?.id`; `canPheDuyet`/`canTraVe` dùng biến này thay `hasPermission(...)`. Nhánh `canTraVe` ở `cho_ky_phong_ban` giữ nguyên `canKyBuoc || isPheDuyetNguoi` (chỉ tightening từ broad permission xuống đúng người, không xóa khả năng approver trả về sớm).
- `my-tasks/page.tsx`: nhánh `cho_phe_duyet` đổi thành `isAdmin || doc.phe_duyet_user_id === uid`.
- `module-tasks.ts`: thêm `phe_duyet_user_id` vào SELECT của `getDocumentsTasks()`, đổi điều kiện đếm `pheDuyetCount` tương tự.
- `sign/route.ts`: action `phe_duyet` đổi guard thành `!isAdmin && d.phe_duyet_user_id !== userId → 403`; action `tra_ve` đổi `canReturn` khởi tạo thành `isAdmin || d.phe_duyet_user_id === userId` (thay vì `isAdmin || hasPermission(...)`), giữ nguyên nhánh bổ sung theo bước ký phòng ban (`step.phong_ban_code`/`step.user_id`).
- Đã verify chéo: `iso/my-tasks/page.tsx` (module ISO tài liệu) từ trước đã gate đúng theo `phe_duyet_user_id`, xác nhận đây là bug cục bộ của module Văn bản, không phải pattern chung toàn app.

### 2. Tổng quát hóa "KT." thành 4 lựa chọn KT./TM./TL./TUQ., chọn lúc ký thay vì lúc soạn thảo

Quyết định đã xác nhận với người dùng: áp dụng cho **cả 2** bước (ký phòng ban lẫn Phê duyệt cuối), và **KHÔNG cần** cho DOCX/XLSX (chỉ áp dụng khi file đang ký là PDF).

- `documents-types.ts`: thêm `SignAsType = "none"|"KT"|"TM"|"TL"|"TUQ"`, `SIGN_AS_OPTIONS`, `SIGN_AS_LABEL`. `nguoi_ky` entries thêm `sign_as?: SignAsType` (giữ `is_kt?: boolean` để đọc dữ liệu cũ). `VanBanDocument` thêm `phe_duyet_sign_as: SignAsType | null` (giữ `phe_duyet_is_kt` — LEGACY, chỉ đọc).
- Migration `20260706_van_ban_sign_as.sql`: `ALTER TABLE van_ban_documents ADD COLUMN IF NOT EXISTS phe_duyet_sign_as TEXT` — **cần chạy thủ công**. Không đổi/xóa `phe_duyet_is_kt` (văn bản cũ đã duyệt trước ngày này vẫn hiển thị đúng qua fallback).
- **Cơ chế mới thay thế hoàn toàn cơ chế cũ đã mô tả ở section "Chữ KT." cho bước ký phòng ban" phía trên** (section đó nay là lịch sử, xem đây là bản thay thế):
  - `SignPlacementModal` (`[id]/page.tsx`): checkbox cũ → radio "Ký trực tiếp / KT. / TM. / TL. / TUQ.", chỉ hiện khi `showSignAsPicker = allowSignAs && showCanvas` (`allowSignAs` = true cho cả `ky_buoc` bước `phong_ban` lẫn toàn bộ `phe_duyet`; `showCanvas` = file là PDF).
  - Thêm hộp kéo-thả thứ 3 "Tiền tố" (`prefixState`, viền xanh emerald) — chỉ render khi `signAs !== "none"`, độc lập tọa độ với hộp tên. `SignPlacement` type thêm `showPrefix?/prefixX?/prefixY?/prefixWidth?/prefixHeight?`.
  - `onConfirm` đổi signature `(pin, placement, signAs: SignAsType)` (thay `isKt: boolean`); `handleSignConfirm` gửi `sign_as` (thay `is_kt`) lên `/api/documents/sign`.
  - Timeline: helper `signAsPrefixLabel(signAs, legacyIsKt)` — ưu tiên `sign_as`/`phe_duyet_sign_as`, fallback `is_kt`/`phe_duyet_is_kt` cho dữ liệu cũ. Dùng cho cả sublabel bước ký phòng ban lẫn Phê duyệt.
  - `sign/route.ts`: `performFileStamp`/`stampPdfStep` thêm tham số `prefixText: string | null` — **chỉ vẽ hộp riêng trên PDF** (`placement.showPrefix` + `prefixX/prefixY`), **KHÔNG ghép vào `signerName`** dùng cho tag DOCX/XLSX (`{{TEN_BUOC_N}}`/`{{TEN_PHE_DUYET}}` luôn nhận tên thuần, không có tiền tố — đúng yêu cầu "DOCX/XLSX không cần"). `ky_buoc` lưu `nguoi_ky[step].sign_as` (không còn `is_kt`); `phe_duyet` lưu vào cột `phe_duyet_sign_as` (không còn ghi `phe_duyet_is_kt`).
  - Checkbox "Phó ký thay" ở `new/page.tsx` (soạn thảo Cong_ty/Don_vi) đã **xóa hẳn** — chọn ký thay giờ chỉ còn ở lúc ký (SignPlacementModal).
  - `new/upload/page.tsx` (upload văn bản ký tay) là **ngoại lệ**: flow này không đi qua SignPlacementModal (không có bước ký live, toàn bộ lịch sử ký được ghi nhận 1 lần lúc lưu) — đổi checkbox cũ thành radio 5 lựa chọn tương tự, ghi thẳng vào `phe_duyet_sign_as` lúc insert, không qua sign-time.

### Việc chưa test tay (bổ sung — session sau)

- Test tay đăng nhập lần lượt 2 tài khoản khác nhau cùng có quyền `documents.phe_duyet` trên 1 văn bản `cho_phe_duyet` — chỉ đúng người có `phe_duyet_user_id` khớp mới thấy nút Phê duyệt/Trả về; người còn lại không thấy nút và gọi thẳng API cũng phải nhận `403`.
- Test tay ký 1 bước phòng ban chọn "TM." trên PDF — xác nhận hộp tiền tố kéo-thả riêng hoạt động, PDF sau ký có "TM." đúng vị trí đã đặt, tách biệt khỏi tên.
- Test tay Phê duyệt cuối chọn "TUQ." — xác nhận PDF có tiền tố đúng, và file DOCX/XLSX (nếu test) **không** bị chèn tiền tố vào tên.
- Test tay upload văn bản ký tay chọn "TL." — xác nhận `phe_duyet_sign_as` lưu đúng, hiển thị đúng trên timeline trang chi tiết.
- Mở lại 1 văn bản cũ đã có `phe_duyet_is_kt = true` (trước migration) — xác nhận timeline vẫn hiện "KT. " qua fallback, không bị mất hiển thị.

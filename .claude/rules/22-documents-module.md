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
| `20260611_van_ban_distribution.sql` | Bảng `van_ban_distribution_batches`, `van_ban_distribution_recipients`; RLS; seed permission `documents.distribute` cho admin/manager | **Cần chạy lại** — bản gốc có bug (xem 2026-07-24) khiến chưa từng chạy thành công |
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

## Trang in văn bản — ĐÃ XOÁ (2026-09-03)

Route `/dashboard/documents/print/?docId={uuid}` (trang HTML dựng lại riêng, hoàn toàn tách biệt
với file PDF/DOCX đã ký thật) và nút "In" trên `[id]/page.tsx` đã bị xoá hẳn — xem CLAUDE.md mục
"Cập nhật (2026-09-03)". File thật đã ký vẫn xem được qua nút "Xem file" (dùng
`file_signed_pdf_url`/`file_signed_office_url`/`file_goc_url`) đã có sẵn ở trang chi tiết.

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


## Lịch sử fix chi tiết (2026-06-21 → 2026-08-01)

Nhật ký đầy đủ từng bug đã fix (phân quyền Phê duyệt/Trả về theo đúng `phe_duyet_user_id`,
tổng quát hóa tiền tố ký thay KT./TM./TL./TUQ., QR trên file đã ký, sửa lỗi migration
`20260611_van_ban_distribution.sql` (permission INSERT sai cột gây rollback), thêm xác thực
server cho `/api/documents/distribute`, nút "Thay file" khi bị trả về, văn bản không có mã...)
đã chuyển sang `.claude/history/22-documents-module-history.md` (không tự nạp context).

Toàn bộ các fix đó đã qua `tsc`/`eslint`/`npm run build` sạch nhưng **chưa được test tay
xác nhận** tính đến 2026-08-01 — nếu người dùng báo lỗi liên quan tới ký duyệt/QR/upload văn
bản, đọc file lịch sử để biết chi tiết implementation trước khi sửa lại.

---

## "Vị trí CỨNG" — áp mẫu `mau_vi_tri` vào route ký thật (2026-09-04, Phần C)

Từ nay mọi lượt **"Gửi ký"** văn bản nguồn **PDF** đều đi qua màn `/dashboard/ky/mau-vi-tri`,
và mẫu vị trí được **chốt (snapshot)** vào `van_ban_documents.placement_ky` ngay trong câu
UPDATE của action `gui_ky`. Các bước ký sau đó **chỉ hỏi PIN** — không còn canvas kéo-thả,
không còn radio "Ký thay" (tiền tố lấy thẳng từ mẫu).

### Nguyên tắc nền

- **Hệ toạ độ trùng khớp tuyệt đối**: `mau_vi_tri.khung[].x_pt/y_pt/w_pt/h_pt` đã là *point,
  gốc dưới-trái* — đúng hệ pdf-lib. Tuyệt đối **không** quy đổi thêm, **không** dùng
  `coords.ts` (file đó dành cho jsPDF mm/top-left).
- **Snapshot, không join sống**: admin sửa mẫu giữa chừng không làm lệch văn bản đang luân
  chuyển dở. `placement_ky._mau` ghi `{loai_tai_lieu, phien_ban, chot_luc}`.
- **Tách 2 luồng tự động theo cờ `tu_mau`**: entry nào có `tu_mau: true` → đường mới; không có
  → `stampPdfStep` cũ **giữ nguyên không sửa 1 dòng**. Văn bản gửi ký trước 2026-09-04 vì vậy
  chạy y hệt như cũ. Kiểm **theo TỪNG BƯỚC**, không phải cả văn bản — mẫu thiếu khung cho bước
  nào thì riêng bước đó rơi về canvas cũ, không chặn ký.

### Ánh xạ vai trò mẫu → `placement_ky` (`src/lib/signing/apply-template.ts`)

| Vai trò mẫu | Key | Quy tắc |
|---|---|---|
| `ky_buoc`, `ky_buoc__banN` | `"1"`, `"2"`… | Mỗi bản nhân bản = **1 BƯỚC KÝ KHÁC NHAU**. Sắp theo `cloneIndexOf()` rồi lấy **index mảng** làm số bước (id có thể không liên tục: `ky_buoc`, `__ban2`, `__ban4` → bước 1,2,3). Cắt theo `so_buoc_tong` |
| `phe_duyet`, `phe_duyet__banN` | `"phe_duyet"` | Ngược lại — **CÙNG 1 người ký ở nhiều vị trí**, gộp hết vào `boxes[]` của 1 entry |
| `qr` / `ngay_ky` / `ghi_chu` | cùng tên | Cấp văn bản, `{tu_mau, boxes[]}` |

Không có khung ký nào (chỉ qr/ghi_chu) → `buildPlacementKyFromTemplate` trả `null` → giữ
nguyên `placement_ky = {}` như cũ.

### Quy tắc vẽ

- **2 công tắc ĐỘC LẬP** `show_name` / `show_chuc_vu` — file PDF gốc có thể đã in sẵn tên
  và/hoặc chức vụ, chỉ người soạn thảo biết cần đè cái nào. Chia dải khung: tắt cả hai → ảnh
  chữ ký chiếm **trọn** khung; bật 1 → chữ ký 72% + dòng đó; bật cả 2 → 55% / tên / chức vụ.
  **Mẫu lưu trước 2026-09-04 chỉ có `show_name`** → mọi nơi đọc phải fallback
  `show_chuc_vu ?? show_name` (giữ ý nghĩa "bật là bật cả hai").
- **Chức vụ** tra `maintenance_staff.chuc_vu_chinh_quyen || chuc_vu` (mirror
  `signer-info/route.ts`). `chuc_vu_key` = `kiem_nhiem`/`doan_the` **trả rỗng** — DB chưa có 2
  cột này (gap chưa chốt cách migrate, **không tự bịa nguồn khác**).
- **Neo trang** (`resolveAnchorPages`): `dau` → trang `so_trang` (clamp); `cuoi` → trang cuối;
  `moi_trang` → mọi trang (ký nháy).
- **`ghi_chu` vẽ 1 lần** ở lượt đóng dấu đầu tiên (`"1"` nếu Cấp 1 có bước, ngược lại
  `"phe_duyet"`); **`ngay_ky` vẽ 1 lần** ở bước `phe_duyet`, giá trị = ngày ban hành. Vẽ 1 lần
  duy nhất để tránh chồng nét qua nhiều lượt (bài học `maintenance-pdf.ts`).
- **Tiền tố ký thay** dùng `drawTextFit` canh giữa **trên mép trên khung** (không dùng
  `drawSignPrefix` — hàm đó canh trái, không nhận chiều rộng). Vẫn giữ rule cũ: chỉ áp dụng cho
  bước `phong_ban`, không áp dụng `ca_nhan`.
- **Mẫu không đặt khung QR** → giữ fallback góc trên-phải mọi trang như luồng cũ, để không im
  lặng làm mất QR tra cứu công khai.

### Chống ghi đè

Khi bước đã khoá: route **bỏ qua** `placement` và `sign_as` client gửi lên (`placement &&
!lockedStep`), lấy `sign_as` từ chính entry mẫu. Client cũng tự ẩn canvas/picker
(`lockedPlacement` → `showCanvas = false`, `handleVerifyPin` gọi thẳng `onConfirm`).

### Office (DOCX/XLSX)

Không đi qua màn mẫu (dùng tag `{{...}}`), **không bao giờ** được gieo `tu_mau`. Chỉ bổ sung
tag tuỳ chọn mới `{{GHI_CHU}}` vào `buildStepTags` cho mọi bước — template không có tag thì tự
bỏ qua, thay lặp qua các bước là vô hại (sau lượt đầu tag đã biến mất khỏi file).

### Không cần migration

`placement_ky` là JSONB tự do; cột `ghi_chu` đã tồn tại. `SignTemplateBox.show_chuc_vu` là
field optional thêm vào JSONB `mau_vi_tri.khung`.

---

## Ngày phê duyệt theo múi giờ nhà máy + Loại VB tùy chọn khi không có mã (2026-09-04)

### Bug đã fix: ngày phê duyệt lệch 1 ngày (00:00–06:59 sáng)

`api/documents/sign/route.ts` có 2 chỗ tính "ngày hôm nay", cả hai đều sai với nhà máy ở UTC+7:

| Chỗ | Code cũ | Vấn đề |
|---|---|---|
| action `phe_duyet` | `new Date().toISOString().slice(0,10)` → lưu `ngay_phe_duyet` | Luôn tính theo **UTC** |
| `performFileStamp` | `new Date().toLocaleDateString("vi-VN", {…})` → in lên PDF + tag `{{NGAY_BAN_HANH}}`/`{{NGAY_KY_BUOC_N}}` + khung `ngay_ky` của mẫu vị trí | **Không truyền `timeZone`** → dùng TZ server: đúng ở localhost (máy UTC+7), **sai trên Vercel (UTC)** |

Cửa sổ lệch: **00:00–06:59 sáng giờ địa phương** — bấm duyệt 05:00 ngày 04/09 bị ghi thành 03/09.
Đã đo bằng code thật: sai đúng **7/24** khung giờ. Nhật ký có thao tác thật rơi vào khung này
(`doc_approval_log` lúc `2026-09-02T23:34:16Z` = 06:34 sáng 03/09 giờ VN).

**Fix**: 2 helper mới trong `src/lib/date-utils.ts` — `FACTORY_TIME_ZONE = "Asia/Ho_Chi_Minh"`,
`getFactoryTodayISO()` (`YYYY-MM-DD`), `formatFactoryDateVN()` (`dd/mm/yyyy`), đều dùng
`Intl.DateTimeFormat` với `timeZone`. Route ký thay đúng 2 chỗ trên.

⚠️ `getTodayISODate()` sẵn có **cũng dùng UTC** (cùng lỗi) nhưng module KPI đang dùng để so ngày
→ **cố ý KHÔNG sửa**, đã ghi chú cảnh báo ngay cạnh hàm. Code mới cần "hôm nay" theo nghiệp vụ
phải dùng `getFactoryTodayISO()`.

Các `new Date().toISOString()` còn lại trong route (`updated_at`, `ky_at`, `tra_ve_at`) là
timestamp đầy đủ, không cắt lấy phần ngày → không bị lệch, không đụng.

### `loai_van_ban` tùy chọn khi tick "Văn bản này không có mã"

Trước đây cả 2 trang đều bắt buộc `loai_van_ban` kể cả khi không có mã — vô lý vì người dùng
hiểu trường này chỉ để sinh mã. Thực tế nó còn là **khóa chọn mẫu vị trí ký**
(`mau_vi_tri.loai_tai_lieu`) và dùng để lọc/thống kê/tìm bằng AI.

- **`new/upload/page.tsx` (Upload ký tay)**: luồng này **không bao giờ** dùng mẫu vị trí ký (văn
  bản đã ký tay trên giấy) → `loai_van_ban` chỉ còn ý nghĩa phân loại ⇒ **tùy chọn** khi
  `khongCoMa`, payload ghi `|| null` (cột đã nullable, không cần migration). Nhãn động bỏ dấu `*`
  và hiện chú thích.
- **`new/page.tsx` (Soạn thảo)**: **giữ bắt buộc** — thiếu nó sẽ không chọn được mẫu vị trí ký.
  Chỉ thêm chú thích giải thích khi tick "không có mã".

---

## Người ký ĐỌC được PDF + xê dịch 3 khối trong khung mẫu (2026-09-05, việc 1)

Phần C ("vị trí CỨNG") ban đầu làm bước ký chỉ còn hộp PIN — người ký **không nhìn thấy nội
dung văn bản** trước khi ký. Nay đổi ngữ nghĩa khung mẫu từ *"vị trí đóng dấu cố định"* thành
**"vùng cho phép"**.

### Module thuần dùng chung `src/lib/signing/template-layout.ts`

**KHÔNG import pdf-lib** (nếu import, UI sẽ kéo cả pdf-lib vào bundle client). Chứa types +
`resolveAnchorPages`, `computeDefaultSubLayout`, `clampRectToBox`, `sanitizeSignerSubLayout`,
`applySignerLayoutToEntry`, `resolveEffectiveSubLayout`. `apply-template.ts` re-export lại các
type/`resolveAnchorPages` cho nơi đang import sẵn.

UI (`documents/[id]/page.tsx`) và server (`api/documents/sign/route.ts` → `apply-template.ts`)
**dùng chung đúng các hàm này** ⇒ bản xem trước và bản đóng dấu không thể lệch nhau.

### Bố cục 4 khối con

`TemplateSignBox.layout?: SignerSubLayout` (`{ sig, name, chuc_vu, prefix, show_* }`, hệ
**point**) — lưu thẳng vào `placement_ky` (JSONB, **không cần migration**). Không có `layout` =
văn bản ký trước bản này → `resolveEffectiveSubLayout` rơi về công thức chia dải cũ
(0.55 / 0.72 / 1.0), **giao diện không đổi 1 pixel**.

- UI giữ state ở **point** (không phải canvas px) vì mỗi trang PDF có thể khác khổ giấy; quy
  đổi sang px chỉ lúc render (`toCanvas`), đổi ngược bằng `toPdf` khi kéo xong.
- Kéo bị chặn 2 lớp: `bounds="parent"` (parent = div "vùng cho phép") **và** `clampRectToBox`.
- **Server BẮT BUỘC kẹp lại** — `applySignerLayoutToEntry` chạy trong cả `ky_buoc` lẫn
  `phe_duyet`. Gọi thẳng API với toạ độ ngoài vùng cũng không thoát ra được. Khung mẫu
  (`x/y/width/height`) client **không sửa được**, chỉ gửi được `layout` bên trong.
- Toggle Tên/Chức danh **đặt lại bố cục mặc định** của cả khung (tỉ lệ chia dải phụ thuộc số
  khối đang hiện). Nút toggle đặt NGOÀI khối (dưới vùng cho phép) để còn bật lại sau khi tắt.

### Quy tắc 2 TẦNG — `show_name`/`show_chuc_vu` ĐỔI NGHĨA

| Mẫu (người soạn thảo) | Người ký thấy gì |
|---|---|
| **Bật** | Thấy khối và **tắt/mở tự do** |
| **Tắt** | **Không thấy**, không có cách nào bật lên |

Tức mẫu chuyển từ *"có vẽ hay không"* → ***"có CHO PHÉP hiển thị hay không"***; lựa chọn thực
tế của người ký lưu trong `layout.show_name`/`show_chuc_vu`. Khối chức danh còn cần có chức vụ
thật (`maintenance_staff` qua `/api/documents/signer-info`) mới hiện.

⚠️ `TEMPLATE_SIGNER_NAME_STYLE` (apply-template.ts) = `VAN_BAN_SIGNER_NAME_STYLE` nhưng
`minMaxWidth: 0`. Bản gốc ép bề rộng tên ≥ 60pt kể cả khi khung hẹp hơn ⇒ chữ tràn ra NGOÀI
khối người ký vừa kéo, phá vỡ cam kết "chỉ xê dịch trong vùng cho phép".

### Tiền tố ký thay KT./TM./TL./TUQ. — khối con thứ 4 (2026-09-05)

Trước đây vẽ **cứng NGOÀI mép trên khung** (`y = box.y + box.height`), không kéo/tắt được. Nay:

- Là 1 khối con như 3 khối kia, **vùng cho phép = chính khung ký** (không mở rộng ra ngoài).
- `computeDefaultSubLayout` nhận thêm `withPrefix`: tiền tố chiếm **dải trên cùng 16%** chiều cao
  khung, 3 khối còn lại chia theo đúng tỉ lệ cũ trên phần chiều cao **còn lại**.
  ⚠️ **Đổi bố cục mặc định có chủ đích** cho khung CÓ `sign_as`; khung không có `sign_as` ⇒
  `innerH === box.height` ⇒ không đổi 1 pixel.
- Người ký **tắt được**. Tắt trên MỌI khung của bước ⇒ route ghi `sign_as = "none"` cho bước đó
  (`signerTurnedPrefixOff()` trong `sign/route.ts`) — tắt tiền tố = **không ký thay nữa**, để
  timeline không hiện "KT." trong khi PDF không có. Còn 1 khung hiện tiền tố thì vẫn là ký thay.
- Quy tắc 2 tầng: mẫu không chọn `sign_as` ⇒ không có khối này, người ký không bật lên được
  (`prefixAvailable`).

---

## Khung "Ghi chú" = ô Ý KIẾN CHỈ ĐẠO lúc phê duyệt (2026-09-05, việc 2)

**Code trước đây hiểu SAI mục đích**: in `van_ban_documents.ghi_chu` (ghi chú người soạn thảo
nhập lúc tạo) vào khung này, ở lượt đóng dấu ĐẦU TIÊN. Thực tế đây là ô để **lãnh đạo gõ ý kiến
chỉ đạo ngay tại bước phê duyệt**.

- Cột mới `ghi_chu_phe_duyet TEXT` (migration `20260904_van_ban_ghi_chu_phe_duyet.sql`).
- Vẽ ở **bước `phe_duyet`** (không phải lượt đầu), bằng `drawTextWrapped()` — hàm mới trong
  `stamp-pdf.ts`, wrap nhiều dòng + tự thu nhỏ + cắt `…` khi tràn. `drawTextFit()` cũ chỉ vẽ
  **1 dòng** và tràn ra ngoài khung ở cỡ chữ nhỏ nhất.
- **Khung Ghi chú là "vùng cho phép" chứa 2 khối con kéo/resize được** (2026-09-05):
  `TemplateNoteBox.layout?: NoteSubLayout` = `{ text, ky_nhay }`. Lý do: ý kiến dài có thể **đè
  lên chữ sẵn có của văn bản** mà lãnh đạo không né được, vì mẫu có khi cho đặt khung ở bất kỳ
  đâu. Bố cục **mặc định** vẫn y hệt trước (ký nháy góc trên-phải, ô text = khung trừ dải trên) —
  `computeDefaultNoteLayout()` giữ nguyên công thức, nên văn bản dở dang không đổi.
- **Chữ ký nháy**: dùng thu nhỏ chính `signatures/{factory}/{user}/chu_ky.png` — không có mục
  upload ảnh ký nháy riêng. Chỉ lãnh đạo phê duyệt có; `ky_buoc` không có. Từ 2026-09-05 **kéo/
  resize được** trong khung (trước đây cố định góc trên-phải).
- Vì 2 khối đã tách rời, `drawGhiChuBox` gọi `drawTextWrapped` với `reserveTopHeight = 0` —
  việc chừa dải trên nay do **bố cục mặc định** đảm nhiệm, không phải tham số vẽ.
- Xem trước wrap ở UI dùng CSS ⇒ **xấp xỉ** vị trí xuống dòng thật (pdf-lib đo theo font
  TimesNewRoman). Đủ để né chữ; không cam kết khớp từng dòng.
- **Không nuốt âm thầm**: mẫu CÓ khung mà lãnh đạo chưa nhập gì VÀ chưa bấm "Không ghi ý kiến"
  → **chặn ký** (banner đỏ ở UI **và** HTTP 400 ở server — không chỉ chặn UI).
- **Tắt khung Ghi chú thì chữ ký nháy mất theo** (một thao tác, không tách rời).
- **Mẫu KHÔNG đặt khung Ghi chú → lãnh đạo không có ô nhập, cũng KHÔNG có chữ ký nháy** ở bất
  kỳ đâu (đã chốt — không tự sinh vị trí mặc định nào).

---

## Tag ngày ký: tick xanh + chữ xám mờ có giây (2026-09-05, việc 3)

- Cột mới `ky_phe_duyet_at TIMESTAMPTZ` (cùng migration trên). `ngay_phe_duyet` chỉ là DATE;
  `updated_at` bị mọi thao tác sau ghi đè nên không dùng làm mốc ký được.
- Khung `ngay_ky` của mẫu giờ vẽ `✓ Văn bản được ký dd/mm/yyyy hh:mm:ss` — tick **xanh
  `rgb(0.06,0.6,0.35)`**, chữ **xám `rgb(0.45,0.45,0.45)`**, canh giữa khung.
- ⚠️ Tick vẽ bằng **2 `drawLine`**, KHÔNG dùng ký tự `✓` — `TimesNewRoman.ttf` có thể thiếu
  glyph (bài học ký tự Unicode ở `.claude/rules/14-maintenance-module.md`).
- Giờ lấy từ `formatFactoryDateTimeVN()` (`date-utils.ts`, `en-GB` 24h + `timeZone` nhà máy).
  `performFileStamp` đọc `d.ky_phe_duyet_at` (route đã set vào `d` trước khi gọi) nên ngày in
  trên PDF khớp tuyệt đối với dữ liệu đã lưu.

---

## Khung QR: người ký ĐẦU TIÊN xê dịch, các lượt sau chỉ xem (2026-09-05)

Trước đây màn ký (chế độ mẫu) **không hiện QR** — người ký không biết QR rơi vào đâu.

- `TemplateQrBox.layout?: LayoutRect` — 1 rect trong khung QR của mẫu.
- `qrLayoutAlreadySet(entry)` quyết định còn chỉnh được không; route chỉ ghi **đúng 1 lần**
  (`mergeTemplateQrLayout()` trong `sign/route.ts`, mirror `mergeQrBox()` cũ "đã có thì thôi").
  Lý do: QR là dữ liệu **cấp văn bản**, vẽ trên mọi trang theo neo — để mỗi bước ký một vị trí
  khác nhau sẽ ra QR lệch nhau giữa các lượt đóng dấu.
- `resolveEffectiveQrRect(box)`: có layout → dùng (đã kẹp); không có → **trọn khung** (hành vi cũ).
  Dùng ở cả `stampPdfWithTemplate` lẫn nhánh hỗn hợp `qrFromTemplate` của `stampPdfStep`.
- UI: `lockedQrAdjustable` → khối `QRCodeSVG` kéo/resize (khoá tỉ lệ) trong vùng cho phép tím;
  ngược lại chỉ xem, nhãn "QR đã chốt ở lượt ký trước".

---

## Việc 4 & 5 (2026-09-05)

- **Dropdown neo trang** (`ky/mau-vi-tri/page.tsx`) giờ hiện ở **cả khi khung đã đặt** — trước
  đây chỉ render trong nhánh `!role.placed` nên muốn đổi neo phải xoá khung đặt lại. Hàm mới
  `changeRoleAnchor()` đổi thẳng `role.anchor` và **nắn `role.page`** theo neo (`cuoi` → trang
  cuối, `moi_trang` → trang 1) để round-trip lưu→nạp lại không lệch toạ độ khi các trang khác
  khổ giấy. Áp dụng cho **mọi vai trò**, không riêng QR.
- **Nhãn nút** ở trang chi tiết: `docExt === "pdf"` → **"Vào cài đặt vị trí"** (bấm là VÀO màn
  cài đặt; việc gửi ký chỉ xảy ra sau khi xác nhận vị trí ở màn đó — nhãn phải mô tả đúng hành
  động ngay lập tức); file Office giữ **"Gửi ký"** (đi thẳng, dùng tag `{{…}}`).

---

## Tự kiểm chứng (2026-09-05) — 158 assertion, gọi thẳng code thật

`npx tsc --noEmit` sạch toàn repo; `npx eslint` 0 lỗi (4 warning `<img>`, 2 pre-existing).

Chạy `node --experimental-strip-types` + resolve hook `@/`→`src/`, import **file thật** (không
phải bản copy):

- **102 assertion logic** (`template-layout.ts`): mọi rect "tấn công" (âm, khổng lồ, NaN, sai
  kiểu, `null`) đều bị kẹp vào khung — cho **cả 4 loại khối** (sig/name/chức danh **+ prefix**),
  ô text + ký nháy của khung Ghi chú, và rect QR; công thức chia dải mặc định khớp **đúng số**
  công thức cũ (`withPrefix: false` ⇒ giống hệt không truyền); quy tắc 2 tầng cho cả tiền tố
  (mẫu không chọn `sign_as` ⇒ không bật lên được); `computeDefaultNoteLayout` giữ đúng hành vi
  cũ (ký nháy bám mép trên-phải, ô text nằm dưới); `qrLayoutAlreadySet` đúng 3 nhánh; khung mẫu
  không bị client sửa ở cả 3 hàm `apply*LayoutToEntry`; `resolveAnchorPages` đủ 5 nhánh.
- **56 assertion PDF thật**: dựng PDF 2 trang → `stampPdfWithTemplate` → **trích lại text bằng
  pdfjs** (công cụ độc lập) xác nhận: tên/chức danh **nằm trong khung** dù client gửi toạ độ
  ngoài vùng; ghi chú wrap ≥2 dòng không tràn ngang/dọc; tag ngày ký trong khung; trang 2 không
  bị lem; **entry không có `layout` vẽ đúng `y = box.y + height*0.26`** (y hệt công thức cũ);
  chữ ghi chú không lấn dải chữ ký nháy; ảnh ký nháy được nhúng; có lệnh vẽ đường (tick) và
  **không** có ký tự `✓`. Bổ sung 2026-09-05: **tiền tố nằm TRONG khung ký** (không còn ở
  `y = box.y + box.height` như trước); ghi chú vẽ vào đúng **ô text đã kéo** (không phải cả
  khung); **QR vẽ đúng rect đã kéo** và **trọn khung khi không có layout**.

⚠️ Khi kiểm QR bằng pdfjs: `getOperatorList()` **tách 1 lệnh `cm` thành nhiều `OPS.transform`**
(translate rồi scale) — phải **nhân dồn ma trận** theo quy ước PDF (`CTM' = M × CTM`) và tôn
trọng `save`/`restore` mới ra vị trí ảnh thật; đọc từng transform rời sẽ ra `[1,0,0,1,0,0]` và
kết luận sai.

⚠️ Nếu chạy lại script kiểu này: `process.cwd()` phải là repo root, nếu không
`loadSignerNameFont()` trả `null` và **mọi hàm vẽ text im lặng không vẽ gì** (đều có guard
`if (!font) return`) — test sẽ fail sạch mà không báo lỗi font.

---

### Không phải bug: văn bản Upload ký tay không có nút "Gửi ký"

Luồng `new/upload` lưu thẳng `trang_thai = "da_phe_duyet"`, `is_uploaded = true`, file vào
`file_signed_pdf_url` (`vanban/uploads/`), `file_goc_url = null` — **không có bước ký số nào**,
nên không có nút "Gửi ký" và không mở màn "Cài đặt vị trí ký". Đúng thiết kế.

Với luồng ký số (trang Soạn thảo), **người cài đặt vị trí là người soạn thảo** — vẽ 1 lần cho
mọi vai trò, kể cả khung của người ký lẫn người phê duyệt.

---

## Màn ký các bước: thumbnail trang + màu vai trò dùng chung (2026-09-05)

Modal ký (`SignPlacementModal`, bước "placement") trước đây chỉ render **đúng 1 trang** lên canvas
và chuyển trang bằng 2 nút mũi tên — người ký không thấy tổng thể tài liệu, không biết khung của
mình ở trang nào. Nay dựng lại theo **màn cài đặt vị trí** (`ky/mau-vi-tri/page.tsx`).

### Bảng màu vai trò — 2 bản, phải giữ ĐỒNG BỘ THỦ CÔNG

`src/lib/signing/template-colors.ts` (`ROLE_COLORS`, `KY_BUOC_CLONE_PALETTE`,
`getKyBuocColor(stepNo)`, `getPlacementKeyColor(key)`) là **bản sao có chủ đích** của bảng màu
trong `ky/mau-vi-tri/page.tsx` (dòng ~110-131). Màn cài đặt vị trí là MẪU THAM CHIẾU, người dùng
yêu cầu **giữ nguyên 100%** — không refactor cho nó import từ file dùng chung.

⇒ Đổi màu ở màn cài đặt vị trí thì **phải sửa đồng bộ** `template-colors.ts`, nếu không màu người
ký nhìn thấy sẽ lệch với màu người soạn thảo đã đặt — đúng thứ tính năng này sinh ra để tránh.

Ánh xạ theo key của `placement_ky`: `"1"`,`"2"`,… → `KY_BUOC_CLONE_PALETTE[(N-1)%8]` (bước 1 amber
`#f59e0b`, bước 2 sky `#0ea5e9`, bước 3 pink `#db2777`…); `phe_duyet` emerald; `qr` violet;
`ngay_ky` rose; `ghi_chu` teal. Cùng màu đó được dùng ở **3 nơi**: khung trên canvas modal ký,
khung sáng trên thumbnail, và viền trái mỗi bước trên timeline trang chi tiết.

### `src/lib/signing/placement-preview.ts` — hàm thuần, CHỈ để hiển thị

`collectPreviewBoxes()` đọc toàn bộ `placement_ky` → danh sách khung kèm `pct` (%, gốc trên-trái)
và `tier`:

- `mine` — khung của chính người đang ký (kể cả `qr` khi còn được chỉnh, `ghi_chu` ở bước phê
  duyệt): viền dày + nền màu + `boxShadow` glow → "sáng lên".
- `done` — bước đã ký: viền mảnh, opacity .55.
- `other` — bước khác: nét đứt, opacity .35.

Quy đổi point (gốc **dưới-trái**) → % (gốc **trên-trái**) dùng đúng công thức màn mẫu:
`y% = (dim.h - box.y - box.height) / dim.h * 100`. Bỏ qua `_mau` (`MAU_META_KEY`), entry thiếu
`tu_mau`, và mọi toạ độ không `Number.isFinite` (JSONB legacy → NaN làm khung nhảy vô hình).

**Tuyệt đối không import file này vào `api/documents/sign/route.ts` / `apply-template.ts`** —
toạ độ đóng dấu thật vẫn do server tự tính và tự kẹp như cũ.

Đã tự kiểm chứng bằng script gọi thẳng code thật (`node --experimental-strip-types`):
**21/21 assertion PASS** — công thức lật trục, phân loại tier, đúng màu từng bước, bỏ dữ liệu bẩn,
neo `moi_trang` xuất hiện ở mọi trang, thiếu `dims` không crash.

### Landmine đã xử lý

1. **`renderPdfPage` phải hủy tác vụ render cũ** (`renderTaskRef` + `.cancel()`, nuốt
   `RenderingCancelledException`). Có rail thumbnail người dùng bấm chuyển trang rất nhanh → pdfjs
   ném *"Cannot use the same canvas during multiple render() operations"* và để lại canvas trắng.
2. **Thumbnail JPEG phải `fillRect` trắng trước `page.render`** — canvas mặc định trong suốt, JPEG
   không có alpha ⇒ nền thành ĐEN.
3. Sinh thumbnail **tái dùng `pdf` đã load** trong effect `loadPdf` (không `getDocument()` lần 2),
   render tuần tự, cập nhật dần từng trang, nhả main thread giữa các trang; guard `thumbRunRef` +
   `cancelled` sau mỗi `await` (StrictMode chạy effect 2 lần). Quá `MAX_THUMB_PAGES = 80` thì bỏ
   ảnh, chỉ giữ ô số trang + overlay khung.
4. Lớp khung mờ của bước khác trên canvas: bắt buộc `pointer-events-none` + `zIndex: 6` (dưới
   region z=9 và các khối kéo z=12-15) để không cướp sự kiện kéo-thả; kích thước lấy từ state
   `thumbDims[currentPage] × pdfScale`, **không đọc `canvasRef.current` trong lúc render** (ref
   không kích hoạt re-render → lệch một nhịp khi đổi sang trang khác khổ giấy).
5. `signedStepKeys`/`stepLabels` ở component cha **cố ý không dùng `useMemo`** — phía trên đã có
   early return (`if (loading)`, `if (!doc)`), thêm hook ở đó sẽ vi phạm rules of hooks.

### Trang chi tiết văn bản

2 card đổi sang grid `lg:grid-cols-5` (3+2) + `items-stretch` + `flex-1` để **luôn cao bằng nhau**
(trước đây 2+1 và card con không giãn nên bên cao bên thấp). Mỗi card có header dải pastel + icon
tròn; `InfoRow` thành tile nền nhạt; `TimelineStep` thành `<li>` trong `<ol>` có connector dọc
(liền emerald khi đã ký / nét đứt amber khi đang chờ), badge tròn 32px, pill trạng thái, và viền
trái 3px mang **màu vai trò của đúng bước đó**. Đáy card có thanh tiến độ "N/M bước".

---

## Chữ ký số PAdES + trang xác thực công khai (2026-09-05, việc 6)

Trước đây file văn bản đã ký chỉ có **con dấu hình ảnh** — không chứng minh được về mặt mật mã.
Nay mỗi bước ký nhúng thêm 1 chữ ký PAdES thật, bấm vào con dấu mở trang xác thực công khai.

### 3 quyết định phạm vi đã chốt

| Câu hỏi | Chốt |
|---|---|
| Áp dụng cho văn bản nào | **Chỉ văn bản mới**. Văn bản đang luân chuyển dở khi deploy giữ nguyên như cũ — tránh file nửa có nửa không chữ ký, người xác thực dễ hiểu nhầm bước cũ bị giả mạo |
| Mô hình chữ ký | **Mỗi bước 1 chữ ký riêng** (giống Bảo trì/Chất lượng/Điều xe) — bấm vào con dấu của ai ra đúng tên người đó |
| Nơi lưu `pades_sig_index` | **Cột mới trên `doc_approval_log`** — bảng này đã có sẵn 1 dòng/bước kèm `content_hash` và trigger bất biến. 1 dòng log = 1 chữ ký = 1 URL xác thực |

`resolvePadesEligibility()` quyết định bật/tắt: bật khi đây là lượt đóng dấu **đầu tiên** của văn
bản (chưa có dòng log nào), hoặc khi các lượt trước **đã có** chữ ký số. Không cần thêm cột cờ nào
trên `van_ban_documents`.

### ⚠️ Đổi thư viện PDF — bắt buộc, không được quay lại `save()`

`stampPdfStep` (route) và `stampPdfWithTemplate` (`apply-template.ts`) trước đây **tự
`PDFDocument.load()` rồi `save()`** — chính pattern đã gây 2 bug ở hệ ký dùng chung: *bug 74.8MB*
(dung lượng nhân đôi mỗi lượt) và *mất chữ ký PAdES của người ký trước* (`save()` ghi lại toàn bộ
file, xoá đoạn incremental-update).

Nay cả hai **nhận `pdfDoc` đã load sẵn và không tự load/save**. `performFileStamp` giữ **một
instance sống duy nhất** load bằng `@cantoo/pdf-lib` với `forIncrementalUpdate: true`, vẽ con dấu →
thêm link annotation → nhúng PAdES, `commit()` nhiều lần trên cùng instance.

- `apply-template.ts` **chỉ Văn bản dùng** (đã grep xác nhận) → đổi an toàn.
- `stamp-pdf.ts` **dùng chung với ISO** (`generate-pdf`, `iso/forms/finalize`) → **giữ nguyên
  `pdf-lib` gốc**, chỉ ép kiểu `as unknown as PdfLibDocument` tại chỗ gọi, đúng cách `requests.ts`
  đang làm.

### Link "xem bằng chứng xác minh"

`logId` được sinh bằng `randomUUID()` **trước khi đóng dấu** — annotation phải nằm trong phần nội
dung được PAdES ký nên không thể chờ insert log xong mới biết id. Link phủ đúng ô con dấu (kể cả
khung nhân bản và khung neo "mọi trang"), trỏ `/van-ban-verify/{logId}`.

⚠️ `grep` chuỗi URL trong file PDF sẽ **không thấy** annotation — `@cantoo/pdf-lib` nén object
stream. Muốn kiểm tra phải đọc lại `page.node.Annots` bằng chính thư viện.

### Best-effort tuyệt đối

Mọi lỗi ở lớp PAdES **chỉ làm mất chữ ký số, không bao giờ chặn luồng ký nghiệp vụ**. Lý do ghi
vào `pades_error` và hiển thị thẳng trên trang xác thực (không im lặng báo "không có chữ ký"):
văn bản dở dang · chưa cấu hình root CA · migration chưa chạy · lỗi nhúng.

Insert log có **fallback**: nếu 2 cột mới chưa tồn tại (migration chưa chạy), PostgREST từ chối cả
câu insert → insert lại bộ cột cũ để không mất trắng audit trail + `content_hash` của lượt ký đó.

### 🐛 Bug ASN.1 đã vá trong `pades.ts` (ảnh hưởng file DÙNG CHUNG)

`issueLeafCertificate` ép `valueTagClass: UTF8` cho `commonName` (fix 2026-08-31) nhưng **bỏ sót
`emailAddress`**. Attribute này theo chuẩn X.509 là **IA5String (chỉ ASCII)**; giá trị chứa dấu
tiếng Việt hoặc em dash "—" làm `TBSCertificate` lúc KÝ và lúc SERIALIZE lệch byte nhau → **leaf
cert có chữ ký sai về toán học**.

Triệu chứng rất dễ chẩn đoán nhầm: `openssl cms -verify -noverify` **thành công** (chữ ký CMS
đúng) nhưng thêm `-CAfile root.pem` thì **`rsa_verify: bad signature`** — lỗi nằm ở chain, không
phải ở chữ ký nội dung. Acrobat sẽ không dựng được chain dù đã import root CA.

Production **không dính**: mọi call site đều truyền email nội bộ `username@auth...` (ASCII thuần).
Đã vá bằng lưới lọc ASCII trong `issueLeafCertificate` + route Văn bản dùng đúng `auth_email` như
`requests.ts`, **không** đưa mã/tên văn bản có dấu vào chứng thư.

### Tự kiểm chứng — 17/17 PASS, gọi thẳng code thật

Script độc lập mô phỏng đúng chuỗi 3 lượt ký (`ky_buoc 1` → `ky_buoc 2` → `phe_duyet`), tên người
ký **có dấu tiếng Việt**:

1. **Byte-identity**: bytes sau lượt N là **tiền tố** của lượt N+1 → chữ ký người trước không bị
   đụng. Mức tăng tuyến tính ~10KB/lượt (đo tăng **tuyệt đối**, không đo tỷ lệ — file test bé nên
   tỷ lệ luôn lớn dù hành vi đúng).
2. **`verifyPadesSignature()` (code thật)**: 3/3 hợp lệ, đúng tên có dấu; index không tồn tại bị từ
   chối; sửa 1 byte → phát hiện ngay.
3. **`openssl cms -verify` (công cụ ngoài)**: 3/3 `Verification successful` với `-CAfile`; bỏ
   `-CAfile` → đúng lỗi self-signed (tương đương "UNKNOWN" trong Acrobat).
4. **Link annotation**: 3 link đúng trang, đúng URL; 3 signature widget.

⚠️ Khi trích chữ ký cho openssl: bắt buộc cờ `-binary`, **dedupe theo giá trị `/ByteRange`** (cùng
byteRange lặp lại qua các generation), và cắt DER theo **header TLV** (`derTotalLength`) — không
cắt bằng cách xoá byte `00` ở đuôi (chữ ký RSA có ~1/256 khả năng kết thúc đúng bằng `0x00`).

### ⚠️ Ranh giới client/server của `src/lib/signing/` (bug build 2026-09-05)

`documents/[id]/page.tsx` là `"use client"` → **mọi** module trong cây import của nó bị bundle cho
trình duyệt. Phân loại bắt buộc nhớ:

| Module | Dùng được ở client? | Lý do |
|---|---|---|
| `template-layout.ts` | ✅ | Thuần, chỉ `import type` |
| `template-colors.ts` | ✅ | Thuần, không import gì |
| `placement-preview.ts` | ✅ | Chỉ được import từ 2 file trên |
| `apply-template.ts` | ❌ | Kéo `stamp-pdf.ts` |
| `stamp-pdf.ts` | ❌ | `import fs`, `import path` (đọc file font) |
| `pades.ts`, `verify-pades.ts`, `requests.ts`, `templates.ts` | ❌ | node-forge / crypto / supabase-admin |

Bug đã xảy ra: `placement-preview.ts` lấy `MAU_META_KEY` từ `apply-template.ts` → build hỏng
`Module not found: Can't resolve 'fs'`. Đã chuyển hằng số sang `template-layout.ts` và re-export
ngược lại từ `apply-template.ts` để call site server không đổi.

**`tsc` và `eslint` KHÔNG bắt được lỗi này** — chỉ lộ khi Next.js bundle. Muốn tự kiểm mà không
chạy `npm run build`: viết script duyệt đệ quy import từ file `"use client"`, bỏ qua `import type`,
báo động nếu chạm `fs`/`path`/`pdf-lib`/`@cantoo/pdf-lib`/`node-forge`/`supabase-admin`. Hằng số
hay type dùng chung 2 phía thì đặt ở module thuần, đừng đặt trong file có logic server.

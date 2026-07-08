---
description: Module Ghi chú nhanh (/dashboard/notes) — ghi chú riêng tư kèm ảnh, chia sẻ theo người dùng, widget trên Dashboard
---

# Module Ghi chú nhanh

## Phạm vi

Ghi chú nhanh nội dung (sự việc, sự cố, bàn giao ca...) kèm ngày xảy ra và hình ảnh hiện
trường. Không gắn với bất kỳ nghiệp vụ dây chuyền/lô nào, không cần chọn dây chuyền/chủng
loại SP — dùng cho mọi mục đích ghi chú nhanh, không chỉ vận hành sản xuất.

- Route đầy đủ: `/dashboard/notes`
- Widget rút gọn: `QuickNotesWidget` trên `/dashboard` (Dashboard chính)
- Permissions: `notes.view`, `notes.create`, `notes.edit`, `notes.delete`
- Migration: `supabase/migrations/20260707_operation_notes.sql` (cần chạy thủ công trong
  Supabase SQL Editor — có sửa lại RLS sau lần tạo đầu, phải chạy lại toàn bộ file kể cả nếu
  đã chạy phần đầu trước đó, mọi câu lệnh đều idempotent an toàn để chạy lại)

## Mô hình quyền xem — RIÊNG TƯ theo người tạo, admin thấy tất cả, chia sẻ theo người dùng

Đây là điểm khác biệt lớn nhất so với các module khác trong app (đa số module chỉ cô lập
theo `factory_id`, không cô lập theo người tạo). Ghi chú nhanh cô lập thêm 1 lớp nữa:

- Mặc định, **chỉ người tạo ghi chú mới thấy ghi chú của mình**.
- **Admin thấy tất cả** ghi chú trong nhà máy, bất kể ai tạo.
- Chủ ghi chú có thể **chia sẻ** cho 1 hoặc nhiều người dùng cụ thể qua bảng
  `operation_note_shares` — người được chia sẻ sẽ tự thấy ghi chú đó trong danh sách của họ
  (cả trang `/dashboard/notes` lẫn widget Dashboard), nhưng **không sửa/xóa được**, chỉ chủ
  ghi chú hoặc admin mới sửa/xóa được.
- **Việc này được thực thi bằng RLS thật ở tầng Postgres**, không chỉ lọc ở query builder
  phía app — quan trọng vì nếu chỉ lọc `.eq("created_by", ...)` ở client mà RLS vẫn cho đọc
  toàn bộ factory thì người dùng có thể mở devtools gọi thẳng Supabase để đọc ghi chú của
  người khác. Do đó khi sửa bất kỳ logic liên quan đến "ai thấy ghi chú nào", phải sửa đúng ở
  RLS trong migration, không phải chỉ sửa `fetchOperationNotes()`.
- Vì RLS đã lọc đúng, `fetchOperationNotes()` ở client **không cần** thêm điều kiện
  `created_by`/`shared` gì cả — cứ `SELECT * WHERE factory_id = ...` là Postgres tự trả về
  đúng tập ghi chú người dùng hiện tại được phép thấy.

## Bảng `operation_notes`

```sql
id            UUID PK
factory_id    UUID NOT NULL
noi_dung      TEXT NOT NULL
ngay_xay_ra   DATE NOT NULL      -- ngày sự việc xảy ra, KHÔNG phải ngày ghi nhận
image_urls    TEXT[] DEFAULT '{}'
created_by    UUID REFERENCES auth.users
nguoi_tao     TEXT               -- snapshot tên hiển thị tại thời điểm tạo
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ DEFAULT now()  -- tự cập nhật bằng trigger
```

RLS (4 policy tách riêng theo action, không dùng `FOR ALL` gộp chung như các bảng khác):

- `operation_notes_select`: `created_by = auth.uid()` HOẶC role admin HOẶC có dòng
  `operation_note_shares` khớp `note_id` + `shared_with_user_id = auth.uid()`.
- `operation_notes_insert`: chỉ cần đúng `factory_id`.
- `operation_notes_update` / `operation_notes_delete`: `created_by = auth.uid()` HOẶC admin
  — **không** cho người được chia sẻ sửa/xóa.

## Bảng `operation_note_shares`

```sql
id                   UUID PK
note_id              UUID NOT NULL REFERENCES operation_notes ON DELETE CASCADE
factory_id           UUID NOT NULL
shared_with_user_id  UUID NOT NULL REFERENCES auth.users
shared_by            UUID REFERENCES auth.users
created_at           TIMESTAMPTZ DEFAULT now()
UNIQUE (note_id, shared_with_user_id)
```

RLS:

- SELECT: `shared_with_user_id = auth.uid()` (người nhận xem dòng của chính họ) HOẶC
  `shared_by = auth.uid()` (chủ ghi chú xem toàn bộ danh sách đã chia sẻ) HOẶC admin.
- INSERT: bắt buộc `shared_by = auth.uid()` VÀ `note_id` phải thuộc ghi chú do chính
  `auth.uid()` tạo (hoặc admin) — không tin `shared_by`/quyền sở hữu do client tự khai.
- DELETE (gỡ chia sẻ): chủ ghi chú hoặc admin.

### Bug đã fix: "infinite recursion detected in policy for relation operation_note_shares"

- `operation_notes_select` tra vào `operation_note_shares` (kiểm tra đã được chia sẻ chưa),
  trong khi `operation_note_shares_insert`/`_delete` lại tra ngược vào `operation_notes`
  (kiểm tra có phải chủ ghi chú không) — 2 chiều tham chiếu chéo giữa 2 bảng đều bật RLS
  khiến Postgres phát hiện chu trình policy và từ chối thực thi, dù logic không thực sự lặp
  vô hạn. Đây là lỗi kinh điển của Postgres RLS khi 2 bảng tham chiếu chéo lẫn nhau trong
  policy, không phải lỗi ở tầng app.
- **Cách sửa chuẩn** (đã áp dụng trong migration): tách phần tra cứu chéo ra 2 hàm
  `SECURITY DEFINER` — `is_operation_note_owner(note_id, user_id)` và
  `is_operation_note_shared_with(note_id, user_id)`. Hàm `SECURITY DEFINER` chạy với quyền
  của chủ hàm (owner tạo bằng SQL Editor, mặc định được miễn RLS vì là chủ bảng, không set
  `FORCE ROW LEVEL SECURITY`) nên truy vấn nội bộ trong hàm KHÔNG kích hoạt lại policy của
  bảng kia — phá vỡ chu trình. `operation_notes_select` gọi
  `is_operation_note_shared_with(...)`; `operation_note_shares_insert`/`_delete` gọi
  `is_operation_note_owner(...)` — thay cho `EXISTS (SELECT ... FROM <bảng kia> ...)` trực
  tiếp như bản đầu.
- Quy tắc chung cho module này (và bất kỳ cặp bảng RLS nào tham chiếu chéo lẫn nhau trong
  tương lai): **không** viết `EXISTS (SELECT ... FROM <bảng B có RLS> ...)` trực tiếp trong
  policy của bảng A nếu bảng B cũng có policy tra ngược lại bảng A — phải bọc bằng hàm
  `SECURITY DEFINER` cho ít nhất 1 chiều.

## Quy tắc chọn người để chia sẻ — cần API route bypass RLS `profiles`

RLS của bảng `profiles` chỉ cho **admin** đọc toàn bộ profiles trong factory (xem
`.claude/rules/16-iso-vanban-module.md`). Vì bất kỳ user thường nào cũng cần chọn người để
chia sẻ ghi chú của mình, danh sách ứng viên **phải** lấy qua API route server-side dùng
`getSupabaseAdmin()`, không được query `profiles` trực tiếp từ browser client:

- `GET /api/notes/share-candidates?factoryId=xxx` (`src/app/api/notes/share-candidates/route.ts`)
  → trả về `{ users: [{ id, name }] }`, chỉ dùng để hiển thị tên trong modal chọn người.
- Việc **insert/delete thực tế** vào `operation_note_shares` vẫn đi qua Supabase client bình
  thường (`setOperationNoteShares()` trong `operation-notes.ts`), **không** qua service role
  — vì RLS của `operation_note_shares` đã đủ chặt để tự xác thực người gọi thật sự là chủ ghi
  chú/admin qua `auth.uid()`. Route API chỉ để lộ tên người dùng, không có quyền ghi gì cả.
- Danh sách trả về chỉ gồm user `status = "active"` (loại tài khoản bị khóa/pending), **có
  quyền `notes.view`** (explicit `user_permissions.granted=true` HOẶC role được cấp qua
  `role_permissions`, cùng pattern với `dept-users/route.ts`), và **loại trừ `role = "admin"`**
  — vì admin đã mặc nhiên thấy mọi ghi chú (RLS `operation_notes_select`) nên chia sẻ cho admin
  là vô nghĩa. Không lọc theo phòng ban hay tiêu chí nào khác.
  - Giới hạn đã biết (giống `dept-users/route.ts`): nếu 1 user bị **thu hồi tường minh**
    `notes.view` (`user_permissions` có dòng `granted=false`) nhưng role mặc định của họ vẫn
    được cấp quyền này qua `role_permissions`, họ vẫn xuất hiện trong danh sách — route chỉ
    cộng gộp các nguồn cấp quyền (additive), không trừ đi phần bị thu hồi tường minh.

## File chính

```
src/lib/operation-notes.ts                          -- types, fetch/CRUD note + share, upload ảnh, canManageOperationNote, bảng pastel
src/app/api/notes/share-candidates/route.ts         -- GET danh sách user active trong factory (bypass RLS profiles)
src/app/dashboard/_components/note-card.tsx         -- thẻ ghi chú pastel dùng chung, có nút Chia sẻ + badge số người được chia sẻ
src/app/dashboard/_components/note-form-fields.tsx  -- textarea + ngày + ảnh, dùng chung widget/modal
src/app/dashboard/_components/note-image-picker.tsx -- upload nhiều ảnh (tối đa 6), lightbox riêng
src/app/dashboard/_components/note-share-modal.tsx  -- modal chọn người dùng để chia sẻ 1 ghi chú
src/app/dashboard/_components/quick-notes-widget.tsx -- widget "Ghi chú nhanh" trên Dashboard
src/app/dashboard/notes/page.tsx                    -- trang đầy đủ: filter, grid, modal thêm/sửa/xóa/chia sẻ
```

## Quy tắc lưu ảnh

- Bucket dùng chung `order-files` (không tạo bucket riêng) — cùng bucket với Bảo trì/Kiểm
  soát quá trình.
- Path: `{factory_id}/notes/{Date.now()}_{random}.{ext}`.
- Tối đa `OPERATION_NOTE_MAX_IMAGES = 6` ảnh/ghi chú, đồng nhất với quy ước "tối đa 6 ảnh"
  đang dùng ở Bảo trì và Kiểm soát quá trình.

## Widget "Ghi chú nhanh" trên Dashboard

- Nhận `factoryId`/`user` từ `dashboard/page.tsx` qua props — **không** tự gọi
  `hydrateActiveSession()` riêng để tránh double session fetch trên trang Dashboard.
- Hiển thị đúng `WIDGET_LIMIT = 5` ghi chú mới nhất (`fetchOperationNotes(fid, { limit: 5 })`)
  **của người dùng hiện tại** (RLS tự lọc đúng phạm vi own/shared/admin) — không phân trang,
  không có nút Chia sẻ (widget chỉ để nhập nhanh + xem lướt, quản lý chia sẻ ở trang đầy đủ).
- Nút "Xem tất cả" điều hướng sang `/dashboard/notes` bằng `router.push` (không reload trang).
- Form nhập nhanh chỉ hiện khi `hasPermission(user, "notes.create")`; nếu không đủ quyền
  `notes.view` thì cả widget ẩn hẳn (`return null`), không hiện khung rỗng gây rối Dashboard.
- Lỗi tải danh sách bị nuốt âm thầm (catch rỗng) — widget là phụ, không được làm gãy cả
  Dashboard chính nếu bảng `operation_notes` lỗi hoặc migration chưa chạy.

## Trang đầy đủ `/dashboard/notes`

- Bootstrap đọc quyền từ cache `localStorage.erp_user` (giống pattern thực tế đang dùng ở
  `quality/page.tsx`, `maintenance/page.tsx`, `process/page.tsx` — không phải
  `hydrateActiveSession()` đầy đủ) rồi `getActiveFactoryId()` lấy `factory_id`.
- Filter: tìm theo nội dung (`ilike noi_dung`), khoảng ngày `ngay_xay_ra` (Từ ngày/Đến ngày).
  Đổi bất kỳ filter nào phải reset `limit` về `PAGE_SIZE` (60) — tránh giữ limit lớn cũ khi
  lọc ra tập dữ liệu nhỏ hơn.
- Không phân trang kiểu offset — dùng "Tải thêm" tăng dần `limit` khi số dòng trả về đúng bằng
  `limit` hiện tại (dấu hiệu có thể còn dữ liệu).
- Layout card dạng masonry (`columns-1 md:columns-2 xl:columns-3` + `break-inside-avoid`),
  giống pattern card ngăn lưu ở `storage/page.tsx`.
- Xóa ghi chú luôn qua `ModalShell` xác nhận — không xóa thẳng khi bấm icon Trash2.
- Nút "Chia sẻ" (icon `Share2`) và badge số người được chia sẻ chỉ hiện khi
  `canManageOperationNote(note, currentUser)` là true (chủ ghi chú hoặc admin) — người được
  chia sẻ nhìn thấy ghi chú nhưng không thấy các nút quản lý này.
- Số người được chia sẻ (`fetchShareCountsForNoteIds`) được fetch hàng loạt cho tất cả ghi
  chú đang hiển thị trong 1 query; RLS tự giới hạn số dòng trả về đúng theo quyền của actor
  nên không cần lọc thêm ở client — chỉ cần không hiển thị badge cho ghi chú không phải của
  mình (đã đảm bảo qua điều kiện `canManage` ở trên).

## Thiết kế thẻ ghi chú (chủ đích khác phong cách card trắng-viền-xám của phần còn lại app)

Theo yêu cầu thiết kế minimalist riêng cho module này: mỗi ghi chú là 1 "thẻ giấy nhớ" —
`rounded-2xl shadow-sm`, **không dùng `border`**, nền pastel xoay vòng theo index
(`notePastelBg()` trong `operation-notes.ts`: amber → sky → emerald → rose → violet → lime).
Container/khung ngoài (widget card, trang list) vẫn giữ style chuẩn `bg-white rounded-2xl
border border-slate-200 shadow-md` như các card khác trong app để không phá vỡ bố cục tổng
thể — pastel/no-border chỉ áp dụng cho từng thẻ ghi chú bên trong, không áp dụng cho khung
điều hướng/filter bar.

Nếu cần đổi bảng màu pastel, chỉ sửa mảng `NOTE_PASTEL_BG` — không hard-code màu rải rác ở
`note-card.tsx` hay nơi khác.

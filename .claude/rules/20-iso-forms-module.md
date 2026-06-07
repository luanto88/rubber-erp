---
description: Module ISO - Thực hiện hồ sơ (form instances), AI semantic search, pgvector, Gemini embedding, clone template, drag-and-drop signing workflow
---

# Module ISO - Thực hiện Hồ sơ (`/dashboard/iso/forms/`)

## Phạm vi

Module cho phép nhân viên tìm kiếm biểu mẫu ISO bằng AI, tạo bản thực hiện (instance) từ template, chỉnh sửa offline, cấu hình luồng phê duyệt và đóng dấu chữ ký số drag-and-drop.

Module này **tách biệt hoàn toàn** với luồng tạo/soát xét tài liệu ISO — không xung đột với `iso_documents` workflow.

---

## Migrations

| File | Nội dung | Trạng thái |
|------|---------|-----------|
| `supabase/migrations/20260607_iso_forms_embedding.sql` | pgvector extension + `iso_documents.embedding vector(768)` + `iso_documents.mo_ta_tim_kiem` + IVFFlat index + RPC `match_iso_templates` | ✅ Đã chạy |
| `supabase/migrations/20260607_iso_form_instances.sql` | Bảng `iso_form_instances` + `iso_form_instance_logs` + RLS + permissions | ✅ Đã chạy |
| `supabase/migrations/20260608_iso_forms_soan_thao_placement.sql` | Thêm 4 cột vào `iso_form_instances`: `soan_thao TEXT`, `soan_thao_placement JSONB`, `soan_thao_signed_url TEXT`, `ky_soan_thao_at TIMESTAMPTZ` | ✅ Đã chạy |

---

## Cấu trúc file

```
src/app/api/iso/forms/
  embed-doc/route.ts     -- POST: embed 1 doc vào iso_documents.embedding (Gemini)
  search/route.ts        -- POST: semantic search qua RPC match_iso_templates
  clone/route.ts         -- POST: copy Storage file + tạo iso_form_instances
  [id]/finalize/route.ts -- POST: ký + stamp PDF/replace Office tags + upload file
  batch-embed/route.ts   -- POST: batch re-embed tất cả doc có embedding IS NULL

src/app/dashboard/iso/forms/
  page.tsx               -- Tìm kiếm AI + danh sách instances + nút "Cập nhật chỉ mục AI"
  [id]/page.tsx          -- Chi tiết instance: upload, cấu hình, workflow ký duyệt
```

---

## Bảng `iso_form_instances`

```sql
id, factory_id, template_doc_id (→ iso_documents),
tieu_de TEXT, nguoi_tao UUID (→ auth.users),
draft_file_url, draft_file_type (docx|xlsx|pdf),
final_office_url, final_pdf_url,
trang_thai: draft|cho_xem_xet|cho_phe_duyet|da_phe_duyet|tra_ve|tu_choi,
cap_tl: "Cấp 1"|"Cấp 2",

-- Bước 1: Soạn thảo ký (migration 20260608)
soan_thao TEXT,              -- snapshot tên người tạo tại thời điểm ký
soan_thao_placement JSONB,   -- vị trí QR/chữ ký/tên do user đặt
soan_thao_signed_url TEXT,   -- file sau khi ký bước 1
ky_soan_thao_at TIMESTAMPTZ,

-- Bước 2: Xem xét
xem_xet_user_id UUID, xem_xet TEXT (snapshot), ky_xem_xet_at TIMESTAMPTZ,
xem_xet_placement JSONB,

-- Bước 3: Phê duyệt
phe_duyet_user_id UUID, phe_duyet TEXT (snapshot), ky_phe_duyet_at TIMESTAMPTZ,
phe_duyet_placement JSONB,

auto_convert_pdf BOOLEAN DEFAULT false,
ghi_chu, ly_do_tra_ve, created_at, updated_at
```

---

## Semantic Search (pgvector + Gemini)

### Model Embedding

- Model: **`gemini-embedding-001`** (768 dimensions, `outputDimensionality: 768`)
- **Không dùng SDK `@google/generative-ai`** — dùng `fetch` trực tiếp REST API
- Key dạng `AQ.Ab8...` (Vertex AI key) chỉ expose `gemini-*` models, không có `text-embedding-004` hay `embedding-001`
- Pattern đúng:
  ```typescript
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: embedText }] },
        outputDimensionality: 768,
      }),
    }
  )
  const json = await res.json() as { embedding?: { values: number[] } }
  const embedding = json.embedding?.values
  ```
- Prefix `models/` trong request body là bắt buộc — SDK thiếu prefix này nên 404

### Nội dung embed

```typescript
const embedText = [
  doc.ten_tai_lieu,
  doc.ma_tai_lieu,
  doc.loai_tai_lieu,
  doc.phong_ban,
  doc.mo_ta_tim_kiem,
].filter(Boolean).join(" ")
```

### Khi nào trigger embed

- Sau khi tài liệu ISO được `phe_duyet` và chuyển `co_hieu_luc`
- Gọi **fire-and-forget** từ `documents/[id]/page.tsx` — lỗi không block workflow:
  ```typescript
  void fetch("/api/iso/forms/embed-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, factoryId }),
  }).catch(() => {})
  ```
- Phải trigger cả hồ sơ con nếu đợt phê duyệt có con

### Batch re-embed tài liệu cũ

Route: `POST /api/iso/forms/batch-embed`
Body: `{ factoryId, forceAll?: boolean }`

- Mặc định chỉ embed các doc có `embedding IS NULL` và `trang_thai = 'co_hieu_luc'`
- `forceAll = true`: re-embed kể cả doc đã có embedding (dùng khi đổi model)
- Có delay 200ms giữa các request để tránh rate limit
- UI: nút "Cập nhật chỉ mục AI" trong header của `forms/page.tsx`

### 2 trường liên quan trên `iso_documents`

| Cột | Kiểu | Ý nghĩa |
|-----|------|---------|
| `embedding` | `vector(768)` | Véc-tơ số học tự sinh bởi Gemini — NULL = chưa được index, có data = đã index |
| `mo_ta_tim_kiem` | `text` | Mô tả bổ sung do người dùng nhập để tăng độ chính xác tìm kiếm AI |

Trường `mo_ta_tim_kiem` đã được thêm vào:
- `iso-types.ts`: field trong `IsoDocument`, `IsoDocumentForm`, `emptyIsoForm()`
- `documents/[id]/page.tsx`: textarea "Mô tả tìm kiếm AI" trong form soạn thảo (chỉ tài liệu cha, không phải hồ sơ con)
- `forms/[id]/page.tsx`: load `mo_ta_tim_kiem` từ template doc, hiển thị read-only trong card template info

### RPC `match_iso_templates`

- Filter: `trang_thai = 'co_hieu_luc'` và `embedding IS NOT NULL`
- Sort: cosine distance (`embedding <=> query_embedding`)
- Trả `similarity = 1 - cosine_distance`

---

## Clone Template

Storage path cho instance: `{factoryId}/iso/instances/{instanceId}/draft.{ext}`

Ưu tiên source file:
1. `file_signed_office_url` (Office đã ký)
2. `file_goc_url` (nếu là Office)
3. Nếu chỉ có PDF → tạo instance với `draft_file_url = null`, trả `{ instanceId, isPdfOnly: true, templatePdfUrl }`

**KHÔNG được sửa file gốc** (`iso_documents.file_goc_url` hay `file_signed_office_url`).

### Luồng xử lý PDF-only template

- `clone/route.ts` vẫn tạo row `iso_form_instances` với `draft_file_url = null` khi chỉ có PDF
- `CloneDialog` trong `forms/page.tsx` kiểm tra `json.isPdfOnly && json.instanceId` → show toast cảnh báo rồi navigate vào instance
- Trong `forms/[id]/page.tsx`: khi `!instance.draft_file_url` và template có PDF → hiện banner amber hướng dẫn tải PDF mẫu về điền rồi upload lại

---

## Workflow phê duyệt

### Cấp 1
`draft → cho_xem_xet → cho_phe_duyet → da_phe_duyet`

### Cấp 2
`draft → cho_phe_duyet → da_phe_duyet`

Nhánh phụ (cả hai cấp):
- `cho_xem_xet | cho_phe_duyet → tra_ve` (trả về nháp, kèm `ly_do_tra_ve`)

### Chuyển trạng thái bước 1 (soan_thao action)

- Cấp 1: `draft → cho_xem_xet`
- Cấp 2: `draft → cho_phe_duyet`

Bước 1 yêu cầu người dùng ký qua `SignPlacementModal` trước khi gửi (xem mục Finalize).

---

## Finalize (ký số + stamp)

### Quy tắc cứng

1. **KHÔNG gọi `fillMetadataPlaceholders()` hoặc `drawFooterOnAllPages()`** — đây là biểu mẫu đã điền, không phải tài liệu ISO có header/footer chuẩn
2. **KHÔNG sửa file gốc** của `iso_documents`
3. **CloudConvert lỗi không block** `da_phe_duyet` — vẫn lưu file Office, vẫn chuyển trạng thái
4. `SIGN_JWT_SECRET` fallback → `SUPABASE_SERVICE_ROLE_KEY` (đồng nhất với các route ký khác)

### Source file theo bước

| Action | Source ưu tiên |
|--------|--------------|
| `soan_thao` | `instance.draft_file_url` |
| `xem_xet` | `instance.soan_thao_signed_url` → `instance.draft_file_url` |
| `phe_duyet` | `instance.final_pdf_url` → `instance.soan_thao_signed_url` → `instance.draft_file_url` |

### Xử lý theo loại file và action

**File PDF (hoặc `auto_convert_pdf = true`):**
- Stamp chữ ký (PNG) + tên tại `placement` coordinates dùng `pdf-lib`
- QR stamp tại `qrX/qrY` từ `soan_thao_placement` (nếu có) hoặc fallback góc trên phải
- **QR được vẽ lên TẤT CẢ trang** khi `qrPlacementOverride` tồn tại (loop `pdfDoc.getPages()`):
  ```typescript
  if (qrPlacementOverride) {
    for (const page of pdfDoc.getPages()) {
      page.drawImage(qrImage, {
        x: qrPlacementOverride.x, y: qrPlacementOverride.y,
        width: qrPlacementOverride.width, height: qrPlacementOverride.height,
      })
    }
  }
  ```
- QR size 54×54 pt, URL: `${NEXT_PUBLIC_APP_URL}/dashboard/iso/forms/${instanceId}`
- Font tên người ký: `public/fonts/TimesNewRoman.ttf`

**File Office (DOCX/XLSX) + `auto_convert_pdf = false`:**
- Gọi `replaceFormTags()` — dùng JSZip để quét và thay tag
- DOCX: quét `word/document.xml`, header/footer XML
- XLSX: quét các `xl/worksheets/sheet*.xml`
- Tags không có trong file → bỏ qua (không lỗi)

### Tags Office theo bước

| Bước | Text tag | Image tag |
|------|----------|-----------|
| `soan_thao` | `{{TEN_SOAN_THAO}}` | `{{CHU_KY_SOAN_THAO}}`, `{{QR}}` |
| `xem_xet` | `{{TEN_XEM_XET}}` | `{{CHU_KY_XEM_XET}}` |
| `phe_duyet` | `{{TEN_PHE_DUYET}}` | `{{CHU_KY_PHE_DUYET}}` |

`{{QR}}` chỉ thay ở bước `soan_thao`. Bước sau không thêm `{{QR}}` mới.

### Storage paths

| File | Path |
|------|------|
| Draft (copy từ template) | `{fid}/iso/instances/{id}/draft.{ext}` |
| Sau bước 1 (soan_thao) | `{fid}/iso/instances/{id}/soan_thao_signed.{ext}` |
| Sau bước 2 (xem_xet, khi PDF) | `{fid}/iso/instances/{id}/xem_xet_signed.pdf` |
| File final (phe_duyet) | `{fid}/iso/instances/{id}/final.{ext}` |

### DB update theo bước

| Action | Fields cập nhật |
|--------|----------------|
| `soan_thao` | `trang_thai`, `soan_thao`, `soan_thao_placement`, `soan_thao_signed_url`, `ky_soan_thao_at` |
| `xem_xet` | `trang_thai = cho_phe_duyet`, `xem_xet`, `xem_xet_placement`, `ky_xem_xet_at` |
| `phe_duyet` | `trang_thai = da_phe_duyet`, `phe_duyet`, `phe_duyet_placement`, `ky_phe_duyet_at`, `final_pdf_url` / `final_office_url` |

---

## UI: SignPlacementModal

Component trong `forms/[id]/page.tsx` — thay thế hoàn toàn `PinModal`.

### Props

- `action: "soan_thao" | "xem_xet" | "phe_duyet"`
- `sourceFileUrl: string | null`
- `fileType: string | null`
- `autoConvertPdf: boolean`
- `signatureUrl: string | null`
- `userName: string` — tên thật của người ký (fetch từ `profiles.full_name` trong bootstrap)
- `instanceId: string` — dùng để build URL QR thật
- `onConfirm(pin: string, placement: FullPlacement): void`
- `onClose(): void`

### Hiển thị tên và QR thật

- **Tên người ký**: hiển thị `userName` thật (font bold violet), không phải placeholder "Tên người ký"
  - `userName` state được khởi tạo trong bootstrap bằng query `profiles.full_name` của user đang đăng nhập
  - Fallback: `profiles.username` → `"Người ký"`
- **QR code**: dùng `<QRCodeSVG>` từ `qrcode.react` (đã có trong project), không phải ô text trống
  - URL: `${window.location.origin}/dashboard/iso/forms/${instanceId}`
  - Size tự điều chỉnh theo kích thước box: `Math.max(24, qrState.h - 6)`
  - Level: `"L"` (tối giản hóa để QR nhỏ vẫn đọc được)

### Logic hiển thị

- `isPdf = fileType === "pdf" || autoConvertPdf || urlIsPdf(sourceFileUrl)`
- `showCanvas = isPdf && !!sourceFileUrl`
- Khi `showCanvas = true`: render pdfjs-dist canvas (scale 1.5) + draggable elements
- Khi `showCanvas = false` (Office không convert): hiện info box về tags sẽ thay + PIN input

### Các element có thể kéo

| Element | Hiện khi | Có nút ẩn/hiện |
|---------|----------|---------------|
| QR | `action === "soan_thao"` | Không |
| Chữ ký | Luôn | Có (eye icon) |
| Tên | Luôn | Có (eye icon) |

### Default positions (canvas px tại scale 1.5)

```
sig:  { x: 60, y: canvasH - 120, w: 140, h: 60 }
name: { x: 60, y: canvasH - 55,  w: 140, h: 24 }
qr:   { x: canvasW - 100, y: 10,  w: 80,  h: 80 }
```

### Canvas → PDF coordinate conversion

```typescript
const toPdf = (canX, canY, w, h) => ({
  x: canX / pdfScale,
  y: pdfPageH - (canY + h) / pdfScale,
  width:  w / pdfScale,
  height: h / pdfScale,
})
```

`pdfScale = 1.5`, `pdfPageH` = chiều cao trang PDF theo pdf-lib units (không phải pixel).

### FullPlacement type

```typescript
type FullPlacement = {
  page: number
  x: number; y: number; width: number; height: number  // sig
  showSignature: boolean; showSignerName: boolean
  nameX: number; nameY: number; nameWidth: number; nameHeight: number
  qrX?: number; qrY?: number; qrWidth?: number; qrHeight?: number
}
```

### Technical: react-draggable React 19

Tất cả `<Draggable>` phải dùng `nodeRef` pattern vì React 19 đã xóa `findDOMNode`:

```typescript
const sigNodeRef = useRef<HTMLDivElement>(null)
<Draggable nodeRef={sigNodeRef as RefObject<HTMLElement>} ...>
  <div ref={sigNodeRef} ...>
```

`<Resizable>` chỉ enable `{ right: true, bottom: true, bottomRight: true }` để position không dịch chuyển khi resize.

---

## UI: Action buttons và quyền thao tác

### Auto-save config khi "Ký & Gửi"

`openSendModal` là `async` — tự động lưu cấu hình phê duyệt vào DB **trước** khi mở `SignPlacementModal`:

- Validate `xemXetUserId` (Cấp 1) và `pheDuyetUserId` trước
- Upsert các trường: `cap_tl`, `phe_duyet_user_id`, `phe_duyet`, `xem_xet_user_id`, `xem_xet`, `auto_convert_pdf`, `ghi_chu`
- Nếu lỗi DB → hiện `actionError`, **không mở modal**
- Gọi `loadInstance()` để reload instance với dữ liệu mới trước khi mở modal (đảm bảo `handleSignConfirm` đọc đúng `xem_xet_user_id`/`phe_duyet_user_id`)
- Không có nút "Lưu cài đặt" riêng — thay bằng hint text nhỏ *"Cài đặt sẽ được lưu tự động khi ký & gửi"*
- `handleSaveConfig` đã **xóa** khỏi codebase (logic đã được inline vào `openSendModal`)

### Card "Tiến trình & Lịch sử" (phải, luôn hiển thị)

Card gộp trong cột phải thay thế 2 section cũ ("Lịch sử" cột trái + "Thông tin phê duyệt" chỉ khi `!isEditable`):

- **Luôn hiển thị** khi instance có bất kỳ dữ liệu ký hoặc logs
- Phần trên: timeline ký từng bước — Soạn thảo / Xem xét / Phê duyệt, tên + ngày + `✓` màu emerald nếu đã ký
- Phần dưới: log entries từ `iso_form_instance_logs`, ngăn cách bằng divider

### Vị trí action buttons

Các nút hành động nằm **cùng hàng với `WorkflowStepper`** trong một card, không có card "Thao tác" riêng trong right column:

```tsx
<div className="flex items-center justify-between gap-4 flex-wrap">
  <WorkflowStepper cap_tl={cap_tl} trang_thai={instance.trang_thai} />
  <div className="flex items-center gap-2 shrink-0 flex-wrap">
    {isEditable && isNguoiTao && (
      <button onClick={openSendModal}>Ký & Gửi xem xét / phê duyệt</button>
    )}
    {isXemXet && <button onClick={openXemXetModal}>Ký xem xét</button>}
    {isPheDuyet && <button onClick={openPheDuyetModal}>Phê duyệt</button>}
    {canReturn && (
      <button onClick={() => setShowReturnModal(true)}>Trả về</button>
    )}
  </div>
</div>
```

### Quy tắc quyền `canReturn`

Chỉ người được giao đúng bước mới được bấm "Trả về" — không phải bất kỳ user nào đăng nhập:

```typescript
const canReturn =
  (instance.trang_thai === "cho_xem_xet" && instance.xem_xet_user_id === userId) ||
  (instance.trang_thai === "cho_phe_duyet" && instance.phe_duyet_user_id === userId)
```

- Khi `cho_xem_xet`: chỉ `xem_xet_user_id` được trả về
- Khi `cho_phe_duyet`: chỉ `phe_duyet_user_id` được trả về
- Người soạn thảo không thể tự trả về sau khi đã gửi

---

## UI: ReturnModal

Component riêng trong `forms/[id]/page.tsx` cho action `tra_ve`.

- Không cần PIN
- Có textarea nhập lý do (optional nhưng khuyến khích)
- Cập nhật `trang_thai = "tra_ve"` + `ly_do_tra_ve`

---

## Permissions

| Permission | Mô tả |
|-----------|-------|
| `iso.forms.view` | Xem danh sách instances |
| `iso.forms.create` | Tạo instance mới |
| `iso.forms.edit` | Sửa nháp + upload file |
| `iso.forms.delete` | Xóa instance nháp |
| `iso.forms.approve` | Ký xem xét + phê duyệt |

---

## Biến môi trường cần thiết

```
GEMINI_API_KEY=<Google AI Studio API key>
```

Thêm vào cả `.env.local` và Vercel environment variables.
Lấy tại: https://aistudio.google.com/app/apikey

---

## Thông báo workflow (ISO Forms Notify)

### API route

`POST /api/iso/forms/notify/route.ts`

Input:
```typescript
{
  instanceId: string
  factoryId: string
  action: string           // "soan_thao" | "xem_xet" | "phe_duyet" | "tra_ve"
  recipientUserIds: string[]
  lyDo?: string            // kèm theo khi action = "tra_ve"
  actorUserId?: string
}
```

### Kênh thông báo (3 kênh, độc lập nhau)

1. **In-app**: insert vào bảng `notifications` với `doc_type: "iso_form"`, `doc_id: instanceId`
2. **Telegram**: gửi đến group cấu hình bởi `ISO_TELEGRAM_BOT_TOKEN` + `ISO_TELEGRAM_CHAT_ID`
3. **Email**: tra email qua `maintenance_staff` (theo `profile_id` hoặc `ten`), gửi qua Gmail SMTP

Email lookup luôn dùng `maintenance_staff.email` — **không** dùng `profiles.auth_email` vì email auth có format nội bộ `username@auth.rubber-erp.example.com`.

### Quy tắc người nhận theo action

| Action | Người nhận |
|--------|-----------|
| `soan_thao` (Cấp 1) | `xem_xet_user_id` |
| `soan_thao` (Cấp 2) | `phe_duyet_user_id` |
| `xem_xet` | `phe_duyet_user_id` |
| `phe_duyet` | `nguoi_tao` + `xem_xet_user_id` (filter null) |
| `tra_ve` (from `cho_xem_xet`) | `nguoi_tao` |
| `tra_ve` (from `cho_phe_duyet`, Cấp 1) | `xem_xet_user_id` |
| `tra_ve` (from `cho_phe_duyet`, Cấp 2) | `nguoi_tao` |

### Helper `sendNotify` trong forms/[id]/page.tsx

```typescript
const sendNotify = (action: string, recipientUserIds: string[], lyDo?: string) => {
  if (!factoryId || !userId) return
  const ids = recipientUserIds.filter(Boolean)
  if (!ids.length) return
  void fetch("/api/iso/forms/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instanceId, factoryId, action,
      recipientUserIds: ids,
      lyDo,
      actorUserId: userId,
    }),
  }).catch(() => {})
}
```

Gọi fire-and-forget sau mỗi action thành công. Lỗi thông báo không block workflow.

### Action labels (header email/Telegram)

- `soan_thao`: "Hồ sơ cần xem xét / phê duyệt"
- `xem_xet`: "Hồ sơ cần phê duyệt"
- `phe_duyet`: "Hồ sơ đã được phê duyệt"
- `tra_ve`: "Hồ sơ bị trả về" (header email màu đỏ, kèm `lyDo`)

---

## Dependencies đã có trong project

- `pdf-lib` — stamp PDF
- `pdfjs-dist` — render PDF canvas trong browser
- `react-draggable` — kéo elements
- `re-resizable` — resize elements
- `jszip` — xử lý DOCX/XLSX (replaceFormTags)
- `qrcode` — tạo QR (server-side)
- `qrcode.react` — render QR trong browser (`QRCodeSVG` dùng trong SignPlacementModal)
- `nodemailer` — gửi email Gmail SMTP (dùng trong `/api/iso/forms/notify/route.ts`)

---

## UI: Upload file trong forms/[id]/page.tsx

### Hành vi upload (đã cập nhật 2026-06-07)

- Chọn file → **auto-upload ngay**, không cần nút "Tải lên" riêng
- Sau khi upload xong: `setUploadFile(null)`, card file dựa vào `instance.draft_file_url`
- Card file đã upload hiển thị: tên file | nút Xem (eye, mở tab mới) | nút Tải xuống | nút "Thay file"
- Nút "Thay file" = click hidden `<input type="file">` để chọn file mới (overwrite)
- Khi file upload là **PDF**: auto-set `auto_convert_pdf = true` và **disable toggle** (không cho tắt)
- Khi file là Office (DOCX/XLSX): toggle `auto_convert_pdf` hoạt động bình thường

### Download filename

- File tải về dùng tên `${instance.tieu_de}.${ext}` thay vì tên path raw (`draft.docx`)
- Pattern: fetch → blob → `URL.createObjectURL` → `<a download="${tieu_de}.${ext}">`

---

## UI: pdfjs worker trong SignPlacementModal

Worker URL phải dùng **local asset**, không dùng CDN (CDN không ổn định trên Vercel production):

```typescript
if ((globalThis as Record<string, unknown>).pdfjsWorker) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = ""
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs", import.meta.url
  ).toString()
}
```

Nếu load PDF fail → hiện message lỗi rõ, không để spinner vô tận.

---

## UI: "Lập hồ sơ" quick dialog trong forms/page.tsx

Nút "Lập hồ sơ" (outline emerald) cạnh nút "Cập nhật chỉ mục AI" trong header.

**Dialog flow**:
1. Dropdown "Phòng ban" — load distinct `phong_ban` từ `iso_documents` where `trang_thai='co_hieu_luc'` AND `phan_loai_tl='con'`
2. Dropdown "Biểu mẫu" — filter theo phòng ban, hiển thị `{ma_tai_lieu} — {ten_tai_lieu}`, sorted by `ma_tai_lieu`
3. Field "Tiêu đề hồ sơ" — auto-fill từ `ten_tai_lieu` khi chọn doc, người dùng có thể sửa
4. Nút "Lập hồ sơ ngay" → POST `/api/iso/forms/clone` → navigate `/iso/forms/{instanceId}`

Giúp người dùng tạo instance nhanh mà không cần dùng AI search.

---

## UI: Quick-action badges trong forms/page.tsx danh sách

Mỗi row trong bảng instances hiển thị badge màu phù hợp với vai trò của user hiện tại:

| Điều kiện | Label | Màu |
|-----------|-------|-----|
| `draft` + user là `nguoi_tao` | Ký & Gửi | emerald |
| `cho_xem_xet` + user là `xem_xet_user_id` | Xem xét | blue |
| `cho_phe_duyet` + user là `phe_duyet_user_id` | Phê duyệt | green |
| `tra_ve` | Xem lý do | amber |
| Còn lại | Mở | slate |

Click bất kỳ badge nào → navigate `/iso/forms/{id}`.

---

## Tích hợp "Việc của tôi" (my-tasks/page.tsx)

Trang `my-tasks` có thêm section **"Hồ sơ thực hiện cần xử lý"** bên dưới bảng tài liệu ISO.

Query `iso_form_instances` với:
- `.or("nguoi_tao.eq.{uid},xem_xet_user_id.eq.{uid},phe_duyet_user_id.eq.{uid}")`
- `.in("trang_thai", ["draft","cho_xem_xet","cho_phe_duyet","tra_ve"])`

Filter thêm client-side:
- `draft` → chỉ hiện nếu `nguoi_tao === uid`
- `cho_xem_xet` → chỉ hiện nếu `xem_xet_user_id === uid`
- `cho_phe_duyet` → chỉ hiện nếu `phe_duyet_user_id === uid`
- `tra_ve` → hiện với tất cả liên quan

Mỗi dòng: tiêu đề, role label (Cần ký & gửi / Cần xem xét / Cần phê duyệt / Đã trả về), trạng thái badge, ngày tạo, nút "Xử lý" → `/iso/forms/{id}`.

---

## Tích hợp Bell notification trong layout.tsx

`src/app/dashboard/layout.tsx` hiển thị bell icon cạnh avatar user (góc trên phải):
- Load 15 thông báo gần nhất từ bảng `notifications` theo `factory_id + user_id`
- Badge đỏ hiện số chưa đọc (tối đa "9+")
- Click dòng thông báo → mark `is_read = true` + navigate đến `notification.link`
- Realtime: subscribe `postgres_changes INSERT` trên bảng `notifications` filter `user_id=eq.{uid}` → thêm thông báo mới vào đầu danh sách ngay lập tức
- "Đánh dấu tất cả đã đọc" → UPDATE toàn bộ unread của user

---

## Trạng thái triển khai

- [x] Code: API routes (embed-doc, search, clone, finalize, batch-embed)
- [x] Code: UI pages (forms/page.tsx, forms/[id]/page.tsx)
- [x] Code: iso-types.ts + iso-shell.tsx đã cập nhật
- [x] Code: Embed trigger fire-and-forget sau phe_duyet trong documents/[id]/page.tsx
- [x] Feature: WorkflowStepper (Cấp 1/2 stepper, badge tra_ve/tu_choi)
- [x] Feature: mo_ta_tim_kiem trên form soạn thảo + read-only trên form instance
- [x] Feature: Drag-and-drop SignPlacementModal cho cả 3 bước
- [x] Feature: replaceFormTags() cho Office signing
- [x] Feature: soan_thao action handler trong finalize/route.ts
- [x] Feature: Auto-upload + card file + PDF locks toggle (2026-06-07)
- [x] Feature: Download filename = instance.tieu_de (2026-06-07)
- [x] Feature: pdfjs local worker trong SignPlacementModal (2026-06-07)
- [x] Feature: "Lập hồ sơ" quick dialog trong forms/page.tsx (2026-06-07)
- [x] Feature: Quick-action badges trong forms list rows (2026-06-07)
- [x] Feature: ISO form instances trong my-tasks/page.tsx (2026-06-07)
- [x] Feature: Bell notification icon trong layout.tsx với Supabase Realtime (2026-06-07)
- [x] Feature: SignPlacementModal hiển thị tên thật (`profiles.full_name`) + QR thật (`QRCodeSVG`) (2026-06-07)
- [x] Feature: `canReturn` chỉ cho phép đúng `xem_xet_user_id` / `phe_duyet_user_id` (2026-06-07)
- [x] Feature: Action buttons (Ký & Gửi / Ký xem xét / Phê duyệt / Trả về) nằm cùng hàng với WorkflowStepper (2026-06-07)
- [x] Feature: `/api/iso/forms/notify/route.ts` — in-app + Telegram + Gmail cho mọi workflow action (2026-06-07)
- [x] Feature: QR stamp trên tất cả trang PDF (loop `pdfDoc.getPages()`) trong finalize route (2026-06-07)
- [x] Feature: `openSendModal` async auto-save config trước khi mở SignPlacementModal; xóa nút "Lưu cài đặt" (2026-06-08)
- [x] Feature: Card gộp "Tiến trình & Lịch sử" thay thế 2 section riêng (2026-06-08)
- [x] Feature: Badge action trong danh sách instances lớn hơn ~30%, cột tiêu đề giới hạn width (2026-06-08)
- [x] Migration 1: `20260607_iso_forms_embedding.sql` ✅ Đã chạy
- [x] Migration 2: `20260607_iso_form_instances.sql` ✅ Đã chạy
- [x] Migration 3: `20260608_iso_forms_soan_thao_placement.sql` ✅ Đã chạy
- [x] `GEMINI_API_KEY` đã thêm vào `.env.local`
- [ ] `GEMINI_API_KEY` cần thêm vào Vercel nếu chưa có

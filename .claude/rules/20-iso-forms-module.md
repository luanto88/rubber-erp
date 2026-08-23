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

### Nguyên tắc tag Office (DOCX/XLSX)

- **Tag có trong file → thay** (text tag hoặc image tag như `{{CHU_KY_*}}`, `{{QR}}`)
- **Tag không có trong file → bỏ qua**, không lỗi
- **Người dùng đã điền thủ công thay vì dùng tag → bỏ qua** (tag không còn trong file nên tự động bỏ qua)

Áp dụng cho tất cả loại file PDF, DOCX, XLSX và tất cả bước `soan_thao`, `xem_xet`, `phe_duyet`.

### Source file theo bước

| Action | File PDF (`draftExt === "pdf"`) | File Office (DOCX/XLSX) |
|--------|--------------------------------|------------------------|
| `soan_thao` | `draft_file_url` | `draft_file_url` |
| `xem_xet` | `soan_thao_signed_url` → `draft_file_url` | `soan_thao_signed_url` → `draft_file_url` |
| `phe_duyet` | `final_pdf_url` → `soan_thao_signed_url` → `draft_file_url` | `soan_thao_signed_url` → `draft_file_url` |

**Quan trọng**: `phe_duyet` cho file Office **không được dùng `final_pdf_url`** làm source — giá trị này có thể là stale từ lần test cũ. `draftExt` được tính từ `draft_file_url` (tên file thật) nên không bị ảnh hưởng.

Backward compat: instance cũ có `soan_thao_signed_url` kết thúc `.pdf` (CloudConvert cũ) → `sourceIsPdf = true` → vẫn đi path `stampPdf` đúng.

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

**DOCX image tag (`replaceDocxImageTag`) — kỹ thuật quan trọng:**
- Signature nhận `ArrayBuffer | Uint8Array` (tương thích Buffer của Node.js)
- Khi lưu file vào ZIP: `Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer)` — tránh copy bytes thừa từ pooled ArrayBuffer
- QR buffer: truyền `qrBuffer` trực tiếp từ `QRCode.toBuffer()`, **không dùng `qrBuffer.buffer`** (`.buffer` trả về pooled ArrayBuffer lớn hơn data thật)
- EMU size: **QR = `432000 × 432000` (~12mm vuông)**; chữ ký = `900000 × 450000` (~24×12mm)
- `<wp:docPr id>` phải **unique** trong toàn document — tính bằng `max(existingIds) + 1`:
  ```typescript
  const existingDocPrIds = [...docXml.matchAll(/<wp:docPr[^>]*\bid="(\d+)"/g)].map(m => parseInt(m[1]))
  const newDocPrId = existingDocPrIds.length > 0 ? Math.max(...existingDocPrIds) + 1 : 1
  ```
  Nếu không unique, Word từ chối hình ảnh thứ hai (QR hiện broken image)

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
| `soan_thao` (PDF) | `trang_thai`, `soan_thao`, `soan_thao_placement`, `soan_thao_signed_url`, `ky_soan_thao_at`, `final_pdf_url` |
| `soan_thao` (Office) | `trang_thai`, `soan_thao`, `soan_thao_placement`, `soan_thao_signed_url`, `ky_soan_thao_at`, **`final_pdf_url = null`**, **`final_office_url = null`** |
| `xem_xet` | `trang_thai = cho_phe_duyet`, `xem_xet`, `xem_xet_placement`, `ky_xem_xet_at` |
| `phe_duyet` | `trang_thai = da_phe_duyet`, `phe_duyet`, `phe_duyet_placement`, `ky_phe_duyet_at`, `final_pdf_url` / `final_office_url` |

**Lý do xóa `final_pdf_url = null` khi `soan_thao` Office**: Ngăn bước `phe_duyet` bị dẫn vào path `stampPdf` do đọc giá trị stale từ lần test cũ (code cũ từng tạo PDF tại soan_thao). Sau khi clear, server và UI đều đọc đúng `soan_thao_signed_url` làm source.

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

### Fix 2026-07-13 — hỗ trợ ký chữ ký ở trang 2+ (trước đó luôn hard-code trang 1)

**Bug đã fix**: `SignPlacementModal` trước đây luôn `pdf.getPage(1)` khi render canvas và luôn gửi `page: 1` trong `FullPlacement` khi ký — không có UI chuyển trang. Với hồ sơ nhiều trang, nếu vị trí đặt chữ ký thực tế nằm ở trang 2 trở đi thì không thể đặt được (chỉ luôn thấy và ký được trên trang 1). Backend `finalize/route.ts` (`stampPdf`) đã hỗ trợ sẵn `placement.page` bất kỳ từ trước (`pageIndex = placement.page - 1`, có bounds-check) — chỉ cần sửa phần giao diện.

**Fix**: mirror đúng pattern đã dùng ở `documents/[id]/page.tsx` (module Văn bản, xem `.claude/rules/22-documents-module.md` mục "PDF nhiều trang trong SignPlacementModal"):
- Thêm `pdfDocRef` (ref giữ `pdf` đã load), `currentPage`/`numPages` state.
- Tách hàm `renderPdfPage(pdf, pageNum)` — render 1 trang bất kỳ lên canvas, tính lại viewport/scale mỗi lần (kích thước trang có thể khác nhau giữa các trang).
- `loadPdf` giờ chỉ load `pdf` 1 lần, lưu vào `pdfDocRef`, gọi `renderPdfPage(pdf, 1)` cho trang đầu.
- Hàm `goToPage(p)` gọi lại `renderPdfPage(pdfDocRef.current, p)`.
- UI điều hướng "Trang X / Y" + nút `ChevronLeft`/`ChevronRight` (chỉ hiện khi `numPages > 1`), đặt ngay trên canvas.
- `handleConfirm` đổi `page: 1` → `page: currentPage` trong nhánh canvas (PDF). Nhánh Office (không có canvas) giữ nguyên `page: 1` vì không có khái niệm trang.
- QR (chỉ có ở bước `soan_thao`) không đổi — theo thiết kế vẽ trên **tất cả trang** của PDF (`finalize/route.ts`), không phụ thuộc `currentPage`.

Cùng đợt, rà lại 2 module ký PDF liên quan khác theo yêu cầu người dùng:
- **Văn bản** (`documents/[id]/page.tsx`): đã đúng từ trước (fix ngày 2026-07-06), không có bug tương tự.
- **Soạn thảo ISO** (`iso/documents/[id]/page.tsx`): modal đặt chữ ký inline (không phải component riêng) đã hỗ trợ chọn trang cho chữ ký/tên từ trước, không có bug tương tự. Tuy nhiên phát hiện thêm 1 bug hẹp hơn ở `src/app/api/sign/generate-pdf/route.ts`: khi `fillMetadataPlaceholders` không đọc được text PDF để dò tag `"QR:"` (lỗi trích xuất text, không phải trường hợp thường gặp), 2 nhánh fallback vẽ QR thủ công (dòng ~1462 và ~1637) hard-code `originalPages.getPage(0)` — bỏ qua trang người dùng đã kéo QR tới. Đã fix: `manualQrPlacement` giờ mang theo `page: soanPlacement.page`, 2 nhánh fallback tính `qrPageIndex = manualQrPlacement.page - 1` (bounds-check trước khi vẽ) thay vì hard-code `getPage(0)`. Không đụng cơ chế chính trong `fillMetadataPlaceholders` (dòng ~886-899) — cơ chế đó vốn đã vẽ QR trên **tất cả trang** đúng thiết kế, không bị bug này.

`npx tsc --noEmit` và `npx eslint` đều sạch (chỉ còn warning cũ không liên quan). **Chưa test tay** — cần: ký 1 hồ sơ PDF ≥2 trang trong `/dashboard/iso/forms`, chuyển sang trang 2+ đặt chữ ký, xác nhận PDF sau ký có chữ ký đúng vị trí/trang; và test case hiếm gặp QR fallback (PDF lỗi trích xuất text) ở module Soạn thảo ISO nếu tái hiện được.

`pdfScale = 1.5`, `pdfPageH` = chiều cao trang PDF theo pdf-lib units (không phải pixel).

**Ghi chú quan trọng (re-verify cùng ngày 2026-07-13)**: người dùng báo lại đúng bug này sau khi mục "Fix 2026-07-13" ở trên đã được ghi vào rule — kiểm tra trực tiếp `forms/[id]/page.tsx` và `generate-pdf/route.ts` lúc đó xác nhận **code vẫn còn hard-code `page: 1`/`getPage(1)`**, dù rule file đã mô tả đúng fix cần làm. Tức là lần trước fix đã được lên kế hoạch/viết tài liệu nhưng **không thực sự được ghi vào code** (session bị ngắt giữa chừng, hoặc thay đổi không được lưu). Đã áp dụng lại đúng fix mô tả ở trên, xác nhận bằng cách đọc trực tiếp file ngay trước khi sửa (không tin nội dung rule mô tả là đã có trong code) và `npx tsc --noEmit` sạch sau khi sửa. Bài học: khi rule mô tả "đã fix X" nhưng người dùng vẫn báo lỗi X, luôn đọc lại chính file code để xác nhận thực tế, không giả định rule đúng.

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

### Source file trong `openPheDuyetModal`

Khi mở modal phê duyệt, phải kiểm tra loại file gốc trước khi chọn source URL:

```typescript
const isDraftPdf = instance.draft_file_type === "pdf"
const src = isDraftPdf
  ? (instance.final_pdf_url || instance.soan_thao_signed_url || instance.draft_file_url)
  : (instance.soan_thao_signed_url || instance.draft_file_url)
```

- File PDF: `final_pdf_url` là kết quả thật từ bước trước → dùng được
- File Office: **bỏ qua `final_pdf_url`** — giá trị này có thể là stale từ code cũ → dùng `soan_thao_signed_url` trực tiếp

Không dùng `urlIsPdf(src)` để quyết định source, vì URL stale có thể trỏ đến `.pdf` không thuộc file hiện tại.

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

## Bài học phiên 2026-06-08

### OTP đổi PIN / chữ ký / mật khẩu

- Luồng OTP cho thao tác nhạy cảm **phụ thuộc vào `maintenance_staff.email`**, không dùng `profiles.auth_email`
- Tài khoản cũ chưa có email thật trong `maintenance_staff.email` sẽ **không đổi được PIN/chữ ký/mật khẩu qua OTP** cho đến khi được bổ sung email
- Khi tạo tài khoản mới, cần lưu email thật ngay từ bước đăng ký và gắn vào `maintenance_staff` theo `profile_id`
- Khi tra email OTP qua `maintenance_staff`, **ưu tiên match theo `profile_id`**; chỉ fallback theo `ten` nếu có đúng 1 hồ sơ chưa liên kết
- Nếu có **nhiều hồ sơ nhân sự trùng họ tên** chưa liên kết, phải trả lỗi rõ ràng để admin xử lý; **không được** tự gán bừa email vào sai người

### Form đăng nhập vs đăng ký

- `Đăng nhập` **không được** validate hay yêu cầu email
- `Email` chỉ bắt buộc ở `Đăng ký` và các flow xác thực OTP
- Nếu thấy lỗi kiểu "Vui lòng nhập email hợp lệ" ở tab `Đăng nhập`, đó là bug UI chứ không liên quan tới việc tài khoản cũ thiếu email
- Nếu giao diện login hiện tiếng Việt bị lỗi dấu hoặc bị đổi sang không dấu, coi đó là **bug UI/encoding**, không phải thay đổi nghiệp vụ

### Migration liên quan

- `20260608_security_otp_challenges.sql`: bảng challenge OTP ngắn hạn cho các thao tác nhạy cảm
- `20260608_maintenance_staff_email.sql`: thêm cột `maintenance_staff.email` để làm đích nhận OTP

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

### Fix 2026-07-13 (tiếp) — "Xem file"/"Tải xuống" hiện nhầm PDF cũ sau khi hồ sơ bị trả về (`tra_ve`) và người soạn thảo thay file khác

**Bug đã fix**: `fileUrl` (`forms/[id]/page.tsx`, dùng cho cả nút mắt "Xem file" lẫn `handleDownload`) tính bằng `instance.final_pdf_url || instance.final_office_url || instance.soan_thao_signed_url || instance.draft_file_url` — không điều kiện theo `trang_thai`. Khi hồ sơ đã qua ít nhất 1 vòng ký (`soan_thao` → `cho_xem_xet`/`cho_phe_duyet`) rồi bị `tra_ve`, các trường file đã ký (`soan_thao_signed_url`/`final_pdf_url`/`final_office_url`) của vòng ký **đã bị từ chối** đó vẫn còn nguyên trong DB (`handleReturn` chỉ set `trang_thai`+`ly_do_tra_ve`, không xóa các trường này — xem `handleReturn`, dòng ~843). Khi người soạn thảo upload file mới (`handleUpload` chỉ cập nhật `draft_file_url`/`draft_file_type`, không đụng các trường trên), `fileUrl` vẫn ưu tiên trường file đã ký CŨ → "Xem file"/"Tải xuống" tiếp tục hiện đúng file PDF trước khi bị trả về, dù `draft_file_url` (badge loại file) đã đổi đúng. Người dùng thấy như "thay file không được".

Lưu ý: bản thân việc upload **không** bị chặn (`isEditable = trang_thai === "draft" || "tra_ve"` đã đúng từ trước, cho phép cả `tra_ve`) và bước ký lại (`soan_thao` action, gọi `finalize/route.ts`) vẫn đọc đúng `draft_file_url` mới nhất làm nguồn ký (`openSendModal` đã có sẵn comment "Dùng URL từ kết quả reload (fresh) thay vì closure cũ") — bug chỉ nằm ở tầng hiển thị "Xem file"/"Tải xuống", không phải ở luồng ký thật.

**Fix**: `fileUrl` giờ ưu tiên `draft_file_url` bất cứ khi nào `isEditable` (tức `draft`/`tra_ve`) — chỉ dùng chuỗi ưu tiên file-đã-ký cũ khi hồ sơ đã ra khỏi trạng thái editable (đang chờ xem xét/phê duyệt trở đi, khi đó `soan_thao_signed_url`/`final_pdf_url` chắc chắn là của vòng ký hiện tại, không phải vòng đã bị từ chối):

```typescript
const fileUrl = isEditable
  ? instance.draft_file_url
  : (instance.final_pdf_url || instance.final_office_url || instance.soan_thao_signed_url || instance.draft_file_url)
```

Không sửa `handleReturn`/`handleUpload` để null hóa các trường file đã ký cũ — không cần thiết vì chúng sẽ bị ghi đè đúng ở lần ký kế tiếp, và giữ lại làm lịch sử không gây hại (chỉ tầng đọc/hiển thị bị sai, không phải tầng ghi).

`npx tsc --noEmit`/`npx eslint` sạch. **Chưa test tay** — cần: tạo 1 hồ sơ, ký & gửi xem xét, người xem xét bấm "Trả về" → xác nhận "Xem file" quay về đúng file gốc (chưa ký); người soạn thảo bấm "Thay file" chọn file khác → xác nhận "Xem file"/"Tải xuống" ngay lập tức phản ánh đúng file mới (không còn thấy PDF cũ); ký lại → xác nhận vòng ký mới hoạt động bình thường và sau khi ký xong `fileUrl` lại đúng theo `soan_thao_signed_url`/`final_pdf_url` mới.

---

**Kế hoạch phiên sau (chưa làm)**: tiền tố ký thay KT./TM./TL./TUQ. + hợp nhất eye-icon ẩn/hiện chữ ký-tên cho toàn bộ module ISO (cả Soạn thảo ISO lẫn Thực hiện hồ sơ ISO) — xem `.claude/rules/16-iso-vanban-module.md` mục "Kế hoạch phiên sau (2026-07-13) — Hợp nhất eye-icon chữ ký/tên + tiền tố ký thay KT/TM/TL/TUQ cho toàn bộ module ISO".

---

## Trạng thái triển khai

Toàn bộ code/feature/fix mô tả trong file này (API routes, UI, SignPlacementModal,
notify, upload, QR...) đã hoàn tất — chi tiết từng mục nằm ở các section tương ứng
phía trên, không lặp lại danh sách checklist ở đây nữa. 3 migration
(`20260607_iso_forms_embedding.sql`, `20260607_iso_form_instances.sql`,
`20260608_iso_forms_soan_thao_placement.sql`) đã chạy.

**Còn 1 việc cần xác nhận**: `GEMINI_API_KEY` đã có trong `.env.local`, nhưng cần
xác nhận đã thêm vào biến môi trường Vercel (production) hay chưa — nếu chưa, tính
năng semantic search/embed sẽ lỗi trên production dù chạy đúng ở local.

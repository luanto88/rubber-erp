# Tra cứu thiết bị bằng QR — ĐÃ CHỌN PA2 (token QR), rate limit bảng DB

> Trạng thái (2026-11-06): GĐ1 ĐÃ CODE (chờ chạy migration `20261111_equipment_qr_tokens.sql` + test tay tem MCC-1, MCC-2). Domain tem chốt: qlsxkpt.vercel.app.

## Context
Kỹ thuật viên cần quét QR dán trên máy/xe để xem ngay lý lịch sửa chữa/bảo dưỡng và vật tư đã thay.
Dữ liệu nền đã có; thiếu lớp truy cập QR → trang thiết bị, trang công khai an toàn, lọc vật tư.

## Bước 0 — Hiện trạng đã đọc
- Thiết bị nằm ở **2 bảng**: `maintenance_assets` (máy móc, `UNIQUE(factory_id, ma_tb)`, `bo_phan`,
  `loai`, `nam_sd`, `bien_so`, `trang_thai active|inactive`) và `dispatch_vehicles` (xe Đội xe —
  biên bản Đội xe lưu `dispatch_vehicle_id`, không có `asset_id`). QR phải phủ cả hai.
- Không có cột "vị trí" → dùng `bo_phan` (khu vực). Không có lịch bảo trì định kỳ → chỉ có
  "lần bảo trì gần nhất" (biên bản `da_duyet` mới nhất), không có "hạn kế tiếp".
- Lịch sử: `maintenance_records` → `maintenance_record_lines` (asset_id / dispatch_vehicle_id,
  noi_dung, cac_khac_phuc, chi_phi_dk…) → `maintenance_materials` (nguon trong_kho/ben_ngoai/gia_cong,
  inventory_item_id, ten_vat_tu, dvt, so_luong, don_gia…). Không có BOM thiết bị.
- Có sẵn để tái dùng: trang **Lý lịch** `maintenance/history/page.tsx` (picker thiết bị/xe, two-step
  query, Quét QR biên bản, in F01/F02); `QrScanner` (`product/confirm/qr-scanner`), `QrScanPortal`;
  `downloadStorageBulkQrPdf` (`src/lib/storage-pdf.ts`, lưới nhãn 35mm) + `pdf-qr-shared.ts`;
  doc-ui (`DetailPageHeader`, `DetailSplitLayout`, `StatusSummaryBar`, `TimelineSteps`, `ExpandableRow`,
  `FilterBar`, `StatusBadge`, `ListState`, `SegmentedTabs`); theme Bảo trì; rule 29.
- Mẫu trang công khai tốt nhất trong repo: `api/iso/public-doc/[id]` (service role + whitelist cột,
  không trả URL file). `/storage` và `/product-label` tra theo mã dễ đoán, chưa rate limit, chưa noindex.
- Migration Bảo trì không có policy RLS trong repo ⇒ trang công khai bắt buộc đi qua API service role.
- Rate limit duy nhất hiện có: bảng DB trong `api/account/_lib/security.ts` (OTP). Không middleware, không Redis.

## Bước 1 — Kết quả nghiên cứu (rút gọn)
| Agent | Điều áp dụng |
|---|---|
| A – CMMS | Fiix/UpKeep/Odoo: QR = URL cố định theo thiết bị; khách chỉ thấy tối thiểu (+ "Báo hỏng" tạo yêu cầu chờ duyệt, MaintainX/Limble). Maximo "auto-add spare part": dựng **BOM thực tế từ lịch sử** (số lần thay, lần gần nhất, khoảng cách TB) rồi mới chốt BOM. SAP "where-used". In hàng loạt lưới nhãn + mã chữ dưới QR, tem chịu dầu/nhiệt. |
| B – UX mobile | Tap ≥48px, chữ 16px, tương phản ≥4.5:1, trạng thái kèm chữ; thanh hành động cố định đáy (safe-area); chip lọc nhanh ngang + sheet lọc nâng cao có "Áp dụng"; timeline 5 mục + "Xem thêm"; vật tư sắp theo tần suất; SSR + skeleton; offline PWA để sau. |
| C – Bảo mật | Mã tuần tự/UUID trong URL công khai ⇒ dò được (OWASP API1) và không thu hồi được → **token ngẫu nhiên ≥128 bit, tạo lại được**; API service role chỉ trả whitelist; 404 trung tính; rate limit (Upstash hoặc bảng DB, không in-memory); `noindex`, `no-store`, `Referrer-Policy: no-referrer`; không trả `err.message`. |

Mâu thuẫn A↔C: A khuyên URL theo mã (đọc được, phân quyền ở server), C khuyên token. Kết hợp được:
URL chứa token, nhãn in thêm mã thiết bị bằng chữ để người đọc được.

## Bước 2 — Phương án
| | PA1 — URL theo mã/UUID | **PA2 — Token QR (khuyến nghị)** | PA3 — CMMS đầy đủ |
|---|---|---|---|
| URL | `/thiet-bi?id=<uuid>` (mirror `/storage`) | `/tb/<token 22 ký tự>` | như PA2 |
| Migration | Không | 1 file nhỏ: bảng ánh xạ `equipment_qr_tokens` + bảng đếm `public_rate_limits`, backfill bằng SQL (không sửa bảng cũ) | PA2 + bảng BOM phụ tùng, lịch bảo trì định kỳ, phiếu báo hỏng |
| Thu hồi nhãn lộ | Không | "Tạo lại QR" → token cũ chết (404 trung tính) | như PA2 |
| Chống dò | UUID khó đoán, mã thì dò được | Tốt | Tốt |
| Rate limit / noindex | Thêm được | Có (bảng DB như OTP) | Có |
| Thời gian (ước) | GĐ1–2 ≈ 3–4 ngày | GĐ1–2 ≈ 5–6 ngày | 3–4 tuần |
| Rủi ro | QR đã in không đổi được nếu sau này cần thu hồi | Nhãn phải in lại khi tạo lại token | Phạm vi lớn, đụng nghiệp vụ mới |
| Mở rộng | Kém | Tốt — PA3 xây chồng lên được | — |

**Khuyến nghị PA2**: ổn định (token không đổi trừ khi admin chủ động tạo lại), không lộ mã nội bộ,
thu hồi được, chi phí thêm chỉ 1 migration nhỏ; GĐ3–4 của PA2 chính là đường lên PA3.

## Bước 3 — Kế hoạch giai đoạn (PA2)
**Một URL duy nhất** `/tb/<token>`: server render phần công khai; client nếu có phiên + `maintenance.view`
+ đúng nhà máy thì gọi API có Bearer để mở thêm phần nội bộ (mẫu `/product-label`).

### GĐ1 — MVP: QR → trang công khai + đăng nhập → lịch sử (CHỈ MÁY MÓC)
- **Migration** (chạy tay), không sửa bảng cũ:
  - Bảng ánh xạ chung `equipment_qr_tokens(token TEXT PK, factory_id, asset_id NULL, dispatch_vehicle_id NULL,
    created_at, created_by, revoked_at NULL)`, CHECK đúng 1 trong 2 cột id; partial unique index 1 token
    còn hiệu lực cho mỗi thiết bị. ⇒ `/tb/<token>` tra MỘT lần, giữ token đã thu hồi để trả 404 trung tính,
    sẵn cột xe cho sau này (không dùng tiền tố m_/v_ vì lộ loại thiết bị và khó đổi).
  - Token sinh trong SQL: `DEFAULT rtrim(translate(encode(extensions.gen_random_bytes(16),'base64'),'+/','-_'),'=')`
    (base64url 22 ký tự, 128 bit, pgcrypto có sẵn trên Supabase) ⇒ backfill bằng 1 câu INSERT … SELECT
    cho mọi `maintenance_assets`, thiết bị tạo sau lấy token qua API (không cần script Node).
  - Bảng đếm rate limit `public_rate_limits(key_hash, bucket_start, hits, PK(key_hash, bucket_start))`:
    UPSERT `hits = hits + 1` theo cửa sổ 1 phút ⇒ tối đa 1 dòng/IP/phút, không phải 1 dòng/lượt quét.
    Mỗi lượt gọi xoá kèm cửa sổ cũ > 1 giờ (dọn tại chỗ, không cần cron). Dùng chung được cho việc vá
    `/storage`, `/product-label` sau này.
- Helper `src/lib/equipment-qr.ts`: dựng URL từ `NEXT_PUBLIC_APP_URL` (domain chính thức, xem câu hỏi mở).
- Helper `src/lib/public-rate-limit.ts`: IP lấy `x-real-ip` → phần tử đầu `x-forwarded-for` (Vercel), băm
  SHA-256 + khoá bí mật trước khi lưu; giới hạn vừa phải (~60 lượt/phút/IP) — token 128 bit nên dò mã
  bất khả thi, đây chỉ chống spam. Vượt ⇒ 429.
- `GET /api/equipment/public/[token]` (service role, whitelist ĐÃ CHỐT: tên, mã, loại, bộ phận, ngày bảo
  trì gần nhất (chỉ biên bản `da_duyet`) + loại SC/BD — KHÔNG trạng thái, KHÔNG biển số; 404 trung tính cho
  token sai/đã thu hồi; lỗi chỉ trả câu chung). Thiết bị `inactive` vẫn mở bình thường.
- `GET /api/equipment/[token]/history` (`requireAuthUser` + `maintenance.view` + cùng nhà máy): biên bản
  `da_duyet` + `cho_duyet` (badge "Chờ duyệt" qua `StatusBadge domain="maintenance"`), bỏ `huy`, phân trang;
  trả thêm cờ `inactive` ⇒ nhãn "Ngừng dùng" chỉ cho người đã đăng nhập. Chi phí chỉ trả khi admin / `maintenance.approve`.
- Trang `src/app/tb/[token]/page.tsx` (+ `loading.tsx`, metadata noindex, header no-store, `Referrer-Policy: no-referrer`).
  Nút "Đăng nhập để xem lịch sử" → `/login?next=/tb/<token>` (`/login` đã hỗ trợ `next` nội bộ) ⇒ đăng nhập xong quay đúng trang.
  Kiểm tra `dashboard/layout`/`/login` không chặn đường `/tb`.
- Settings → Bảo trì → Thiết bị: nút "Xem QR / Tải PNG" từng dòng (tạo token nếu thiết bị chưa có).
- Nghiệm thu: chưa đăng nhập chỉ thấy whitelist (kiểm payload); đăng nhập → quay về đúng `/tb/<token>`,
  thấy cả biên bản chờ duyệt; người không có `maintenance.approve` không nhận trường chi phí; token sai = token
  thu hồi = 404 giống hệt; >60 lượt/phút → 429; bảng đếm không phình (1 dòng/IP/phút, dòng cũ bị xoá).

### GĐ2 — Lọc vật tư thay thế + phân quyền
- Khoá gom: `inventory_item_id`, nếu không có thì tên chuẩn hoá (NFD bỏ dấu, thường, gộp khoảng trắng,
  bỏ ký tự thừa) ⇒ "Dao băm" = "dao bằm". Hiện các tên gốc khác nhau trong cùng nhóm để người dùng nhận ra.
  Gộp thủ công (bảng bí danh `maintenance_material_aliases`) để GĐ3 nếu chuẩn hoá chưa đủ.
- `GET /api/equipment/[token]/materials`: gom `maintenance_materials` theo khoá trên → số lần thay, tổng SL, lần gần nhất, khoảng cách TB; lọc tên/mã, từ–đến ngày, Sửa chữa/Bảo dưỡng, số lần ≥ N.
- ĐÃ CHỐT: đơn giá/thành tiền/chi phí chỉ trả khi admin hoặc `maintenance.approve` (lọc ở server, cả history lẫn materials).
- Tab "Vật tư" + tab "Lịch sử" trên trang; nút "Tạo biên bản cho thiết bị này" (`maintenance.create`, điền sẵn bộ phận/thiết bị).

### GĐ3 — Tối ưu
- In QR hàng loạt (lưới nhãn A4, mã chữ dưới QR, tên ngắn) từ Settings + trang Lý lịch.
- "Tạo lại QR" (admin / `settings.maintenance_config`), Quét QR thiết bị ở ô tìm trang Lý lịch & Biên bản.
- Trang thống kê: MTBF ước lượng (khoảng cách TB giữa biên bản Sửa chữa), top vật tư; "where-used".
- PWA cache trang vừa quét (dùng lại SW màn quét Thành phẩm nếu hợp).

### GĐ4 — Mở rộng
- Chốt "BOM thực tế" thành danh sách phụ tùng chính thức; lịch bảo trì định kỳ + nhắc; cảnh báo vật tư hay thay sắp hết tồn.
- Nút "Báo hỏng" công khai → phiếu yêu cầu chờ duyệt: bắt buộc CAPTCHA + rate limit riêng (chặt hơn trang xem) vì là cửa spam.
- Mở rộng QR sang xe Đội xe (cột `dispatch_vehicle_id` đã có sẵn trong bảng ánh xạ).

### Ngoài phạm vi — mở việc riêng
- Vá `/storage` (`?code=` dễ đoán) và `/product-label`: rate limit (dùng lại `public-rate-limit.ts`), noindex, lỗi chung.

## Wireframe (mobile, duyệt trước khi code)
```
Công khai                         Đã đăng nhập (thêm)
┌──────────────────────────┐      ┌──────────────────────────┐
│ [banner Bảo trì]         │      │ ...phần công khai...     │
│ MÁY BĂM THÔ  MT-05       │      │ [Lịch sử | Vật tư]       │
│ Mủ tạp · Máy móc         │      │ chip: Tất cả·SC·BD·90ng  │
│                          │      │ ┌ 12/10 Sửa chữa ✓     ┐ │
│ Bảo trì gần nhất:        │      │ │ Thay dao băm  · Tài  │ │
│ 12/10/2026 (Sửa chữa)    │      │ └──────────── ▼ ──────┘ │
│                          │      │ Vật tư: Dao băm ×4 lần  │
│ [Đăng nhập để xem lịch sử]│      │   gần nhất 12/10 · TB 45n│
└──────────────────────────┘      │ ▓ [Tạo biên bản][Quét lại]│ ← thanh đáy
                                  └──────────────────────────┘
```
Desktop: `DetailSplitLayout` 70/30 (trái: Lịch sử/Vật tư, phải: StatusSummaryBar + thông tin + hành động).

## File chính dự kiến
Mới: `supabase/migrations/2026xxxx_equipment_qr_tokens.sql` (bảng ánh xạ + bảng đếm), `src/lib/equipment-qr.ts`, `src/lib/public-rate-limit.ts`,
`src/app/api/equipment/public/[token]/route.ts`, `src/app/api/equipment/[token]/{history,materials}/route.ts`,
`src/app/tb/[token]/page.tsx`, `src/app/dashboard/maintenance/_components/equipment-*.tsx`.
Sửa: `settings/page.tsx` (tab Bảo trì), `maintenance/history/page.tsx` (quét QR thiết bị), rule 14.

## Thứ tự làm sau khi duyệt
1. Duyệt wireframe trang `/tb/<token>` (mục Wireframe).
2. Chỉ làm GĐ1, dừng cho test tay; GĐ2 sau khi bạn xác nhận. Mỗi màn hình mới mô tả lại wireframe trước khi code.

## Đã chốt thêm (theo góp ý)
- GĐ1 chỉ máy móc; xe để GĐ4. Thiết bị `inactive`: mở bình thường, nhãn "Ngừng dùng" chỉ khi đã đăng nhập.
- Lịch sử cho người đã đăng nhập gồm cả biên bản chờ duyệt (gắn nhãn).

## Câu hỏi còn mở
- **Domain chính thức in lên tem** (bắt buộc chốt TRƯỚC khi in hàng loạt ở GĐ3; GĐ1 chỉ in thử vài tem):
  hiện `NEXT_PUBLIC_APP_URL` = qlsxkpt.vercel.app — QR đã in sẽ chết nếu đổi domain.
- Khổ tem in (35mm như nhãn ngăn lưu, hay khổ khác)? → cần cho GĐ3.

## Kiểm chứng
`npx tsc --noEmit` + `npx eslint <file>`; script Node gọi API thật (chưa đăng nhập / user thường / admin) so payload với whitelist; test tay trên điện thoại: quét, đăng nhập, lọc, tạo lại QR.

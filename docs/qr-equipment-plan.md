# Tra cứu thiết bị bằng QR — ĐÃ CHỌN PA2 (token QR), rate limit bảng DB

> Trạng thái (2026-11-06): GĐ1 ĐÃ CODE + migration `20261111_equipment_qr_tokens.sql` ĐÃ CHẠY trên production.
> Đã sửa lỗi production "Server Components render" (icon truyền từ server sang client). Đã thêm ảnh thumbnail
> trong biên bản xổ ra + chip người đăng nhập góc phải — CHỜ deploy + test tay lại (tem MCC-1, MCC-2).
> Domain tem chốt: qlsxkpt.vercel.app. Prompt bàn giao: mục cuối file.
> Sửa sau test lần 2 (2026-11-06, chờ test): đăng xuất từ chip (ở lại trang), icon quét QR, quyền riêng
> `maintenance.qr_lookup` (migration 20261112 CHƯA chạy). Kế hoạch GĐ2 (wireframe tab Vật tư) / GĐ3 (tem 35×35mm,
> 20 tem/A4 — đã chốt) / ô tìm nhanh Cài đặt: `C:\Users\Software\.claude\plans\prompt-b-n-giao-cho-composed-walrus.md`.

> GĐ2 tab Vật tư ĐÃ CODE + test localhost 2026-11-06; sửa sau test: ô tìm có dropdown gợi ý, quyền riêng
> `maintenance.view_cost` (migration 20261113 CHƯA chạy) — xem rule 14. Đăng nhập tại chỗ: BỎ khỏi kế hoạch
> (người dùng chốt 2026-11-06 giữ logic cũ `/login?next=`). Prompt phiên sau: cuối file.

> GĐ3 (in tem hàng loạt + Tạo lại QR) + ô tìm nhanh Cài đặt ĐÃ CODE 2026-11-06, chờ test tay — xem rule 14.
> Tem chốt bố cục A (QR 35mm + mã + tên bên dưới). Tạo lại QR xác nhận bằng ô tick "Tôi hiểu tem cũ sẽ ngừng hoạt động" (2026-11-07, bỏ gõ lại mã; không có cột lý do).
> Còn của GĐ3: Quét QR thiết bị ở ô tìm trang Lý lịch & Biên bản; in tem từ trang Lý lịch; thống kê MTBF; PWA.

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
  → ĐÃ CHỐT 2026-11-07, xem mục "GĐ3b — Thống kê chu kỳ + sản lượng" cuối file.
- PWA cache trang vừa quét (dùng lại SW màn quét Thành phẩm nếu hợp).
  → ĐÃ CHỐT 2026-11-07: CHỈ phần công khai + thông báo mất kết nối, xem mục "GĐ3c — PWA" cuối file.

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
- ~~Khổ tem~~ ĐÃ CHỐT 2026-11-06: 35×35mm, 20 tem/A4 (như nhãn ngăn lưu).

## Kiểm chứng
`npx tsc --noEmit` + `npx eslint <file>`; script Node gọi API thật (chưa đăng nhập / user thường / admin) so payload với whitelist; test tay trên điện thoại: quét, đăng nhập, lọc, tạo lại QR.

## Prompt bàn giao cho phiên sau (2026-11-06)

```
Tiếp tục module "Tra cứu thiết bị bằng QR" (Bảo trì). Đọc trước, theo thứ tự:
1. CLAUDE.md, .claude/rules/29-ui-standard.md, .claude/rules/14-maintenance-module.md (mục cuối
   "Tra cứu thiết bị bằng QR — GĐ1" + "Cải tiến sau test"), docs/qr-equipment-plan.md (toàn bộ).
2. Code GĐ1 đã có (đọc lại file thật trước khi sửa, không tin mô tả):
   - supabase/migrations/20261111_equipment_qr_tokens.sql (ĐÃ CHẠY production): equipment_qr_tokens
     (token base64url 22 ký tự, asset_id | dispatch_vehicle_id, revoked_at), public_rate_limits +
     RPC public_rate_limit_hit. RLS bật, không policy ⇒ chỉ service role.
   - src/lib/equipment-qr.ts (thuần: type, buildEquipmentQrUrl → https://qlsxkpt.vercel.app/tb/<token>,
     parseEquipmentQrToken), src/lib/equipment-lookup.ts (service role: resolveEquipmentToken,
     loadPublicEquipment, loadEquipmentHistory, loadEquipmentViewer, getOrCreateAssetToken),
     src/lib/public-rate-limit.ts (60/phút/IP băm, lỗi DB ⇒ cho qua).
   - src/app/tb/[token]/page.tsx (Server Component, noindex, no-referrer; thẻ công khai truyền làm
     children vào EquipmentHistoryPanel), not-found.tsx, loading.tsx.
   - src/app/api/equipment/[token]/history/route.ts (maintenance.view + cùng nhà máy; giá chỉ admin /
     maintenance.approve; trả viewer), src/app/api/equipment/qr-token/route.ts (lấy/tạo token).
   - src/app/dashboard/maintenance/_components/equipment-history-panel.tsx (client: chip người dùng góc
     phải, banner, lịch sử thẻ xổ, thumbnail ảnh + ImageLightbox, lọc Sửa chữa/Bảo dưỡng, Xem thêm 20,
     thanh đáy Quét QR khác/Lý lịch), equipment-qr-modal.tsx (nút QR ở Cài đặt → Bảo trì → Thiết bị).

Quyết định đã chốt (KHÔNG tự đổi): trang công khai CHỈ tên, mã, loại, bộ phận, ngày bảo trì gần nhất
(biên bản da_duyet) — không trạng thái, không biển số; token sai = thu hồi = cùng màn 404; giá/chi phí lọc
ở SERVER; lịch sử đăng nhập gồm da_duyet + cho_duyet; GĐ1 chỉ máy móc (xe = GĐ4); domain tem
qlsxkpt.vercel.app; login quay về bằng /login?next=/tb/<token>.

Landmine đã gặp: page.tsx là Server Component — KHÔNG truyền hàm/component (icon, onClick) làm prop cho
client component (PageHeaderBanner...) ⇒ production lỗi "An error occurred in the Server Components
render" (dev không báo). Bọc trong client component.

Việc 1 — xác nhận test tay GĐ1 + cải tiến (hỏi người dùng kết quả trước): quét tem MCC-1/MCC-2 khi chưa
đăng nhập (chỉ 5 thông tin; MCC-1 gần nhất 24/10/2026, MCC-2 02/11/2026), đăng nhập → quay về đúng trang,
chip góc phải đúng họ tên/@username/chức vụ, thumbnail ảnh bấm phóng to, tài khoản không có
maintenance.approve không thấy giá, sửa 1 ký tự token → 404.

Việc 2 — GĐ2 lọc vật tư thay thế (theo docs/qr-equipment-plan.md mục GĐ2). Mô tả wireframe tab "Vật tư"
cho người dùng duyệt TRƯỚC khi code. Nội dung: GET /api/equipment/[token]/materials gom
maintenance_materials của các dòng thiết bị (biên bản da_duyet + cho_duyet) theo inventory_item_id, không
có thì tên chuẩn hoá (NFD bỏ dấu, thường, gộp khoảng trắng); trả số lần thay, tổng SL, lần gần nhất,
khoảng cách TB giữa các lần, các tên gốc trong nhóm; lọc tên/mã, từ–đến ngày, Sửa chữa/Bảo dưỡng, số lần ≥ N;
giá chỉ admin/maintenance.approve. Trang /tb: SegmentedTabs [Lịch sử | Vật tư], sắp vật tư theo số lần
thay giảm dần. Nút "Tạo biên bản cho thiết bị này" (maintenance.create) — kiểm records/new có nhận tham số
điền sẵn không trước khi hứa. Phân trang mọi query bảng lớn (.range), chia .in() theo lô 200.

Việc 3 (nếu còn thời gian, hỏi trước): GĐ3 in QR hàng loạt (lưới nhãn A4, mã dưới QR — tham khảo
downloadStorageBulkQrPdf trong src/lib/storage-pdf.ts; HỎI khổ tem), "Tạo lại QR" (thu hồi token).

Kiểm tra: npx tsc --noEmit + npx eslint <file> (KHÔNG npm run build). Kiểm chứng dữ liệu bằng script Node
gọi code thật: node --env-file=.env.local --experimental-strip-types --import <hook map @/ → src/>
(cwd = gốc repo). Không cat/sed .env.local. Hỏi trước khi commit/push. Cuối phiên: cập nhật rule 14 +
docs/qr-equipment-plan.md, hướng dẫn test tay, prompt bàn giao mới.
```

## Prompt bàn giao phiên sau (2026-11-06, sau GĐ2)

```
Tiếp tục module "Tra cứu thiết bị bằng QR" (Bảo trì). Đọc trước: CLAUDE.md, .claude/rules/29-ui-standard.md,
.claude/rules/14-maintenance-module.md (các mục "Tra cứu thiết bị bằng QR" GĐ1 + GĐ2), docs/qr-equipment-plan.md.
Đọc lại file thật trước khi sửa, không tin mô tả.

Trạng thái: GĐ1 + GĐ2 (tab Vật tư, nút Tạo biên bản, quyền maintenance.view_cost) đã code, test localhost.
Migration 20261112 (qr_lookup) đã chạy localhost — xác nhận production; 20261113 (view_cost) CHƯA chạy —
chạy TRƯỚC deploy (code mới kiểm view_cost, thiếu ⇒ không ai thấy giá trừ admin).
Đã chốt (KHÔNG đổi): đăng nhập tại chỗ ĐÃ BỎ (giữ /login?next=/tb/<token>); đăng xuất ở lại trang; quyền
qr_lookup + view_cost cấp sẵn theo maintenance.view / maintenance.approve; tem 35×35mm, 20 tem/A4; trang công khai
chỉ 5 thông tin; token sai = thu hồi = 404 giống nhau; domain tem qlsxkpt.vercel.app; GĐ1-3 chỉ máy móc.

Việc 1 — Ô tìm nhanh trong Cài đặt: component dùng chung src/app/dashboard/settings/_components/list-search.tsx
(ô tìm + nút xoá, lọc client bỏ dấu — dùng lại normalizeMaterialName của src/lib/equipment-qr.ts hoặc tách ra
helper chung). Rà settings/page.tsx + settings/_components/* liệt kê đủ 11 danh sách CHƯA có ô tìm (mô tả danh
sách cho người dùng duyệt trước khi sửa), mỗi danh sách có số "N/M" kết quả. Không đổi query/quyền.

Việc 2 — GĐ3: (a) In tem QR hàng loạt từ Cài đặt → Bảo trì → Thiết bị (chọn nhiều/chọn theo bộ phận): PDF A4
20 tem 35×35mm, mã thiết bị dưới QR, tên ngắn — tham khảo downloadStorageBulkQrPdf (src/lib/storage-pdf.ts) +
pdf-qr-shared.ts; token lấy/tạo hàng loạt ở server (getOrCreateAssetToken, chia lô 200). (b) "Tạo lại QR"
(admin / settings.maintenance_config): thu hồi token cũ (revoked_at) + tạo mới, hộp xác nhận nói rõ tem cũ sẽ
chết. Mô tả wireframe trước khi code.

Kiểm tra: npx tsc --noEmit + npx eslint <file> (KHÔNG npm run build). Script kiểm chứng: node --env-file=.env.local
--experimental-strip-types --import <file đăng ký scripts/_ts-resolve-hook.mjs qua module.register> (cwd = gốc repo).
Không cat/sed .env.local. Hỏi trước khi commit. Cuối phiên: cập nhật rule 14 + file này, hướng dẫn test tay.
```

## Prompt bàn giao phiên sau (2026-11-06, sau GĐ3 phần in tem)

```
Tiếp tục module "Tra cứu thiết bị bằng QR" (Bảo trì). Đọc trước: CLAUDE.md, .claude/rules/29-ui-standard.md,
.claude/rules/14-maintenance-module.md (các mục "Tra cứu thiết bị bằng QR" GĐ1/GĐ2/GĐ3 + "Ô tìm nhanh trong Cài
đặt"), docs/qr-equipment-plan.md. Đọc lại file thật trước khi sửa.

Trạng thái: GĐ1 + GĐ2 + GĐ3 (in tem hàng loạt, Tạo lại QR) + ô tìm nhanh 12 danh sách Cài đặt đã code, chờ test tay.
Hỏi người dùng kết quả test trước. Migration 20261112/20261113 phải chạy production TRƯỚC deploy.
Đã chốt (KHÔNG đổi): như các prompt trên + tem bố cục A (QR 35mm, mã + tên bên dưới, 20 tem/A4); Tạo lại QR xác
nhận bằng gõ lại mã thiết bị (không lưu lý do, không migration).

Việc tiếp (mô tả wireframe trước khi code): Quét QR thiết bị (/tb/<token>) ở ô tìm trang Lý lịch & danh sách Biên
bản ⇒ lọc đúng thiết bị (cần API tra token → asset_id, quyền maintenance.view); in tem từ trang Lý lịch (dùng lại
buildEquipmentQrLabelsPdf + /api/equipment/qr-token/bulk). Thống kê MTBF / PWA để sau, hỏi trước.

Kiểm tra: npx tsc --noEmit + npx eslint <file>. Script kiểm chứng: xem bản trước (cần shim jspdf default export khi
chạy Node, chặn fetch /fonts/ đọc public/fonts). Không cat/sed .env.local. Hỏi trước khi commit.
```

## Prompt bàn giao phiên sau (2026-11-07, sau GĐ3 quét tem + in tem Lý lịch)

```
Tiếp tục module "Tra cứu thiết bị bằng QR" (Bảo trì). Đọc trước: CLAUDE.md, .claude/rules/29-ui-standard.md,
.claude/rules/14-maintenance-module.md (các mục "Tra cứu thiết bị bằng QR" GĐ1/GĐ2/GĐ3), docs/qr-equipment-plan.md.
Đọc lại file thật trước khi sửa.

Trạng thái: GĐ1-3 (in tem hàng loạt, Tạo lại QR xác nhận bằng ô tick, quét tem ở ô tìm Lý lịch + Biên bản, in tem
từ Lý lịch, API /api/equipment/resolve) đã code — hỏi người dùng kết quả test tay trước.

Việc tiếp: (a) Thống kê MTBF — đề xuất tab "Thống kê" thứ 3 trên /tb/<token>: MTBF = TB số ngày giữa các biên bản
Sửa chữa ĐÃ DUYỆT liên tiếp (nhiều BB cùng ngày = 1 lần, <3 lần ⇒ "chưa đủ dữ liệu"), số lần SC trong kỳ, lần gần
nhất, biểu đồ cột khoảng cách, dự kiến lần hỏng tiếp (tham khảo), top 5 vật tư, chi phí chỉ khi maintenance.view_cost;
kỳ 6 tháng/12 tháng/tất cả. HỎI chốt vị trí (tab /tb hay trang Lý lịch hay cả hai) trước khi code. (b) PWA /tb khi
mất mạng — dùng lại public/service-worker.js (đang chỉ phạm vi /dashboard/product/confirm); HỎI có cache dữ liệu
đăng nhập (giá) không — đề xuất chỉ phần công khai; giữ tối đa 30 thiết bị, xoá khi đăng xuất.

Kiểm tra: npx tsc --noEmit + npx eslint <file> (KHÔNG npm run build). Không cat/sed .env.local. Hỏi trước khi commit.
Cuối phiên: cập nhật rule 14 + file này, hướng dẫn test tay, prompt bàn giao mới.
```

## GĐ3b — Thống kê chu kỳ sửa chữa + sản lượng giữa 2 lần sửa (ĐÃ CODE 2026-11-07, chờ chạy migration 20261114 + test tay)

### Người dùng đã chốt
- Vị trí: **cả 2 nơi** — tab "Thống kê" thứ 3 trên `/tb/<token>` (sau Lịch sử | Vật tư) + khối thống kê trên trang
  Lý lịch (`maintenance/history`).
- Ngoài MTBF: với các lần **sửa chữa lớn**, mỗi chu kỳ (giữa 2 lần liên tiếp) hiện thêm "sản lượng" theo bộ phận:

| Bộ phận / loại | Hiện thêm | Nguồn |
|---|---|---|
| Mủ tạp (`maintenance_assets.bo_phan`) | Tấn thành phẩm Mủ tạp | `lot_transactions.so_kg` (ngày `ngay_nhap`) ⋈ `lots.day_chuyen='Mủ tạp'` |
| Mủ nước | Tấn thành phẩm Mủ nước | như trên, `day_chuyen='Mủ nước'` |
| Xe nâng (`dispatch_vehicles.vehicle_type='Nâng sản xuất'`) | Số giờ — CHỈ khi 2 biên bản đầu/cuối chu kỳ đều ghi `km_dong_ho` | `maintenance_record_lines.km_dong_ho` (hiệu 2 lần) |
| Xe xúc (`'Xúc sản xuất'`) | Số giờ (như xe nâng) + tấn nguyên liệu nhập trong kỳ | giờ như trên; nguyên liệu = Điều xe (`dispatch_entries.rows`) |
| Xe vận chuyển (Isuzu/Cozon vận chuyển, Cozon nội bộ, Tải 20 tấn, Cozon) | Tấn xe đó chở | `dispatch_entries.rows` lọc `so_xe = vehicle.code` |
| Biomass, Nước thải, Văn phòng, Khác | Không hiện thêm (chỉ MTBF) | — |

### Kiểm chứng dữ liệu thật (script chỉ đọc, phuochoa_kt, 2026-11-07)
- MCC-2 thay Dao băm 06/10/2026 (lớn) → 19/10/2026 (lớn): `SUM(lot_transactions.so_kg)` Mủ tạp 06/10–19/10
  **TÍNH CẢ 2 ĐẦU** = **566.895 kg** — đúng con số người dùng đưa (07/10–18/10 chỉ ra 449.960 kg). ⇒ quy ước kỳ =
  [ngày sửa trước, ngày sửa sau], cả 2 đầu.
- `lots.day_chuyen` không có dòng NULL ⇒ tách Mủ tạp / Mủ nước tin được.
- Thiết bị (`maintenance_assets`): Mủ tạp 56 · Mủ nước 4 · Nước thải 39 · Biomass 10 · Văn phòng 1. KHÔNG có xe nâng /
  xe vận chuyển trong bảng này — toàn bộ xe ở `dispatch_vehicles` (N01, N02 nâng; X01, X02 xúc SX; X03 xúc Biomass;
  ~35 xe vận chuyển). "X03 Xe xúc 03" có ở CẢ 2 bảng (Biomass / Xúc Biomass).
- `km_dong_ho`: chỉ **23/2.241** dòng biên bản có số (toàn bộ ở dòng xe, 0 dòng máy móc) ⇒ giờ máy gần như sẽ trống.
- Biên bản Sửa chữa lớn đã duyệt: **42 dòng** toàn nhà máy. MCC-2 bắt đầu có "lớn" từ 07/2026 (Dao băm trước đó là
  "nhỏ"/NULL vì Lớn/Nhỏ tự tính theo ngưỡng chi phí — rule 14 A6).

### Định nghĩa — ĐÃ CHỐT 2026-11-07 (thay bản đề xuất cũ)
- **Chu kỳ** = giữa 2 lần **Sửa chữa** liên tiếp của cùng thiết bị, **bất kể Lớn/Nhỏ, bất kể đã duyệt hay chưa**
  (`cho_duyet` + `da_duyet`; đề xuất loại `huy`/`tu_choi` — xem câu chốt thêm). Nhiều biên bản cùng ngày = 1 lần.
- **MTBF** = TB số ngày các chu kỳ trên; < 3 lần ⇒ "chưa đủ dữ liệu". Kỳ lọc 6 tháng / 12 tháng / tất cả.
- **Sản lượng mỗi chu kỳ** = [ngày sửa trước, ngày sửa sau] **TÍNH CẢ 2 ĐẦU** (thống kê tương đối — người dùng chốt);
  ghi chú dưới bảng, không hiện dòng tổng các chu kỳ.
- Chu kỳ đang mở (lần gần nhất → hôm nay) hiện riêng "Đang chạy: N ngày, X tấn", không tính vào TB.
- Xe vận chuyển: tấn **tươi** (tổng 5 loại KL tươi trên Điều xe của xe đó).
- Xe xúc (X01, X02 "Xúc sản xuất"): nguyên liệu = **tổng KL tươi** mủ tạp nhập về toàn nhà máy (chén + đông chén +
  đông khối + dây) theo Điều xe.
- X03 "Xúc Biomass": theo **Biomass** ⇒ không hiện thêm gì.
- Ford bán tải, Thuê ngoài, Thu mua (TM1, TM6) ⇒ không hiện thêm gì.
- Hệ quả: R3 (Lớn/Nhỏ) và R4 (chờ duyệt) không còn ảnh hưởng chu kỳ; biên bản chờ duyệt hiện badge "Chờ duyệt" trong
  bảng chu kỳ.

### Biểu đồ (cải tiến)
- Cột = số ngày mỗi chu kỳ (sửa chữa lớn màu đậm, sửa thường màu nhạt), đường nét đứt = MTBF; trục phải (đường) = tấn
  thành phẩm / tấn chở của chu kỳ. Chạm cột ⇒ tooltip ngày đầu–cuối, số ngày, tấn, tấn/ngày, vật tư thay.
- Bảng dưới: Từ · Đến · Số ngày · Tấn · Tấn/ngày · Giờ (nếu có) · Vật tư thay · link biên bản.
- Tóm tắt: MTBF, số lần SC trong kỳ, TB tấn/chu kỳ lớn, chu kỳ đang chạy, dự kiến lần sau (tham khảo).
- Chi phí chu kỳ chỉ khi `maintenance.view_cost`.

### Kỹ thuật
- Module thuần `src/lib/equipment-stats.ts` (gộp ngày, tách chu kỳ, MTBF) — dùng chung /tb và Lý lịch.
- Sản lượng theo ngày bằng **RPC SQL mới** (migration chạy tay), gọi 1 lần cho cả khoảng rồi cộng dồn ở JS — không kéo
  hàng nghìn dòng `lot_transactions` về điện thoại:
  - `equipment_daily_product_output(p_factory, p_from, p_to)` → `(ngay, day_chuyen, so_kg)`; gồm lô mồ côi (không giao
    dịch) theo `ngay_ht || ngay_sx` như F12.
  - `equipment_daily_dispatch_output(p_factory, p_from, p_to, p_so_xe NULL)` → `(ngay, so_xe, KL tươi/khô theo loại)`;
    chuẩn hoá `dispatch_entries.ngay` cả `dd/mm/yyyy` lẫn ISO (rule 19), đọc JSONB `rows` (nguồn thật), mã xe chuẩn hoá
    như `parseVehicleCode`.
- API `GET /api/equipment/[token]/stats` (`maintenance.qr_lookup`, cùng nhà máy) + route cho Lý lịch theo
  asset/vehicle (`maintenance.view`). Giá lọc ở server.
- Lý lịch: chọn 1 thiết bị/xe ⇒ khối đầy đủ; chọn nhiều ⇒ bảng tóm tắt (MTBF, số lần lớn, tấn TB/chu kỳ).
- /tb hiện chỉ máy móc ⇒ xe (nâng/xúc/vận chuyển) trên /tb chỉ có sau GĐ4 (QR cho xe); trên Lý lịch làm được ngay.

### Đánh giá rủi ro
| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | Tấn thành phẩm là sản lượng **cả dây chuyền**, không riêng máy — MCC-1, MCC-2… cùng hiện 1 số; máy dừng giữa kỳ vẫn "được tính" | Cao (dễ đánh giá sai) | Nhãn "Thành phẩm Mủ tạp toàn nhà máy trong kỳ"; chưa có giờ chạy máy nên không tách được |
| R2 | Ngày sửa thuộc CẢ 2 chu kỳ liền kề (quy ước cả 2 đầu theo ví dụ) ⇒ cộng các chu kỳ > tổng thực | TB | Ghi chú dưới bảng; không hiện "tổng các chu kỳ" |
| R3 | Lớn/Nhỏ tự tính theo ngưỡng chi phí ⇒ thay dao trước 07/2026 là "nhỏ"/NULL; đổi ngưỡng làm loại đổi theo thời gian | Cao | Chế độ "theo vật tư" (❓); hiện "dữ liệu sửa chữa lớn có từ ngày …" |
| R4 | Biên bản còn `cho_duyet` / nhập trễ (MCC-2 21/09 có 1 BB lớn chưa duyệt; nhiều BB 2024 chưa duyệt) ⇒ chu kỳ gộp dài sai | TB | Chỉ tính đã duyệt; cảnh báo "có N biên bản chờ duyệt trong kỳ" |
| R5 | Giờ máy gần như không có (23 dòng); đồng hồ nhập sai/thay ⇒ hiệu âm | TB | Chỉ hiện khi CẢ 2 đầu có số và hiệu > 0; có thể cân nhắc bắt buộc nhập Km/giờ cho Đội xe (hỏi sau) |
| R6 | Điều xe: KL ghi ngược từ Sản lượng; chuyến chưa có sản lượng = 0 ⇒ tấn chở ngày gần nhất thấp | TB | Ghi chú "theo Điều xe đã có sản lượng" |
| R7 | `so_xe` trên Điều xe là snapshot, có thể lệch mã `dispatch_vehicles` | Thấp–TB | Chuẩn hoá mã + script đối chiếu trước khi bật |
| R8 | Hiệu năng điện thoại + giới hạn 1000 dòng PostgREST | TB | RPC GROUP BY theo ngày |
| R9 | Lộ số liệu sản xuất qua tem QR ngoài hiện trường | Cao nếu làm sai | Chỉ trong API đã đăng nhập + `maintenance.qr_lookup`; trang công khai không thêm gì; PWA không cache |
| R10 | Thiết bị đổi bộ phận theo thời gian (`bo_phan` là giá trị hiện tại) | Thấp | Dùng bộ phận hiện tại, ghi rõ |

Chốt thêm 2026-11-07: bỏ biên bản huỷ/từ chối; Bảo dưỡng chỉ thống kê thời gian; có lọc "theo vật tư"; xem số tấn bằng
quyền `maintenance.qr_lookup`; giờ máy chỉ khi cả 2 đầu có số. Lý lịch: chỉ khi chọn đúng 1 thiết bị/xe (bảng tóm tắt
nhiều thiết bị chưa làm).

### Thứ tự làm
1. ~~Người dùng trả lời 4 câu ❓~~ — đã chốt 2026-11-07 (mục Định nghĩa).
2. Migration 2 RPC (chạy tay) + script đối chiếu: MCC-2 06/10–19/10 phải ra 566.895 kg; 1 xe vận chuyển khớp tab
   Thống kê Điều xe cùng kỳ.
3. `equipment-stats.ts` + kiểm bằng code thật (gộp cùng ngày, < 3 lần, chu kỳ đang mở, cả 2 đầu).
4. API + tab Thống kê trên /tb (máy móc). 5. Khối thống kê trên Lý lịch (máy móc + xe). 6. Cập nhật rule 14 + file này.

## GĐ3c — PWA trang /tb khi mất mạng (ĐÃ CODE 2026-11-07, chờ test trên bản Vercel)

### Người dùng đã chốt
Offline CHỈ hiện phần công khai (tên, mã, loại, bộ phận, ngày bảo trì gần nhất) + thông báo "Không có kết nối". Không
cache lịch sử / vật tư / thống kê / giá.

### Thiết kế
- Mở rộng `public/service-worker.js` thêm nhánh navigation `/tb/*`: network-first (~5s), lưu HTML vào cache riêng
  `tb-public-v1`, tối đa 30 trang gần nhất. Không cache `/api/*`, `_rsc`.
- Offline: panel đăng nhập không gọi API, thanh vàng "Không có kết nối — đang hiển thị thông tin công khai lưu lúc …".
  Thiết bị chưa từng mở lúc có mạng ⇒ trang tĩnh "Chưa có dữ liệu ngoại tuyến cho thiết bị này".
- Lưu kèm `/_next/static/*` của /tb bằng postMessage cho SW (bài học GĐ-B màn quét, rule 06 mục 4.21).

### Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| P1 | SW dùng chung với màn quét Thành phẩm (đang chạy thật) — sửa nhầm làm hỏng offline Thành phẩm | Nhánh `/tb` tách hàm + cache riêng; test lại màn quét TP |
| P2 | Tem đã "Tạo lại QR" nhưng máy còn bản cache ⇒ offline vẫn hiện | Chấp nhận (chỉ thông tin công khai); có mạng lại network-first trả 404 ⇒ xoá khỏi cache |
| P3 | SW chỉ chạy production; WebView Zalo/Telegram không có SW; iOS xoá dữ liệu site sau 7 ngày | Ghi rõ trong hướng dẫn |
| P4 | Trang SSR có header `no-store` | SW tự lưu bản sao, không dựa HTTP cache — kiểm khi code |

Làm SAU (hoặc song song) GĐ3b. Test trên preview Vercel: chế độ máy bay, mở tem đã quét / chưa quét / màn quét TP.

## Kết quả test GĐ3b (2026-11-07) + việc sửa phiên sau
Migration `20261114_equipment_stats_rpc.sql` ĐÃ CHẠY. Test 3, 4, 5 PASS (xe vận chuyển khớp Điều xe; X01/N01/X03; Nước thải).

### Lỗi 1 — Thống kê chu kỳ ở Lý lịch KHÔNG theo ô Từ ngày–Đến ngày (lỗi logic, xác nhận)
- Hiện tượng: Lý lịch chọn MCC-2, Từ 06/10/2026 – Đến 19/10/2026, mở "Thống kê chu kỳ" + lọc Dao băm ⇒ thẻ số liệu và
  bảng vẫn tính theo nút kỳ của riêng tab (6 tháng / 12 tháng / Tất cả): 31 lần, 30 chu kỳ, TB 26,2 ngày, TB 357,319 tấn.
  Banner trang ghi "2 lần bảo trì" (đúng khoảng ngày) ⇒ 2 nơi lệch nhau.
- Nguyên nhân: `EquipmentStatsView` chỉ có state `period` nội bộ; trang Lý lịch không truyền `filterFrom/filterTo`;
  `computeStats` chỉ có `since`, không có mốc cuối.
- Sửa đề xuất:
  1. `computeStats` thêm `until` (lọc `e.ngay <= until`); chu kỳ đang mở chỉ tính khi `until` trống hoặc ≥ hôm nay.
  2. `EquipmentStatsView` nhận prop tuỳ chọn `range?: { from: string | null; to: string | null }`. Có `range` (Lý lịch có
     nhập ít nhất 1 ngày) ⇒ thêm lựa chọn kỳ "Theo ngày đã chọn (dd/mm – dd/mm)" và CHỌN SẴN nó; đổi ngày ở trang ⇒ cập
     nhật theo (không gọi lại API — dữ liệu đã có đủ). Không có `range` (trang /tb) ⇒ giữ 6/12 tháng/Tất cả như cũ.
  3. Lưu ý quy ước: khoảng 06/10–19/10 gồm 2 lần thay dao ⇒ đúng 1 chu kỳ 13 ngày / 566,895 tấn.
  4. Kiểm: Lý lịch MCC-2 06/10–19/10, lọc Dao băm ⇒ 2 lần, 1 chu kỳ, TB "chưa đủ dữ liệu", bảng 1 dòng 566,895 tấn; xoá
     ngày ⇒ quay về kỳ tab.

### Lỗi 2 — Tài khoản KHÔNG có "xem giá / chi phí khi tra cứu QR thiết bị" vẫn thấy giá ở Lý lịch
- Hiện tượng (tài khoản Chau Nho): tab Lịch sử của trang Lý lịch hiện cột "Giá trị" ($244…).
- Phân tích: tab Thống kê (cả /tb lẫn Lý lịch) ĐÃ lọc giá ở server theo `maintenance.view_cost` — đúng. Cột "Giá trị" của
  Lý lịch là tính năng CŨ, chỉ cần `maintenance.view`, đọc thẳng `maintenance_record_lines.chi_phi_dk/cong_tho` bằng
  supabase client (RLS không che cột). Quyền `maintenance.view_cost` hiện chỉ được định nghĩa cho tra cứu QR.
- Giá còn hiện ở các nơi khác cùng quyền `maintenance.view`: Tổng quan (`maintenance/page.tsx` — KPI chi phí), Biên bản
  (`records/page.tsx`, `maintenance-row-cells.tsx`), chi tiết biên bản (`records/[id]`), in F01/F02/F07 (`print/page.tsx`).
- ❓ CẦN NGƯỜI DÙNG CHỐT TRƯỚC KHI CODE:
  (a) Chỉ ẩn cột "Giá trị" ở Lý lịch (+ bản in lý lịch F01/F02) khi không có `view_cost`; hay
  (b) Mở rộng `maintenance.view_cost` thành "xem giá / chi phí bảo trì" cho TOÀN module (Tổng quan, Biên bản, Lý lịch, in
      F01/F02/F07) — người lập/duyệt biên bản vẫn phải thấy chi phí khi sửa (đề xuất: người có `maintenance.create`/
      `maintenance.edit`/`maintenance.approve` được xem ở trang chi tiết biên bản dù không có view_cost).
  Đề xuất (b) nhưng đổi nhãn quyền; migration cấp sẵn `view_cost` cho ai đang có `maintenance.approve` đã làm ở 20261113.
- Ẩn ở giao diện là chưa đủ nếu muốn bảo mật thật (client vẫn đọc được cột qua supabase) — nếu cần chặn thật phải chuyển
  sang API service role / view. Hỏi người dùng mức yêu cầu.

## Prompt bàn giao phiên sau (2026-11-07, sau GĐ3b)
```
Đọc CLAUDE.md, rule 14 (mục "GĐ3b thống kê chu kỳ") và docs/qr-equipment-plan.md mục "Kết quả test GĐ3b".
Migration 20261114 đã chạy. Việc:
1) Sửa Lỗi 1: thống kê chu kỳ ở Lý lịch theo ô Từ–Đến ngày (computeStats thêm `until`; EquipmentStatsView nhận prop
   `range`, thêm kỳ "Theo ngày đã chọn" chọn sẵn khi có ngày). Kiểm bằng code thật: MCC-2 06/10–19/10 lọc Dao băm ⇒
   1 chu kỳ 13 ngày 566,895 tấn.
2) Lỗi 2 (giá hiện cho người không có maintenance.view_cost): HỎI người dùng chọn (a) chỉ Lý lịch hay (b) toàn module,
   và mức chặn (giao diện hay API). Chưa chốt thì không code.
3) Sau đó GĐ3c (PWA /tb khi mất mạng) theo mục GĐ3c — cẩn thận service worker dùng chung màn quét Thành phẩm.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build. Hỏi trước khi commit. Cuối phiên tóm tắt + hướng dẫn test.
```

### Cập nhật 2026-11-07 (cùng phiên)
- Lỗi 1 ĐÃ SỬA (thống kê theo Từ–Đến ngày; kiểm MCC-2 06/10–19/10 Dao băm = 1 chu kỳ 13 ngày 566,895 tấn).
- Lỗi 2 ĐÃ SỬA theo phương án (b) người dùng chốt — xem rule 14 mục "Quyền xem giá maintenance.view_cost cho TOÀN module".
- GĐ3c ĐÃ CODE — xem rule 14 mục "Trang tem /tb khi mất mạng".

## Trạng thái 2026-11-07 (cuối ngày) — GĐ1→GĐ3c ĐÃ LÊN PRODUCTION
- Đã commit + push lên `main` (Vercel production): GĐ3b thống kê chu kỳ, quyền xem giá `maintenance.view_cost` toàn
  module, GĐ3c trang tem `/tb` khi mất mạng, quét tem ở ô tìm Lý lịch/Biên bản, in tem từ Lý lịch. Migration 20261114 đã chạy.
- Test PASS: localhost (thống kê theo ngày, quyền xem giá, màn quét Thành phẩm không ảnh hưởng) + GĐ3c trên PC bằng
  `npm run build` + `npm run start` (SW đăng ký, offline có thanh vàng, tem chưa mở ⇒ trang tĩnh).
- Nguyên nhân lần test GĐ3c đầu thất bại: `npm run dev` cũ vẫn giữ cổng 3000 ⇒ `npm run start` không lên. Không phải lỗi code.
- CHƯA test trên điện thoại thật bằng tem giấy (qlsxkpt.vercel.app) sau khi production cập nhật.

### Hướng dẫn test GĐ3c trên PC (giữ lại để tham khảo)
1. Đóng HẾT cửa sổ terminal đang chạy dev (Ctrl+C). Kiểm cổng: `netstat -ano | findstr :3000` không còn dòng LISTENING.
2. `npm run build` — phải kết thúc không lỗi (chụp lỗi nếu có).
3. `npm run start` — phải in "Ready … http://localhost:3000".
4. Mở `http://localhost:3000/tb/<token>`: KHÔNG được thấy nút tròn "N" góc trái dưới (thấy = vẫn là dev).
5. F12 → Application → Service workers: có `service-worker.js?v=…` "activated and is running". Tải lại 1 lần, chờ 3 giây.
6. Tick Offline → F5 tem vừa mở ⇒ thanh vàng SÁT MÉP TRÊN "Không có kết nối — … lưu lúc …". Dán tem chưa mở ⇒ trang trắng
   nhỏ "chưa được mở lần nào trên máy này". Bỏ Offline ⇒ mọi tab tải lại bình thường.
7. Xong: Ctrl+C, chạy lại `npm run dev` (bản dev tự gỡ SW).
Test điện thoại: cần https ⇒ commit + push nhánh để có link preview Vercel (dùng chung dữ liệu Supabase); dán link
`https://<preview>/tb/<token>` (QR giấy trỏ qlsxkpt.vercel.app — chưa có code mới cho tới khi deploy production).

### Việc tiếp theo (chưa làm — hỏi người dùng chọn trước)
1. Test điện thoại thật trên production: quét tem giấy (có mạng) → bật chế độ máy bay → mở lại tem ⇒ bản lưu + thanh vàng.
2. Lý lịch: bảng tóm tắt thống kê khi chọn NHIỀU thiết bị/xe (MTBF, số lần sửa, TB ngày/chu kỳ, tấn TB/chu kỳ mỗi dòng;
   bấm 1 dòng ⇒ mở khối chi tiết đầy đủ như khi chọn 1). Hiện chỉ có khi chọn đúng 1.
3. GĐ4a — QR cho xe Đội xe: token theo `dispatch_vehicle_id` (cột đã có trong `equipment_qr_tokens`), backfill xe, `/tb`
   + API history/materials/stats nhận xe, nút QR + in tem hàng loạt ở Cài đặt → Bảo trì → Xe & Tài xế, quét tem xe ở Lý lịch
   (chọn đúng xe, bộ phận "Đội xe"), "Tạo biên bản" điền sẵn xe (`?vehicle_id=`).
4. GĐ4 khác (chưa chốt): BOM thực tế, lịch bảo trì định kỳ + nhắc, nút "Báo hỏng" công khai (CAPTCHA + rate limit).
5. Ngoài phạm vi: vá `/storage` + `/product-label` (rate limit, noindex).

## Trạng thái 2026-11-07 (phiên tối) — GĐ4a ĐÃ CODE, chờ test tay
- Test điện thoại thật GĐ3c: PASS (người dùng xác nhận).
- /tb: 2 tầng tab tách hình thức (menu lớn dính đầu màn + chip lọc nhỏ).
- GĐ4a QR cho xe: xem rule 14 mục "GĐ4a". Migration 20261115 (tuỳ chọn) chưa chạy.
- Sửa lỗi Cài đặt → Xe "Hiệu lực từ" luôn = hôm nay + `addDays` lệch 1 ngày. Dữ liệu thật (kiểm 2026-11-07, chỉ đọc):
  66 dòng lịch sử tài xế / 46 xe, 19 cặp hở 1 ngày, 2 dòng "đến < từ" (X03, 5B) — CHƯA sửa, chờ người dùng quyết.

## Prompt bàn giao phiên sau (2026-11-07, sau khi lên production)
```
Đọc CLAUDE.md, rule 14 (các mục "Tra cứu thiết bị bằng QR" GĐ1→GĐ3c) và docs/qr-equipment-plan.md mục
"Trạng thái 2026-11-07 (cuối ngày)" + "Việc tiếp theo". GĐ1→GĐ3c đã lên production (main), migration tới 20261114 đã chạy.
Việc:
1) Hỏi kết quả test điện thoại thật (tem giấy, offline). Có lỗi thì sửa trước.
2) Hỏi người dùng chọn làm tiếp: (a) bảng tóm tắt thống kê nhiều thiết bị ở Lý lịch, hay (b) GĐ4a QR cho xe Đội xe.
   Lên plan liệt kê file + migration (nếu có) để người dùng duyệt TRƯỚC khi code; với GĐ4a đọc kỹ equipment-lookup.ts,
   /tb/[token], API /api/equipment/*, equipment-qr-modal, Cài đặt → Xe & Tài xế, history/page.tsx.
3) Code xong: npx tsc --noEmit + npx eslint <file>, hướng dẫn test tay, hỏi trước khi commit/push.
Không npm run build khi dev server đang chạy (test SW phải tắt hẳn dev trước). Cuối phiên tóm tắt + prompt bàn giao.
```

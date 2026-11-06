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
> Tem chốt bố cục A (QR 35mm + mã + tên bên dưới). Tạo lại QR xác nhận bằng gõ lại mã (không có cột lý do).
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

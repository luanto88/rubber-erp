---
description: Business logic các module sản xuất - Điều xe, Kho nguyên liệu, Thành phẩm
---

# Business Logic: Sản xuất

## 1. Rule chung

- Mọi query phải filter theo `factory_id`.
- Mọi form CRUD phải có field `day_chuyen` đặt ở đầu form khi nghiệp vụ phụ thuộc dây chuyền.
- Các dropdown phụ thuộc phải reset khi đổi `day_chuyen`.
- Các option sản phẩm phải lấy từ matrix cấu hình nhà máy, không hard-code rải rác.

## 2. Điều xe

- `dispatch_entries` là header/chứng từ.
- `dispatch_entry_rows` là nguồn dữ liệu vật lý chính cho từng chuyến.
- Không đọc/ghi trực tiếp `dispatch_entries.rows` cho logic mới, chỉ xem như cache legacy tạm thời.
- Khi thêm/sửa/import điều xe, chi tiết phải đi qua `dispatch_entry_rows`.
- Khối lượng khô phải auto-calc từ khối lượng tươi và DRC.
- `chuyen` được auto-assign theo xe trong ngày:
  - Khi chọn `so_xe` cho một dòng: `chuyen` = số dòng khác đã có cùng `so_xe` + 1.
  - Khi nhân bản dòng hoặc xóa dòng trong form Điều xe (`src/app/dashboard/dispatch/page.tsx`): phải đánh lại `chuyen` tuần tự (1,2,3...) cho **tất cả** dòng cùng `so_xe`, theo đúng thứ tự xuất hiện trong mảng. Không được để dòng nhân bản giữ nguyên số chuyến của dòng gốc; không được để hở số chuyến khi xóa dòng ở giữa hoặc đầu danh sách cùng xe.
  - Helper dùng chung cho việc đánh số lại: `renumberChuyenForVehicle(rows, so_xe)` trong `dispatch/page.tsx`, gọi từ `cloneRow` và `removeRow`.
  - Dòng chưa chọn `so_xe` (rỗng) không bị đụng tới bởi việc đánh số lại.
- Danh mục `diem_gn` dùng `dispatch_delivery_points`, có filter `factory_id`.
- `lo_thu_hoach` của chuyến phải suy ra từ `diem_gn + phiên`.

## 3. Kho nguyên liệu (`ngans`)

### Trạng thái hợp lệ

- `Đang nhận`
- `Đóng`
- `Chờ sản xuất`
- `Đang sản xuất`
- `Đã sản xuất`

### Rule trạng thái

- Không có trạng thái `Hoàn thành` cho ngăn.
- Nếu đã có `Từ ngày` nhưng chưa có `Đến ngày` thì trạng thái là `Đang nhận`.
- Nếu đã có cả `Từ ngày` và `Đến ngày` thì trạng thái nền là `Đóng`.
- Nếu đã có cả `Từ ngày` và `Đến ngày`, đồng thời `ngày hiện tại - Từ ngày >= 21` thì tự động chuyển `Chờ sản xuất`.
- Admin được chuyển tay từ `Đóng` sang `Chờ sản xuất` khi `ngày lưu >= 6`.
- Nút đổi trạng thái ngăn nằm ở hàng icon header của card ngăn trong `src/app/dashboard/storage/page.tsx`.
- Không đặt nút đổi trạng thái trong vùng chọn ngăn của module Thành phẩm.

### Rule tạo/sửa ngăn

- Được phép tạo ngăn rỗng để giữ chỗ và cập nhật nguyên liệu sau.
- Khi nhập `Ngày bắt đầu`, hệ thống phải lọc chuyến xe ngay, không chờ `Ngày kết thúc`.
- Vẫn cho phép lưu khi chỉ có `Ngày bắt đầu`.
- Chuyển `Đóng -> Chờ sản xuất` là thao tác chỉ dành cho admin.
- Chuyển `Đã sản xuất -> Đang sản xuất` để mở lại cho nhập tiếp cũng chỉ dành cho admin.
- Nút "Sửa" ngăn ở `src/app/dashboard/storage/page.tsx`: user thường chỉ sửa được khi ngăn ở `Đang nhận`, `Đóng`, `Chờ sản xuất`. Admin được sửa ở **mọi trạng thái**, kể cả `Đang sản xuất` và `Đã sản xuất` — dùng để đồng bộ lại khối lượng nguyên liệu (thêm/bớt chuyến, đổi ngày) khi dữ liệu điều xe có sai lệch phát sinh sau khi ngăn đã vào sản xuất.

### Đồng bộ trạng thái ngăn theo sản lượng thật (2026-08-08)

- **Bug đã fix**: luồng quét QR nhập thành phẩm (`/dashboard/product/confirm`, "Lưu tạm" rồi "Gửi tất cả") ghi `lot_transactions` thật qua RPC `submit_confirm_draft_batch` nhưng chưa từng cập nhật `ngans.trang_thai` — ngăn kẹt mãi ở `Chờ sản xuất` dù tỷ lệ TP/QK hiển thị trên card đã tăng theo thời gian thực. Nguyên nhân: hàm `syncNganStatusAfterLotEdit()` (đồng bộ trạng thái theo % lấp đầy) chỉ tồn tại phía client trong `product/page.tsx`, được gọi từ luồng nhập tay (`handleCreateSave`/`handleEditSave`/`handleDelete`) — luồng quét QR hoàn toàn tách biệt, không bao giờ gọi tới.
- **Fix**: RPC mới `sync_ngan_production_status(p_ngan_id)` (`supabase/migrations/20260808_sync_ngan_production_status.sql`) — chỉ đụng 2 trạng thái "sống" (`Chờ sản xuất`/`Đang sản xuất`), không chạm `Đang nhận`/`Đóng`/`Đã sản xuất`. Quy tắc: có bất kỳ sản lượng thật nào (`SUM(lot_transactions.so_kg) > 0`) → chuyển `Đang sản xuất` ngay; về 0 (xóa hết giao dịch) → trả lại `Chờ sản xuất`.
- **Khác quy tắc luồng nhập tay có chủ đích**: quy tắc mới **kể cả khi tỷ lệ đã ≥100% ngay từ lần nhập đầu tiên** vẫn chuyển thẳng `Đang sản xuất` — không chờ xác nhận tay như luồng nhập tay (`Lưu: lưu phiếu và giữ ngăn ở luồng nhập tiếp, kể cả khi ngăn đã đạt 100% - 110%` ở trên chỉ áp dụng cho `product/page.tsx`). Việc đánh dấu `Đã sản xuất` vẫn là thao tác tay riêng (nút trên `storage/page.tsx`, ngưỡng ≥50%), không đổi. Đã chốt với người dùng — **không** sửa `syncNganStatusAfterLotEdit()` để đồng nhất 2 luồng, tránh đổi hành vi đã ổn định của luồng nhập tay ngoài phạm vi yêu cầu.
- **Wire vào 3 nơi ghi `lot_transactions` của module quét QR** (`src/app/dashboard/product/confirm/actions.ts`): `submit_confirm_draft_batch` (atomic trong transaction, vòng lặp `v_touched_ngans` mirror `v_touched_lots`/`sync_lot_master_snapshot` có sẵn), `deleteShiftHistoryEntry` và `editShiftHistoryEntry` (best-effort, gọi RPC sau khi thao tác chính thành công, không chặn kết quả nếu lỗi — `editShiftHistoryEntry` sync cả ngăn cũ lẫn ngăn mới nếu người dùng đổi ngăn nguồn). Không đụng `confirmKienProduction()` — hàm chết, không còn call site nào từ khi nút "GỬI DỮ LIỆU" đổi thành "LƯU TẠM" (xem mục "Quét theo lượt" phía dưới).
- **Migration `20260808_sync_ngan_production_status.sql` cần chạy thủ công trên Supabase SQL Editor** trước khi tính năng hoạt động — cho tới lúc đó, luồng quét QR vẫn hoạt động bình thường (ghi `lot_transactions` thành công) nhưng trạng thái ngăn tiếp tục không tự đồng bộ.
- **Backfill 1 lần cho dữ liệu cũ**: RPC mới chỉ kích hoạt khi có ghi mới đi qua — không hồi tố cho `lot_transactions` đã tồn tại TRƯỚC migration. Migration đã kèm sẵn 1 khối `DO $$ ... $$` backfill toàn bộ ngăn `Chờ sản xuất`/`Đang sản xuất` hiện có (idempotent, an toàn chạy lại) — **đã xác nhận thật trên 3 ngăn N1/N5.1/N2** (factory `phuochoa_kt`, đều có 50-94 dòng `lot_transactions` ghi trước migration, tỷ lệ 103-105%) bằng cách gọi trực tiếp RPC qua script tạm: cả 3 chuyển đúng `Chờ sản xuất → Đang sản xuất`.
- **Nút "Đồng bộ nhanh" trên card ngăn** (`storage/page.tsx`, `handleQuickSyncNgan`) giờ gọi thêm `sync_ngan_production_status` sau khi đồng bộ lại KL tươi/khô — cho admin công cụ tự tay bù lại trạng thái cho từng ngăn cụ thể mà không cần chạy script, thông báo kết quả có thêm phần "trạng thái X → Y" nếu có đổi.
- **Chưa test tay trên UI thật** — cần: quét QR nhập 1 kiện cho ngăn `Chờ sản xuất` (cả trường hợp <100% và trường hợp 1 lần gửi đã đẩy thẳng lên ≥100%) → xác nhận card ngăn chuyển `Đang sản xuất` ngay; sửa/xóa 1 dòng trong "Lịch sử ca" đổi/xóa hết sản lượng của 1 ngăn → xác nhận trạng thái đồng bộ đúng theo cả 2 chiều; bấm nút "Đồng bộ nhanh" trên 1 ngăn cũ còn kẹt sai trạng thái → xác nhận UI cập nhật ngay không cần tải lại trang; xác nhận luồng nhập tay (`/dashboard/product`) không đổi hành vi.

### Cập nhật 2026-08-30 — Fix ngăn kẹt "Chờ sản xuất" dù đã đầy thật (lô mồ côi + thiếu escape-hatch tay)

Phát sinh từ báo cáo thật: ngăn N10 đạt tỷ lệ lấp đầy 107% (`152.460 / 142.498,24 kg`) nhưng `trang_thai` vẫn kẹt `Chờ sản xuất`, và admin không thấy bất kỳ nút nào trên card để tự sửa. Có 2 bug độc lập chồng lên nhau:

- **Bug 1 (RPC)**: `sync_ngan_production_status()` (2026-08-08) tính `v_total_kg` chỉ từ `SUM(lot_transactions.so_kg)`, trong khi card ngăn ở `storage/page.tsx` tính `tpKg`/`tpPct` qua `loadStorageLots()` (`storage-detail.ts`), vốn CÓ thêm fallback cộng `lots.tong_kg` cho các lô "mồ côi" (có `ngan_id` đúng nhưng không có `lot_transactions` nào — xem mục "Invariant bắt buộc... lot_transactions backing" phía trên). Khi sản lượng thật của một ngăn đến từ (một phần) lô mồ côi, RPC thấy `v_total_kg` thấp hơn thực tế (có thể bằng 0) nên không bao giờ tự chuyển `Chờ sản xuất` → `Đang sản xuất`, dù UI hiển thị tỷ lệ lấp đầy > 100%. **Fix**: `CREATE OR REPLACE FUNCTION sync_ngan_production_status` (mới trong `supabase/migrations/20260830_sync_ngan_production_status_orphan_lots.sql`) cộng thêm `SUM(lots.tong_kg) WHERE lots.ngan_id = p_ngan_id AND NOT EXISTS (lot_transactions ứng với lô đó)` — cùng công thức với `loadStorageLots()`. Guard trạng thái, khóa `FOR UPDATE`, logic 2 chiều giữ nguyên không đổi.
- **Bug 2 (UI)**: nhánh `nextManualStatus` trên card ngăn (`storage/page.tsx`) trước đây không có case nào cho `n.trang_thai === "Chờ sản xuất"` — nên dù RPC có đúng hay không, admin cũng không có nút thủ công nào để tự đẩy ngăn `Chờ sản xuất` sang `Đang sản xuất` khi phát hiện ngăn đã có sản lượng thật. **Fix**: thêm `canForceInProduction` (`n.trang_thai === "Chờ sản xuất" && tpPct > 0`) vào cascade `nextManualStatus`, nút mới "Bắt đầu SX" (chỉ admin thấy, màu emerald — cùng theme với trạng thái đích "Đang sản xuất"), vẫn gọi chung `handleNganStatusToggle()` như 3 nút chuyển trạng thái tay còn lại.
- **Migration `20260830_sync_ngan_production_status_orphan_lots.sql` cần chạy thủ công trên Supabase SQL Editor** — bao gồm 1 vòng backfill `DO $$ ... $$` re-sync lại toàn bộ ngăn đang `Chờ sản xuất`/`Đang sản xuất` trên mọi nhà máy (idempotent, an toàn chạy lại nhiều lần) để các ngăn bị kẹt từ trước (vd N10) tự sửa ngay khi chạy migration, không cần đợi admin bấm nút "Bắt đầu SX" mới ở trên.
- **Chưa test tay**:
  - [ ] Chạy migration trên Supabase SQL Editor, xác nhận không lỗi.
  - [ ] Ngăn N10 (hoặc ngăn tương tự đang kẹt) tự chuyển sang "Đang sản xuất" sau backfill mà không cần thao tác gì thêm (kiểm tra lại UI sau khi refresh `/dashboard/storage`).
  - [ ] Xác nhận nút "Bắt đầu SX" xuất hiện đúng lúc `tpPct > 0` cho ngăn còn kẹt (nếu vì lý do nào đó backfill chưa xử lý hết) và biến mất sau khi bấm.
  - [ ] Xác nhận nút "Đồng bộ nhanh" (`handleQuickSyncNgan`) trên 1 ngăn KHÔNG có lô mồ côi vẫn hoạt động bình thường như trước (không regression).
  - [ ] Xác nhận RPC vẫn không đụng ngăn "Đang nhận"/"Đóng"/"Đã sản xuất" (gọi RPC tay qua Supabase SQL Editor trên 1 ngăn ở mỗi trạng thái đó, xác nhận `trang_thai` không đổi).
  - [ ] Xác nhận 3 chuyển trạng thái tay hiện có (Đóng→Chờ SX, Đang SX→Đã SX ở ≥50%, Đã SX→Đang SX từ tab Lịch sử) không có regression.

## 4. Thành phẩm (`lots`)

- `lots` là bảng master tổng hợp theo `ma_lo`.
- `lot_transactions` là lịch sử chi tiết theo từng ca / ngày / ngăn.
- Trong cùng `factory_id`, chỉ được 1 dòng `lots` cho mỗi `ma_lo`.
- `ma_lo` là định danh nghiệp vụ duy nhất trong cùng `factory_id`.
- `tong_banh = kien_a + kien_b + kien_c + kien_d`.
- `tong_kg = tong_banh * loai_banh`.
- `ma_lo = ${num}${suffix}/${year}`.

### Rule chọn ngăn cho Thành phẩm

- Picker ngăn ở `src/app/dashboard/product/page.tsx` hiển thị chung một danh sách.
- Các mã chuẩn `N1-N24` và mã nhập tay như `BN`, `10.2`, `MN` không tách khu riêng.
- Một phiếu thành phẩm có thể có nhiều `block`; mỗi `block` chọn `ngan_id` riêng, không còn mô hình cả phiếu chỉ có 1 ngăn.
- Khi lưu phiếu, phải ưu tiên `block.ngan_id`; không quay lại dùng `session.ngan_id` cho logic ghi transaction.
- Chỉ hiển thị ngăn có trạng thái `Chờ sản xuất` hoặc `Đang sản xuất`.
- Ngăn `Đã sản xuất`, `Đóng`, `Đang nhận` không được hiện trong form nhập thành phẩm.
- Chỉ hiển thị ngăn có nguyên liệu thực sự, tức có baseline nguyên liệu như `tong_kho > 0`.
- Ngăn rỗng tuyệt đối không được dùng để tạo thành phẩm.
- Ngăn chỉ xuất hiện lại trong form khi admin chuyển tay từ `Đã sản xuất` về `Đang sản xuất`.
- Không tự chuyển trạng thái ngăn sang `Đang sản xuất` chỉ vì người dùng vừa chọn ngăn trong form.

### Rule lưu thành phẩm và trạng thái ngăn

- Khi ngăn ở `Chờ sản xuất`, người dùng được chọn để nhập thành phẩm.
- Khi phiếu có nhiều block, save-time phải kiểm tra theo từng ngăn được chọn trong từng block, không chỉ theo tổng của cả phiếu.
- Save-time phải chặn cứng nếu bất kỳ ngăn nào sau lưu vượt `110%`.
- Sau khi lưu thành công, nếu có ngăn nào đạt trong khoảng `100% - 110%` thì UI phải hiện banner cho phép tick nhanh và đánh dấu các ngăn đó sang `Đã sản xuất`.
- Banner hậu lưu hoạt động theo danh sách ngăn đạt chuẩn của phiên vừa nhập, không được suy diễn lại từ header cũ của phiếu.
- `Lưu`: lưu phiếu và giữ ngăn ở luồng nhập tiếp, kể cả khi ngăn đã đạt `100% - 110%`.
- Từ banner hậu lưu hoặc thao tác admin tay, người dùng/admin mới chuyển ngăn sang `Đã sản xuất`.
- Save-time phải chặn cứng nếu:
  - ngăn không có nguyên liệu
  - thiếu `ngan_id` ở bất kỳ block nào
  - tỷ lệ sau lưu vượt `110%`
- **Cập nhật 2026-07-11**: Nút đánh dấu thủ công `Đã SX` trên thẻ ngăn ở `src/app/dashboard/storage/page.tsx` (chỉ admin thấy) không còn giới hạn trong khoảng `100% - 110%` — admin được chuyển tay sang `Đã sản xuất` khi ngăn đang `Đang sản xuất` và tỷ lệ lấp đầy đạt **từ 50% trở lên** (`tpPct >= 50`, không giới hạn trên). Ngưỡng `100% - 110%` của banner hậu lưu trong module Thành phẩm (dòng dưới) giữ nguyên không đổi — 2 cơ chế độc lập nhau.
- Nếu ngăn đang là `Đã sản xuất` và dữ liệu đồng bộ làm tỷ lệ xuống dưới `100%`, hệ thống tự chuyển về `Đang sản xuất`.
- Nếu ngăn đang là `Đã sản xuất` và tỷ lệ sau đồng bộ vẫn trong `100% - 110%`, giữ nguyên `Đã sản xuất`.
- Không tự trả về `Đang sản xuất` chỉ vì user bấm nhầm `Lưu & đánh dấu đã sản xuất` sớm nhưng tỷ lệ vẫn còn trong `100% - 110%`; case này admin xử lý tay.
- Sau khi nhập/sửa/xóa thành phẩm, việc đồng bộ trạng thái ngăn phải tuân theo logic của module Kho nguyên liệu, không dùng rule cũ mâu thuẫn.

### Invariant bắt buộc: mọi lô có `tong_banh > 0` phải có `lot_transactions` backing (2026-07-03)

- Mọi `lots` có `tong_banh > 0` phải có **ít nhất 1** bản ghi `lot_transactions` tương ứng (`lot_id`). Modal "Sửa lô" (`src/app/dashboard/product/page.tsx`) tìm transaction để sửa từ `lot.lot_transactions`; nếu rỗng, hiển thị lỗi "Lô này chưa có giao dịch để sửa." và không sửa được, dù `lots` vẫn có `tong_banh/trang_thai` hợp lệ.
- Nguồn gốc vi phạm invariant này **không phải bug trong luồng sống**: `saveLotTransaction()` (`product/actions.ts`) luôn ghi đồng thời `lots` + `lot_transactions` qua `syncLotMasterSnapshot()`. Vi phạm chỉ xảy ra khi có ai đó **ghi trực tiếp vào bảng `lots` ngoài luồng app** (CSV bulk-upload, thao tác tay trên Supabase Table Editor/SQL Editor...) mà không kèm ghi `lot_transactions`.
- **Case thật đã xảy ra và đã xử lý (2026-07-01 phát sinh, 2026-07-03 fix xong)**: CSV bulk-upload ghi đè 86 lô (`895cs/26`–`980cs/26`) trực tiếp vào `lots`, bỏ qua `lot_transactions`. 65/86 đã có `qc_results` thật, 21/86 đã thật sự nằm trong `export_orders.assignments` của 2 đơn xuất có thật — tức đây là dữ liệu lịch sử đúng, không phải lô rác, chỉ thiếu lớp `lot_transactions`. Đã fix bằng: (1) chạy nút "Đồng bộ trạng thái lô" cho 21 lô đã xuất hàng bị lệch `trang_thai`; (2) backfill INSERT-only (copy y nguyên `kien_a/b/c/d`, `tong_banh`, `tong_banh*loai_banh` từ chính `lots` hiện tại) cho 65 lô chưa xuất hàng còn lại — verify bằng diff trước/sau xác nhận 0 sai lệch số liệu.
- **KHÔNG bao giờ** sửa/xóa `id`, `ma_lo`, `kien_a-d`, `tong_banh` của lô đang được `export_orders`/`qc_results` tham chiếu qua `lot_id` để "fix" tình trạng thiếu `lot_transactions` — chỉ được bổ sung (insert) dữ liệu còn thiếu, không sửa đè dữ liệu đúng.
- **Consumer thứ 2 bị ảnh hưởng đã phát hiện (2026-07-03)**: `loadStorageLots()` trong `src/lib/storage-detail.ts` — nguồn dữ liệu cho khối "Thành phẩm đã dùng nguyên liệu" ở chi tiết ngăn lưu (`/dashboard/storage` modal xem chi tiết, trang public tra cứu `/storage`, PDF chi tiết ngăn) — cũng chỉ đọc từ `lot_transactions` join `lots`. Lô nào thiếu `lot_transactions` backing (21 lô "đã xuất hàng" cố ý không backfill ở lần fix 2026-07-03 trước, ví dụ `910cs/26`, `911cs/26` dùng ngăn N14 ngày 21/06/2026) sẽ **biến mất hoàn toàn** khỏi view này dù `lots.ngan_id` vẫn đúng — kéo theo cả `lotStats`/`tpPct` (% lấp đầy ngăn, điều kiện admin đánh dấu "Đã sản xuất") bị tính thiếu.
  - **Đã fix bằng fallback tại tầng đọc** (không đụng dữ liệu): `loadStorageLots()` giờ query thêm `lots` trực tiếp theo `factory_id + ngan_id`, chỉ lấy các lô **chưa** có mặt trong kết quả `lot_transactions` (so theo `lot_id`), rồi merge vào làm dòng tổng hợp 1-bản-ghi (dùng `lots.ngay_sx/ca/tong_banh/tong_kg` thay cho `lot_transactions.ngay_nhap/ca/so_banh/so_kg`). Vì `loadStorageDetail()` và `lotStats` đều gọi qua `loadStorageLots()`, fix này tự động lan ra mọi nơi hiển thị (modal, trang public, PDF, % lấp đầy ngăn).
  - Nếu phát hiện thêm nơi khác đọc trực tiếp `lot_transactions` mà không qua `loadStorageLots()`/`loadStorageLotsByNgans()`, phải áp dụng cùng fallback này, không tạo query rời rạc mới.

#### ⚠️ Nguồn gốc đã xác nhận của case 2026-07-01: Supabase Table Editor "Export as CSV" → sửa `id` tay → "Insert data from CSV"

- Đã xác nhận với người vận hành (2026-07-03): quy trình gây ra 86 lô mồ côi là thao tác tay trong **Supabase Dashboard → Table Editor**: chọn các dòng `lots` cần xử lý → **Export → Export as CSV** → sửa `id` trong file CSV cho khớp với `id` của các lô đã tồn tại/đã xuất hàng → **Insert → Insert data from CSV** để ghi lại vào bảng `lots`.
- Đây **không phải** một script trong `scripts/`, không phải tính năng import nào trong app — hoàn toàn là thao tác qua UI của Supabase, nằm ngoài mọi code guard của app. Vì vậy **không có code nào trong repo có thể chặn được thao tác này** — hướng chặn chỉ có thể là quy trình vận hành, không phải sửa code.
- **Quy tắc vận hành bắt buộc từ nay**: tuyệt đối không dùng Table Editor "Insert data from CSV" (hoặc bất kỳ hình thức ghi hàng loạt trực tiếp nào khác) để tạo hoặc sửa đè lên bảng `lots`. Nếu cần sửa dữ liệu lô hàng loạt ngoài luồng app:
  - Ưu tiên tuyệt đối: dùng UI của app (`/dashboard/product`) để tạo/sửa từng lô — `saveLotTransaction()` tự động ghi đồng thời `lots` + `lot_transactions`.
  - Nếu bắt buộc phải thao tác trực tiếp trên DB (migration dữ liệu lớn, sửa lỗi hàng loạt): phải viết **cả hai** — INSERT/UPDATE vào `lots` VÀ INSERT tương ứng vào `lot_transactions` trong cùng một bước, không được tách rời. Không dùng Table Editor CSV import cho việc này; dùng SQL Editor với transaction rõ ràng, có review payload trước khi chạy.
  - Nếu chỉ sửa `id` để "gộp" lô CSV vào lô đã tồn tại: đây là dấu hiệu cho thấy nên sửa `lot_id` trên bảng tham chiếu (`export_orders.assignments`, `qc_results.lot_id`) thay vì sửa `id` của `lots`, hoặc nên hỏi trước khi thao tác vì rất dễ phá vỡ invariant `lot_transactions` backing như đã xảy ra ở case này.

#### ⚠️ Trigger `trigger_update_lot_master` ghi `trang_thai` KHÔNG DẤU — landmine khi insert `lot_transactions` trực tiếp bằng SQL

- Migration `supabase/migrations/20260515_refactor_lots_master_detail.sql` tạo trigger `trigger_update_lot_master` trên bảng `lot_transactions`, chạy `AFTER INSERT OR UPDATE OR DELETE`, tự tính lại `lots.tong_banh`, `tong_kg` **và `trang_thai`** từ `SUM(lot_transactions)` của lô đó.
- Hàm `update_lot_master_totals()` set `trang_thai` bằng chuỗi **ASCII không dấu**: `'Hoan thanh'` / `'Do dang'` — khác hoàn toàn với chuẩn có dấu `"Hoàn thành"` mà toàn bộ app dùng để filter/hiển thị (`export/page.tsx`, `product/page.tsx`...). Trigger này không biết về trạng thái `"Xuất hàng"`.
- **Hệ quả nếu insert `lot_transactions` bằng SQL trực tiếp (backfill, migration, sửa lỗi tay) mà không xử lý trigger**: `trang_thai` của lô bị ghi đè thành ASCII không dấu → lô biến mất khỏi mọi filter dùng chuỗi có dấu; nếu lô đó đang là `"Xuất hàng"`, trigger sẽ hạ nhầm về `"Hoan thanh"` (không dấu), tái tạo đúng loại bug "lô kẹt sai trạng thái" mà nút "Đồng bộ trạng thái lô" được sinh ra để fix.
- **Cách an toàn đã dùng khi backfill 65 lô (2026-07-03)**: gói trong 1 transaction SQL Editor — `ALTER TABLE lot_transactions DISABLE TRIGGER trigger_update_lot_master;` → `INSERT` các dòng cần thiết → `ALTER TABLE lot_transactions ENABLE TRIGGER trigger_update_lot_master;` → `COMMIT;`. Vì trigger không chạy trong lúc insert, `lots` hoàn toàn không bị đụng tới — đúng insert-only, không rủi ro corrupt `trang_thai`. Đã verify bằng diff trước/sau: 0 sai lệch `tong_banh/tong_kg/trang_thai` trên cả 65 lô.
- Không có migration nào sau `20260515` DROP hoặc sửa trigger này cho tới **2026-07-08**, khi migration `supabase/migrations/20260708_fix_lot_status_trigger.sql` được tạo để sửa dứt điểm: đổi 2 literal trong `update_lot_master_totals()` sang chuẩn có dấu (`'Hoàn thành'`/`'Dở dang'`), đồng thời thêm điều kiện **không ghi đè `trang_thai`** khi lô hiện tại đã là `'Xuất hàng'` (trước đây trigger có thể hạ cấp nhầm lô đã xuất hàng nếu 1 giao dịch cũ của lô đó bị sửa/xóa sau này). Migration này **cần chạy tay** trong Supabase SQL Editor (đúng quy ước dự án) — kèm 2 câu `UPDATE` chuẩn hóa 1 lần các dòng `lots.trang_thai` đang sai hiện có.
- **Xác nhận bằng dữ liệu thật (2026-07-08)**: tại thời điểm phát hiện, có **278/1035 lô (27%)** của nhà máy `phuochoa_kt` mang giá trị ASCII không dấu (`Hoan thanh`: 277, `Do dang`: 1) — gây tách sai slice trên biểu đồ "Trạng thái lô" ở Dashboard chính (`src/app/dashboard/page.tsx`, khắc phục bằng gọi `normalizeLotStatus()` trước khi group, đồng thời phân trang lại query `lots` không giới hạn tại đây vì cùng lỗi 1000-dòng nêu ở mục dưới). Cũng phát hiện 2 nơi khác filter DB trực tiếp bằng chuỗi có dấu (`src/app/dashboard/warehouse/page.tsx`, `src/app/dashboard/_components/module-tasks.ts`, và nút "Đồng bộ trạng thái lô" trong `product/page.tsx`) có nguy cơ âm thầm bỏ sót lô mang giá trị ASCII còn sót — đã thêm `"Hoan thanh"` vào các `.in("trang_thai", [...])` này làm lưới an toàn tạm thời trong lúc chờ migration/chuẩn hóa dữ liệu.

### Cập nhật 2026-07-08 — Mất dữ liệu ngày do PostgREST cắt 1000 dòng + sai lệch ngăn khi lô trải nhiều ngăn/ngày

- **Bug đã fix**: `loadData()` trong `src/app/dashboard/product/page.tsx` query toàn bộ `lots` của nhà máy **không phân trang** (`.range()`) — khi nhà máy vượt 1000 lô (PostgREST mặc định cắt ở mốc này), các lô có `ngay_sx` **cũ nhất** bị cắt mất hoàn toàn khỏi danh sách thành phẩm chính một cách im lặng, dù vẫn hiện đúng trong chi tiết ngăn (vì `loadStorageLots()` filter theo `ngan_id` cụ thể nên luôn dưới 1000 dòng). Đã fix bằng vòng lặp phân trang `fetchAllLots()` theo đúng pattern `.claude/rules/04-code-patterns.md`. Cùng lỗi này cũng tồn tại ở query `allLots` trong `src/app/dashboard/page.tsx` (Dashboard) — đã fix tương tự.
- **Bug đã fix — `dorDangCountByNganId`** (`product/page.tsx`): trước đây đếm số lô "Dở dang" theo `lots.ngan_id` (giá trị đơn, luôn bị `syncLotMasterSnapshot()` ghi đè thành ngăn của **giao dịch mới nhất**) — nếu 1 lô dở dang trải qua 2 ngăn khác ngày (vd kiện A/B ở ngăn X ngày 1, kiện C/D ở ngăn Y ngày 2), cảnh báo "ngăn đang có lô dở dang" chỉ hiện đúng cho ngăn Y, bỏ sót ngăn X. Đã sửa để tính theo **tất cả** `lot_transactions.ngan_id` thật sự có giao dịch của lô đó, không chỉ ngăn đơn trên `lots`.
- **Lưu ý quan trọng liên quan tới lô "mồ côi"**: hiện tượng "1 lô dở dang chia 2 ngày lại tự gộp thành 1 dòng khi chuyển Xuất hàng, mất sản lượng ca sản xuất" mà người dùng từng báo cáo — trường hợp cụ thể đã điều tra (`895cs/26`) hóa ra chính là 1 trong 21 lô "mồ côi" thiếu `lot_transactions` (mục trên), KHÔNG phải do lỗi `dorDangCountByNganId`. Một lô có `lot_transactions` đầy đủ (tạo đúng qua UI) sẽ hiển thị đúng từng ngày/từng ngăn riêng biệt trong danh sách — không bao giờ tự gộp. Module Xuất hàng (`export/page.tsx`) đã xác nhận **không đụng tới `lot_transactions`** ở bất kỳ đâu (chỉ đọc/ghi `export_orders.assignments` và `UPDATE lots.trang_thai` khi reconcile) nên **không thể** tạo thêm lô mồ côi mới trong tương lai — nguồn gốc duy nhất của lô mồ côi vẫn là thao tác tay ngoài luồng app đã ghi ở mục trên.
- **21 lô mồ côi còn lại (đã "Xuất hàng", cố ý chưa backfill ở lần fix 2026-07-03)**: đã có migration `supabase/migrations/20260708_backfill_orphan_lot_transactions.sql` — khác cách tiếp cận với 65 lô trước (không liệt kê cứng từng lô), dùng 1 câu `INSERT ... SELECT` động với điều kiện **chính là định nghĩa vi phạm invariant** (`tong_banh > 0 AND NOT EXISTS lot_transactions`), nên an toàn chạy lại nhiều lần và tự áp dụng cho bất kỳ lô mồ côi nào phát sinh sau này từ cùng nguyên nhân. Vẫn tắt/bật trigger trong lúc insert như kỹ thuật cũ. Đây là backfill **xấp xỉ** — chỉ khôi phục đúng tổng số liệu, không khôi phục được lịch sử ngày/ca/ngăn chi tiết thật đã mất do CSV ghi đè.

### Rule sửa transaction thành phẩm

- Modal sửa ở `src/app/dashboard/product/page.tsx` là modal sửa theo transaction cụ thể, không phải header chung của cả phiếu.
- Trong modal sửa phải hiện rõ `ngan_id` của transaction đang sửa và cho đổi trực tiếp tại đó.
- Danh sách ngăn trong modal sửa vẫn theo rule chọn ngăn của Thành phẩm, nhưng được phép giữ lại ngăn hiện tại của transaction để tránh mất dấu dữ liệu cũ khi ngăn đó không còn nằm trong trạng thái chọn bình thường.
- `pallet` là dữ liệu nhiều giá trị; UI sửa phải dùng kiểu chọn nhiều giá trị rõ ràng, không dùng input text thô.
- `ca`, `bọc`, `pallet`, `thảm` nên là nhóm chọn nhanh dễ bấm, dễ đọc để người dùng không nhầm giữa header phiếu và dòng nhập.
- Modal sửa nên hiển thị thêm thông tin tỷ lệ dự kiến của ngăn sau lưu để cảnh báo sớm trước khi bấm lưu.

## 4.4b. Khóa ca sản xuất (2026-08-28)

### Bối cảnh

`lot_transactions` không có snapshot/khóa nào — "Ngày sản xuất" trên form quét QR
(`/dashboard/product/confirm`) hoàn toàn tự do, không validate so với ngày hệ thống. Nếu công
nhân chọn nhầm ngày, dữ liệu ghi thẳng vào ngày sai mà không ai cản, kể cả sau khi bấm "Kết thúc
ca" (hành động đó chỉ sinh PDF, không khóa gì). Tính năng này thêm 1 lớp khóa theo
`(factory_id, ngay_sx, ca)` — sau khi khóa, không ai (trừ admin) ghi/sửa/xóa được
`lot_transactions` của đúng ca đó nữa, dù ghi qua kênh nào (quét QR hay nhập tay module Thành
phẩm chính). **Không** giải quyết triệt để việc nhập sai ngày TRƯỚC khi khóa — đây là rủi ro còn
tồn tại, chỉ chặn được các thao tác SAU thời điểm duyệt.

### Schema

- `product_shift_locks` — `factory_id, ngay_sx DATE, ca TEXT, is_active BOOLEAN, locked_by,
  locked_at, unlocked_by, unlocked_at, unlock_reason`. Lưu lịch sử đầy đủ (khóa → mở khóa → khóa
  lại tạo dòng mới, không ghi đè) — partial unique index `WHERE is_active` đảm bảo chỉ 1 khóa
  active tại 1 thời điểm cho mỗi `(factory_id, ngay_sx, ca)`.
- RLS chỉ có SELECT cho `authenticated` — không có INSERT/UPDATE/DELETE nào cho client, mọi ghi
  đi qua 2 RPC `product_lock_shift`/`product_unlock_shift`.
- Permission `product.approve_shift` — cấp mặc định `admin` + `manager` (không cấp `user`).
- `product_lock_shift(p_factory_id, p_ngay_sx, p_ca)` — `SECURITY DEFINER`, gọi TRỰC TIẾP từ
  client (không qua server action) để dùng `auth.uid()` thật, tránh giả mạo actor. Check
  `current_profile_has_permission('product.approve_shift')`.
- `product_unlock_shift(p_factory_id, p_ngay_sx, p_ca, p_reason)` — cũng gọi trực tiếp từ
  client, chỉ `profiles.role = 'admin'`, bắt buộc `p_reason` non-empty, giữ lại dòng lịch sử cũ
  (`is_active=false` + `unlock_reason`), không xóa.
- Cả 2 RPC dùng `pg_advisory_xact_lock` theo hash `(factory_id, ngay_sx, ca)` để tránh race khi
  bấm khóa/mở khóa đồng thời.

### 6 điểm guard (tất cả đường ghi `lot_transactions` đã xác nhận qua code)

| # | Hàm/RPC | Cơ chế | Cách chèn |
|---|---|---|---|
| 1 | `saveLotTransaction()` — `product/actions.ts` | JS `"use server"`, service role | `assertShiftNotLocked()` đầu hàm, nhận `actorUserId` |
| 2 | `delete_lot_transaction` RPC | `SECURITY DEFINER` | Guard trong SQL, nhận thêm `p_actor_id` |
| 3 | `submit_confirm_draft_batch` RPC | `SECURITY DEFINER`, atomic | Guard trong vòng lặp draft, dùng `p_user_id` sẵn có |
| 4 | `editShiftHistoryEntry()` — `confirm/actions.ts` | JS `"use server"` | 2 lần `assertShiftNotLocked()` (ca nguồn + ca đích nếu đổi ca) |
| 5 | `deleteShiftHistoryEntry()` — `confirm/actions.ts` | Gọi lại #2 | Thread `actorUserId` xuống |
| 6 | `handleDateHeaderSave()` — `product/page.tsx` | **Ghi thẳng bằng browser client, chịu RLS thật** | Pre-check UX phía client + mở rộng RLS `lot_transactions_update`/`lots_update` |

Helper dùng chung `assertShiftNotLocked()` trong `src/app/dashboard/product/shift-lock.ts`
(`"use server"`) — vì #1/#3/#4/#5 chạy bằng service role (không có `auth.uid()`), phải thread
`actorUserId` như tham số rồi tra `profiles.role` để xác định admin. Không tin thẳng 1 boolean
từ client.

### UI

- Hành động Duyệt/Mở khóa đặt **duy nhất** ở `/dashboard/product` (module Thành phẩm chính) —
  header mỗi nhóm Ngày có 1 icon đại diện tổng trạng thái khóa của cả ngày (`ShieldCheck` màu
  emerald nếu chưa khóa gì và có quyền; `Lock` đỏ nếu khóa hết, hổ phách nếu khóa một phần; ẩn
  hẳn nếu chưa khóa gì và không có quyền). Click mở `ShiftLockModal` — liệt kê từng `ca` trong
  ngày, cho khóa/mở khóa riêng từng ca (mở khóa bắt buộc nhập lý do).
- Cụm icon header Ngày (Xem phiếu PDF/Duyệt-khóa/Thêm/Sửa/Xóa) dùng style icon-only
  (`rounded-lg p-1.5 text-{color}-600 hover:bg-{color}-50`, không nền màu, không chữ, chỉ
  `title` tooltip) — đồng bộ với style đã dùng ở Điều xe/Sản lượng. Chế độ xóa hàng loạt
  (`deleteMode === date`) vẫn giữ dạng có chữ (cần hiện số lượng đã chọn động).
- Nút "Sửa" cấp ngày disable khi ngày đó có bất kỳ ca nào đã khóa và người xem không phải admin.
- Mỗi bảng con theo `ca` có badge "🔒 Đã khóa" cạnh nhãn "Ca {ca}" nếu ca đó đang khóa; checkbox
  chọn xóa hàng loạt bị disable cho ca đã khóa (trừ admin).
- Hub quét QR (`/dashboard/product/confirm`) **chỉ hiển thị badge thông tin** (đỏ, "Ca này đã
  được duyệt & khóa bởi {tên} · {giờ}. Liên hệ quản trị viên...") — KHÔNG có nút hành động ở đây,
  tránh 2 nơi cùng có logic khóa/mở khóa dễ lệch nhau. Nút Sửa/Xóa trong "Lịch sử ca" tự ẩn theo
  `canEdit`/`canDelete` đã tính lại ở server (`loadShiftHistory()`).

### Chia sẻ phiếu báo thành phẩm dạng ảnh (2026-08-28, không phụ thuộc khóa ca)

`ShiftReportPreviewBar` (`confirm/shift-report-preview-bar.tsx`) — nút "Chia sẻ phiếu" giờ gọi
`shareShiftReportImage()` (`shift-report-pdf.ts`): rasterize toàn bộ trang PDF qua `pdfjs-dist`
(worker local, không CDN — theo đúng convention repo) rồi **ghép dọc thành 1 ảnh PNG dài duy
nhất** trước khi chia sẻ qua Web Share API (fallback tải PNG nếu không hỗ trợ). Nút "Tải phiếu
PDF" **không đổi**, vẫn tải PDF gốc qua `downloadShiftReportPdfDoc()`. Hàm `shareShiftReportPdfDoc`
cũ (chia sẻ thẳng PDF) đã bị xóa vì không còn call site nào.

## 4.4c. `product-draft/page.tsx` — ĐÃ XÓA (2026-09-28)

Route `/dashboard/product-draft` là bản sao cũ của trang Thành phẩm: không có permission guard,
đóng băng từ 02/07/2026 (thiếu mọi fix toàn vẹn dữ liệu sau đó), lỗi encoding, không có link nào
trỏ tới. Người dùng đã **quyết định XÓA ngày 2026-09-28** — đã xóa thư mục
`src/app/dashboard/product-draft/` và dòng `revalidatePath("/dashboard/product-draft")` trong
`revalidateLotScreens()` (`product/actions.ts`); `grep "product-draft"` trong `src/` = 0 kết quả.
**Không hỏi lại, không khôi phục.** Nếu thấy route này xuất hiện lại thì đó là file lạ, cần hỏi nguồn gốc.

## 4.5. Sang kiện / Thay bọc — "tròn kiện" (viết lại GĐ6, 2026-09-28)

Quy tắc nghiệp vụ (người dùng chốt): khi SẢN XUẤT 1 lô không được lẫn 2 loại bọc; SAU sản xuất được
thay bọc / sang pallet nhưng **phải đổi NGUYÊN KIỆN**. Hệ quả: 1 lô có thể có kiện khác bọc/pallet,
**không còn tách lô tồn dư `…r`** (bản cũ 20260619 sinh lô `…r` không có giao dịch = lô mồ côi).

- Migration `20260930b_sang_kien_thay_boc_tron_kien.sql` (**chạy tay**): DROP bản 4 tham số, tạo
  `perform_sang_kien_thay_boc(p_factory_id, p_actor_id, p_loai, p_lots, p_new_boc, p_new_pallet,
  p_history_payload)`, **chỉ service_role**. `p_lots = [{lot_id, kiens:["a","c"]}]`.
- Gọi qua server action `performSangKienThayBoc` (`product/actions.ts`) — tự xác thực token, quyền
  `product.edit` (nút mở cũng gate quyền này; trước đây ai xem được Thành phẩm cũng mở được).
- Điều kiện 1 kiện đổi được: lô "Hoàn thành", kiện có bành, **tổng gán đơn xuất của kiện = 0** (khớp
  `lot_id` hoặc `ma_lo`). Kiện thuộc ca đã khóa → chặn, trừ admin.
- RPC sửa `lot_transactions` (bọc hoặc pallet của kiện được chọn). Dòng giao dịch chứa cả kiện đổi
  lẫn không đổi → tách dòng (dòng mới giữ ngày/ca/ngăn/người nhập/`created_at`; kg chia theo tỷ lệ
  bành). Rồi `sync_lot_master_snapshot`. Đổi bọc đủ mọi kiện → lan `lot_prediction_lots.boc` + nháp.
- UI: mỗi kiện là 1 nút bật/tắt (không nhập số bành); kiện đã xuất hiện "Đã xuất N" và bị khóa. Số
  liệu kiện tải qua `loadSkKienAvailability` (service role, không phụ thuộc RLS `export_orders`).
- `lots.boc`/`pallet` chỉ là snapshot giao dịch cuối → báo cáo phải lấy bọc/pallet **theo giao dịch
  / theo kiện**: F11 in "Bọc X A, B / Bọc Y C, D", F12 xuất kho tính bọc theo từng kiện.
- `sk_history` giữ nguyên cấu trúc; bản ghi mới có `split=false`, `residual_*=null`.

### Lô tồn dư `…r` cũ
- Kiểm DB 2026-09-28: 0 lô `…r`. Nếu phát sinh (dữ liệu cũ) → `scripts/reconcile-f12-stock.mjs` mục [1].

## 4.6. Dự đoán số lô trước sản xuất + in nhãn QR theo kiện (2026-07-09)

### Mục tiêu

Cho phép dự đoán trước dãy số lô sẽ phát sinh khi sản xuất một ngăn cụ thể, in nhãn QR (theo từng **kiện**, không phải theo lô) để đưa xuống ca — công nhân dán nhãn lên pallet ngay khi sản xuất tới lô đó, thay vì văn phòng gõ lại toàn bộ sau khi nhận giấy ghi tay.

### Bảng mới (migration `20260709_lot_predictions.sql`)

- `lot_prediction_batches` — 1 dòng / 1 ngăn / lần "chọn ngăn → tạo dự đoán" (khi chọn nhiều ngăn cùng lúc, mỗi ngăn vẫn tạo 1 batch riêng — xem mục "Chọn nhiều ngăn" bên dưới, không đổi schema bảng này).
- `lot_prediction_lots` — 1 dòng / lô dự kiến, có 4 cột `kien_a_ngan_id..kien_d_ngan_id` (ngăn nguồn dự kiến của từng kiện), `unassignable_kien TEXT[]` (kiện đã có thật ở lô thật — đủ hoặc dở dang một phần — KHÔNG được gán ngăn mới qua dự đoán, dù cột `kien_X_ngan_id` tương ứng vẫn NULL), `carry_over_status` (`none|pending|continued|abandoned`), `trang_thai` (`Dự kiến|Đã dùng|Hủy`), `real_lot_id` (liên kết mềm khi đã có lô thật khớp `ma_lo`). `UNIQUE (factory_id, ma_lo)` — không được khóa cứng `ma_lo` như bảng `lots`, chỉ là gợi ý đã lưu lại để tra cứu/tự điền, không tạo bản ghi `lots` thật.
- RLS: SELECT mở public (`USING (true)`, mirror precedent "Allow all" của `ngans`/`lots`) để trang tra cứu QR công khai `/product-label` đọc được không cần đăng nhập; INSERT/UPDATE vẫn giới hạn theo `factory_id` của user đăng nhập.
- RPC atomic `create_lot_prediction_batch(...)` — xử lý **1 ngăn/lần gọi**, thực thi thuật toán phân bổ trong 1 transaction (`FOR UPDATE` lock ngăn + lô carry-over cùng series). Nhận thêm `p_reserved_kg`, `p_real_lot_ma_lo`, `p_real_lot_num`, `p_real_unassignable_kien` để tự "bridge" 1 lô thật Dở dang chưa từng qua dự đoán (xem mục "Kiện dở dang một phần"). Xem chi tiết thuật toán trong chính file migration (đã comment đầy đủ).

### Ràng buộc nghiệp vụ

- 1 lô có 4 kiện (a,b,c,d), **được phép sản xuất từ 2 ngăn khác nhau** theo kiện (vd A,B từ ngăn 1, C,D từ ngăn 2), nhưng **1 kiện đơn lẻ tuyệt đối không được lấy nguyên liệu từ 2 ngăn**.
  - **Lưu ý quan trọng (đã xác minh qua code thật, 2026-07-09)**: hệ thống thật (`product/page.tsx`, `product/actions.ts` `syncLotMasterSnapshot`) **hiện KHÔNG hề chặn cứng** điều này — `locked_X = prev_X >= max_per_kien` chỉ khóa kiện đã ĐỦ bánh, và tổng `kien_a/b/c/d` được tính bằng SUM tất cả `lot_transactions` cùng `lot_id` mà **không lọc theo `ngan_id`**. Rule "1 kiện 1 ngăn" hiện chỉ là quy ước vận hành, không phải ràng buộc code ở hệ thống thật — tính năng dự đoán tôn trọng đúng tinh thần rule này (xem mục "Kiện dở dang một phần"), nhưng không (và không thể) ngăn người dùng nhập liệu thật trái quy ước đó ngoài luồng dự đoán.
- Số lô đề xuất tự tính vừa khít 100–110% sức chứa còn lại của ngăn (dùng đúng công thức `getLoaiBanhConfig`/`lo_tron`/`kien_weight_kg` mirror từ `product/page.tsx`, xem `src/lib/product-lot-config.ts`), người dùng có thể giảm số lô muốn in (không được tăng vượt đề xuất).
- **Carry-over từ dự đoán trước KHÔNG được tự động ép buộc**: khi phát hiện 1 lô dở dang (`carry_over_status='pending'`) đang chờ nối từ ngăn trước cùng series (phát sinh từ chính thuật toán dự đoán, không phải lô thật), hệ thống bắt buộc hỏi người dùng rõ ràng "Tiếp tục lô dở dang" hay "Bỏ qua, bắt đầu lô mới" — không tự chọn thay (ví dụ thực tế: ngăn đang sản xuất phát hiện chất lượng kém phải ngưng giữa chừng, chuyển ngăn khác và muốn bắt đầu lô mới, không muốn nối tiếp phần kiện còn thiếu của lô cũ).
- QR trên nhãn dùng khóa nghiệp vụ thật `(factory_id, ma_lo, kiện)` — **không** dùng `lot_prediction_lots.id` — để hoạt động cho MỌI lô kể cả lô nhập tay trực tiếp không qua dự đoán, và để module Xuất hàng/EUDR sau này có thể tự tái sinh đúng QR này in trên báo cáo (xem `src/lib/product-label.ts`).
- "Sửa" 1 lô dự kiến (đổi ngăn nguồn từng kiện, đổi CSR/bọc/bành) chỉ chặn khi ngăn đích sau khi nhận thêm kiện vượt quá 110% — không có ràng buộc tối thiểu 100% (100% chỉ là ngưỡng "sẵn sàng đánh dấu Đã sản xuất", không phải điều kiện chặn sửa). User thường chỉ sửa được lô chưa `Đã dùng`; admin sửa được mọi trạng thái.

### Kiện dở dang một phần (2026-07-09)

Khi 1 lô thật đang "Dở dang" có kiện đã có sản lượng thật nhưng **chưa đủ** số bánh chuẩn (vd kiện C = 12/36 bánh) và **CHƯA từng qua dự đoán** (chưa có row `lot_prediction_lots` khớp `ma_lo`), thuật toán dự đoán tự động ("bridge", không hỏi người dùng — khác hẳn carry-over từ dự đoán trước):

- Xác định trạng thái từng kiện qua `findRealContinuationForSeries()` (`predict/actions.ts`) — quét `lot_transactions` của lô đó, với mỗi kiện: `empty` (chưa có bánh nào), `partial` (có nhưng chưa đủ `max_per_kien`), `full` (đã đủ).
- Kiện `full` và `partial` → đưa vào `unassignable_kien` của row bridge — KHÔNG được dự đoán/gán ngăn mới (dù cột `kien_X_ngan_id` vẫn NULL). Chỉ kiện `empty` (vd kiện D) mới được gán cho ngăn đang xử lý.
- Với mỗi kiện `partial`, phần bánh còn thiếu (`max_per_kien - real_count`) được coi là **"đã có chủ"** — quy về đúng ngăn đã sản xuất phần bánh thật đó (`origin_ngan_id` lấy từ `lot_transactions.ngan_id` của lần đóng góp gần nhất > 0 cho kiện đó). Phần KL này được TRỪ vào capacity khả dụng của đúng ngăn đó (`p_reserved_kg`) để tính đúng tỷ lệ ngăn, **dù không in nhãn/dự đoán cho phần đó**.
- Ví dụ thực tế: ngăn 8 đang sản xuất CSR10/bành 35, lô `1014cs` đã có kiện A,B đủ (thật) + kiện C thật = 12/36 bành; khi dự đoán tiếp cho ngăn 8 (hoặc ngăn khác), hệ thống tự bỏ qua C (không dự đoán), bắt đầu dự đoán từ kiện D, đồng thời trừ phần 24 bánh còn thiếu của kiện C vào capacity của **đúng ngăn 8** (ngăn đã sản xuất 12 bánh đầu của kiện C).

### Chọn nhiều ngăn cùng lúc (2026-07-09)

- Bước 1 của `predict/page.tsx` dùng `FilterMultiSelect` (đã dùng ở nhiều module khác) — cho phép chọn **nhiều ngăn cùng lúc** trong 1 lần tạo dự đoán, thay vì chỉ 1 ngăn/lần như bản đầu.
- Thứ tự tiêu thụ: **ngăn "Đang sản xuất" trước, sau đó theo đúng thứ tự người dùng bấm chọn** (không cho kéo sắp xếp lại) — tính bằng `Array.prototype.sort` ổn định trên mảng `selected` của `FilterMultiSelect` (mảng này tự nhiên giữ đúng thứ tự click vì `onChange` luôn append vào cuối).
- **Không đổi schema đa ngăn** — mỗi ngăn trong danh sách vẫn tạo **1 batch riêng** (`lot_prediction_batches` giữ nguyên 1 cột `ngan_id`). "Đa ngăn" chỉ là điều phối ở tầng client: `createLotPredictionBatchMulti()` (`predict/actions.ts`) gọi lại RPC atomic 1-ngăn hiện có, tuần tự từng ngăn theo đúng thứ tự đã sắp — carry-over phát sinh giữa các ngăn TRONG CÙNG thao tác này tự động "continue" (không hỏi lại người dùng); chỉ ngăn ĐẦU TIÊN mới có thể gặp carry-over từ 1 phiên trước và cần hỏi (`needsCarryDecision`).
- Không trộn ngăn khác `day_chuyen` (Mủ tạp/Mủ nước) trong cùng 1 lần chọn — `mixedDayChuyen` chặn tạo dự đoán nếu phát hiện.

### Lọc ngăn "hết dung lượng dự đoán" (2026-07-09)

- `loadPredictAvailableNgans()` ngoài lọc `trang_thai IN ('Chờ sản xuất','Đang sản xuất')`, giờ loại thêm ngăn đã hết dung lượng — real kg + predicted kg đã chạm ~110% `tong_kho` (không còn chỗ trống dù chỉ 1 kiện).
- Tính thuần theo kg, **không phụ thuộc CSR/bành cụ thể** (vì bước chọn ngăn diễn ra TRƯỚC khi chọn CSR/bành ở bước 2) — dùng chung `getExistingRealKg`/`getExistingPredictedKg` đã có.

### Quyền Hủy dự đoán — chỉ admin (2026-07-09)

- Nút "Hủy" trong tab Lịch sử chỉ hiển thị khi `user.role === 'admin'` (trước đây là `product.predict_manage`, mọi user có quyền quản lý đều hủy được).
- `cancelPredictionLot()` nhận thêm tham số `isAdmin`, kiểm tra chặn cứng ở tầng server action (không chỉ ẩn nút UI).
- Nút "Sửa" vẫn theo `product.predict_manage` như cũ (không đổi).

### Nhãn in lớn (redesign 2026-09-26, 6 nhãn/trang + icon + thanh lấp đầy)

A4 portrait, **cố định 6 nhãn/trang** (lưới 2×3, các nhãn sát nhau, khe 2mm để cắt kéo, lề trang 6mm — `computeSixPerPageLayout` trong `src/lib/product-label-pdf.ts`). Mỗi nhãn gồm 4 khối, không còn footer:

1. Logo (`public/logo-phk-moi.png`, giữ tỷ lệ gốc) + 3 dòng chữ thường: tên công ty 2 dòng + "NHÀ MÁY CHẾ BIẾN" (`ProductLabelPdfOptions.companyLine1/2/3`).
2. Trái: QR (trỏ `/product-label?f=...&lo=...&kien=...`) + mã ngăn 1 dòng (tự co chữ) + **thanh tỷ lệ lấp đầy** (`drawFillProgressBar`: phần đầy tô chuyển dần trắng→đen bằng 48 dải rect, chỉ hiện số `X%`, >~85% thì số đặt trong phần đầy màu trắng, >100% vẫn hiện số thật). Phải: CSR / **SỐ LÔ (to nhất, giả đậm)** / "Kiện {X}", tự co chữ cho vừa cột.
3. Một hàng: [icon quả cân KG] "Bành {x} kg" · [icon lá tái chế] "Bọc ...".
4. Ghi tay, **không nhãn chữ**: [icon lịch] = Ngày SX · [icon nhà máy] = Ca SX · [icon công nhân] = Trực ca, mỗi ô 1 đường kẻ đứt xám. Đã bỏ "Giờ SX" và footer "Nhà máy chế biến PHK".

Icon: SVG vẽ tay trong `src/lib/product-label-icons.ts`, chuyển PNG qua canvas (`loadIconPng`, có cache, lỗi → bỏ icon, không chặn in).

⚠️ Font PDF (`ensurePdfFont`) chỉ có NotoSans **Regular** — style "bold" trỏ cùng file nên `setFont(...,"bold")` KHÔNG đậm. Số lô giả đậm bằng `renderingMode: "fillThenStroke"` + `setLineWidth(size*0.016)`; nét dày hơn (~0.03) làm chữ số dính nhau.

PDF đã lưu Storage trước 2026-09-26 (`pdf_large_url`) vẫn là layout cũ 4 nhãn/trang — không hồi tố. Nhãn QR nhỏ (16/trang) không đổi.

In đen trắng hoàn toàn (logo màu vẫn nhúng nguyên bản — máy in đen trắng tự rasterize thành grayscale khi in, không cần xử lý trước). Mỗi kiện in đúng 2 bản giống nhau. Thuật ngữ hiển thị dùng **"Bành"** (dấu huyền), không phải "Bánh" — xem mục "Đính chính thuật ngữ" trong lịch sử plan, chỉ áp dụng phạm vi tính năng này, không đụng module Xuất hàng (rule 08 khóa cứng "bánh").

### File liên quan

- `src/lib/product-lot-config.ts` — mirror `getLoaiBanhConfig`/`buildMaLo`/`getLoaiCSRByDayChuyen`/`getBocsForLoaiCSR` từ `product/page.tsx` (các hàm gốc không export vì `page.tsx` là module-private — nếu sửa công thức ở `product/page.tsx`, phải cập nhật đồng bộ ở đây).
- `src/lib/product-label.ts`, `src/lib/product-label-pdf.ts` — URL/QR + resolve logic + PDF nhãn (logo, mã ngăn, Ca SX, footer).
- `src/app/product-label/page.tsx` + `src/app/dashboard/product/_components/product-label-client.tsx` — trang tra cứu công khai (mirror `/storage`).
- `src/app/dashboard/product/predict/page.tsx` + `actions.ts` — UI multi-select ngăn → xác nhận CSR/bọc/bành/số lô → xem trước & in + tab lịch sử (sửa/hủy admin-only/in lại/xóa đợt admin-only). `actions.ts` có thêm `findRealContinuationForSeries`, `createLotPredictionBatchMulti`, `getReservedKgForPartialKien`, `deletePredictionBatch`, `loadNganLabelInfoWithFill`.
- `src/lib/pdf-qr-shared.ts` — tách từ `storage-pdf.ts` (`ensurePdfFont`, `addQrImage`, `safeName`, `PDF_FONT_NAME`) để dùng chung giữa nhãn ngăn và nhãn kiện thành phẩm.
- Permission mới: `product.predict_view`, `product.predict_manage` (đã thêm vào `DEFAULT_PERMISSION_CODES` + `ROLE_DEFAULTS.manager` trong `src/lib/auth.ts`; `user` role không có quyền này).


### Lịch sử redesign 4.6 (nhãn in, luồng quét QR, phiếu báo thành phẩm) — đã chuyển ra file riêng

Toàn bộ nhật ký chi tiết các phiên redesign nhãn in QR, luồng "trạm quét" xác nhận sản xuất
(`/dashboard/product/confirm`), luồng "Lưu tạm nhiều kiện rồi Gửi 1 lần", fix race condition
`sync_lot_master_snapshot`, và phiếu báo thành phẩm (gộp theo ngày, sắp Ca 1/Ca 2 theo giờ thật...)
đã chuyển sang `.claude/history/06-module-production-history-4.6.md` (không tự nạp context). Toàn
bộ đó đã **code xong và qua ≥1 vòng test tay** tính đến 2026-07-22, trừ các mục còn treo dưới đây.

### Việc còn treo / cần xác minh lại (chưa xác nhận đã xong)

1. **Phiếu báo thành phẩm — sắp "Ca 1"/"Ca 2" theo giờ sản xuất thật**: logic
   (`earliestCreatedAtByCa` trong `confirm/actions.ts`) đã code đúng, nhưng lần test tay
   2026-07-22 vẫn thấy bug cũ tái hiện trên **bản deploy production** — nghi ngờ do fix chưa
   từng được commit/push/deploy thật (working tree có thay đổi chưa commit tại thời điểm đó).
   **Cần xác minh lại**: đối chiếu code hiện tại đã lên production chưa, nếu chưa thì
   commit+push+deploy rồi test lại đúng kịch bản (2 ca, ca sau có giao dịch sớm hơn ca trước).
2. **Mobile responsive cho 5 màn hình cụ thể** (ký phòng ban, xuất hàng, EUDR, báo cáo chất
   lượng, action Thành phẩm ở module quét QR) — trạng thái không rõ ràng trong nhật ký đã
   archive; có thể đã được xử lý trong đợt tổng rà responsive riêng (xem memory
   `project_mobile_responsive.md`), nhưng chưa xác nhận trực tiếp cho đúng 5 màn hình này. Nếu
   người dùng báo còn vỡ layout ở 1 trong 5 màn hình trên, đọc lại
   `.claude/history/06-module-production-history-4.6.md` mục "Kế hoạch phiên sau (2026-07-21)"
   để có đầy đủ yêu cầu gốc trước khi sửa.

## 4.7. Báo cáo lô sản xuất (F11) + bắt buộc & xác nhận ở Dự đoán số lô (2026-09-26)

- **Báo cáo lô sản xuất** (`NMCB-QT01-F11`, mẫu `cung_cap_dl/NMCB-QT01-F11Báo cáo lô sản xuất.pdf`)
  dựng ở `src/app/dashboard/product/confirm/lot-report-pdf.ts` (`buildLotReportPdf`) từ CHÍNH
  `ShiftReportData` của phiếu F09 — không query thêm. Là file RIÊNG, không gộp vào F09.
  - Mục 1: chỉ các lô **HOÀN THÀNH trong ngày báo cáo** (`lots.ngay_ht = ngày`, loại "Dở dang")
    — lấy qua `loadCompletedLotsForDay` → `ShiftReportData.completedLots`. Lô mở hôm trước nhưng
    tròn lô hôm nay VẪN có; lô mở hôm nay còn dở dang thì KHÔNG. Mỗi lô 1 dòng theo `num`; tên lô
    bỏ đuôi năm (`1636cs/26` → `1636cs`); pallet gom từ `lot_transactions` của lô (mọi ngày), nối
    `/`; ghi chú = `lots.ghi_chu`. Cuối bảng có dòng **"Tổng: N lô"**.
  - Mục 2: `data.byGroup` = thành phẩm SẢN XUẤT trong ngày (theo giao dịch, như phiếu F09) + dòng
    Cộng — cố ý khác phạm vi mục 1 (đúng mẫu giấy: 13-14 lô nhưng tổng 1.941 bành).
  - Ô trùng dòng liền trên in dấu `"` (`applyDitto`) — không áp cho Số bành/Số kg.
- `ShiftReportPreviewBar` giờ bắt buộc `lotDoc`/`lotFileName`: 2 nút chia sẻ ảnh riêng
  ("Thành phẩm" / "Báo cáo lô") + 1 icon tải **cả 2 PDF**. 3 call site (product/page.tsx,
  confirm/page.tsx ×2) dựng `lotDoc` cùng lúc với `doc`.
- **Dự đoán số lô** (`predict/page.tsx`): Thảm là dropdown cứng `Cũ`/`Mới` (mặc định `Cũ`); Loại
  bọc và Hậu tố bắt buộc — hậu tố KHÔNG còn tự chọn sẵn `cs`, state `null` = chưa chọn, "Trống
  (không hậu tố)" là 1 lựa chọn rõ ràng. Nút "Tạo dự đoán" chỉ mở modal xác nhận liệt kê mọi lựa
  chọn; "Xác nhận & tạo" mới gọi `handleCreate()`.

## 4.8. Báo cáo sản xuất hằng ngày (F12) — xuất kèm F11 (2026-09-27)

- Mẫu `cung_cap_dl/NMCB-QT01-F12 Báo cáo sản xuất hàng ngày.pdf`, khổ NGANG, luôn đúng 1 trang
  (tự giảm mật độ chữ qua `DENSITY`, `confirm/daily-report-pdf.ts`), mã tài liệu góc trái dưới.
- Dữ liệu: `confirm/daily-report-actions.ts` (`loadDailyProductionReportData`, phân trang `.range()`).
  - Mục 1: gom theo Loại CSR + Nguồn gốc (`lots.suffix` → `suffixes.nguon`: NT=Công ty, M/TM=Thu
    mua, GC*=Gia công, TL=Thanh lý) + Bọc + Loại bành. Liệt kê mọi tổ hợp có nhập/xuất trong năm
    hoặc còn tồn (đã xuất hết vẫn hiện, tồn 0). Nhập = `lot_transactions`; Xuất = đơn xuất ĐÃ DUYỆT
    (`trang_thai` NULL/`da_phe_duyet`) theo `export_orders.ngay`, kg = bành gán × `lots.loai_banh`;
    Tồn = nhập mọi thời điểm − xuất mọi thời điểm (tới hết ngày).
  - Mục 2: sản lượng từng ca tách CSR + loại bành (KHÔNG tách bọc), lũy kế theo mã ca + CSR + bành;
    từ GĐ5 (2026-09-29) nhãn + thứ tự theo chữ cái ca A→B→C kèm tên ca trưởng (xem 4.14). Dòng dầu Diesel = số người dùng nhập.
- Dầu DO: KHÔNG lưu DB. Trước khi dựng PDF, 3 luồng (Hub, Kết thúc ca, "Xem phiếu PDF") đều hiện
  `DailyReportInputForm`: gợi ý = xuất kho `DO750K` (`movement_type='export'`) trong ngày, sửa được;
  lũy kế = xuất kho DO750K các ngày trước + số vừa nhập; ghi chú chỉ vào dòng dầu.
- `confirm/report-bundle.ts` dựng cả F09/F11/F12 1 lần. Chia sẻ "Báo cáo lô" = 2 ảnh tách rời
  (F11 + F12, `shareReportImages`); tải PDF = F09 + 1 file gộp F11 (dọc) + trang F12 (ngang).
- Form nhập dầu chỉ có tiếng Việt (chưa qua `i18n` của trang quét QR).

## 4.9. Tách "Phiếu thành phẩm" và "Báo cáo ngày" + quyền `product.report_daily` (2026-09-27)

- 2 hành động ĐỘC LẬP (`confirm/report-bundle.ts`):
  - **Phiếu thành phẩm (F09)** — `loadShiftReport()` → `buildShiftReport()`. Không nhập dầu, không
    dựng F11/F12. Quyền = **quyền tạo thành phẩm có sẵn** (`product.create` HOẶC
    `product.confirm_scan`), KHÔNG có mã quyền riêng (đã chốt với người dùng).
  - **Báo cáo ngày (F11 + F12)** — `loadDailyReportDraft()` → `DailyReportInputForm` (dầu DO) →
    `buildDailyReport()`. Quyền mới **`product.report_daily`** (nhân viên văn phòng).
- Thanh xem trước tách 2: `ShiftReportPreviewBar` (1 ảnh + 1 PDF) và `DailyReportPreviewBar`
  (2 ảnh F11/F12 + 1 PDF gộp).
- 3 call site: header nhóm ngày `product/page.tsx` (2 icon `FileDown` / `ClipboardList`), Hub quét
  QR (2 nút cạnh nhau), modal **"Kết thúc ca" CHỈ còn Phiếu thành phẩm** (bỏ bước nhập dầu).
- **Guard server**: `loadShiftReportData(fid, ngay, accessToken, purpose)` và
  `loadDailyProductionReportData(fid, ngay, accessToken)` tự xác thực token qua
  `confirm/report-access.ts` (`assertReportAccess`: đúng nhà máy, active, quyền hiệu lực mirror
  `fetchPermissionCodesForUser`, admin luôn qua). F11 dựng từ dữ liệu F09 nên `purpose: "daily"`
  nhận `product.report_daily`.
- Migration `20260927_product_report_daily_permission.sql` (**chạy tay**): seed `permissions` +
  `role_permissions` CHỈ cho admin. Mọi tài khoản đang có `user_permissions` tường minh ⇒ admin phải
  **tick tay** quyền này cho từng nhân viên văn phòng ở Cài đặt → Phân quyền (nhãn "báo cáo ngày (Báo
  cáo lô F11 + Báo cáo sản xuất F12)"). Cố ý không có trong `ROLE_DEFAULTS.manager/user`.

## 4.10. Bộ lọc danh sách thành phẩm (2026-09-27)

- Thứ tự: Tìm nhanh → Từ ngày → Đến ngày → Dây chuyền → Loại CSR → Loại bọc → Trạng thái → Ca →
  Ghi chú → Xóa lọc.
- Ngày mặc định = đầu tháng → hôm nay theo **múi giờ nhà máy** (`getDefaultListDateRange()` dùng
  `getFactoryTodayISO()`). "Xóa lọc" đưa về lại mặc định này; 2 ngày mặc định không tính vào
  `activeCount`. Cảnh báo lô dở dang, `dorDangCountByNganId`, KPI "Tổng/Hoàn thành/Dở dang" tính trên
  `lots` nên KHÔNG bị bộ lọc ngày ảnh hưởng (chỉ Tổng bành/kg theo danh sách đang lọc).
- Loại CSR: `getLoaiCSRByDayChuyen(dc, factoryPrefix)` (chưa chọn dây chuyền → hợp 2 dây chuyền) ∪
  `loai_csr` thực tế trong dữ liệu (giữ lọc được lô cũ kiểu "CSR5").
- Loại bọc (`filterBoc`, so khớp chính xác sau trim trên `c.boc`): `getBocsForLoaiCSR` theo DC+CSR ∪
  `boc` thực tế khớp cùng điều kiện.
- Đổi dây chuyền/CSR mà giá trị con không còn trong option → tự reset (CSR reset kéo theo Bọc).
- Trạng thái / Ca / Ghi chú độc lập, không lọc chéo.

## 4.11. Hotfix ngăn kẹt + thứ tự kiện F09 + đổi ngăn khi quét QR (2026-09-28)

### Ngăn kẹt "Chờ sản xuất" — lỗi hồi quy migration
- `20260808` đã thêm vòng `v_touched_ngans` → `sync_ngan_production_status` vào
  `submit_confirm_draft_batch`, nhưng `20260828_product_shift_lock_guards.sql` dựng lại hàm từ bản
  CŨ `20260716` nên làm mất vòng này; `20260918` chép tiếp bản thiếu ⇒ từ 28/08 ngăn không tự sang
  "Đang sản xuất" sau khi Gửi, admin phải bấm "Bắt đầu SX".
- Fix: `20260928_submit_draft_batch_restore_ngan_sync.sql` = nguyên thân bản 20260918 + khôi phục
  vòng (diff chỉ 3 chỗ thêm) + backfill. **Chạy tay.**
- ⚠️ Mọi `CREATE OR REPLACE submit_confirm_draft_batch` sau này PHẢI chép từ file MỚI NHẤT và giữ vòng
  `v_touched_ngans`. File mới nhất hiện là `20260928b_fix_submit_draft_batch_ambiguous_lot_id.sql`.
- 🐛 "Gửi tất cả" báo `column reference "lot_id" is ambiguous` (có từ `20260918`): hàm có
  `RETURNS TABLE (draft_id, lot_id, ma_lo, kien, so_kg)` nên dòng lan bọc
  `UPDATE lot_transactions SET boc … WHERE lot_id = v_lot_id` (không alias) mơ hồ với biến OUT; nháp
  luôn có bọc ⇒ mọi lần gửi đều hỏng. Fix `20260928b_…` (đổi đúng 1 dòng sang alias `ltb`).
  **Quy tắc: trong hàm PL/pgSQL có `RETURNS TABLE`, mọi cột trùng tên cột trả về phải có alias bảng.**

### F09 in kiện C, D, A, B
- Lô tách nhiều dòng (khác ngăn/pallet) từng được sắp theo lần quét mới nhất của từng dòng. Nay
  (`loadShiftReportData`): lô xếp theo mốc quét SỚM nhất → cùng lô liền nhau → kiện A, B, C, D →
  thời gian. Sửa kèm lỗi `created_at` null làm ca bị xếp đầu (F09 + F12).

### Đổi ngăn nguồn của kiện (cập nhật 2026-09-28, lần 2)
- Ngăn của 1 kiện có 3 nơi: kế hoạch (`lot_prediction_lots.kien_X_ngan_id`), nháp, thật
  (`lot_transactions.ngan_id`). Đổi ngăn = đổi KẾ HOẠCH của đúng kiện (+ nháp đang sửa) qua RPC
  `swap_predicted_kien_ngan` (`20260928_swap_predicted_kien_ngan.sql`, **chạy tay**, chỉ service
  role), ghi nhật ký `lot_prediction_ngan_changes`. Không tạo lô/kiện mới ⇒ không tính trùng.
- **Chỉ 1 lối vào**: màn tra cứu nhãn `/product-label`, icon `ArrowLeftRight` góc phải dòng "Xem chi
  tiết ngăn nguồn gốc" (`KienSwapNganModal`). Form Xác nhận sản xuất KHÔNG còn nút đổi, chỉ có link
  dẫn sang màn tra cứu. Icon chỉ hiện khi đã đăng nhập + đúng nhà máy + `product.confirm_scan` +
  status `predicted/partial`.
- ⚠️ `/product-label` là trang CÔNG KHAI ⇒ `loadKienSwapContext`/`swapKienNgan` tự xác thực access
  token bằng `assertProductAccess` (`confirm/report-access.ts`), không tin `userId`/`factoryId` client
  gửi; ngăn cũ + dây chuyền cũng tính lại ở server. Điều kiện được đổi nằm ở
  `evaluateSwapEligibility()` (nguồn sự thật duy nhất): kiện theo dự đoán, 0 bành thật, 0 bành nháp
  của bất kỳ ai, ngăn đang dùng = ngăn kế hoạch.
- Danh sách ngăn = `loadSwapCandidateNgans` (`predict/actions.ts`): Chờ/Đang SX, `tong_kho > 0`,
  **đã có lịch sử dự đoán** (là `lot_prediction_batches.ngan_id` hoặc xuất hiện trong
  `kien_X_ngan_id` của 1 lô dự đoán còn hiệu lực), **KỂ CẢ ngăn đã tick "đã dự kiến xong"**; cùng dây
  chuyền. % hiển thị là tỷ lệ SAU khi nhận kiện; ngăn vượt 110% hiện xám không chọn được, server kiểm
  lại trước khi ghi. Sức chứa dùng chung `computeNganCapacities` với màn Dự đoán.
- Sau khi đổi, quét lại QR (kể cả nhãn giấy cũ) phải ra ngăn mới: `resolveProductLabelLookupTarget`
  lấy `lastKienTx.ngan_id || kien_X_ngan_id (kế hoạch) || lots.ngan_id` — trước đây kiện chưa có bành
  của lô đã có kiện khác gửi rơi về `lots.ngan_id` (= ngăn của kiện KHÁC).
- Sửa nháp (`updateDraftKien`) đổi ngăn: nếu nháp đang đúng ngăn kế hoạch thì đi qua
  `swapKienNganInternal` (không export). ⚠️ `updateDraftKien` bản thân vẫn tin `userId` client gửi
  (lỗ hổng có sẵn, chưa vá).
- Vá lỗ giữ chỗ: `getReservedKgForPartialKien` cộng `kien_weight_kg` cho kiện CHƯA sản xuất của lô đã
  thành lô thật (có ngăn kế hoạch, 0 bành thật, không thuộc `unassignable_kien`).
- Rủi ro chấp nhận: nhãn giấy vẫn ghi ngăn + tỷ lệ cũ; ngăn "đã dự kiến xong" có thể nhận thêm kiện
  (vẫn chặn cứng ở 110%); không tự dời các kiện dự kiến khác của ngăn mới.
- Chữ Khmer của phần đổi ngăn (`doiNgan*` trong `confirm/i18n.ts`) do máy soạn — cần người bản ngữ duyệt.

### Thay bọc lô thành phẩm — 3 lỗi cũ ĐÃ SỬA ở GĐ6 (2026-09-28)
Bản cũ chỉ sửa `lots`, sinh lô tồn dư `…r` không có giao dịch, báo cáo không thấy bọc mới. Đã viết lại
theo quy tắc "tròn kiện" — xem mục 4.5.

## 4.12. Quyền sửa sau khi Gửi + RPC sửa giao dịch + bịt lỗ khóa ca (GĐ4 + GĐ7a, 2026-09-28)

### Quyền
- Giao dịch **ĐÃ GỬI** chỉ **admin** sửa/xóa — cả Lịch sử ca (màn quét) lẫn trang Thành phẩm (nút
  Sửa / Xóa / "Sửa theo ngày" ẩn với người khác, kể cả có `product.edit`). Nháp vẫn tự sửa như cũ.
  "Thêm" thủ công giữ `product.create`.
- Mọi server action sửa/xóa/tạo nhận **access token** và tự xác thực (`assertProductAdmin` /
  `assertProductAccess` / `resolveProductActor` trong `confirm/report-access.ts`). Đã bỏ việc tin
  `isAdmin`/`actorUserId` do trình duyệt gửi (trước đây gửi `isAdmin: true` là sửa được lô đã xong).

### Sửa giao dịch — 1 nguồn duy nhất
- `adminUpdateLotTransaction` (`product/actions.ts`) → RPC `admin_update_lot_transaction`
  (`20260929_lot_admin_edits.sql`, chỉ service role). Cả modal Sửa trang Thành phẩm lẫn
  `editShiftHistoryEntry` đều gọi hàm này. **Không đổi mã lô / CSR / loại bành / thảm**; sửa được ngăn,
  bọc, số bành 4 kiện, pallet, chỉ thị, ca, ngày nhập; **lý do bắt buộc**.
- RPC: chặn lô Xuất hàng + có KN; mỗi kiện ≤ `max_per_kien` (server tính bằng `getLoaiBanhConfig`);
  không giảm dưới số bành đã gán đơn xuất; ngăn mới không Đang nhận/Đóng và ≤110% (trừ chính giao
  dịch); đổi bọc → lan `lot_transactions` toàn lô + `lots` + `lot_prediction_lots.boc` + nháp **chỉ khi lô
  đang đồng nhất 1 bọc** — lô đã có kiện khác bọc (Thay bọc tròn kiện) thì chỉ đổi đúng giao dịch đang sửa
  (migration `20261001_admin_update_lot_transaction_fixes.sql`); đã gán đơn xuất khớp cả `lot_id` lẫn
  `ma_lo`. Form sửa ở trang Thành phẩm điền sẵn bọc/pallet/chỉ thị **từ chính giao dịch**, không từ bản
  chụp `lots`; Lịch sử ca sửa dòng nhiều kiện chỉ được đổi các trường khác (giữ số bành từng kiện); đổi ngăn →
  `lot_prediction_lots.kien_X_ngan_id` của các kiện trong dòng; `sync_lot_master_snapshot` +
  `sync_ngan_production_status` 2 ngăn; ghi `lot_admin_edits` (insert-only, trigger chặn sửa/xóa).
- `saveLotTransaction` **chỉ còn tạo mới** (truyền `transaction.id` ⇒ từ chối).
- "Sửa theo ngày" → `saveDateHeaderEdits` (server, admin): ngày SX, chỉ thị (ghi xuống cả giao dịch của
  ngày đó, nếu không snapshot sẽ ghi đè lại), ký hiệu kỹ thuật, ảnh. **Bỏ đổi hậu tố/năm** (= đổi mã
  lô, khóa QR của nhãn đã in). Lô lỗi trả về `skipped` và hiện rõ, không lưu một nửa âm thầm.

### Khóa ca (GĐ7a, `20260929_shift_lock_gaps.sql`)
- `sync_lot_master_snapshot` không hạ lô "Xuất hàng" (giữ `trang_thai` + `ngay_ht`); dựng lại từ bản
  kiểu INTEGER để chấm dứt 2 file cùng ngày 20260715 ghi đè nhau.
- `delete_orphan_lot`: chỉ admin (`auth.uid()`), cùng nhà máy, lô phải 0 giao dịch, không Xuất hàng,
  không có KN. Giữ chữ ký `(p_lot_id)` để code cũ trên production không gãy.
- RLS DELETE `lots` / `lot_transactions` thêm điều kiện khóa ca như policy UPDATE.
- `saveLotTransaction` lan bọc: người không phải admin chỉ lan cho giao dịch ở ca chưa khóa.
- `submit_confirm_draft_batch` KHÔNG cần sửa: hàm đã chặn bọc nháp ≠ bọc lô nên lệnh lan chỉ lấp `null`.

### Lý do sửa = banner cảnh báo (2026-09-28, sau test tay)
- Không còn ô "Lý do" đứng sẵn trong form. Bấm Lưu ⇒ `ReasonConfirmBanner`
  (`product/_components/reason-confirm-banner.tsx`) hiện ngay trên cụm nút, nhập lý do trong banner,
  chỉ "Xác nhận lưu" mới gọi server. Dùng ở modal Sửa giao dịch, "Sửa theo ngày" và `EditEntryModal`.

### Lô `lots` lệch `lot_transactions` (371cs/26, 1159cs/26)
- Quy tắc: `lots.kien_*`/`tong_banh` luôn = tổng giao dịch sản xuất (đủ 144); Xuất hàng tự trừ phần đã
  gán, 1 kiện xuất nhiều lần tới khi hết; lô "Xuất hàng" chỉ khi gán đủ tổng.
- 2 lô trên bị giảm `lots` xuống phần còn lại (không rõ nguồn, không qua Thay bọc) ⇒ Xuất hàng tính
  "còn lại" âm, ẩn lô. Sửa bằng `scripts/repair-lot-snapshot-from-transactions.mjs` (mặc định chỉ xem,
  `--apply` ghi): lan bọc Thay bọc xuống giao dịch nếu cần → `sync_lot_master_snapshot` → trạng thái
  theo đơn xuất. Script còn liệt kê 24 lô "đơn xuất gán > tổng lô" (vd 288/144) — chưa sửa, để GĐ6.

## 4.13. F11 pallet theo kiện + F12 tồn đầu kỳ + đối soát (GĐ6, 2026-09-28)

### F11 (`confirm/actions.ts` → `loadCompletedLotsForDay`)
- `formatPalletByKien()`: 1 loại pallet/bọc → in tên như cũ; ≥2 loại → `"Sắt mỏng A, C / Sắt đế gỗ B, D"`.
  Dùng cho cả cột pallet lẫn cột bọc (sau Thay bọc tròn kiện). Giao dịch không có pallet → pallet lô.
- `loadDayTransactions` và truy vấn giao dịch F11 đã phân trang (`fetchAllPaginated`, order thêm `id`).

### F12 (`confirm/daily-report-actions.ts`)
- Bảng mới `product_opening_stock` (migration `20260930_product_opening_stock.sql`, **chạy tay**):
  tồn kiểm kê tại **hết ngày** `ngay_chot`, theo `(loai_csr, nguon_goc, boc, loai_banh)`; `nguon_goc` lưu
  đúng nhãn F12 ("Công ty"/"Thu mua"/…), `boc` rỗng = `''`. Ghi: admin hoặc `settings.manage_config`.
- Quản trị: Cài đặt → Cấu hình nhà máy → **Tồn đầu kỳ thành phẩm** (`opening-stock-tab.tsx`) — chọn
  ngày chốt, "Gợi ý từ hệ thống" (`loadOpeningStockSuggestion`, số tự tính KHÔNG dùng mốc chốt cũ), sửa
  theo kiểm kê, Lưu (upsert trước, xóa dòng thừa sau).
- Công thức: mốc chốt gần nhất ≤ ngày báo cáo ⇒ tồn = chốt + nhập − xuất **sau** ngày chốt; nhóm
  không có trong chốt = 0. Chưa chốt ⇒ toàn bộ nhập − toàn bộ xuất. PDF ghi rõ nguồn số tồn.
- Bỏ ép tồn âm về 0 — âm tô đỏ trên PDF. Lũy kế tháng/năm không đổi.
- Đơn xuất trỏ `lot_id` không còn tồn tại: thử khớp theo `ma_lo` (chỉ khi mã lô duy nhất); vẫn không
  khớp ⇒ không trừ tồn, PDF in dòng đỏ "Có N bành trong M đơn xuất trỏ tới lô không còn tồn tại".
- Lô không có giao dịch ⇒ nhập = `lots.tong_kg` tại `ngay_ht || ngay_sx` (không vào Mục 2).
- Bọc lấy theo giao dịch trước, lô sau; xuất kho tính bọc theo từng kiện (map lô → kiện → bọc).

### Đối soát `scripts/reconcile-f12-stock.mjs` (chỉ đọc)
`--ngay=YYYY-MM-DD --factory=<code> --json=out.json`. In: [1] lô mồ côi, [2] lô lệch `lots` ↔ giao
dịch, [3] lệch bọc, [4] gán đơn xuất trỏ lô mất (tách "khớp theo mã" / "mất hẳn"), [5] lô gán vượt số
sản xuất + đơn nghi trùng, [6] tồn thô theo nhóm (+ tồn chốt nếu có).

Kết quả chạy 2026-09-28 (phuochoa_kt): [1][2][3] = 0; [4] 97 dòng — 74 khớp lại theo mã lô (lô bị tạo
lại id mới), **23 mất hẳn** (1428–1450cs/25, đơn `XH-PHR-1-080126/1`); [5] **29 lô gán vượt** (phần lớn
cặp đơn `XH-NBS-13-120226/1` + `XH-HK RUBBER-12-120226/1` cùng ngày 12/02/2026 gán trùng nguyên lô
154–177cs/26; 1593cs/25 sản xuất 29 nhưng gán 144) — **chưa sửa, chờ người dùng quyết**.

Cập nhật 2026-09-29: người dùng đã tự sửa phần lớn đơn gán vượt; `scripts/repair-export-orders.mjs` đã
relink 74 dòng (xem rule 08). Chạy lại: [4] chỉ còn 23 dòng lô 2025 (giữ nguyên, đã chốt); [5] còn 6 lô —
4 lô tổng gán đúng 144 nhưng **lệch theo kiện** (137, 143, 189, 593cs/26: đơn ghi kiện khác thực tế) và 2
lô **vượt thật**: `1593cs/25` (sản xuất 29, đơn `XH-PHR-22-210426/1` gán 144) và `934cs/26` (gán 288: đơn
`XH-PHR-1-080126/1` 08/01 + `XH-KUMHO-36-080726/1` 08/07) — chờ người dùng xem.

### Tab tồn đầu kỳ — dropdown dữ liệu thật (2026-09-29)
4 cột Loại CSR / Nguồn gốc / Bọc / Loại bành là `<select>` lọc xếp tầng, tổ hợp lấy từ server action
`loadOpeningStockOptions` (lots + bọc theo giao dịch + dòng đã chốt). Đổi cột trước → cột sau tự chọn nếu
chỉ còn 1 lựa chọn, ngược lại để trống; giá trị cũ không còn trong danh sách vẫn hiện nền vàng "(giá trị cũ)".

## 5. Kiểm nghiệm và Xuất hàng

- Luồng chính phải giữ:
  - `Tròn lô -> Kiểm nghiệm`
  - `Kiểm nghiệm Đạt hạng -> Xuất hàng`
  - `Xuất hàng -> Không cho sửa lô`
  - `Ngăn có nguyên liệu -> Mới tạo Thành phẩm`
- Lô `Xuất hàng` không được phép sửa/xóa theo luồng thành phẩm.
- Logic `Xuất hàng` phải reconcile theo snapshot `export_orders` đọc lại từ DB, không tin snapshot cục bộ.

### Rule reconcile trang thái lô sau xóa phiếu KN (2026-06-30)

**KHÔNG bao giờ** set cứng `trang_thai = "Hoàn thành"` sau khi xóa phiếu kiểm nghiệm (`qc_results`).

Lý do: lô có thể đang được gán trong `export_orders.assignments` dù phiếu KN đã xóa. Set cứng "Hoàn thành" sẽ downgrade nhầm lô đang thuộc đơn xuất.

**Pattern bắt buộc** trong `quality/page.tsx` `handleDelete` và `handleBulkDelete`:

```typescript
// SAI — set cứng không check export_orders
await supabase.from("lots").update({ trang_thai: "Hoàn thành" }).in("id", affectedLotIds)

// ĐÚNG — reconcile từ export_orders thực tế
const { data: allOrders } = await supabase
  .from("export_orders")
  .select("assignments")
  .eq("factory_id", factoryId)
const { data: lotsData } = await supabase
  .from("lots")
  .select("id, tong_banh, trang_thai")
  .eq("factory_id", factoryId)
  .in("id", affectedLotIds)
for (const lot of lotsData ?? []) {
  const assigned = (allOrders ?? []).reduce((sum, order) => {
    const assgns = (order.assignments as Array<{lot_id:string;kien_a:number;kien_b:number;kien_c:number;kien_d:number}>) ?? []
    return sum + assgns
      .filter(a => a.lot_id === lot.id)
      .reduce((s, a) => s + (a.kien_a||0) + (a.kien_b||0) + (a.kien_c||0) + (a.kien_d||0), 0)
  }, 0)
  const nextStatus = assigned > 0 && assigned >= Number(lot.tong_banh || 0)
    ? "Xuất hàng"
    : "Hoàn thành"
  if (lot.trang_thai !== nextStatus) {
    await supabase.from("lots").update({ trang_thai: nextStatus }).eq("id", lot.id)
  }
}
```

Logic này mirror `reconcileLotStatuses` trong `export/page.tsx` — các thay đổi phải đồng bộ giữa 2 nơi.

### Admin sync button — fix lô bị kẹt do xóa DB trực tiếp

Xóa dữ liệu trực tiếp từ Supabase (không qua UI) → không có code reconcile nào chạy → lô có thể kẹt sai trạng thái.

Nút **"Đồng bộ trạng thái lô"** (amber, chỉ hiện với `user.role === "admin"`) trong `/dashboard/product` (`handleSyncAllLotStatuses`):

- Quét tất cả `lots` có `trang_thai IN ("Hoàn thành", "Xuất hàng")` trong `factory_id`
- Tính lại `assigned` từ `export_orders.assignments` cho từng lô
- Cập nhật `trang_thai` về đúng giá trị
- Idempotent — chạy nhiều lần không có tác hại

Dùng khi người dùng báo lô hiển thị sai trạng thái sau khi thao tác trực tiếp trên DB.

## 6. Sản lượng

- Khóa nghiệp vụ chuẩn của `production_records` là `factory_id + ngay + doi + so_xe + chuyen`.
- Preview import phải cảnh báo:
  - trùng trong cùng file
  - trùng với dữ liệu đã có trong hệ thống
- Nếu file tự chứa nhiều dòng trùng cùng khóa thì phải chặn import.
- Import phải chủ động đọc trước dữ liệu hiện có để:
  - `insert` dòng chưa tồn tại
  - `update` dòng đã tồn tại đúng khóa
  - dọn bản ghi trùng cũ nếu lịch sử dữ liệu đã bị lỗi
- Sau import/sửa/xóa thủ công, phải write-back sang Điều xe.
- Thêm/sửa/xóa thủ công trong Sản lượng chỉ dành cho `admin`.

## 7. UI filter và thống kê

### Điều xe

- Danh sách và Thống kê có filter `Loại nguyên liệu` dạng `multi-select`.
- Filter này phải kết hợp được với `Ghi chú`.
- Filter `Đội` và `Xe` trong tab Thống kê cũng là `multi-select` (dùng chung component `FilterMultiSelect` với `Loại nguyên liệu`), phải hoạt động đồng thời với `Loại nguyên liệu`, `Ghi chú`, `Từ ngày`, `Đến ngày`.
- Thống kê phải hiển thị tổng bảng phân xe, tổng chuyến, tổng km, khối lượng tươi/khô theo loại.
- Không để text mojibake; mọi text phải là Unicode tiếng Việt bình thường.

### Sản lượng

- Danh sách và Thống kê có filter `Loại nguyên liệu` dạng `multi-select`.
- Danh sách hiển thị theo ngày, bấm mở rộng mới thấy chi tiết từng dòng.
- Header ngày phải có tổng `Tươi/Khô` và action của ngày.
- Thống kê phải hiển thị được khối lượng các loại nguyên liệu tươi/khô.

## 8. Ghi chú lô (`lots.ghi_chu`) bắt buộc chọn từ danh mục (Cập nhật 2026-07-22)

Chi tiết đầy đủ cơ chế + component dùng chung xem `.claude/rules/04-settings-master-data.md` mục "4.11. Ghi chú bắt buộc". Tóm tắt riêng phạm vi Thành phẩm:

- 3 nơi nhập `ghi_chu` của lô đều đổi từ `<input list="...">` (datalist) sang `RequiredNoteSelect` (`src/app/dashboard/_components/required-note-select.tsx`): form tạo phiên sản lượng mới (`product/page.tsx`, field `session.ghi_chu`), modal "Sửa theo ngày" (`dateEditHeader.ghi_chu`), và `product/confirm/page.tsx` (luồng quét QR mobile, `product_confirm_drafts.ghi_chu` — trước đó là `<textarea>` tự do hoàn toàn, không có gợi ý/quick-add).
- **Modal "Sửa transaction thành phẩm"** (`editModal`/`editForm` trong `product/page.tsx`) **KHÔNG có và KHÔNG cần thêm** field sửa `ghi_chu` — banner amber trong chính modal đó đã ghi rõ: "Header chung như ngày SX, hậu tố, ngăn và ghi chú được sửa ở modal theo ngày. Màn này chỉ sửa chi tiết riêng của transaction đang chọn." `editForm.ghi_chu` tồn tại trong state/type/payload chỉ để pass-through giữ nguyên giá trị hiện có của lô khi lưu transaction, không phải field còn thiếu UI.
- Đã bỏ 3 hàm `handleAddRequiredNote`/`handleAddSessionRequiredNote` cục bộ (mỗi hàm lặp lại y hệt logic `window.prompt` + `createRequiredNote`) — nay nằm gọn trong `RequiredNoteSelect`.
- State `requiredNotes: string[]` trong `product/page.tsx` vẫn giữ nguyên — vẫn cần cho filter `<select>` (Pattern A, lọc danh sách theo `ghi_chu`), không liên quan tới các input đã đổi.

## 4.14. Tên ca theo ca trưởng có ngày hiệu lực + nhãn F09/F12 (GĐ5, 2026-09-29)

- 2 khái niệm KHÁC nhau: **Ca 1 / Ca 2** = ca Ngày / ca Đêm (thứ tự theo giờ quét trong ngày, F09 đánh số);
  **Ca A / B / C** = ca theo ca trưởng (giá trị `lot_transactions.ca`).
- Bảng `production_shift_names` (`ca`, `ca_truong`, `hieu_luc_tu`, `ghi_chu`; unique `(factory_id, ca,
  hieu_luc_tu)`), migration `20261002_production_shift_names.sql` (**chạy tay**, seed từ `factories.ca_*_ten`
  mốc 2020-01-01). Ghi: admin hoặc `settings.manage_config`.
- Tên ca của ngày X = dòng `hieu_luc_tu ≤ X` mới nhất (`confirm/shift-names.ts` `resolveShiftNamesAt`, hàm thuần
  `pickShiftNamesAt`). Ca chưa có dòng / bảng chưa tồn tại ⇒ fallback 3 cột LEGACY `factories.ca_*_ten`.
  `shift-names.ts` là server-only (supabase-admin) — client gọi qua server action `loadFactoryShiftNames(fid, ngay)`.
- Cài đặt → Danh mục → Thông tin công ty: `settings/_components/shift-names-tab.tsx`. Đổi ca trưởng = THÊM mốc
  mới, không sửa đè; chỉ xóa được mốc khi ca còn ≥2 mốc. Không còn ghi `factories.ca_*_ten` từ UI.
- F09 (`shift-report-pdf.ts`): "Ca 1 (Ca ngày)" / "Ca 2 (Ca đêm)" / "Ca 3", cạnh đó chữ nhỏ "— Ca A – Sok Khum".
- F12 Mục 2: dòng "Khối lượng sản xuất Ca A (Sok Khum) – CSR10", sắp A→B→C; lũy kế giữ key `ca||csr||bành`
  (trước đây nhãn "Ca 1/2" theo giờ lệch với lũy kế theo chữ cái).
- Màn quét QR: dropdown ca nạp tên theo `ngaySx` đang chọn trên form.
- `shift-assignments-tab.tsx` (phân công người trực) là khái niệm khác, không đổi.

## 4.15. Bản cứng PDF F09 / F11 / F12 khi ngày đã khóa đủ ca (GĐ7b, 2026-09-29)

- **Điều kiện sinh bản cứng (người dùng chốt)**: (1) mọi ca có phát sinh trong ngày (`lot_transactions.ca`
  DISTINCT theo `ngay_nhap`) đều có khóa active trong `product_shift_locks`; (2) có người render lần đầu sau
  đó. **Khóa ca KHÔNG tự sinh PDF.**
  - F09: lần mở "Phiếu thành phẩm" đầu tiên → dựng + lưu.
  - F11 + F12: lần đầu người có `product.report_daily` nhập dầu DO/ghi chú → lưu 3 file `F11`, `F12`,
    `F11_F12` (bản gộp lưu CUỐI, là dấu "đủ bộ"); `inputs` (dầu, ghi chú) lưu kèm.
- Đã có bản hiện hành → **mọi người, kể cả admin**, mở lại nhận đúng bản đó (không dựng lại, không hỏi dầu).
  Muốn sửa: admin mở khóa → sửa → khóa lại → lần render kế tiếp tạo bản mới.
- "Bản hiện hành" = bản mới nhất có `lock_ids` trùng đúng bộ id khóa active của ngày. Mở/khóa lại đổi bộ id
  → bản cũ tự hết hiệu lực nhưng vẫn giữ (bảng bất biến, trigger chặn UPDATE/DELETE).
- Migration `20261003_product_shift_report_snapshots.sql` (**chạy tay**): bucket private
  `product-shift-reports` (không policy storage), bảng `product_shift_report_snapshots`, RLS chỉ SELECT.
- Server `confirm/report-snapshots.ts` (service role, xác thực token): `loadDayLockState`,
  `prepareReportSnapshotUpload` (signed upload URL — PDF không đi qua server action), `finalizeReportSnapshot`
  (tải lại object, kiểm `%PDF`, **tự tính sha256**, lock_ids tính ở server, từ chối nếu đã có bản hiện hành),
  `getReportSnapshotUrl` (signed URL 120s).
- Client `confirm/report-bundle.ts`: `openShiftReport` (F09), `prepareDailyReport` → `buildDailyReport`
  (F11/F12). Lỗi lưu bản cứng **không chặn** xem PDF — thanh preview hiện cảnh báo vàng, mở lại để thử lại.
  "Kết thúc ca" giữ render sống (ca chưa khóa). Bảng chưa tạo → tự tắt, chạy như cũ.
- PDF helpers nhận `PdfSource = jsPDF | Blob` (bản cứng tải về là Blob; chia sẻ ảnh/tải vẫn dùng chung).
- Quyền: tạo F09 = `product.create | product.confirm_scan | product.approve_shift` (thêm người khóa ca vào
  `REPORT_SHIFT_PERMISSIONS`); tạo F11/F12 = `product.report_daily`; xem = `product.view` hoặc các quyền trên.
- `ShiftLockModal` hiện khung "Ngày đã khóa đủ tất cả các ca — bản cứng PDF" + nút Xem từng bản.

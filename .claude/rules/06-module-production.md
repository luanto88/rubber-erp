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

## 4.4c. Điều tra `product-draft/page.tsx` — code mồ côi, kế hoạch xử lý phiên sau (2026-08-28)

Trong lúc rà toàn bộ call site của `saveLotTransaction`/`deleteLotTransaction` cho tính năng
"Khóa ca sản xuất" (mục 4.4b), phát hiện `src/app/dashboard/product-draft/page.tsx` — 1 route
gần như song song với `/dashboard/product` nhưng **không có guard quyền nào cả** (không gọi
`hydrateActiveSession()`/`hasPermission()`, chỉ có `getActiveFactoryId()`) — vi phạm trực tiếp
invariant bắt buộc "Mọi trang dashboard phải có permission guard" đã ghi trong CLAUDE.md. Đã
điều tra kỹ bằng git history (không đoán) trước khi kết luận, để phiên sau không phải điều tra
lại từ đầu:

### Bằng chứng đã xác nhận

- **`git log --follow` gây nhiễu**: lần đầu chạy `git log --follow` cho ra lịch sử dài y hệt
  `product/page.tsx` (kể cả commit "Initial setup") — đây là **rename-detection giả** của Git
  (heuristic theo độ giống nội dung, không phải lịch sử thật của đúng file này). Lịch sử THẬT
  (dùng `git log` không kèm `--follow`) chỉ có **4 commit**:
  `9de125b` (06/05/2026, tạo file — cùng lúc với hàng trăm file khác trong 1 commit lớn, giống
  dấu hiệu gộp snapshot thư mục làm việc) → `fa774a9`/`0fc32e2` (06/05/2026, cùng nội dung fix
  "xóa lô dở dang ca này xóa luôn ca kia") → `53432b5` (02/07/2026, "Cải tiến giao diện mobile
  GD4.1") — **và dừng hẳn từ đó**.
- **Đã đóng băng 85 commit / ~6.5 tuần** (từ 02/07/2026 tới thời điểm điều tra 28/08/2026) trong
  khi `product/page.tsx` tiếp tục phát triển mạnh — đã tăng từ 6498 dòng (tại thời điểm
  `product-draft` bị bỏ) lên 7072+ dòng, kèm theo TOÀN BỘ các fix dữ liệu quan trọng đã ghi
  trong file này từ mục "Cập nhật 2026-07-03" trở đi (lô mồ côi, `sync_lot_master_snapshot`
  atomic RPC, race condition, luồng quét QR/"Lưu tạm" viết lại hoàn toàn, KPI evidence-linking,
  và giờ là "Khóa ca sản xuất" mục 4.4b) — **không có fix nào trong số này lan sang
  `product-draft`**.
- **Nội dung file bị lỗi encoding UTF-8 nặng** — dòng đầu có BOM thừa (`﻿"use client";`), nhiều
  comment tiếng Việt bị mojibake (`â”€â”€â”€ Types â”€â”€â”€...`) — dấu hiệu file từng bị lưu/ghi đè qua 1
  công cụ xử lý encoding sai, càng củng cố đây là bản sao/backup cũ, không phải code đang được
  chủ động soạn thảo.
- **Không có bất kỳ nơi nào trong app trỏ tới route này** — đã `grep -rn "product-draft"` toàn bộ
  `src/`, chỉ tìm thấy đúng 1 kết quả NGOÀI chính file đó: dòng
  `revalidatePath("/dashboard/product-draft")` trong `revalidateLotScreens()`
  (`product/actions.ts`). Dòng này (theo `git blame`) cũng được thêm đúng ngày 06/05/2026, cùng
  lúc file được đồng bộ lần 2 — chưa từng bị sửa lại kể từ đó. Không có link sidebar, không có
  `<Link>`/`router.push`/redirect nào trỏ tới route này ở bất kỳ đâu khác trong codebase — chỉ
  truy cập được nếu gõ thẳng URL.
- File vẫn **import đúng các hàm service-role hiện tại** (`saveLotTransaction`,
  `deleteLotTransaction`, `dedupeLotsByMaLo`, `normalizeLotStatus` từ `product/actions.ts`/
  `product/shared.ts`) — nghĩa là các guard tầng backend mới (kể cả "Khóa ca sản xuất" mục 4.4b)
  **vẫn áp dụng đúng** nếu ai đó thao tác qua trang này, vì guard nằm trong chính các hàm dùng
  chung. Rủi ro còn lại chỉ nằm ở tầng UI/business-rule cũ kỹ của chính trang (thiếu mọi cải tiến
  nghiệp vụ 6+ tuần qua) và việc thiếu permission guard (bất kỳ tài khoản đăng nhập hợp lệ nào,
  không phân biệt quyền `product.view`/`product.edit`, đều dùng được trang này nếu biết URL).

### Kết luận

Đây là code mồ côi/bản backup cá nhân bị bỏ quên, **không phải tính năng đang dùng** — không có
route nào trong app dẫn tới nó, và nó đã tụt hậu quá xa so với module thật để còn an toàn nếu
dùng nhầm (thiếu mọi fix toàn vẹn dữ liệu quan trọng). Rủi ro thực tế thấp (không ai vô tình bấm
vào được) nhưng không phải zero (ai đó nhớ/đoán được URL vẫn thao tác được, bỏ qua toàn bộ
permission gate).

### Kế hoạch xử lý — CHƯA LÀM, cần làm ở phiên sau

1. **Hỏi trực tiếp người dùng trước khi xóa bất cứ gì** — xác nhận đây có đúng là bản backup cá
   nhân bỏ quên hay có mục đích cố ý nào khác (vd sandbox test riêng) mà rule file này chưa biết.
2. Nếu xác nhận không cần giữ:
   - Xóa hẳn thư mục `src/app/dashboard/product-draft/`.
   - Xóa dòng `revalidatePath("/dashboard/product-draft")` trong `revalidateLotScreens()`
     (`product/actions.ts`) — dead reference, không còn ý nghĩa gì sau khi xóa route.
   - Chạy `npx tsc --noEmit`, `npx eslint`, `npm run build` xác nhận sạch — đã verify trước
     (mục 4.4b) rằng đây là 2 điểm chạm DUY NHẤT trong toàn bộ codebase, nên rủi ro breaking rất
     thấp.
3. Nếu người dùng muốn giữ lại (vd làm sandbox test an toàn tách biệt): tối thiểu phải thêm đúng
   permission guard chuẩn (`hydrateActiveSession()` + `hasPermission(user, "product.view")`,
   theo đúng Pattern A đã mô tả ở `.claude/rules/12-settings-permissions.md`) trước khi coi là
   an toàn để tồn tại tiếp — và ghi rõ mục đích tồn tại của nó vào rule file này để không bị hiểu
   nhầm là mồ côi ở các phiên sau.

## 4.5. Sang kiện / Thay bọc (Atomic RPC — 2026-06-19)

Kể từ migration `20260619_sk_atomic_rpc.sql`, **toàn bộ thao tác Sang kiện / Thay bọc phải gọi RPC `perform_sang_kien_thay_boc`** — không dùng lại 3 bước DB riêng biệt.

### Quy tắc bắt buộc

- `handleSkSave()` trong `product/page.tsx` gọi `supabase.rpc("perform_sang_kien_thay_boc", ...)`.
- RPC nhận `p_factory_id`, `p_loai` ("Sang kiện" | "Thay bọc"), `p_lots` (JSONB array), `p_history_payload` (JSONB).
- RPC tự thực thi trong 1 transaction: `FOR UPDATE` lock từng lô → validate → UPDATE lô gốc → INSERT lô tồn dư (nếu split) → INSERT `sk_history`.
- **Không được tách ra 3 bước riêng** — nếu tách, mất tính atomic: lô gốc bị cắt nhưng lô tồn dư chưa tạo khi lỗi xảy ra giữa chừng.

### Lô tồn dư khi split

- `suffix = lot.suffix + "r"`, `ma_lo = buildMaLo(num, suffix+"r", year)`.
- INSERT dùng `ON CONFLICT (factory_id, ma_lo) DO NOTHING` — **không DO UPDATE** để bảo vệ lô tồn dư đã có lịch sử xuất hàng riêng.
- Client tính sẵn `has_residual`, `residual_ma_lo`, `res_kien_a/b/c/d`, `res_tong_banh`, `res_tong_kg` rồi truyền vào `p_lots`.

### Payload client

```typescript
// Mỗi phần tử trong lotsPayload
{
  lot_id, new_kien_a, new_kien_b, new_kien_c, new_kien_d,
  new_tong_banh, new_tong_kg,
  new_boc,     // string | null (chỉ Thay bọc)
  new_pallet,  // string[] | null (chỉ Sang kiện)
  has_residual,
  // nếu has_residual:
  residual_ma_lo, res_kien_a, res_kien_b, res_kien_c, res_kien_d,
  res_tong_banh, res_tong_kg,
}
```

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

### Nhãn in (redesign 2026-07-09, theo mẫu `cung_cap_dl/Nhãn dán pallet.png`)

A4 portrait, **cố định 4 nhãn/trang** (lưới 2×2, khác lưới nhỏ nhiều-nhãn/trang của QR ngăn), mỗi nhãn gồm 4 khối ngăn cách bằng đường kẻ đứt + 1 footer viền liền:

1. Logo công ty (`public/logo-phk-moi.png`) + tên công ty 2 dòng.
2. QR (trỏ `/product-label?f=...&lo=...&kien=...`) + mã ngăn nguồn gốc của đúng kiện đó bên dưới QR | CSR/mã lô rút gọn không năm/"Kiện {X}" (to đậm, cột phải).
3. "Bành {loại_bành} kg" + "Bọc {tên đầy đủ}".
4. "Ngày SX:" + "Ca SX:" — để trống, ca trực tự viết tay khi dán nhãn lên pallet.
5. Footer viền liền: "Nhà máy chế biến {tên}" (hiện đang hard-code "PHK", **chưa có quyết định cách rút gọn động cho nhà máy khác** — xem `ProductLabelPdfOptions.footerText` trong `product-label-pdf.ts` để tuỳ biến).

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

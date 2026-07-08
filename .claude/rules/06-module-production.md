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
- Nếu ngăn đang là `Đang sản xuất` và tỷ lệ nằm trong `100% - 110%`, admin có thể chuyển tay sang `Đã sản xuất`.
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

### Cập nhật phiên 2 (2026-07-07) — fix bug thật sau test tay + redesign nhãn

Sau khi test tay lần đầu, người dùng báo 8 vấn đề. Đã fix hết ở tầng code (chưa test tay lại):

1. **Bug "Đề xuất 0 lô" rỗng + nút "In lại" không phản hồi** — nguyên nhân gốc: `getExistingRealKg`/`getExistingPredictedKg` không tính KL "có chủ" của kiện dở dang MỘT PHẦN thuộc lô thật "Dở dang" khác (`reservedKg`) — chỉ tính đúng 1 lần tại thời điểm "bridge" (`findRealContinuationForSeries`) rồi bị bỏ quên ở các lần gọi RPC sau, khiến ngăn còn "dung lượng ảo" (thực ra đã hết) nhưng vẫn hiện trong danh sách chọn.
   - Hàm mới `getReservedKgForPartialKien(factoryId)` quét **tất cả** lô "Dở dang" của nhà máy (không giới hạn 1 series), tính lại reservedKg **mỗi lần gọi**, dùng thống nhất trong `loadPredictAvailableNgans`, `previewLotPrediction`, `createLotPredictionBatch`, và fill% (mục 5 bên dưới). `findRealContinuationForSeries` chỉ còn giữ vai trò xác định `unassignableLetters/openLetters` để bridge, không còn tính `reservedKgByNgan` (tách 2 trách nhiệm).
   - `createLotPredictionBatchMulti`: sau vòng lặp, nếu **không có ngăn nào** tạo được dù chỉ 1 dòng (không lô đầy đủ, không leftover, không nối tiếp carry-over — `createdIds.length===0 && !carryContinued`), tự động **xóa** các đợt rỗng vừa tạo (`cleanupEmptyBatches`, không cần `isAdmin` vì chỉ dọn dẹp chính request vừa tạo ra) và trả về lỗi rõ ràng thay vì "thành công" với 0 lô.
   - `canCreate`/`outOfCapacity` ở `page.tsx` giờ gate theo **`availableKg < kienWeightKg`** (không đủ cho dù 1 kiện), **không phải** `suggestedLotCount<=0` (không đủ cho 1 LÔ đầy đủ) — vì RPC vẫn hợp lệ tạo lô lẻ 1-3 kiện khi còn giữa 1-4 kienWeight; gate sai theo lô đầy đủ sẽ chặn nhầm case hợp lệ này.
   - `handlePrintAfterCreate`/`handleReprintBatch`: khi `items.length===0`, hiện banner lỗi rõ ràng thay vì im lặng không làm gì.
2. **Nút "Xóa" đợt dự đoán cho admin** — server action `deletePredictionBatch(factoryId, batchId, isAdmin)`: chặn xóa nếu có lô đã `real_lot_id` (đã dùng thực tế); nếu có lô KHÁC đợt nhưng `last_batch_id` trỏ vào đợt này (đợt này từng "nối tiếp" 1 lô dở dang nguồn gốc từ đợt khác), tự trỏ lại `last_batch_id` về đúng `origin_batch_id` của lô đó trước khi xóa (trường này không được đọc ở đâu trong code nên an toàn). UI: nút "Xóa đợt" (đỏ, icon `Trash2`) trong panel mở rộng của mỗi đợt lịch sử, chỉ admin thấy, có modal xác nhận.
3. **Logo tròn hơn** — logo gốc `logo-phk-moi.png` là ảnh dọc 631×809 (vòng tròn + chữ bên dưới); ép cứng vào ô vuông `logoSize×logoSize` làm vòng tròn bị bóp méo thành bầu dục. Đã crop bằng `sharp` thành `public/logo-phk-icon.png` (631×631 vuông, chỉ giữ vòng tròn) và đổi `LOGO_PATH` trong `product-label-pdf.ts` sang file này. Không đụng `logo-phk-moi.png` gốc (vẫn dùng ở `export/print`, trang chủ — nơi đó dùng `<img>` CSS, không bị lỗi này).
4. **Tên công ty (header) + tên nhà máy (footer) +10% font**: `7.5pt → 8.25pt` (company), `8.5pt → 9.35pt` (footer). Line-height company cũng tăng tương ứng (3.2mm → 3.5mm) để không đè chữ.
5. **Tỷ lệ lấp đầy ngăn dưới mã ngăn của mỗi kiện** — `ProductLabelItem` thêm field `nganFillPercent?: number`; hàm mới `loadNganLabelInfoWithFill(factoryId, ids)` (thay `loadNgansByIds` — đã xóa hẳn vì không còn nơi nào dùng) tính `(realKg + predictedKg + reservedKg) / tongKho * 100` — **có tính cả `reservedKg`** (phần kiện dở dang một phần "có chủ" — đúng yêu cầu "code đã bỏ qua" trước đây). Hiển thị dạng `"Đầy 87%"` ngay dưới mã ngăn, màu theo ngưỡng (emerald ≥100%, amber ≥80%, slate còn lại).
6. **CSR/số lô/số kiện +50% font + đậm**: `15pt → 22.5pt` (đã đậm sẵn từ trước), `rightLineHeight` tăng tương ứng `7mm → 10.5mm`. Đồng thời tăng `midBlockHeight` từ `0.42×cellHeight` lên `0.46×cellHeight` để đủ chỗ (bù lại giảm `blankBlockHeight` từ `0.16` xuống `0.14`).
7. **Đường kẻ Ngày SX/Ca SX đổi nét đứt xám, nằm mép dưới mỗi dòng** — hàm mới `dashedGrayLine()` (màu `slate-400`, dash `[1,1]`) thay cho `doc.line()` liền đen ngay dưới baseline chữ như trước; vị trí đổi sang mép dưới của từng hàng trong khối (`blankTop + rowH - 0.8` và `blankTop + blankBlockHeight - 0.8`) thay vì `label1Y - 1`/`label2Y - 1`.
8. **Hậu tố mã lô gợi ý từ DB thật** — vẫn là `<input>` tự do (không ép thành `<select>` cứng, vì đây chỉ là gợi ý mã lô dự kiến, không phải chọn từ danh mục bắt buộc) nhưng có `<datalist>` nạp từ bảng `suffixes` thật (`.eq("factory_id", fid).order("code")`, load trong bootstrap) — mirror đúng nguồn dữ liệu `product/page.tsx` đang dùng cho dropdown "Hậu tố" thật.
9. **Redesign responsive** — `predict/page.tsx` tab "Tạo dự đoán" đổi từ 1 cột `max-w-xl` cố định sang layout `lg:grid lg:grid-cols-[1.5fr_1fr]`: cột trái (chọn ngăn + CSR/bành/bọc/thảm/hậu tố) và cột phải sticky (`lg:sticky lg:top-6`, carry-over + preview + nút Tạo) — trên mobile 2 cột tự stack theo thứ tự DOM (trái trước, phải sau). Tăng `min-h-[40-46px]` cho các nút/input chính (tap target), header/tab responsive hơn (`text-xl sm:text-2xl`, nút "Quay lại" full-width trên mobile).

**Chưa test tay** — toàn bộ 9 mục trên mới qua `tsc --noEmit`/`eslint`/`npm run build` (đều sạch), chưa chạy `npm run dev` xác nhận trên trình duyệt thật. Đặc biệt cần test tay:
- Đúng kịch bản bug gốc: chọn 2 ngăn đã gần đầy (do đợt trước đã dùng gần hết dung lượng), tạo đợt mới → phải bị chặn nút Tạo (banner đỏ "không đủ dung lượng cho dù 1 kiện") thay vì tạo ra 2 dòng lịch sử rỗng.
- Trường hợp còn 1-3 kiện lẻ (không đủ 1 lô đầy đủ nhưng đủ ≥1 kiện) — nút Tạo phải VẪN bấm được, tạo ra 1 lô "dở dang" đúng số kiện đó.
- Nút "Xóa đợt" admin trên 1 đợt có lô thật/carry-over phức tạp.
- Nhãn in ra thật (kiểm tra logo tròn, font size, đường kẻ xám nét đứt, dòng "Đầy X%" đúng số).
- Layout 2 cột trên màn hình desktop thật và trên điện thoại.

### Cập nhật phiên 3 (2026-07-07, tiếp) — fix nhãn sau test tay lần 2 + mục tiêu 100-105% + % lũy kế theo kiện + đóng ngăn

Sau khi test tay bản phiên 2, người dùng báo tiếp 3 vấn đề nhãn nhỏ + 3 yêu cầu nghiệp vụ lớn hơn. Đã fix/implement hết ở tầng code (chưa test tay lại — xem cuối mục này):

**Nhãn in (thay thế mục 3/4/7 ở phiên 2 phía trên nếu có mâu thuẫn):**

- **Logo**: bản crop vuông `logo-phk-icon.png` (631×631, chỉ giữ vòng tròn) ở phiên 2 vô tình cắt mất dòng chữ viết tắt "VRG PHUOC HOA KAMPONG THOM" nằm dưới vòng tròn trong ảnh gốc. Đã xóa hẳn `public/logo-phk-icon.png`, quay lại dùng `public/logo-phk-moi.png` (đầy đủ) nhưng vẽ theo **đúng tỷ lệ khung hình gốc** (`LOGO_ASPECT = 631/809`, `logoWidth = logoHeight * LOGO_ASPECT`) thay vì ép vuông như bản rất đầu (đó là nguyên nhân bầu dục ban đầu) — vừa giữ vòng tròn không méo, vừa giữ nguyên dòng chữ viết tắt (dù nhỏ). `headerHeight` tăng từ `0.16×cellHeight` lên `0.185×cellHeight` để có thêm chỗ; `midBlockHeight` bù giảm từ `0.46` xuống `0.445`.
- **Font tên công ty +20% cộng dồn** (không phải tính lại từ gốc): `8.25pt → 9.9pt` (tổng +32% so với 7.5pt gốc), line-height `3.5mm → 4.2mm`.
- **Đường kẻ Ca SX dịch lên 2mm**: `blankTop + blankBlockHeight - 0.8` → `blankTop + blankBlockHeight - 0.8 - 2`, chỉ dòng Ca SX, dòng Ngày SX giữ nguyên vị trí.

**Mục tiêu lấp đầy 100-105% (thay auto-max 110%) + điều chỉnh tay kiện lẻ cuối — chỉ khi chọn đúng 1 ngăn:**

- Client tính mặc định `TARGET_FILL_RATIO = 1.02` (giữa khoảng 100-105%): `targetFullLots`/`targetTrailingKien` (0-3) suy từ `preview.availableKg`/`lotWeightKg`/`kienWeightKg` đã có sẵn, không gọi thêm server — set làm giá trị mặc định của `requestedLotCount`/`trailingKienCount` (state mới) mỗi khi effect tính `preview` chạy lại (đổi ngăn/CSR/bành). Chỉ áp dụng khi `selectedNgans.length === 1`; multi-ngăn giữ `""`/tự động tối đa 110%/ngăn như cũ, không đổi.
- UI: stepper "Kiện lẻ cuối (0-3)" cạnh input "Số lô muốn in", hiện live "Tỷ lệ ngăn sau khi tạo: ~X%" tính hoàn toàn client-side (`liveCalc` trong `page.tsx`, không round-trip server). Guard: nếu người dùng tự chỉnh về `0 lô đầy đủ + 0 kiện lẻ`, chặn nút Tạo với message rõ ràng (`singleNganZeroZero`) thay vì rơi vào lỗi "hết dung lượng" chung chung.
- Backend: `CreateLotPredictionBatchInput` thêm `trailingKienCount: number | null` (null = auto-max, dùng cho multi-ngăn) → RPC nhận thêm `p_requested_trailing_kien INTEGER DEFAULT NULL`.
- **SQL quan trọng**: khối "đuôi lẻ" (leftover) của `create_lot_prediction_batch` trước đây chỉ chạy khi `v_n = v_n_max` (đã dùng hết mức 110%). Vì mặc định mới nhắm 102% khiến `v_n` hầu như luôn NHỎ HƠN `v_n_max`, đã sửa gate thành `IF v_n = v_n_max OR p_requested_trailing_kien IS NOT NULL THEN` — nếu không sửa, khối leftover (cả tự động lẫn override thủ công) sẽ bị bỏ qua hoàn toàn. Thêm `LEAST(FLOOR(...), 3)` vì invariant "leftover luôn < 1 lô" chỉ đúng khi `v_n = v_n_max`. Override thủ công (`p_requested_trailing_kien`) chỉ được **giảm** so với mức tối đa an toàn vừa tính (không bao giờ vượt trần 110%/`v_cap_kg`). Không đụng nhánh `v_continue` (nối tiếp lô dở dang/carry-over — xử lý kiện có danh tính cố định, độc lập với khối leftover).

**% lũy kế đúng theo từng kiện trên nhãn (thay flat % cào bằng ở phiên 2) — theo mẫu `cung_cap_dl/goi_y.pdf`:**

- File mẫu cho thấy mỗi kiện dự kiến phải hiện tỷ lệ **lũy kế tại đúng vị trí của nó** trong chuỗi (kiện đầu dự kiến % thấp nhất, kiện cuối % cao nhất) — không phải 1 số tổng cào bằng cho mọi kiện như `loadNganLabelInfoWithFill` (đã **xóa hẳn**, không còn call site nào dùng).
- `getExistingPredictedKg(factoryId, nganId, excludeIds?)` generalize thêm tham số thứ 3 (mặc định `[]`, cần thêm `id` vào `.select()`) — 2 call site cũ (`loadPredictAvailableNgans`, `previewLotPrediction`) không đổi vì optional. `getNganFillPct` (dùng trong `updatePredictionLot`) refactor gọn lại để dùng chung hàm này thay vì query trùng lặp.
- Hàm mới `loadNganCumulativeBaselines(factoryId, nganIds, excludePredictionLotIds)` tính `baselineKg` = real + predicted (LOẠI TRỪ các lô đang được in trong chính đợt này) + reservedKg — điểm bắt đầu để cộng dồn.
- `buildLabelItemsFromLots` (`page.tsx`): group theo `nganId`, sort mỗi nhóm theo `(num asc, KIEN_LETTERS.indexOf(kien) asc)`, cộng dồn `cumulativeKg` từ baseline, mỗi kiện set `nganFillPercent = cumulativeKg/tongKho*100` (giữ `undefined` nếu không có baseline — không mặc định `0`, tránh in nhầm "Đầy 0%"). `handlePrintAfterCreate`/`handleReprintBatch` dùng chung hàm này nên tự động nhất quán.

**Đánh dấu ngăn "đã dự kiến xong" (checkbox mặc định tick) + mở lại:**

- Nghiệp vụ xác nhận: checkbox trong form tạo, **mặc định tick sẵn**. Lý do cần cờ riêng (không chỉ dựa vào capacity còn lại): mục tiêu mặc định chỉ 100-105% (không phải 110%) nên luôn còn dư ~5-10% nếu chỉ dựa vào capacity thô — nếu không có cờ đóng riêng, ngăn sẽ tiếp tục bị gợi ý dù người dùng đã coi là "xong".
- Schema: `lot_prediction_batches.closes_ngan BOOLEAN NOT NULL DEFAULT false` — batch nào của 1 ngăn có cờ này thì ngăn đó bị loại khỏi `loadPredictAvailableNgans`, bất kể còn dư bao nhiêu. RPC thêm `p_closes_ngan BOOLEAN DEFAULT false`, ghi vào INSERT.
- Backend mới: `loadClosedNgans(factoryId)` (danh sách ngăn đang đóng), `reopenNganPrediction(factoryId, nganId)` (hạ `closes_ngan=false`, không cần `isAdmin` — không phá hủy dữ liệu). `CreateLotPredictionBatchInput` thêm `closesNgan: boolean`, áp dụng cho **mọi** ngăn trong `orderedNganIds` khi tạo nhiều ngăn cùng lúc (độc lập với giới hạn 1-ngăn của mục tiêu 100-105%).
- UI: checkbox trong form Tạo dự đoán; panel "Ngăn đã đóng dự kiến" ở đầu tab Lịch sử (chip mã ngăn + nút "Mở lại"), load qua `loadClosed` cùng lúc với `loadNgans`/`loadHistory`.

**Xác nhận không cần viết lại logic TH1/TH2** (đối chiếu yêu cầu "so sánh MAX(lots.num) vs MAX(lot_prediction_lots.num)"): `findRealContinuationForSeries` (tìm lô `trang_thai='Dở dang'` mới nhất, chưa bridge) + nhánh `v_continue` của RPC đã đúng là TH1 (số lô thật lớn hơn); khi không có lô Dở dang cần bridge, RPC tự rơi vào fallback `GREATEST(MAX(lots.num), MAX(lot_prediction_lots.num không tính abandoned))+1` — đúng là TH2 (không có logic phần thừa kiện thực). Không sửa 2 nhánh này, chỉ đảm bảo khối leftover (mục tiêu 100-105%) không đụng vào `v_continue`.

### Cập nhật phiên 4 (2026-07-07, tiếp) — fix 2 bug modal "Sửa lô" phát hiện khi test tay lần 3

Test tay bản phiên 3 phát hiện modal "Sửa lô" ở tab Lịch sử hiển thị SAI: cả 4 kiện đều hiện "-- Chưa gán --" dù lô đã có ngăn thật (ví dụ lô đã in nhãn thành công). Điều tra ra **2 bug**, cả 2 đã fix:

1. **Dropdown hiển thị sai "-- Chưa gán --" cho kiện đã có ngăn**: `<select>` trong modal sửa lấy option từ state `ngans` — vốn là danh sách CHỈ dành cho chọn ngăn MỚI (`loadPredictAvailableNgans`, đã lọc bỏ ngăn đóng dự kiến/hết dung lượng). Ngăn đã được gán cho 1 lô thường CHÍNH LÀ loại ngăn đã đóng/gần đầy này (nhất là từ phiên 3, checkbox "đóng ngăn" mặc định tick khiến ngăn biến mất khỏi `ngans` ngay sau khi tạo) — nên `<select value={uuid_thật}>` không tìm thấy option khớp, trình duyệt hiển thị option đầu tiên ("-- Chưa gán --") dù giá trị thật vẫn đúng trong state.
   - Fix: `openEditLot` (giờ là async) tính các `ngan_id` đang được gán cho lô, ngăn nào KHÔNG có trong `ngans` thì gọi hàm mới `loadNgansByIdsRaw(ids)` (không lọc trạng thái/dung lượng/đóng — chỉ tra thông tin hiển thị) để bổ sung vào state riêng `editNganOptions`, dùng cho dropdown thay vì `ngans` trực tiếp. Option của ngăn đã đóng/hết dung lượng có thêm hậu tố "(đã đóng/hết dung lượng)" để phân biệt.
2. **Không thể thực sự bỏ gán 1 kiện (chọn "-- Chưa gán --" rồi Lưu không có tác dụng)**: `handleSaveEdit` cũ có điều kiện `if (value && value !== original)` — khi user chọn "-- Chưa gán --" thì `value = ""`, là falsy, nên KHÔNG BAO GIỜ được đưa vào payload gửi lên server, dù đã đổi so với `original`.
   - Fix: đổi điều kiện thành `if (value !== original) assignments[key] = value === "" ? null : value` — gửi `null` thật xuống DB khi bỏ gán. `UpdatePredictionLotInput.kienAssignments` đổi kiểu từ `Partial<Record<KienKey, string>>` sang `Partial<Record<KienKey, string | null>>`; `updatePredictionLot` không cần đổi gì thêm (payload spread + Supabase update đã tự xử lý đúng `null`).

**Tự động đồng bộ `carry_over_status` khi sửa kiện (đã xác nhận nghiệp vụ, đã cài đặt)**: `updatePredictionLot` giờ select thêm `kien_a-d_ngan_id`, `unassignable_kien`, `carry_over_status` của lô hiện tại, merge với các thay đổi trong `input.kienAssignments`, rồi tự tính lại `carry_over_status` — thiếu ít nhất 1 kiện (và kiện đó không nằm trong `unassignable_kien`, tức không phải kiện đã có thật ngoài đời qua bridge) → `'pending'`; đủ cả 4 (kể cả tính unassignable) → `'none'`. Chỉ áp dụng khi `real_lot_id IS NULL` (lô chưa thực sự dùng). Nhờ đó, ví dụ bỏ gán kiện D của 1 lô đầy đủ (đưa ngăn từ 102% xuống 100,1%) sẽ tự chuyển lô đó sang `'pending'`, và lần tạo dự đoán kế tiếp cùng CSR/bành/năm sẽ được `findPendingCarryLot` gợi ý "Tiếp tục lô dở dang" đúng lô đó — nếu sau đó gán lại đủ 4 kiện, tự chuyển về `'none'`.

**Chưa test tay lại** — cả 2 fix bug modal + cơ chế tự động pending mới qua `tsc --noEmit`/`eslint`/`npm run build` (đều sạch). Cần test tay: sửa lô bỏ gán 1 kiện → mở lại modal Sửa xác nhận không còn hiện "-- Chưa gán --" sai; tạo dự đoán mới cùng series cho ngăn khác → xác nhận banner "Tiếp tục lô dở dang" xuất hiện đúng lô vừa sửa; xác nhận gán lại đủ 4 kiện thì lô không còn được gợi ý nữa.

**Chưa test tay** — toàn bộ các mục trên mới qua `tsc --noEmit`/`eslint`/`npm run build` (đều sạch), chưa chạy `npm run dev` xác nhận trên trình duyệt thật. Đặc biệt cần test tay:
- Logo: xuất PDF, xác nhận vòng tròn không méo VÀ dòng chữ viết tắt vẫn hiện (dù nhỏ); font tên công ty rõ ràng to hơn; đường kẻ Ca SX dịch đúng ~2mm.
- Chọn đúng 1 ngăn: khối xanh lá hiện tỷ lệ ước tính quanh 100-105% mặc định; tăng/giảm stepper kiện lẻ, % preview đổi live, không vượt 110%; thử chỉnh về 0/0 → nút Tạo bị chặn đúng message.
- Tạo 1 đợt với checkbox mặc định tick → ngăn biến mất khỏi danh sách chọn dù còn dư kg; vào Lịch sử thấy ngăn trong panel "Ngăn đã đóng dự kiến"; bấm "Mở lại" → ngăn xuất hiện lại.
- In nhãn nhiều kiện liên tiếp cùng 1 ngăn — % trên từng kiện TĂNG DẦN đúng thứ tự lô/kiện (không còn 1 số cào bằng), khớp `cung_cap_dl/goi_y.pdf`.
- Test case TH1 (có lô Dở dang thật) và TH2 (ngăn mới hoàn toàn) sau khi sửa khối leftover, xác nhận cả 2 nhánh vẫn đúng.

### Cập nhật phiên 5 (2026-07-08) — nhãn lớn: font to hơn + thêm dòng Giờ SX; thêm nhãn QR nhỏ 16/trang

Yêu cầu người dùng: tăng font CSR/Kiện/Số lô +10% (giữ đậm), thêm dòng "Giờ SX:" dưới "Ngày SX:" trong khối ghi tay (nay 3 dòng thay vì 2, nên khối này phải cao hơn khối Bành/Bọc 2 dòng), và thêm hẳn 1 kiểu nhãn mới chỉ có QR — theo mẫu `cung_cap_dl/nhãn nhỏ.png` — in 4×4 = 16 nhãn/trang A4 đứng.

1. **Nhãn lớn** (`renderLabelCell` trong `product-label-pdf.ts`):
   - CSR/Số lô/Kiện: `22.5pt → 24.75pt` (cộng dồn +10%), `rightLineHeight` `10.5mm → 11.55mm`, vẫn `bold`.
   - Khối 4 (ghi tay) thêm dòng **"Giờ SX:"** ngay giữa "Ngày SX:" và "Ca SX:" (thứ tự: Ngày SX → Giờ SX → Ca SX), mỗi dòng có đường kẻ nét đứt xám riêng để viết tay.
   - Rebalance tỷ lệ chiều cao để nhường chỗ, **giữ nguyên footer** (vẫn ~0.07×cellHeight): header `0.185→0.16`, mid (QR/CSR) `0.445→0.42`, info (Bành/Bọc) `0.16→0.15`, blank (Ngày/Giờ/Ca SX) `0.14→0.20` — 0.20 > 0.15 nên khối ghi tay giờ cao hơn khối Bành/Bọc như yêu cầu.
2. **Nhãn nhỏ mới** — hàm `downloadProductLabelSmallQrPdf(items)` trong `product-label-pdf.ts`:
   - Lưới **cố định 4 cột × 4 hàng = 16 nhãn/trang A4 đứng** (không auto-tính theo kích thước QR như `downloadStorageBulkQrPdf` của module ngăn lưu — cố ý cố định 4×4 theo đúng yêu cầu).
   - Mỗi nhãn: khung nét đứt (đường cắt) → QR (chiếm gần hết bề rộng ô) → mã ngăn nguồn gốc (`nganMa`, đậm, wrap tối đa 2 dòng) → "Lắp đầy: X%" (canh giữa) → "Lô: {mã lô ngắn} {kiện}" (đậm, to, trái) — đúng bố cục mẫu `cung_cap_dl/nhãn nhỏ.png`.
   - Cũng in **2 bản/kiện** giống nhãn lớn (đồng nhất theo mục 4.6 phía trên), dùng chung `ProductLabelItem`/`buildProductLabelLookupUrl`/`buildShortLotLabel` — không cần dữ liệu gì thêm ngoài những field đã có sẵn.
3. **UI `predict/page.tsx`**: nút "In nhãn QR" duy nhất trước đây tách thành 2 nút **"In nhãn QR nhỏ"** (gọi nhãn mới) và **"In nhãn QR lớn"** (gọi nhãn cũ) — áp dụng ở cả màn hình "Đã tạo dự đoán thành công" (`handlePrintAfterCreate(size)`) lẫn nút in lại trong tab Lịch sử (`handleReprintBatch(batchId, size)`, đổi tên nút thành "In lại nhãn nhỏ" / "In lại nhãn lớn").
4. Không đổi bất kỳ logic nghiệp vụ dự đoán/carry-over/reserved-kg nào — thuần túy thay đổi trình bày PDF + thêm 1 hàm in mới.

Ban đầu (`npx tsc --noEmit`/`npx eslint` sạch) chưa test tay — 2 vòng test tay sau đó trên `npm run dev` phát hiện các vấn đề đã fix lần lượt bên dưới.

**Fix vòng 1 (cùng ngày 2026-07-08)** — phản hồi sau khi mở `npm run dev` lần đầu:

- **Nhãn nhỏ**: dòng "Lô: {mã} {kiện}" đổi từ canh trái sang **canh giữa**, font `13pt → 14.3pt` (+10%, vẫn đậm) — thêm `splitTextToSize` wrap an toàn tối đa khi text vượt bề rộng ô (hiếm gặp, chỉ để phòng hờ số lô dài bất thường).
- **Nhãn lớn**: đường kẻ nét đứt của dòng "Ca SX:" dịch lên thêm 2mm so với mép dưới hàng mặc định (chỉ dòng Ca SX, 2 dòng Ngày SX/Giờ SX ở trên giữ nguyên vị trí).

**Fix vòng 2 (cùng ngày 2026-07-08, tiếp)** — người dùng test lại, báo dòng mã ngăn ("mã lô" theo cách gọi của người dùng) và dòng "Lắp đầy %" ("tỷ lệ") vẫn chưa canh giữa, cùng yêu cầu tăng cỡ chữ cả 3 dòng (mã ngăn, tỷ lệ, số lô) thêm 10% nữa, và chỉ dòng mã ngăn giữ in đậm:

- Dòng mã ngăn (dưới QR): trái → **canh giữa**; font `7.5pt → 8.25pt` (+10%); vẫn `bold` — là dòng DUY NHẤT còn in đậm trong nhãn nhỏ.
- Dòng "Lắp đầy X%": vẫn canh giữa (đã đúng từ trước, chỉ tăng cỡ) — font `7.5pt → 8.25pt` (+10%); giữ chữ thường.
- Dòng "Lô: {mã} {kiện}" (số lô): vẫn canh giữa (giữ từ fix vòng 1) — font `14.3pt → 15.73pt` (+10% cộng dồn, tổng +21% so với gốc 13pt); **đổi từ đậm sang chữ thường** theo yêu cầu "riêng mã lô in đậm" (chỉ dòng mã ngăn đậm, 2 dòng còn lại không đậm).
- `textReserveMm` (khoảng dành cho text dưới QR) tăng `17mm → 20mm` để có đủ chỗ cho cỡ chữ lớn hơn — không ảnh hưởng `qrSize` vì QR vẫn đang bị giới hạn bởi bề rộng ô, không phải chiều cao.

`tsc --noEmit`/`eslint` sạch sau cả 2 vòng fix. **Vẫn cần test tay lại lần nữa** để xác nhận đúng ý — đặc biệt kiểm tra nhãn nhỏ không bị tràn/đè chữ khi mã ngăn dài phải wrap 2 dòng.

**Fix vòng 3 (cùng ngày 2026-07-08, tiếp)** — người dùng test lại nhãn lớn (chụp riêng khối 3 "Bành/Bọc" + khối 4 "Ngày/Giờ/Ca SX") và nhãn nhỏ, báo 4 vấn đề:

- **Nhãn lớn — khối 3 (Bành/Bọc)**: chữ "Bọc" bị lặp 2 lần (`Bọc Bọc nhãn 0,04 VRG CSR10`) — nguyên nhân: `item.boc` trong DB đã tự có sẵn tiền tố "Bọc" (vd `"Bọc nhãn 0,04 VRG CSR10"`, xem `.claude/rules/11-factory-config.md`), nhưng code lại ghép cứng thêm `"Bọc "` phía trước. Fix bằng hàm mới `bocDisplayLine(boc)` — chỉ tự thêm tiền tố "Bọc " khi giá trị **chưa có sẵn** tiền tố đó (thay hàm `shortBoc` cũ, đã xóa). Đồng thời yêu cầu "cân đối ... nằm giữa khung": đổi từ 2 mốc tỷ lệ cố định `infoBlockHeight * 0.42/0.85` (lệch nhau, không đối xứng) sang kỹ thuật **căn giữa cả nhóm 2 dòng theo chiều dọc** — y hệt công thức đã dùng cho cột CSR/Số lô/Kiện ở khối 2 (`(blockHeight - n×lineHeight)/2 + lineHeight×0.75`), `infoLineHeight = 6mm`.
- **Nhãn lớn — khối 4 (Ngày/Giờ/Ca SX)**: yêu cầu "3 dòng cách đều nhau" — gỡ bỏ hẳn quy tắc lệch riêng "`-2mm`" chỉ áp dụng cho dòng Ca SX (thêm ở fix vòng 1, vô tình phá vỡ tính đều nhau của 3 hàng). 2 hàng Ngày SX/Giờ SX viết lại thành mảng `blankRows` lặp qua **cùng một công thức duy nhất** (`rowTop + rowH*0.62` cho label, `rowTop + rowH - 0.8` cho đường kẻ) — vì `rowH = blankBlockHeight/3` chia đều tuyệt đối nên 3 hàng tự "nằm giữa khung" (lấp đầy toàn bộ khối, không dư khoảng trống lệch).
- **Nhãn lớn — hàng Ca SX tách 2 cột, thêm "Trực ca:"**: thay vì 1 cột full-width như 2 hàng trên, hàng thứ 3 (`caRowTop = blankTop + rowH*2`) tách làm 2 nửa bằng nhau (`caColWidth = (cellWidth - padX*2) / 2`) — cột trái "Ca SX:" (dashOffset 16mm) + cột phải "Trực ca:" (dashOffset 18mm, có 3mm gap giữa 2 cột) — cả 2 cùng baseline `caLabelY`/cùng đường kẻ `caDashY` để thẳng hàng ngang với nhau.
- **Nhãn nhỏ**: dòng "Lô: {mã} {kiện}" (số lô) — người dùng xác nhận **cũng phải in đậm**, đảo ngược quyết định "chữ thường" ở fix vòng 2 (hóa ra "riêng mã lô in đậm" ở fix vòng 2 không có nghĩa là CHỈ mã ngăn đậm — số lô vẫn cần đậm). Đổi lại `doc.setFont(..., "normal")` → `"bold")`, giữ nguyên font `15.73pt` và canh giữa. Chỉ còn dòng "Lắp đầy %" là chữ thường duy nhất trong nhãn nhỏ.

`tsc --noEmit`/`eslint` sạch sau vòng fix này. **Vẫn cần test tay lại** — đặc biệt xác nhận khối 3/4 nhãn lớn giờ nhìn cân đối, chữ "Bọc" không còn lặp, hàng Ca SX/Trực ca không bị chật/đè chữ, và nhãn nhỏ có cả mã ngăn lẫn số lô đều đậm còn tỷ lệ % vẫn chữ thường.

**Fix vòng 4 (cùng ngày 2026-07-08, tiếp)** — người dùng test lại, báo tiếp 4 vấn đề (3 thuộc nhãn PDF, 1 thuộc form `/dashboard/product/predict`):

- **Nhãn lớn — cột phải (CSR/Số lô/Kiện) tăng thêm 10%**: `24.75pt → 27.225pt` cộng dồn (tổng đã +81,5% so với gốc 15pt qua 3 đợt tăng: +50% → +10% → +10%), `rightLineHeight` `11.55mm → 12.705mm` (giữ đúng tỷ lệ `7×1.5×1.1×1.1`). Vẫn `bold`, vẫn căn giữa như cũ.
- **Nhãn lớn — QR/mã ngăn/tỷ lệ lấp đầy canh giữa vào ô chứa**: trước đây nhóm này bị neo cứng ở mép trên (`qrY = midTop + 3`), để dư khoảng trống ở đáy cột trái nếu nội dung không lấp đầy hết `midBlockHeight`. Viết lại theo đúng kỹ thuật "căn giữa cả nhóm" đã dùng cho khối 3/khối 2-cột-phải: đo trước `nganLines` (đặt font 6.5pt trước khi gọi `splitTextToSize` để đo đúng độ rộng) để biết số dòng thực tế, tính `qrContentHeight = qrSize + gapAfterQr(3.2mm) + belowQrLines×3mm`, rồi `qrY = midTop + (midBlockHeight - qrContentHeight)/2` — QR co giãn tự nhiên theo `qrColWidth` như cũ (vẫn thường bị giới hạn bởi bề rộng cột, không phải chiều cao) nhưng giờ cả nhóm nằm giữa theo chiều dọc với lề trên/dưới đối xứng.
- **Nhãn lớn — Bọc bị lặp chữ "Bọc" (tái xuất hiện trong ảnh test mới)**: đã có fix ở vòng 3 (hàm `bocDisplayLine`) — xác nhận code hiện tại đã đúng, ảnh test lần này của người dùng có thể chụp trước khi refresh lại bản build mới; không có thay đổi code thêm ở vòng này cho mục này.
- **`predict/page.tsx` — trường Loại CSR tự gợi ý mặc định**: thêm `useEffect` theo dõi thời điểm `selectedNganIds` CHUYỂN từ rỗng sang có chọn (dùng `useRef` lưu trạng thái trước đó, tránh ép lại giá trị nếu người dùng chủ động xoá về rỗng giữa chừng) — khi vừa chọn ngăn đầu tiên và `loaiCsr` đang trống, tự set `loaiCsr = csrOptions[0]` (với ngăn Mủ tạp, `getLoaiCSRByDayChuyen` trả `["CSR10","CSR20","Ngoại lệ"]` nên mặc định ra đúng "CSR10" như yêu cầu) và `loaiBanh` tương ứng.
- **`predict/page.tsx` — trường "Hậu tố mã lô" chuyển từ `<input>` tự do + `<datalist>` sang `<select>` bắt buộc**: mirror đúng pattern đã có sẵn ở `product/page.tsx` (field "Hậu tố \*") — option đầu `<option value="">Trống (không hậu tố)</option>` (đáp ứng yêu cầu "dropdown phải có trống"), các option còn lại từ `suffixOptions`. Label đổi `"Hậu tố mã lô (tuỳ chọn)"` → `"Hậu tố mã lô *"`. Bootstrap sau khi load `suffixOptions` tự `setSuffix("cs")` nếu danh mục có mã này (đáp ứng "gợi ý sẵn cs"), mirror đúng default `session.suffix = "cs"` của `product/page.tsx`. Vì là `<select>` luôn có 1 giá trị được chọn tại mọi thời điểm (kể cả `""` = "Trống"), tự thoả điều kiện "bắt buộc" mà không cần thêm validate chặn submit riêng — không có state "chưa chọn gì".

`npx tsc --noEmit`, `npx eslint` (cả `product-label-pdf.ts` lẫn `predict/page.tsx`), và `npm run build` đều sạch/pass sau vòng fix này. **Vẫn cần test tay lại trên `npm run dev`** — đặc biệt: nhãn lớn cột phải to hơn không tràn cột; nhóm QR/mã ngăn/tỷ lệ hiện nằm giữa cột trái có lề trên dưới đối xứng; chọn ngăn Mủ tạp lần đầu → Loại CSR tự nhảy "CSR10"; dropdown Hậu tố mặc định "cs" và có option "Trống".

### Phạm vi CHƯA làm (cần hoàn thiện ở phiên sau)

- **Test tay nhãn in phiên 5** (xem mục ngay trên) — ưu tiên cao vì đụng trực tiếp tới file in thực tế đưa xuống xưởng.
- **Chưa tích hợp nút "Nhập từ dự đoán" vào form tạo phiếu Thành phẩm** (`product/page.tsx`) — mới có nút "Dự đoán số lô" ở header link sang trang `/dashboard/product/predict`. Văn phòng hiện vẫn phải gõ tay `ma_lo`/CSR/bọc/bành như trước khi tạo phiếu thật; dự đoán chỉ có tác dụng in nhãn, chưa tự điền lại vào form nhập liệu thật.
- Migration `20260709_lot_predictions.sql` **chưa chạy** trên Supabase — cần chạy thủ công trong SQL Editor trước khi tính năng hoạt động (theo đúng convention toàn bộ migration trong repo). Đã sửa nhiều lần trong lúc code (thêm cột `unassignable_kien`, `closes_ngan`, thêm tham số RPC `p_requested_trailing_kien`/`p_closes_ngan`) — vì CHƯA chạy lần nào nên an toàn để sửa trực tiếp file cũ, không tạo migration nối tiếp. Chạy lại **toàn bộ** file (idempotent) kể cả nếu trước đó đã chạy 1 phần.
- Cách rút gọn tên nhà máy cho footer nhãn (khi nhà máy khác PHK) **chưa được quyết định** — hiện hard-code "Nhà máy chế biến PHK".
- Toàn bộ luồng (đơn ngăn lẫn đa ngăn, bridge kiện dở dang, lọc hết dung lượng, nhãn mới) **chưa test tay** trên dữ liệu thật.

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

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

### Trang tra cứu QR (`/product-label`) — thêm Ca sản xuất + Ngày sản xuất "Chờ nhập liệu" (2026-07-08)

Khi quét QR trên nhãn (cả nhãn nhỏ lẫn nhãn lớn), trang `ProductLabelClient` (`src/app/dashboard/product/_components/product-label-client.tsx`, dùng bởi route `/product-label`) trước đây **không hiển thị "Ca sản xuất"** và chỉ hiện "Ngày sản xuất" khi đã có dữ liệu thật (`{data.ngaySx && (...)}`) — kiện ở trạng thái dự đoán (`predicted`) hoặc dở dang chưa nhập kiện này (`partial`) thì cả 2 field này biến mất hoàn toàn khỏi UI thay vì báo rõ "chưa có dữ liệu".

- `ProductLabelLookupResult` (`src/lib/product-label.ts`) thêm field `ca: string | null` — giá trị Ca sản xuất thật (`"A"|"B"|"C"`) lấy từ đúng dòng `lot_transactions` đã ghi nhận kiện này (chỉ có giá trị khi `status === "produced"`); `predicted`/`partial`/`not_found` luôn `ca: null`.
- `resolveProductLabelLookupTarget()`: câu query `lot_transactions` (nhánh lô thật) thêm cột `ca` vào `.select(...)`, gán vào field `ca` của kết quả trả về ở nhánh `produced`.
- UI: cả 2 dòng "Ngày sản xuất" và "Ca sản xuất" giờ **luôn hiển thị** (không còn ẩn có điều kiện) trong khối thông tin — khi `status !== "produced"` (tức `predicted`/`partial`), cả 2 hiện chữ **"Chờ nhập liệu"** màu amber (`text-amber-600`) thay vì trống/ẩn; khi đã `produced`, hiện đúng ngày/ca thật (màu slate bình thường), fallback `"—"` nếu hiếm khi thiếu `ca` dù đã produced.

`tsc --noEmit`/`eslint`/`npm run build` đều sạch. **Chưa test tay** — cần quét thử QR của 1 kiện còn ở trạng thái dự đoán (phải thấy "Chờ nhập liệu" ở cả Ngày SX và Ca SX) và 1 kiện đã nhập liệu thật (phải thấy đúng ngày + đúng ca đã nhập).

### Trang tra cứu QR (`/product-label`) — thêm "Đạt hạng" + tắt cache + Loading/Error UI (2026-07-09)

- **"Đạt hạng"**: `ProductLabelLookupResult` (`src/lib/product-label.ts`) thêm field `datHang: string | null`. Hàm mới `fetchLatestDatHang(lotId)` query `qc_results` theo `lot_id`, dedupe theo `lan` lớn nhất rồi `created_at` mới nhất — mirror đúng logic `getRotHangLotCount()` trong `module-tasks.ts`. Chỉ tính khi đã có lô thật (`status === "produced"` hoặc `"partial"`, cả 2 đều có `realLotId`); `predicted`/`not_found` luôn `datHang: null`.
  - UI (`ProductLabelClient`) thêm 1 khối riêng ngay dưới lưới thông tin: `"Đạt hạng: {datHang || "Đang chờ kiểm nghiệm"}"` — nền/màu đổi theo kết quả: chưa có KN → amber; có KN và **không** kết thúc bằng `"RH"` (đạt) → emerald; kết thúc `"RH"` (rớt hạng) → đỏ. Đúng quy tắc `dat_hang` ở `.claude/rules/07-module-quality.md` (`CSR10` = đạt, `CSR10RH` = rớt hạng).
- **Tắt cache hoàn toàn** (`src/app/product-label/page.tsx`): thêm `export const dynamic = "force-dynamic"` + `export const revalidate = 0` (đã verify qua `npm run build`: route đổi từ `○ Static` sang `ƒ Dynamic`). Thêm `export const metadata` với `other: { "Cache-Control", "Pragma", "Expires" }`, đồng thời render trực tiếp 3 thẻ `<meta httpEquiv=... />` trong JSX (React 19 tự hoist vào `<head>`) — dự phòng cho WebView nhúng (Zalo/Facebook) thường chỉ đọc thẻ meta, không đọc header HTTP thật.
- **Loading UI**: `src/app/product-label/loading.tsx` (Next.js route loading boundary) + skeleton dùng chung `ProductLabelSkeletonCard` (`src/app/dashboard/product/_components/product-label-skeleton.tsx`, `animate-pulse` + `bg-slate-200`, mô phỏng đúng bố cục card thật: icon tròn + tiêu đề, lưới 2 cột, khối "Đạt hạng", khối liên kết ngăn). Vì dữ liệu thật được fetch **client-side** trong `useEffect` của `ProductLabelClient` (không phải server fetch), `loading.tsx` của Next chỉ che được lúc render Server Component ban đầu (rất nhanh) — khoảng chờ thật sự (gọi Supabase) nằm ở trạng thái `loading` nội bộ của `ProductLabelClient`, nên đã đổi trạng thái đó từ text "Đang tải..." sang dùng chung `<ProductLabelSkeletonCard />`.
- **Error UI**: `src/app/product-label/error.tsx` (Next.js error boundary, bắt buộc `"use client"`) — icon `AlertTriangle` (amber) + câu thông báo cố định tiếng Việt (không in mã lỗi/stack) + nút "Thử lại" gọi `reset()`. Trạng thái lỗi/không có dữ liệu **thật sự thường gặp nhất** (network lỗi, không tìm thấy) đã được `ProductLabelClient` tự bắt bằng `try/catch` nội bộ nên không throw lên tới `error.tsx` — nhánh `error || !data` trong `ProductLabelClient` cũng được nâng cấp cùng phong cách (icon + câu thông báo + nút "Thử lại" gọi `window.location.reload()`) để nhất quán, `error.tsx` đóng vai trò lưới an toàn cho lỗi runtime không lường trước.
- `npx tsc --noEmit`, `npx eslint` (các file đã sửa), `npm run build` đều sạch. **Chưa test tay** — cần quét QR thật trên điện thoại (đặc biệt qua Zalo/Facebook WebView) để xác nhận dữ liệu luôn mới, skeleton hiện đúng lúc camera vừa quét xong, và "Đạt hạng" hiển thị đúng cho cả 3 trường hợp (đã đạt, rớt hạng RH, chưa KN).

### Fix 2026-07-09 — Chrome tab thường cache trang cũ (ẩn danh mới hiện đúng) + bố cục "Đạt hạng"

- **Nguyên nhân cache**: thẻ `<meta http-equiv="Cache-Control">` chỉ là gợi ý cho một số WebView cũ (Zalo/Facebook), **Chrome và các trình duyệt hiện đại bỏ qua hoàn toàn meta http-equiv cho quyết định cache thật** — chỉ tuân theo response header HTTP thật. Đây là lý do tab Chrome thường (đã từng mở `/product-label` trước khi có bản sửa) tiếp tục phục vụ HTML cũ từ HTTP cache/bfcache, trong khi tab ẩn danh (không có cache cũ) luôn fetch mới nên hiển thị đúng — kể cả khi `export const dynamic = "force-dynamic"` đã bật ở tầng Next.js.
- **Fix**: thêm `headers()` trong `next.config.ts` — set thật `Cache-Control: no-store, must-revalidate` / `Pragma: no-cache` / `Expires: 0` cho route `/product-label` ở tầng response HTTP (không chỉ meta tag). Đây là lớp bắt buộc phải có; meta tag chỉ là lớp dự phòng cho WebView.
- **Lưu ý vận hành cho người dùng**: các tab Chrome đã mở `/product-label` **trước khi bản fix này được deploy** vẫn có thể còn giữ bản cache cũ trong phiên hiện tại — cần đóng tab/hard refresh (Ctrl+Shift+R) một lần sau khi deploy; các lượt quét QR mới sau đó sẽ luôn lấy dữ liệu mới mà không cần thao tác gì thêm.
- **Bố cục "Đạt hạng"**: đổi từ khối full-width riêng biệt bên dưới lưới thông tin thành 1 ô trong chính lưới `grid-cols-2` (đặt ngay sau "Ca sản xuất") — 6 ô vừa khít 3 hàng × 2 cột, "Ca sản xuất" và "Đạt hạng" nằm cùng hàng cuối, song song nhau. Màu chữ (không còn nền khối riêng): amber khi chờ KN, đỏ khi `RH` (rớt hạng), emerald khi đạt — nhất quán với 2 dòng "Ngày SX"/"Ca SX" phía trên.
- `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay** — cần deploy rồi kiểm tra lại đúng kịch bản người dùng báo cáo (tab Chrome thường đã mở trước đó vs tab ẩn danh) để xác nhận cache header mới đã khắc phục dứt điểm.

### Quét QR nhãn kiện → xác nhận sản xuất thật (2026-07-12, redesign thành "trạm quét" liên tục)

Đóng phần "Chưa tích hợp nút Nhập từ dự đoán" cho riêng luồng hiện trường: công nhân dán nhãn lên pallet, quét QR ngay trên nhãn đó → xác nhận → dữ liệu dự kiến trở thành dữ liệu thật, lặp lại liên tục tới lô cuối rồi bấm "Kết thúc ca". Giao diện song ngữ Việt/Khmer (công nhân xưởng Kampong Thom).

**Bản đầu (chỉ 1 kiện/lần, phải rời trang quay lại `/product-label` để quét tiếp) đã bị thay bằng mô hình "hub" liên tục sau khi test tay phát hiện không đúng ý** — tham khảo `cung_cap_dl/mau.png` (form nhập liệu) và `cung_cap_dl/ket thuc.png` (màn hub + log phiên + nút kết thúc ca).

- QR nhãn kiện **không đổi** — vẫn trỏ `/product-label?f=&lo=&kien=` (public, read-only, giữ nguyên `resolveProductLabelLookupTarget`). `ProductLabelClient` vẫn có nút "Xác nhận sản xuất" điều hướng sang `/dashboard/product/confirm?f=&lo=&kien=` — đây là cách vào lần đầu duy nhất từ 1 nhãn in sẵn.
- `src/app/dashboard/product/confirm/page.tsx` giờ là 1 SPA nội bộ 3 view (`view: "hub" | "scanning" | "form"`), không còn round-trip URL cho mỗi kiện:
  - **`hub`** (màn mặc định khi mở trang không có `lo` trên URL, hoặc sau khi gửi thành công 1 kiện): nút to "Quét QR" (`ScanLine` icon) mở camera; panel "Log dữ liệu đã gửi" — **danh sách phía client, chỉ tồn tại trong phiên hiện tại** (state `sessionLog`, KHÔNG query DB) — mỗi dòng: mã lô - kiện / số bành · ca · tên người gửi · giờ; "Ca bắt đầu lúc: HH:mm:ss" (`sessionStartAt` chụp 1 lần lúc bootstrap); nút đỏ "Kết thúc ca" mở modal xác nhận rồi điều hướng `/dashboard/product` — **vẫn thuần UI, không ghi DB** (giữ đúng quyết định nghiệp vụ đã chốt trước đó).
  - **`scanning`**: full-screen camera (nền đen) qua component mới `qr-scanner.tsx`, dùng thư viện **`html5-qrcode`** (mới thêm vào `package.json`) — camera sau (`facingMode: "environment"`), decode liên tục, khi ra kết quả gọi `onDecoded(text)`. Nếu chuỗi quét được không parse ra được `lo` hợp lệ (không đúng định dạng URL `/product-label?...`) hoặc `f` (factory) không khớp session hiện tại → hiện banner đỏ lỗi ngay trong màn quét, **tự mở khoá lại sau 1.5s** để tiếp tục quét (không cần thoát/vào lại) — xử lý bằng `setTimeout` reset `decodedRef` trong `qr-scanner.tsx`. Bấm nút X hoặc "Hủy quét" quay lại `hub`.
  - **`form`**: chính là form "Nhập dữ liệu sản xuất" cũ (Số lô/Kiện/Số bành stepper/Ngày SX/Giờ SX ticking mỗi giây/Ca/Bọc/Pallet/Ghi chú/nút GỬI DỮ LIỆU) — logic gọi `resolveKienForConfirm`/`confirmKienProduction` **không đổi** so với bản đầu. Khác biệt duy nhất: sau khi gửi thành công, thay vì hiện "SuccessCard" đứng yên, code **push 1 dòng vào `sessionLog` rồi tự động `setView("hub")`** kèm toast xanh nổi 2.5s "Đã gửi dữ liệu thành công" — đúng yêu cầu "gửi xong quay lại giao diện quét".
  - **`qr-scanner.tsx` bắt buộc import qua `next/dynamic({ ssr: false })`** trong `page.tsx` — `html5-qrcode` đụng trực tiếp `navigator.mediaDevices`/`document` ở thời điểm chạy, cùng loại rủi ro SSR-crash đã từng gặp với `leaflet` ở module Kho Thành phẩm (xem `.claude/rules/storage.md` mục 14) — che chắn bằng dynamic import để tránh lặp lại bug đó.
  - Header sticky dùng chung cho `hub`/`form`: hàng trên cùng là nút chuyển ngôn ngữ (`LangToggle`, "VI"/"ខ្មែរ", lưu lựa chọn vào `localStorage` qua `product_confirm_lang`); hàng dưới gồm mũi tên quay lại (chỉ ở `form`, quay về `hub` chứ không phải `router.back()`) + tiêu đề + **avatar tròn + tên người dùng đang đăng nhập + nhãn "Trực ca"** (góc phải, theo đúng yêu cầu "tên user và tên người trực ca đăng nhập").
  - "Giờ sản xuất" là đồng hồ sống định dạng **`dd/mm/yyyy hh:mm:ss`** (tự viết `formatDMYHMS`, không qua `toLocaleString` vì thứ tự có thể khác nhau tuỳ thiết bị/locale), cập nhật mỗi giây qua `setInterval`, chỉ mang tính hiển thị tham khảo — vẫn **không thêm cột DB mới** cho "giờ", giá trị thật lưu qua `lot_transactions.created_at` như quyết định ban đầu.
- **Song ngữ**: `src/app/dashboard/product/confirm/i18n.ts` — từ điển phẳng `DICT.vi`/`DICT.km` + hàm `t(lang, key, vars?)` hỗ trợ nội suy `{max}`/`{kien}`/`{maLo}`. **Bản dịch Khmer là dịch kỹ thuật cơ bản, CHƯA được người bản ngữ rà soát** — cần kiểm tra lại thuật ngữ chuyên ngành cao su (bành/bọc/ngăn/pallet...) trước khi coi là chính thức lâu dài.
- Permission `product.confirm_scan`, migration `confirmKienProduction`/`resolveKienForConfirm`/capacity-110%-check/`markLotPredictionRealized` hook — **giữ nguyên không đổi** so với bản đầu, chỉ phần UI/luồng điều hướng bị viết lại.
- Đã bỏ hẳn: `loadRecentConfirmations()` (query DB toàn công ty trong ngày) không còn được gọi từ `page.tsx` nữa — thay bằng `sessionLog` phía client theo đúng tinh thần "mô phỏng" của mockup `ket thuc.png`. Hàm này vẫn còn trong `confirm/actions.ts` (không xoá, có thể tái dùng sau nếu cần báo cáo thật từ DB) nhưng hiện là dead code từ góc nhìn UI.
- `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch (kể cả sau khi thêm dependency `html5-qrcode`). **Chưa test tay trên thiết bị thật** — cần: xin quyền camera trên điện thoại thật hoạt động đúng; quét 1 nhãn QR thật ra đúng form; gửi xong tự quay về hub và log hiện đúng dòng; quét liên tục nhiều kiện của nhiều lô khác nhau không bị kẹt; quét mã QR không phải của app (random QR khác) → hiện đúng lỗi "Mã QR không hợp lệ" và tự thử lại; đổi ngôn ngữ Khmer → toàn bộ chữ hiển thị đúng, không vỡ layout do chữ Khmer dài hơn tiếng Việt ở một số nhãn; bấm "Kết thúc ca" → modal xác nhận đúng, xác nhận xong điều hướng đúng, không phát sinh ghi DB nào.

#### Cập nhật 2026-07-12 (phiên 2) — đã code xong mục 1/2/3/5/6/8, mục 7 hoãn sang phiên sau

Theo yêu cầu người dùng, phiên này **chỉ tập trung cải thiện luồng quét QR xác nhận sản xuất + phiếu báo thành phẩm**; mục 7 (responsive mobile ở các module khác) cố ý **chưa làm**, để lại nguyên trạng cho phiên sau. Mục 4 (bug nghi vấn "đủ 4 kiện vẫn Dở dang") đã được xác minh và đóng ở phiên trước, không nhắc lại ở đây.

**Mục 1 (pallet theo kiện) — thiết kế đã chốt và code xong**: không đổi cấu trúc `lots` (vẫn 1 dòng/mã lô). Thêm 3 cột `boc TEXT`, `pallet TEXT[]`, `chi_thi TEXT` vào `lot_transactions` (migration `20260712_lot_transactions_kien_fields.sql`, **cần chạy thủ công**) — mỗi kiện xác nhận tự ghi lại lựa chọn của mình vào đúng dòng giao dịch đó. `syncLotMasterSnapshot()` (`src/app/dashboard/product/actions.ts`) dùng helper mới `lastNonNull()` để suy `lots.boc/pallet/chi_thi` từ dòng giao dịch **mới nhất có giá trị non-null** (mirror đúng cách `ca`/`ngan_id` đã được suy trước đó) — dòng nào không gửi 3 cột này (vd `product/page.tsx` nhập tay, chưa đổi) thì bị bỏ qua khi tìm giá trị mới nhất, không vô tình xoá boc/pallet/chi_thi của lô. `confirm/page.tsx` giờ **luôn** hiện 3 field Bọc/Loại pallet/Số chỉ thị ở dạng cho sửa (không còn nhánh đọc-only theo `isNewLot`), tự pre-fill từ `lookup.boc/pallet/chiThi` (tức giá trị của kiện gần nhất cùng lô) mỗi lần quét kiện mới.

**Mục 2 (banner "Quét kiện khác")**: nhánh `lookup.status === "produced"` giờ có thêm nút to "Quét kiện khác" ngay dưới `CardMessage`, gọi thẳng `setView("scanning")`.

**Mục 3 (chức danh thật)**: hàm mới `loadUserChucVu(factoryId, profileId)` (`confirm/actions.ts`) tra `maintenance_staff.chuc_vu_chinh_quyen || chuc_vu` theo `profile_id + factory_id + active=true`, mirror đúng pattern `dept-leader/route.ts`. Fallback khi `null` (chưa liên kết `profile_id` hoặc chưa khai chức vụ): **giữ nguyên nhãn "Trực ca"** (`tt("shiftLabel")`) — quyết định đã chốt với người dùng.

**Mục 5 (top-up kiện dở dang một phần)**: `ConfirmKienStatus` thêm trạng thái `"partial_kien"`. `resolveKienForConfirm()` giờ tính `existingBanh` (tổng số bành đã có của đúng kiện đó, không còn là boolean) rồi phân 3 nhánh: `existingBanh >= maxPerKien` → `"produced"` (chặn); `0 < existingBanh < maxPerKien` → `"partial_kien"` (cho nhập tiếp, kèm `existingBanh`/`remainingBanh`); `existingBanh === 0` → `"partial"` như cũ. `confirmKienProduction()` đổi race-check từ chặn tuyệt đối sang so `existingBanh + soBanh` với `maxPerKien` (tính lại server-side qua `getLoaiBanhConfig`), trả lỗi rõ ràng đúng mẫu **"Kiện {X} đã có {N} bành, lần này chỉ được nhập tối đa {M} bành."** nếu vượt. `confirm/page.tsx`: stepper "Số bành" clamp theo `stepperMax` (= `remainingBanh` khi `partial_kien`, ngược lại `maxPerKien`), banner cảnh báo amber hiển thị khi ở trạng thái này.

**Mục 6 (bố cục lại form)**: thứ tự mới trong `confirm/page.tsx` (view `"form"`): Ngày sản xuất (full) → Giờ sản xuất (full, đồng hồ sống) → thẻ emerald "Mã lô | Kiện" (2 cột) → banner cảnh báo top-up (nếu có) → "Ca sản xuất | Số chỉ thị" (2 cột) → khối "Số bành" (stepper, căn giữa, ô riêng) → Ngăn nguồn → Bọc (luôn cho sửa) → Loại pallet (luôn cho sửa) → Ghi chú (chỉ khi `isNewLot`). Logic rollover "Ngày sản xuất" (`getDefaultNgaySx()`): **05:00-23:59 → hôm nay; 00:00-04:59 → hôm nay trừ 1** (mốc giờ đã chốt với người dùng), áp dụng làm giá trị mặc định mỗi lần quét kiện mới — người dùng vẫn sửa tay được.

**Mục 8 (PDF kết thúc ca)**: hàm mới `loadShiftReportData(factoryId, userId, sinceIso, nguoiGui, chucVu)` (`confirm/actions.ts`) — **truy vấn lại DB** (`lot_transactions` theo `created_by = userId` và `created_at >= sinceIso`, không dùng `sessionLog` phía client — quyết định đã chốt để không mất dữ liệu nếu người dùng lỡ tải lại trang giữa ca), gộp theo `ma_lo` (kiện = union các chữ cái đã xác nhận trong ca, KL = tổng, "hoàn thành lúc" = giao dịch cuối cùng của lô đó trong ca). File mới `confirm/shift-report-pdf.ts` (`buildShiftReportPdf`, `shareOrDownloadShiftReportPdf`) dùng `jspdf` + `jspdf-autotable` + `ensurePdfFont`/`safeName` từ `src/lib/pdf-qr-shared.ts` — bảng chi tiết theo lô (STT/Lô số (kiện)/Loại CSR/Bọc/Pallet/Số chỉ thị/Số bành/KL/✓ Hoàn thành lúc, cột cuối tô xanh đậm có dấu ✓) + bảng "Tổng hợp theo loại CSR" bên dưới. Bố cục lấy cảm hứng từ `cung_cap_dl/mau_ptp.pdf` (đã đọc được text qua `pdfjs-dist` dù không render được ảnh do môi trường thiếu poppler) nhưng **không copy y nguyên** — tự thiết kế lại theo phong cách banner xanh + bảng `autoTable` nhất quán với `storage-pdf.ts`. `EndShiftConfirmModal` giờ gọi `handleConfirmEndShift` (async): tải dữ liệu ca → nếu rỗng thì báo `endShiftNoData` ngay trong modal (không đóng, không điều hướng) → nếu có dữ liệu thì gọi `shareOrDownloadShiftReportPdf()` (Web Share API nếu trình duyệt hỗ trợ, fallback tải file) rồi mới đóng modal + điều hướng về `/dashboard/product`.

**Mục 7 (responsive mobile 5 màn: ký phòng ban, xuất hàng, EUDR, báo cáo chất lượng, action Thành phẩm) — CHƯA làm theo yêu cầu người dùng, để nguyên cho phiên sau.** Vẫn còn thiếu đúng 4 ảnh chụp màn hình tham chiếu (`ky_phong_ban.jpg`, `eudr.jpg`, `tkcl.jpg`, `tp.jpg`) — không tồn tại trong `cung_cap_dl/` tại thời điểm ghi chú này; phiên sau cần xin người dùng gửi lại trước khi bắt tay sửa UI, không tự đoán bố cục qua mô tả suông. Xem chi tiết yêu cầu gốc (5 điểm cụ thể + chỉ thị "chủ động sửa luôn các chỗ lệch khác phát hiện được") ở lịch sử git của file này nếu cần tra lại nguyên văn.

`npx tsc --noEmit`, `npx eslint` (các file đã sửa: `product/actions.ts`, `confirm/actions.ts`, `confirm/page.tsx`, `confirm/i18n.ts`, `confirm/shift-report-pdf.ts`), và `npm run build` đều sạch. **Chưa test tay trên thiết bị thật** — cần:
- Chạy migration `20260712_lot_transactions_kien_fields.sql` trên Supabase SQL Editor trước khi test.
- Quét kiện đầu của 1 lô mới → xác nhận Bọc/Pallet/Số chỉ thị đều editable, Số chỉ thị tự gợi ý theo lô có ngày thành phẩm gần nhất.
- Quét kiện thứ 2 của 1 lô đã có kiện khác → xác nhận Bọc/Pallet/Số chỉ thị tự pre-fill đúng theo kiện gần nhất, sửa lại được, sau khi gửi thì `lots.boc/pallet/chi_thi` cập nhật đúng theo lựa chọn mới nhất.
- Quét 1 kiện đã đủ bành → xác nhận banner + nút "Quét kiện khác" hoạt động, bấm vào mở lại camera ngay.
- Quét 1 kiện đang có một phần bành (vd đã có 35/36) → xác nhận form vẫn mở, stepper chỉ cho tăng tối đa phần còn thiếu, banner cảnh báo hiện đúng số.
- Xác nhận chức danh thật hiện đúng cho tài khoản đã liên kết `maintenance_staff.profile_id`; tài khoản chưa liên kết vẫn hiện "Trực ca".
- Test "Ngày sản xuất" mặc định đúng theo mốc 05:00/00:00 ở cả 2 phía ranh giới (test tay ở giờ thật hoặc giả lập giờ hệ thống).
- Bấm "Kết thúc ca" khi ca chưa có dữ liệu → hiện đúng thông báo, không đóng modal; khi có dữ liệu → PDF sinh ra đúng, share/tải về được, mở PDF xem đúng dữ liệu (đặc biệt lô có giờ hoàn thành rơi sang ngày hôm sau).

#### Cập nhật 2026-07-12 (phiên 3) — fix race condition nghiêm trọng + redesign "Lịch sử ca" theo (Ngày SX, Ca) thay vì theo người dùng + hàng loạt yêu cầu UI/PDF

**Bug thật đã phát hiện và fix — race condition (lost update) trong `syncLotMasterSnapshot()`**: người dùng báo cột "SL thực tế ca này" (`src/app/dashboard/product/page.tsx`, bảng ngày → ca) hiện `+0 (0kg)` cho nhiều dòng "Dở dang" dù cột "Kiện (A/B/C/D)" có số thật. Điều tra bằng script Node (service role) phát hiện: 8 dòng lỗi trong ảnh chụp của người dùng đã bị chính người dùng xóa (nút "Xóa 8 dòng") trước khi tôi kịp tra — không còn dữ liệu gốc để xác nhận 100%, nhưng đối chiếu code: `tong_banh_cua_ca`/`disp_a-d` trong `contributions` (`product/page.tsx`) đọc TRỰC TIẾP từ `tx.so_banh`/`tx.kien_a-d` (nhánh có `lot_transactions`) hoặc `lot.tong_banh`/`lot.kien_a-d` (nhánh lô "mồ côi", 0 giao dịch) — quét toàn bộ 1301 `lot_transactions` hiện có xác nhận **0 dòng lệch** `so_banh` so với tổng kiện, nên bug không nằm ở tầng đọc/hiển thị mà ở tầng **ghi**: `syncLotMasterSnapshot()` (bản cũ, JS) đọc toàn bộ `lot_transactions`, tính tổng ở JS, rồi `.update()` đè lên `lots` — không có khóa nào giữa đọc và ghi. Khi 2 kiện của CÙNG 1 lô được xác nhận gần như đồng thời (rất dễ xảy ra với tính năng quét QR liên tục, có thể nhiều điện thoại quét song song), request nào tính tổng TRƯỚC (lúc giao dịch kia chưa insert xong) nhưng ghi đè SAU sẽ làm mất cập nhật của request kia — đúng lớp lỗi "read-modify-write không khóa", và người dùng xác nhận không hề thấy lỗi hiển thị lúc quét (khớp giả thuyết: mỗi request tự báo thành công đúng, chỉ có bản ghi `lots` cuối cùng bị lệch).
  - **Fix**: chuyển toàn bộ phép tính SUM + ghi `lots` thành 1 hàm Postgres atomic `sync_lot_master_snapshot(p_lot_id uuid)` (migration `20260712_sync_lot_master_snapshot_rpc.sql`, **cần chạy thủ công**), khóa dòng `lots` bằng `SELECT ... FOR UPDATE` ngay đầu hàm trước khi `SUM` — loại bỏ hoàn toàn khoảng hở đọc-tính-ghi (mirror đúng pattern atomic đã dùng cho `perform_sang_kien_thay_boc` và `create_lot_prediction_batch`). `syncLotMasterSnapshot()` phía JS (`product/actions.ts`) giờ chỉ gọi RPC rồi `SELECT` lại `lots` để trả `snapshot` cho caller — logic tính toán không còn nằm ở JS nữa. Đã bỏ hẳn helper `lastNonNull()` phía JS (không cần nữa, RPC tự xử lý bằng subquery `ORDER BY ... DESC LIMIT 1` cho từng cột `boc/pallet/chi_thi`).
  - Trigger cũ `trigger_update_lot_master` (từ `20260515_refactor_lots_master_detail.sql`, đã vá literal dấu ở `20260708_fix_lot_status_trigger.sql`) **vẫn còn tồn tại**, vẫn tự chạy trên mọi INSERT/UPDATE/DELETE của `lot_transactions` — không tắt/xóa trigger này (rủi ro thấp: vì `saveLotTransaction()` luôn gọi `sync_lot_master_snapshot()` RPC **ngay sau** insert trong cùng request, RPC này khóa dòng + tính lại từ đầu nên luôn là "tiếng nói cuối cùng" đè lên bất kỳ gì trigger đã ghi trước đó cho request đó; xem giải thích đầy đủ về tính đúng đắn trong lịch sử phiên nếu cần đối chiếu lại).

**Thay đổi kiến trúc — "Lịch sử ca" và phiếu báo cáo giờ theo (Ngày SX, Ca), KHÔNG theo người dùng/phiên đăng nhập** (đã chốt với người dùng qua 3 câu hỏi):
- `confirm/actions.ts`: xóa hẳn `loadShiftReportData(factoryId, userId, sinceIso, nguoiGui, chucVu)` bản cũ, thay bằng **`loadShiftReportData(factoryId, ngaySx, ca)`** — không lọc theo `created_by`, vì 1 ca có thể có nhiều người trực nối tiếp nhau. Hàm dùng chung `loadShiftTransactions(factoryId, ngaySx, ca)` (query `lot_transactions` theo `ngay_nhap + ca`, join `lots!inner`).
- Hàm mới `loadShiftHistory(factoryId, ngaySx, ca): ShiftHistoryEntry[]` — danh sách TỪNG giao dịch (không gộp theo lô) cho khối "Lịch sử ca" trong Hub, kèm `nguoiNhap` (resolve tên qua `profiles`) và `canDelete` (`true` khi lô liên quan vẫn `normalizeLotStatus === "Dở dang"`).
- Hàm mới `deleteShiftHistoryEntry(transactionId)` — trả lời câu hỏi "nhập sai thì sửa sao": xóa hẳn giao dịch để người dùng quét lại đúng. Re-check `trang_thai` ở SERVER (không tin `canDelete` phía client) trước khi gọi `deleteLotTransaction()` (đã có sẵn từ trước, dùng chung). Chỉ cho xóa khi lô còn "Dở dang" — chặn xóa nhầm dữ liệu đã qua Kiểm nghiệm/Xuất hàng.
- `ShiftReportData` đổi field: bỏ `nguoiGui`/`chucVu` (không còn 1 người đại diện cho cả phiếu), thêm `nganMa` (danh sách mã ngăn distinct dùng trong ca, phục vụ header PDF) và `byGroup` (tổng hợp theo **Loại CSR - Loại bành - Bọc - Pallet**, thay cho `byLoaiCsr` cũ). Mỗi `ShiftReportLotRow` thêm `loaiBanh` và `nguoiNhap` (tên người nhập giao dịch CUỐI CÙNG của lô đó trong ca — trả lời đúng yêu cầu cột "Hoàn thành lúc" dòng 2 hiện tên người nhập của đúng lô đó).
- `confirm/page.tsx`: bỏ hẳn `sessionLog`/`SessionLogEntry`/`sessionStartAt` (chỉ tồn tại trong bộ nhớ trình duyệt, mất khi tải lại trang — đúng vấn đề người dùng nêu "quét lại cùng ngày/ca thấy lịch sử"). Thay bằng state `historyNgay`/`historyCa` (mặc định `getDefaultNgaySx(new Date())` + `"A"`) + `history` (load qua `loadShiftHistory`, tự refetch khi đổi selector hoặc quay lại Hub). Sau khi gửi 1 kiện thành công, tự đặt `historyNgay/historyCa` theo đúng giá trị vừa nhập rồi quay về Hub — thấy ngay dòng vừa gửi VÀ dữ liệu người trực trước đó (nếu có) trong cùng ngày+ca.
- Khối "Lịch sử ca" trong Hub có thêm 2 ô chọn Ngày/Ca (để xem lại bất kỳ ca nào, không chỉ ca hiện tại), mỗi dòng lịch sử có nút xóa (icon thùng rác) chỉ hiện khi `canDelete`, bấm vào yêu cầu xác nhận inline (không dùng modal riêng) trước khi xóa thật.
- **Trả lời câu hỏi 2 của người dùng ("phiếu quên gửi thì lấy lại bằng cách nào")**: thêm nút **"Xem / Tạo lại phiếu PDF"** ngay trong Hub (đặt cùng chỗ với "Lịch sử ca", dùng chung selector Ngày+Ca) — gọi lại `loadShiftReportData` + `shareOrDownloadShiftReportPdf` bất kỳ lúc nào, không cần đang ở giữa ca, không phụ thuộc phiên đăng nhập nào (dữ liệu luôn nằm trong DB). Nút "Kết thúc ca" giờ cũng dùng chung `historyNgay/historyCa` làm tham số sinh phiếu (thay vì `sessionStartAt`/`userId` cũ).

**UI form nhập liệu (`confirm/page.tsx`, view `"form"`) — đổi bố cục theo yêu cầu**:
- Thứ tự mới: Ngày sản xuất (full) → Giờ sản xuất (full) → **Ca sản xuất | Số chỉ thị** (2 cột, đưa lên ngay dưới Giờ sản xuất — trước đây nằm sau thẻ Mã lô/Kiện) → thẻ gộp **Mã lô + Kiện + Số bành** → banner cảnh báo top-up (nếu `partial_kien`) → Ngăn nguồn → Bọc → Loại pallet → Ghi chú (chỉ lô mới).
- **Gộp thẻ**: thẻ emerald trước đây chỉ có Mã lô/Kiện (Số bành nằm ở khối riêng bên dưới) — giờ Số bành nằm chung 1 thẻ với Mã lô/Kiện (ngăn cách bằng đường kẻ `border-t border-white/20`), thiết kế lớn hơn nhưng cân đối (icon `Package` nhỏ cạnh nhãn "SỐ BÀNH").
- **Số bành nhập tay được**: đổi từ `<span>` tĩnh (chỉ tăng/giảm qua nút +/-) sang `<input type="number">` thật — xóa được, gõ số khác trực tiếp, vẫn giữ 2 nút +/- hai bên. Value hiển thị rỗng khi = 0 (tránh literal "0" gây rối mắt khi đang gõ dở). Vẫn clamp trong khoảng `[0, stepperMax]` (`stepperMax` = `remainingBanh` khi `partial_kien`, ngược lại `maxPerKien`).
- **Icon trước nhãn field** (thêm prop `icon?: ReactNode` vào component `Field`, dùng chung): Ngày SX → `Calendar`; Giờ SX → `Clock`; Ca SX → `Sun`; Số chỉ thị → `Hash`; Ngăn nguồn → `Warehouse` (cả 2 nhánh select lẫn hiển thị tĩnh); Bọc → `Layers`; Loại pallet → `Boxes`.

**PDF phiếu báo thành phẩm (`shift-report-pdf.ts`) — redesign toàn bộ theo yêu cầu, tham chiếu `cung_cap_dl/mau_ptp.pdf`**:
- Đổi từ `orientation: "landscape"` sang `"portrait"` (A4 dọc) — thu hẹp lại toàn bộ cột bảng chi tiết (font `7.3pt`, các cột CSR/Bọc/Pallet/Chỉ thị/Bành/KL rút gọn tên cột) để vừa khổ dọc.
- Header: dòng 1 góc trái đậm **"CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM"** (hard-code — cùng tiền lệ "Nhà máy chế biến PHK" hard-code ở nhãn kiện, chưa có cơ chế đổi theo nhà máy khác), dòng 2 ngay dưới cũng góc trái **"NHÀ MÁY CHẾ BIẾN"** (đã sửa theo bản chốt cuối — KHÔNG phải "ở giữa" như bản nháp đầu người dùng gõ nhầm, đã tự sửa theo bản làm rõ thứ 2 "dòng dưới"), tiêu đề **"PHIẾU BÁO THÀNH PHẨM NHẬP KHO"** căn giữa cỡ lớn bên dưới.
- Dòng meta: **bỏ hẳn tên trực ca**, đổi thành `Ngày: ... Ca: ... Ngăn lưu: {nganMa}` (nganMa = danh sách mã ngăn distinct dùng trong ca, join bằng ", " nếu nhiều ngăn).
- Cột **"Hoàn thành lúc"** đổi cấu trúc 2 dòng khác kiểu chữ: dòng 1 đậm màu xanh emerald `✓ dd/mm/yyyy hh:mm:ss`, dòng 2 chữ thường màu xám tên người nhập (`ShiftReportLotRow.nguoiNhap`) — kỹ thuật: chặn render mặc định của ô này qua `didParseCell` (set `cell.text = []`) rồi tự vẽ 2 dòng thủ công qua `didDrawCell` (autoTable không hỗ trợ mixed style trong 1 cell qua config thường).
- Bảng "Tổng hợp" đổi từ nhóm theo Loại CSR đơn thuần sang nhóm theo **Loại CSR - Loại bành - Bọc - Pallet** (`byGroup`), mỗi tổ hợp khác nhau ra 1 dòng riêng đúng yêu cầu "nếu nhiều loại chia nhiều dòng".

**Fix khung quét QR bị méo thành hình chữ nhật** (`qr-scanner.tsx`): nguyên nhân xác định qua đọc code — container quét cũ `className="mx-auto w-full max-w-md flex-1"` không ép `aspect-square`, nên trên điện thoại (khung `flex-1` kéo cao theo chiều dọc màn hình, rộng bị giới hạn `max-w-md`) tỷ lệ khung hiển thị của `html5-qrcode` bị lệch dù cấu hình `qrbox: {width:250,height:250}` vốn đã vuông về mặt logic. Fix: bọc `<div id={REGION_ID}>` trong 1 container `flex items-center justify-center` và tự nó dùng `aspect-square w-full max-w-md` (ép vuông thật sự bằng CSS), đồng thời truyền thêm `aspectRatio: 1` vào config `start()` của `html5-qrcode` và tăng `qrbox` lên `260x260`. **Chưa test tay trên thiết bị thật** — đây là chẩn đoán qua đọc code, cần xác nhận lại đã hết méo/dễ quét hơn.

**Chưa test tay** — toàn bộ nội dung "Cập nhật 2026-07-12 (phiên 3)" ở trên, `npx tsc --noEmit`/`npx eslint`/`npm run build` đều sạch nhưng chưa chạy `npm run dev` xác nhận trên trình duyệt/điện thoại thật. Cần đặc biệt kiểm tra:
- Migration `20260712_sync_lot_master_snapshot_rpc.sql` chạy xong → quét liên tục nhiều kiện của CÙNG 1 lô thật nhanh (mô phỏng race) → xác nhận `lots.tong_banh/kien_a-d` cuối cùng luôn khớp đúng tổng thật, không còn hiện tượng "SL thực tế ca này" = 0 sai lệch.
- Selector Ngày+Ca trong Hub load đúng lịch sử của đúng ngày/ca đã chọn, kể cả dữ liệu do người khác nhập.
- Xóa 1 dòng lịch sử (khi lô còn Dở dang) → xác nhận `lots` được tính lại đúng qua RPC; thử xóa dòng của 1 lô đã "Hoàn thành"/"Xuất hàng" (giả lập) → phải bị chặn với thông báo rõ.
- Nút "Xem/Tạo lại phiếu PDF" hoạt động độc lập với "Kết thúc ca" (không điều hướng, không đóng gì).
- PDF portrait mới không tràn cột trên khổ A4 thật, cột "Hoàn thành lúc" hiện đúng 2 dòng 2 màu, bảng tổng hợp nhóm đúng theo CSR-bành-bọc-pallet.
- Khung quét QR trên điện thoại thật không còn méo, quét nhạy hơn.

### Cập nhật 2026-07-13 (phiên 4) — 2 bug thật đã fix + redesign phiếu PDF bám sát mẫu giấy gốc + form nổi bật hơn

**Bug 1 đã fix — "Tổng hợp" phiếu ca sai khi 1 lô có nhiều pallet khác nhau giữa các kiện**: `loadShiftReportData()` (`confirm/actions.ts`) trước đây gộp giao dịch theo `ma_lo` rồi ghi đè `boc`/`pallet` của CẢ DÒNG BÁO CÁO theo giao dịch cuối cùng (last-wins) — nếu kiện A/B/C của 1 lô dùng "Sắt đế gỗ" nhưng kiện D dùng "MB5", dòng báo cáo của CẢ LÔ hiển thị sai thành "MB5", kéo theo bảng "Tổng hợp" cộng nhầm toàn bộ số bành vào nhóm MB5. Đã sửa: gộp theo khóa `(ma_lo, boc, pallet)` của ĐÚNG giao dịch — kiện có thuộc tính khác nhau trong cùng 1 lô tự tách thành các dòng báo cáo riêng, mỗi dòng đúng số liệu; bảng "Tổng hợp" phía sau (vẫn gộp theo `loai_csr, loai_banh, boc, pallet`) nhờ đó tự động đúng theo.

**Bug 2 đã fix — trang tra cứu QR `/product-label` hiện "-" cho ngăn nguồn gốc từ kiện thứ 2 trở đi**: `resolveProductLabelLookupTarget()` (`src/lib/product-label.ts`), nhánh `status: "partial"` (lô đã có ít nhất 1 kiện thật nhưng kiện đang xem chưa có giao dịch) hard-code `nganMa: null, nganTen: null` thay vì tra theo `lot.ngan_id` — vì vậy kiện ĐẦU TIÊN của 1 lô mới (đi qua nhánh "predicted", tra đúng ngăn) hiện đúng số ngăn, nhưng các kiện B/C/D quét sau (khi lô đã tồn tại, rơi vào nhánh "partial") luôn hiện "Xem chi tiết ngăn nguồn gốc: -" dù `lot.ngan_id` đã có giá trị hợp lệ. Đã sửa: nhánh "partial" giờ tự query `ngans` theo `lot.ngan_id` giống hệt nhánh "produced".

**Redesign phiếu PDF (`shift-report-pdf.ts`) bám sát 100% bố cục mẫu giấy gốc `cung_cap_dl/mau_ptp.pdf`** (không thêm nội dung ngoài mẫu, trừ 1 điểm nhấn được yêu cầu riêng — xem mục tích xanh bên dưới):
- Header đổi từ 2 dòng (Công ty + Nhà máy) sang **đúng 1 dòng** "NHÀ MÁY CHẾ BIẾN CAO SU PHƯỚC HÒA KAMPONG THOM" (bold, căn giữa), tiêu đề bên dưới đổi thành **"PHIẾU BÁO THÀNH PHẨM NHẬP KHO - CSR {danh sách loai_csr xuất hiện trong ca, cách nhau dấu phẩy}"** (vd "- CSR 10, 20"), tự tính từ `data.rows`.
- Khối "Ngày/Ca/Ngăn SX/Số chỉ thị" đổi từ 1 dòng text sang **bảng khung viền đen 2×2** đúng mẫu (`renderMetaBox`, tự co giãn chiều cao theo số dòng) — nhãn đổi "Ngăn lưu" → **"Ngăn SX"**, thêm mới **"Số chỉ thị"** (trước đây field `chi_thi` bị bỏ hẳn khỏi phiếu; giờ là 1 field header-level dùng chung cho cả ca, tính bằng hợp các giá trị `chi_thi` khác nhau đã ghi nhận trong ca — field mới `ShiftReportData.soChiThi`).
- Bảng chi tiết đổi từ 9 cột (STT, Lô số, CSR, Bọc, Pallet, Chỉ thị, Bành, KL, Hoàn thành lúc) xuống **đúng 7 cột theo mẫu**: Lô số | Loại CSR | Số bành | K.lượng (kg) | Bọc | Thùng chứa | Trực ca — bỏ hẳn STT và cột Chỉ thị riêng (đã chuyển lên header). "Loại CSR" hiển thị dạng `CSR{giá trị}` (vd "CSR10", mirror quy ước `CSR${sanPham}` đã dùng ở `quality-stats.ts`). "Lô số" ghép `{ma_lo} {kienLetters}` cách nhau dấu cách (không còn ngoặc đơn). Theme đổi từ header xanh emerald sang **viền đen mỏng, header trắng chữ đen đậm** (giống văn bản ISO chính thức, khớp tinh thần mẫu giấy) — chỉ còn màu xanh ở đúng huy hiệu tích (xem dưới).
- Bảng "Tổng hợp" đổi từ bảng riêng 6 cột (Loại CSR, Loại bành, Bọc, Pallet, Tổng bành, Tổng KL) sang **dùng chung đúng 7 cột/độ rộng cột với bảng chi tiết** (không có header riêng), cột "Lô số" và "Trực ca" để trống ở các dòng nhóm, dòng cuối "Tổng" đặt ở cột "Lô số" — khớp chính xác cấu trúc mẫu (2 bảng thẳng cột với nhau).
- Footer đổi từ "In lúc.../Trang X/Y" sang **đúng mã tài liệu góc dưới trái theo mẫu**: `"NMCB-QT01-F09 (03-01/08/2026) Có hiệu lực"`, có đường kẻ mỏng phía trên (mirror style `DocumentFooter` của module Bảo trì).
- **Điểm nhấn được yêu cầu riêng (không phải nội dung có trong mẫu giấy)**: cột "Trực ca" mỗi dòng có **huy hiệu tích xanh vẽ bằng vector** (`drawCheckBadge` — hình tròn xanh emerald + 2 nét trắng bo tròn tạo dấu ✓, không dùng ký tự Unicode ✓/✅ vì phụ thuộc glyph font) đặt trước dòng ngày giờ, thay cho ký tự "✓" thuần chữ trước đây.

**Form `confirm/page.tsx` — tăng cỡ chữ +10% và làm nổi bật hơn 6 trường theo yêu cầu**: `highlightFieldClass`/`highlightFieldClassAmber` (2 hằng số class dùng chung, cỡ chữ `text-[15.4px]` = 14px+10%, viền `border-2`, nền nhấn nhẹ, padding `py-3`) áp dụng cho Ngày sản xuất, Ca sản xuất, Số chỉ thị, Ngăn nguồn (cả khối hiển thị tĩnh lẫn dropdown chọn tay), Bọc, Loại pallet (khối pill bọc trong khung viền nhấn `border-emerald-200`). Các trường KHÔNG nằm trong yêu cầu (Giờ sản xuất — read-only, Ghi chú) giữ nguyên style cũ để tạo tương phản rõ với nhóm được nhấn mạnh.

`npx tsc --noEmit`, `npx eslint` (các file đã sửa: `src/lib/product-label.ts`, `confirm/actions.ts`, `confirm/shift-report-pdf.ts`, `confirm/page.tsx`), và `npm run build` đều sạch. **Chưa test tay trên thiết bị thật** — cần:
- Quét 1 lô có ≥2 kiện dùng pallet/bọc khác nhau → xác nhận phiếu PDF tách đúng thành nhiều dòng, "Tổng hợp" cộng đúng số bành theo từng pallet, không còn hiện tượng "cả lô đổi theo pallet của kiện cuối".
- Quét lần lượt các kiện A→D của 1 lô mới → xác nhận trang `/product-label` (không phải `confirm`) hiện đúng số ngăn cho MỌI kiện, không chỉ kiện đầu tiên.
- Đối chiếu bản in PDF thật với `cung_cap_dl/mau_ptp.pdf` — đặc biệt kiểm tra khung 2×2 Ngày/Ca/Ngăn SX/Số chỉ thị không tràn khi có nhiều ngăn/nhiều chỉ thị trong cùng ca, và 2 bảng (chi tiết + tổng hợp) thẳng cột với nhau.
- Kiểm tra huy hiệu tích xanh hiển thị sắc nét, không lệch dòng, không đè lên text ngày giờ khi số ký tự dài (ngày dài + giờ dài).
- Xác nhận 6 trường được nhấn mạnh trong form quét QR dễ đọc hơn rõ rệt trên điện thoại thật, không bị vỡ layout ở màn hình nhỏ.

### Cập nhật 2026-07-13 (phiên 5) — Bug thật đã xác nhận trên DB: xóa giao dịch cuối cùng của lô "Dự đoán số lô" để lại "lô ma" vĩnh viễn không xóa được

**Đã điều tra bằng script Node đọc trực tiếp DB thật** (không đoán) — xác nhận 100% nguyên nhân gốc cho đúng hiện tượng người dùng báo cáo: lô `1074cs/26` (factory `phuochoa_kt`) có `lot_transactions = []` (0 giao dịch) nhưng `lots.kien_d = 36`, `lots.tong_banh = 0`, `trang_thai = "Dở dang"` — và `lot_prediction_lots` có đúng 1 dòng `ma_lo="1074cs/26", real_lot_id = <id của lô này>, trang_thai="Đã dùng"`.

**Chuỗi lỗi**: `deleteLotTransaction()` (`product/actions.ts`, dùng chung bởi cả nút Xóa trong `/dashboard/product` lẫn "Lịch sử ca" trong `confirm/page.tsx`) trước đây làm 3 bước Supabase RIÊNG BIỆT, không atomic:
1. `DELETE lot_transactions` (xóa giao dịch cuối cùng của lô) — **luôn thành công**, và tự kích hoạt trigger cũ `trigger_update_lot_master` (từ `20260515_refactor_lots_master_detail.sql`) — trigger này CHỈ recompute `tong_banh/tong_kg/trang_thai` từ `SUM(lot_transactions)` còn lại, **không đụng tới `kien_a/b/c/d`** — nên sau bước này `tong_banh` đã về đúng 0 nhưng `kien_a-d` vẫn giữ giá trị CŨ.
2. Đếm lại số giao dịch còn lại → 0.
3. `DELETE lots` — **luôn thất bại** với lỗi vi phạm khóa ngoại `lot_prediction_lots.real_lot_id REFERENCES lots(id)` (không có `ON DELETE CASCADE`/`SET NULL`) vì lô này được tạo qua tính năng "Dự đoán số lô" (`create_lot_prediction_batch`) rồi `markLotPredictionRealized()` đã gán `real_lot_id` trỏ vào đúng lô này khi kiện đầu tiên được quét QR xác nhận.

Vì bước 1 đã **commit trước** bước 3 (2 câu lệnh riêng biệt, không nằm trong 1 transaction), lỗi ở bước 3 để lại đúng trạng thái nửa vời quan sát được: giao dịch đã mất, `lots` vẫn còn với `kien_a-d` stale, và **mọi lần bấm Xóa lại sau đó đều lặp lại đúng lỗi 23503 y hệt** (vì `lot_prediction_lots` vẫn còn trỏ vào lô này) — đúng nghĩa "không thể xóa" người dùng mô tả. Thêm vào đó, `product/page.tsx`'s `handleDelete()` hiển thị **sai thông báo lỗi** cho case này ("đã có phiếu kiểm nghiệm liên quan") — thông báo đó chỉ đúng khi lỗi đến từ `qc_results`, nhưng ở đây lỗi thực ra đến từ `lot_prediction_lots`, khiến người dùng bị hướng dẫn nhầm hướng xử lý (đi tìm phiếu KN không tồn tại).

**Fix — migration `supabase/migrations/20260713_delete_lot_transaction_rpc.sql` (CẦN CHẠY THỦ CÔNG trong Supabase SQL Editor TRƯỚC KHI deploy code)**:
- RPC atomic mới `delete_lot_transaction(p_transaction_id uuid)` — khóa `lots` `FOR UPDATE`, xóa giao dịch, nếu còn giao dịch khác thì gọi lại `sync_lot_master_snapshot()` để tính đúng lại `kien_a-d` (không chỉ `tong_banh`); nếu đây là giao dịch cuối cùng thì **chủ động gỡ `lot_prediction_lots.real_lot_id = NULL, trang_thai = 'Dự kiến'`** (đảo ngược đúng `markLotPredictionRealized()`) trước khi `DELETE lots` — tất cả trong 1 transaction duy nhất, thành công toàn bộ hoặc rollback toàn bộ.
- RPC atomic mới `delete_orphan_lot(p_lot_id uuid)` — cùng cơ chế gỡ liên kết dự đoán, dùng cho nhánh xóa lô 0-giao-dịch (lô rác từ CSV import cũ hoặc từ chính bug này trước khi có fix) — thay cho `.from("lots").delete()` thô trước đây trong `product/page.tsx`.
- `product/actions.ts`'s `deleteLotTransaction()` giờ chỉ gọi RPC `delete_lot_transaction` rồi đọc lại `lots` nếu chưa bị xóa — không còn 3 bước rời rạc.
- `product/page.tsx`'s `handleDelete()` nhánh `transactionCount === 0` giờ gọi RPC `delete_orphan_lot`; thông báo lỗi 23503 đổi thành trung lập hơn ("đã có phiếu kiểm nghiệm hoặc đơn xuất hàng liên quan") vì giờ đã loại trừ nguyên nhân `lot_prediction_lots`.

**Quan trọng — thứ tự deploy**: migration PHẢI chạy trước khi code mới lên production — nếu không, mọi thao tác xóa giao dịch/lô (cả 2 luồng: nút Xóa ở `/dashboard/product` lẫn "Lịch sử ca" ở `confirm/page.tsx`) sẽ lỗi ngay lập tức vì gọi RPC chưa tồn tại (đúng bài học đã từng gặp với `sync_lot_master_snapshot`).

**Dữ liệu rác hiện có**: lô `1074cs/26` (factory `phuochoa_kt`) hiện vẫn đang ở trạng thái "lô ma" mô tả trên — **chưa xóa thủ công qua script**, cố ý để người dùng tự bấm nút "Xóa" lại trong UI SAU KHI migration đã chạy + code đã deploy, để xác nhận fix hoạt động đúng trên chính case thật đã gây ra bug này (thay vì tôi tự ý xóa dữ liệu qua script).

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay** — cần sau khi chạy migration: thử xóa lại đúng dòng `1074cs/26` (giờ phải thành công, không còn báo lỗi 23503); thử quét QR tạo lô mới qua dự đoán rồi xóa giao dịch vừa tạo (case lần đầu chưa từng gặp lỗi) để xác nhận không có regression; thử xóa 1 giao dịch KHÔNG PHẢI cuối cùng của lô (còn giao dịch khác) để xác nhận `kien_a-d` vẫn được tính lại đúng qua `sync_lot_master_snapshot`.

### Cập nhật 2026-07-13 (phiên 6) — Fix bug "CSR CSR10" trong phiếu PDF + quy tắc mới: 1 kiện làm nhiều lần phải cùng Bọc/Pallet/Loại bành

**Bug đã fix — tiêu đề và cột "Loại CSR" của phiếu báo thành phẩm hiện dư chữ "CSR" (`shift-report-pdf.ts`)**: khác với module Kiểm nghiệm (lưu `loai_csr` thô dạng `"10"`/`"20"`, cần tự thêm tiền tố `"CSR"` khi hiển thị — xem `src/lib/quality-stats.ts`), module Thành phẩm (`lots.loai_csr`, nguồn dữ liệu của phiếu này) đã lưu **sẵn** chuỗi đầy đủ dạng `"CSR10"`/`"CSRL"`/`"CSRCV50"` (xem `product-lot-config.ts`). Hàm `loaiCsrLabel()` (thêm ở phiên 4 cùng ngày) nhầm lẫn 2 quy ước này, tự thêm `"CSR"` một lần nữa → ra `"CSRCSR10"` ở cột "Loại CSR" và `"CSR CSR10, CSR20"` ở tiêu đề. Đã sửa: `loaiCsrLabel()` giờ chỉ trả thẳng giá trị gốc (không thêm tiền tố); tiêu đề dùng riêng hàm `stripCsrPrefix()` (`replace(/^(CSR|SVR)/, "")`) để tách tiền tố ra khỏi từng giá trị trước khi ghép thành `"- CSR 10, 20"` (đúng định dạng mẫu `mau_ptp.pdf`).

**Quy tắc nghiệp vụ mới đã chốt — 1 kiện làm nhiều lần (partial_kien top-up) phải đồng nhất Bọc/Loại pallet/Loại bành, được phép khác Ca SX/Số chỉ thị/Ngày SX**:
- Bối cảnh: 1 kiện (vd kiện D) có thể được sản xuất/nhập liệu qua **nhiều lần quét QR** (mỗi ca làm một phần, hoặc dở dang rồi hoàn thành sau — trạng thái `"partial_kien"`, xem mục 5 phía trên). Về mặt vật lý, kiện là MỘT khối/pallet vật lý duy nhất — không thể một phần dùng bọc/pallet này, phần còn lại dùng bọc/pallet khác trong cùng 1 kiện (khác với việc các KIỆN KHÁC NHAU của cùng 1 lô được phép khác bọc/pallet — xem bug tổng hợp sai đã fix ở phiên 4). "Loại bành" không cần kiểm tra thêm vì vốn đã cố định theo lô (`lots.loai_banh`), không phải trường chọn tay trong form quét QR.
- `resolveKienForConfirm()` (`confirm/actions.ts`) giờ trả thêm 2 field `existingKienBoc`/`existingKienPallet` — lấy từ giao dịch **gần nhất của ĐÚNG kiện đang xác nhận** (lọc theo `kien_${letter} > 0`, sort theo `created_at`), **không phải** `lot.boc`/`lot.pallet` (giá trị "mới nhất của cả lô", có thể đến từ 1 kiện KHÁC đã scan sau kiện này — nguồn gốc đúng của bug "cả lô đổi theo pallet của kiện cuối" đã fix ở phiên 4, nay áp dụng luôn cho pre-fill để tránh lặp lại bug tương tự ở tầng form).
- Khi `status === "partial_kien"`: form (`confirm/page.tsx`) tự pre-fill Bọc/Pallet theo `existingKienBoc`/`existingKienPallet` (đúng kiện, không phải đúng lô); nếu người dùng chủ động đổi khác đi, banner đỏ **"Bọc/Pallet không khớp lần nhập trước của kiện này"** hiện ra kèm nút "Đặt lại đúng giá trị" (reset về đúng giá trị bắt buộc) — và **chặn cứng nút Gửi dữ liệu** (`canSubmit` thêm điều kiện `!kienMismatch`) cho tới khi khớp lại, nhất quán với các validate chặn cứng khác trong luồng này (vượt 110%, vượt max_per_kien...).
- Helper `sameStringSet()` so khớp mảng pallet dạng tập hợp (không phân biệt thứ tự chọn).

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay** — cần: quét kiện D lần 1 (chọn Bọc X, Pallet Y) → quét lại kiện D lần 2 (top-up phần còn thiếu) → xác nhận Bọc/Pallet tự pre-fill đúng X/Y; thử đổi tay sang giá trị khác → banner đỏ hiện đúng, nút Gửi bị khóa; bấm "Đặt lại đúng giá trị" → về đúng X/Y, nút Gửi mở lại; đối chiếu phiếu PDF không còn "CSRCSR10"/"CSR CSR10, CSR20".

### Cập nhật 2026-07-13 (phiên 7) — Pallet chỉ chọn 1, phiếu báo thành phẩm gộp theo NGÀY (nhiều ca), cấu hình tên ca

**Loại pallet ở form quét QR đổi từ multi-select sang chọn 1**: `confirm/page.tsx` — click vào 1 pallet đang chưa chọn sẽ thay thế hoàn toàn lựa chọn cũ (`setPallet([p])`), click lại đúng pallet đang chọn để bỏ chọn (`setPallet([])`). Kiểu dữ liệu vẫn giữ `string[]` (khớp cột DB `TEXT[]` của `lots.pallet`/`lot_transactions.pallet`, và khớp `sameStringSet()`/`kienMismatch` đang so sánh dạng tập hợp) — chỉ ràng buộc ở tầng UI của riêng màn quét QR này còn tối đa 1 phần tử. **Không đổi** rule "pallet là dữ liệu nhiều giá trị" ở modal sửa lô trong `product/page.tsx` (rule mục 4 phía trên) — 2 nơi độc lập nhau.

**Phiếu báo thành phẩm nhập kho đổi từ phạm vi "1 ngày + 1 ca" sang "1 NGÀY, gộp tất cả ca có dữ liệu"** — theo mẫu thật `cung_cap_dl/mau_2.pdf` (trường hợp 2 ca cùng làm 1 ngày, ca sau xuất báo cáo phải thấy được dữ liệu của cả 2 ca):

- `loadShiftReportData(factoryId, ngaySx)` (`confirm/actions.ts`) **bỏ tham số `ca`** — query `loadDayTransactions()` mới lấy toàn bộ giao dịch của cả ngày (mọi ca), không còn `loadShiftTransactions(..., ca)` (hàm đó vẫn giữ nguyên, chỉ dùng riêng cho `loadShiftHistory`/Hub "Lịch sử ca" — nơi này KHÔNG đổi, vẫn lọc theo đúng 1 ca người dùng chọn để xem/xóa từng dòng).
- `ShiftReportData` đổi cấu trúc: bỏ field `ca`/`nganMa` (header-level), thay bằng `sections: ShiftReportCaSection[]` — mỗi phần tử là 1 ca THỰC SỰ có giao dịch trong ngày đó (`{ ca, caLabel, caName, rows, tongBanh, tongKg }`). `caLabel` là số thứ tự hiển thị ("Ca 1", "Ca 2"...) theo đúng **thứ tự thời gian trong ngày** (Ca A luôn buổi sáng, Ca B luôn buổi chiều chạy xuyên đêm — hằng số `CA_ORDER = ["A","B","C"]`, hàm `compareCaCode()`), không phải alphabet của mã ca. Nhóm dòng theo `(ca + ma_lo + boc + pallet)` — thêm `ca` vào khóa nhóm (khác bản cũ chỉ `ma_lo+boc+pallet`) để 1 lô có kiện làm ở 2 ca khác nhau tự tách đúng section, không bị trộn.
- `ShiftReportLotRow` thêm field `nganMa: string` (mã ngăn nguồn, có thể nhiều ngăn cách nhau `", "` nếu các giao dịch gộp vào cùng dòng đó dùng khác `ngan_id` — không có ràng buộc cứng nào chặn 1 kiện lấy nguyên liệu từ nhiều ngăn khác nhau qua nhiều lần top-up, dù đây không phải cách vận hành thông thường).
- `byGroup` ("Tổng hợp") **giữ nguyên logic cũ** — gộp theo `loai_csr+loai_banh+boc+pallet` **trên toàn bộ các dòng của mọi ca cộng lại** (không tách theo ca), đúng yêu cầu "bảng tổng vẫn tổng hợp chung như cũ".
- `shift-report-pdf.ts` viết lại renderer: meta box đầu phiếu chỉ còn 2 ô "Ngày" + "Số chỉ thị" (bỏ "Ca"/"Ngăn SX" — 2 field này giờ ở cấp section/dòng); mỗi section vẽ tiêu đề `"{caLabel}: {ca} {caName}"` (khớp mẫu `"Ca 1: A Sok Khum"`) rồi 1 bảng chi tiết + dòng "Tổng" riêng của ca đó; sau tất cả section là 1 bảng "Tổng hợp" dùng chung layout 8 cột với bảng chi tiết. Bảng chi tiết đổi từ 7 cột lên **8 cột**: `Lô số | Loại CSR | Số bành | K.lượng (kg) | Bọc | Thùng chứa | Ngăn SX | Trực ca` (thêm lại cột "Ngăn SX" làm cột riêng thay vì gộp vào header — vì giờ 1 dòng có thể ứng với nhiều ngăn khác nhau, không thể gộp chung 1 giá trị header cho cả phiếu). `COLUMN_WIDTHS = [24,15,12,16,36,20,34,25]` (tổng 182mm khớp `CONTENT_WIDTH`); text dài không dấu cách (mã ngăn dạng `"N5-NT-ĐC-X-26/06/26-27/06/26"`) tự động word-wrap qua cơ chế mặc định của `jspdf-autotable`/`doc.splitTextToSize` (đã verify: jsPDF's `splitTextToSize` tự ngắt cứng theo ký tự khi 1 "từ" dài hơn bề rộng cột, không cần xử lý thủ công).
- Trước mỗi section/bảng "Tổng hợp", có kiểm tra khoảng trống còn lại trên trang (`ensurePageSpace()`) — nếu không đủ thì tự `doc.addPage()` trước khi vẽ tiêu đề bằng `doc.text()` thủ công (khác với bảng autoTable tự phân trang được, tiêu đề vẽ tay thì không).
- `buildShiftReportFileName()` bỏ hậu tố `-ca-{ca}` khỏi tên file (phiếu giờ không còn gắn với 1 ca cụ thể).
- Text `endShiftNoData` (`confirm/i18n.ts`, cả 2 ngôn ngữ VI/KM) đổi từ "Ca này chưa có dữ liệu..." sang "Ngày này chưa có dữ liệu..." cho khớp phạm vi mới; thêm hint `reportCoversWholeDayHint` hiển thị dưới nút "Xem / Tạo lại phiếu PDF" trong Hub, giải thích phiếu gồm tất cả ca đã có dữ liệu trong ngày đã chọn.
- `handleGenerateReportNow`/`handleConfirmEndShift` (`page.tsx`) gọi `loadShiftReportData(factoryId, historyNgay)` (bỏ `historyCa`); điều kiện "không có dữ liệu" đổi từ `data.rows.length === 0` sang `data.sections.length === 0`. **Selector "Lịch sử ca" trong Hub (Ngày + Ca) không đổi ý nghĩa** — vẫn dùng để lọc xem/xóa từng dòng giao dịch theo đúng 1 ca; chỉ nút "Xem/Tạo lại phiếu" và "Kết thúc ca" giờ chỉ dùng phần "Ngày" của selector đó, bỏ qua phần "Ca".

**Tên ca sản xuất (vd "Ca A: Sok Khum", "Ca B: Binh Ban") — cấu hình theo nhà máy, KHÔNG hard-code**:

- Migration `supabase/migrations/20260713_factories_shift_names.sql` (**cần chạy thủ công**) — thêm 3 cột `factories.ca_a_ten`, `ca_b_ten`, `ca_c_ten` (TEXT, nullable). Chỉ 3 cột riêng (không tạo bảng con) vì số ca cố định chỉ 3 giá trị (`CA_OPTS = ["A","B","C"]` trong `confirm/page.tsx`).
- Quản trị tại **Cài đặt → Danh mục → Thông tin công ty** — thêm 1 card mới "Tên ca sản xuất" (3 input Tên Ca A/B/C) ngay dưới card "Thông tin công ty (EUDR Seller)" hiện có, dùng chung state `factoryInfo`/hàm `handleSaveFactory()` sẵn có (chỉ mở rộng `FactoryInfo` type + `emptyFactoryInfo()` + câu `SELECT` load factory).
- `loadFactoryShiftNames(factoryId)` (`confirm/actions.ts`) đọc 3 cột này, dùng cho cả 2 nơi: (1) tiêu đề section trong phiếu PDF (`caName`), (2) label dropdown "Ca sản xuất" ở cả form quét QR lẫn Hub — `page.tsx` có helper `caLabel(c)` trả về `"Ca {c} — {tên}"` nếu đã cấu hình, ngược lại `"Ca {c}"`. Chưa cấu hình tên vẫn hoạt động bình thường (không bắt buộc).

`npx tsc --noEmit`, `npx eslint` (các file đã sửa), `npm run build` đều sạch. **Chưa chạy migration `20260713_factories_shift_names.sql`** trên Supabase — cần chạy trước khi dùng tính năng đặt tên ca (nếu chưa chạy, `loadFactoryShiftNames()` vẫn không lỗi vì chỉ đọc cột qua `.select()`, Supabase sẽ trả lỗi "column does not exist" bị nuốt bởi optional chaining `data?.ca_a_ten` — nhưng chắc chắn không lấy được tên thật, cứ hiển thị "Ca A" trơn cho tới khi chạy migration). **Chưa test tay**:
- Chạy migration, vào Cài đặt → Danh mục → Thông tin công ty, đặt tên 2 ca (vd "Sok Khum"/"Binh Ban"), lưu, load lại xác nhận còn nguyên.
- Vào `/dashboard/product/confirm`, xác nhận dropdown "Ca sản xuất" (cả form quét lẫn Hub) hiện đúng `"Ca A — Sok Khum"`.
- Quét/nhập dữ liệu cho cả Ca A và Ca B trong cùng 1 ngày → bấm "Xem/Tạo lại phiếu PDF" (chỉ cần chọn đúng Ngày, Ca nào cũng ra cùng 1 phiếu) → xác nhận PDF có 2 section "Ca 1: A..."/"Ca 2: B..." đúng thứ tự, mỗi section có dòng "Tổng" riêng, và bảng "Tổng hợp" cuối cùng cộng đúng cả 2 ca.
- Test case 1 kiện được nhập từ 2 ngăn khác nhau (hiếm, top-up khác ngăn) → xác nhận cột "Ngăn SX" hiện đủ cả 2 mã ngăn cách nhau dấu phẩy.
- Test pallet chỉ chọn được 1 trên form quét QR — chọn pallet A, chọn tiếp pallet B → A tự bỏ chọn, chỉ còn B; click lại B → bỏ chọn hết.

### Phạm vi CHƯA làm (cần hoàn thiện ở phiên sau)

- **Mục 7 (responsive mobile 5 màn)** ở mục ngay trên — đang thiếu 4 ảnh chụp màn hình tham chiếu, cần xin lại người dùng trước khi sửa UI.
- **Toàn bộ nội dung phiên 3 (2026-07-12) vừa code chưa test tay** — xem checklist ngay trên mục "Cập nhật 2026-07-12 (phiên 3)".
- **Test tay nhãn in phiên 5** (xem mục phía trên) — ưu tiên cao vì đụng trực tiếp tới file in thực tế đưa xuống xưởng.
- **QUAN TRỌNG — Migration `20260712_sync_lot_master_snapshot_rpc.sql` CHƯA CHẠY** trên Supabase (đã verify trực tiếp bằng `supabase.rpc(...)` → lỗi "Could not find the function" 2026-07-12) — **bắt buộc chạy migration này TRƯỚC khi deploy code của phiên 3**, nếu không mọi lần lưu thành phẩm (cả nhập tay `product/page.tsx` lẫn quét QR) sẽ lỗi ngay lập tức vì `saveLotTransaction()` giờ gọi RPC này làm bước bắt buộc.
- Đã verify (2026-07-12): migration `20260712_lot_transactions_kien_fields.sql` (cột `boc/pallet/chi_thi` trên `lot_transactions`) và `20260712_product_confirm_scan_permission.sql` (permission `product.confirm_scan`) **ĐÃ chạy xong** trên Supabase — 2 dòng note "chưa chạy" ở các phiên trước đã lỗi thời, gỡ khỏi danh sách này.
- Migration `20260709_lot_predictions.sql` **chưa chạy** trên Supabase — cần chạy thủ công trong SQL Editor trước khi tính năng hoạt động (theo đúng convention toàn bộ migration trong repo). Đã sửa nhiều lần trong lúc code (thêm cột `unassignable_kien`, `closes_ngan`, thêm tham số RPC `p_requested_trailing_kien`/`p_closes_ngan`) — vì CHƯA chạy lần nào nên an toàn để sửa trực tiếp file cũ, không tạo migration nối tiếp. Chạy lại **toàn bộ** file (idempotent) kể cả nếu trước đó đã chạy 1 phần.
- Cách rút gọn tên nhà máy cho footer nhãn (khi nhà máy khác PHK) **chưa được quyết định** — hiện hard-code "Nhà máy chế biến PHK".
- Toàn bộ luồng (đơn ngăn lẫn đa ngăn, bridge kiện dở dang, lọc hết dung lượng, nhãn mới) **chưa test tay** trên dữ liệu thật.

### Cập nhật 2026-07-14 — Fix bug drift carry-over giữa các batch (nhãn phantom/thiếu kiện) + PDF cố định + cảnh báo 110% khi in + số lô bắt đầu có gợi ý

Người dùng báo: dự đoán ngăn N5 kết thúc `1083cs/26` kiện C, dự đoán tiếp ngăn N4 chọn "Tiếp tục lô dở dang" — nhưng PDF của N4 lại bắt đầu từ `1084cs/26` kiện A thay vì `1083cs/26` kiện D; quay lại "In lại nhãn lớn" của N5 thì lòi thêm 1 nhãn phantom `1083cs/26 D` (ghi ngăn SX = N4) ở cuối file, không tồn tại trong lần in đầu của N5. Đồng thời phát hiện nhãn ngăn 6 in ra ghi "Đầy 135%" dù RPC có giới hạn 110%.

**Root cause (bug chính)**: `lot_prediction_lots` trước đây chỉ có `origin_batch_id` (batch tạo dòng) và `last_batch_id` (batch chạm gần nhất) ở cấp **cả dòng** — không có thông tin "kiện nào do batch nào gán" ở cấp **từng kiện**. Khi N4 "continue" bằng cách `UPDATE lot_prediction_lots SET kien_d_ngan_id = N4 WHERE id = <dòng 1083cs do N5 tạo>`, `origin_batch_id` của dòng đó không đổi (vẫn là N5). Cả 2 hàm print đều chỉ lọc theo `origin_batch_id`:
- `loadPredictionLotsForBatch(N4)` không khớp dòng này → PDF của N4 thiếu kiện D.
- `loadPredictionLotsForBatch(N5)` vẫn khớp dòng này (origin không đổi) → khi in lại, thấy `kien_d_ngan_id` giờ đã là N4 → sinh nhãn phantom "D — ngăn N4" (nằm cuối vì `1083cs/26` có `num` lớn nhất trong batch N5, kiện D được push sau cùng theo thứ tự A→B→C→D).

**Fix (migration `supabase/migrations/20260714_lot_prediction_fixes.sql`, cần chạy thủ công)**:

- Thêm 4 cột `kien_a_batch_id..kien_d_batch_id UUID REFERENCES lot_prediction_batches(id)` vào `lot_prediction_lots` — theo dõi batch nào **thực sự** gán ngăn cho từng kiện, độc lập với `origin_batch_id`/`last_batch_id` ở cấp cả dòng. Backfill 1 lần cho dữ liệu hiện có bằng heuristic 2-hop (khớp `ngan_id` hiện tại của từng kiện với `ngan_id` của `origin_batch_id` trước, fallback `last_batch_id`, fallback cuối `origin_batch_id`) — xử lý đúng chuỗi continue 1 bước (đúng case N5→N4 thật của người dùng); chuỗi continue ≥3 bước (hiếm) có thể backfill sai, chấp nhận được.
- `create_lot_prediction_batch` RPC: **DROP** đúng chữ ký cũ (20 tham số) trước khi `CREATE OR REPLACE` với 21 tham số — bắt buộc vì Postgres coi thêm 1 tham số cuối (dù có `DEFAULT`) là tạo overload MỚI chứ không thay thế hàm cũ, gây `function is not unique` khi PostgREST gọi bằng named params. Mọi nơi ghi `kien_X_ngan_id` (vòng lặp lô đầy đủ, khối leftover, khối continue) giờ ghi kèm `kien_X_batch_id = v_batch_id` trong cùng câu lệnh.
- `predict/actions.ts`: hàm mới `loadPredictionLotsForPrint(batchIds)` (query `.or()` khớp `origin_batch_id` HOẶC bất kỳ `kien_X_batch_id` nào trong danh sách) — **thay thế hoàn toàn cho việc build nhãn** (không thay `loadPredictionLotsForBatch` gốc, vẫn dùng cho bảng admin Sửa/Hủy trong panel batch, không đổi).
- `predict/page.tsx`: `buildLabelItemsFromLots(lots)` cũ (build nhãn từ TẤT CẢ 4 cột `kien_X_ngan_id` bất kể batch) → thay bằng `buildLabelItemsForBatches(batchIds)` — mỗi KIỆN chỉ được đưa vào nhãn nếu `kien_X_batch_id` của nó nằm trong đúng tập `batchIds` đang in, không dùng cả dòng làm đơn vị lọc. `handlePrintAfterCreate`/`handleReprintBatch` gọi hàm này trực tiếp bằng `batchId`(s), không còn tách bước `loadPredictionLotsForBatch` + flatten riêng.

**Fix phụ — 2 lỗi giới hạn 110% đã xác nhận thật (Bug B là nguyên nhân code, Bug A chỉ là hiển thị)**:

- **Bug A (banner xem trước lúc TẠO, cosmetic)**: `liveCalc.fullLots` (`predict/page.tsx`) đọc thẳng `requestedLotCount` không kẹp trần `preview.suggestedLotCount` — gõ tay số quá lớn vào ô "Số lô muốn in" làm banner hiện % vượt xa 110% dù RPC vẫn tự kẹp đúng khi tạo thật. Đã thêm `Math.min(..., preview.suggestedLotCount)`.
- **Bug B (thật, ở modal "Sửa" kiện thủ công)**: `updatePredictionLot` (`actions.ts`) trước đây loại TOÀN BỘ dòng đang sửa ra khỏi `predictedKg` (`getExistingPredictedKg(..., [predictionLotId])`) rồi check `pct > 110` **mà không cộng lại phần đóng góp MỚI của chính dòng đó** sau khi áp `kienAssignments` — gán nhiều kiện cùng lúc vào 1 ngăn gần đầy có thể lọt qua 110%. Đã sửa: tính thêm `thisRowKienCount` (số kiện của dòng đang sửa sẽ trỏ về đúng `nganId` sau khi áp thay đổi) × `kien_weight_kg`, cộng vào `pctOthers` trước khi so `> 110`.
- **Ngăn 6 "Đầy 135%" in trên nhãn thật**: đã xác nhận với người dùng — không phải bug tạo dự đoán (RPC luôn kẹp ≤110% tại thời điểm tạo), nhiều khả năng `tong_kho` ngăn 6 bị sửa/đồng bộ lại (sửa tay hoặc "Đồng bộ nhanh" ở Kho nguyên liệu — xem `.claude/rules/storage.md` mục 15) **sau khi** đã dự đoán, khiến % tính lại lúc in (đọc trạng thái ngăn hiện tại qua `loadNganCumulativeBaselines`) bị vượt dù dữ liệu dự đoán ban đầu vốn hợp lệ. Không điều tra sâu thêm dữ liệu — thay vào đó thêm **cảnh báo phòng vệ lúc in**: `computeOverflowWarning(items)` trong `predict/page.tsx` quét `item.nganFillPercent > 110` trên nhãn vừa build, hiện banner đỏ (cả màn "Đã tạo dự đoán thành công" lẫn tab Lịch sử) liệt kê ngăn/% cụ thể — **không chặn** tải PDF (nhãn có thể đã dán ngoài hiện trường).

**PDF cố định — mở lại qua icon, không render lại (theo yêu cầu người dùng, đã chốt UX: 2 icon riêng nhỏ/lớn)**:

- `downloadProductLabelPdf`/`downloadProductLabelSmallQrPdf` (`src/lib/product-label-pdf.ts`) đổi `Promise<void>` → `Promise<Blob>` — vẫn giữ `doc.save(...)` để tải file như cũ, thêm `return doc.output("blob")`. Chỉ `predict/page.tsx` gọi 2 hàm này (đã grep xác nhận) và trước đây không dùng giá trị trả về, nên đổi kiểu an toàn.
- Thêm 4 cột `pdf_small_url/pdf_small_generated_at/pdf_large_url/pdf_large_generated_at` vào `lot_prediction_batches`. Hàm mới `persistBatchPdf(batchIds, size, blob)` (`predict/page.tsx`) upload blob lên bucket `order-files` (tái dùng đúng pattern `supabase.storage.from("order-files").upload(...)` đã có ở `operation-notes.ts`/`process/measurements/page.tsx`) tại path `{factoryId}/product-predict/{batchIds.join("-")}/{Date.now()}-{size}.pdf`, rồi gọi action mới `updateBatchPdfUrl(...)` lưu URL vào batch. Khi in cùng lúc nhiều batch (multi-ngăn), TẤT CẢ batch trong lần in đó cùng trỏ về 1 URL (đúng file tổng hợp đã in). Lỗi upload không chặn — người dùng vẫn có file vừa tải về qua `.save()`.
- UI: trong panel batch ở tab Lịch sử (`predict/page.tsx`), 2 nút icon `FileText` mới **"PDF nhỏ đã lưu"** / **"PDF lớn đã lưu"** đặt **trước** nút "Xóa đợt" — mở đúng `pdf_small_url`/`pdf_large_url` bằng `<a target="_blank">` (không render lại), mờ/disabled nếu chưa từng in loại nhãn đó. Mỗi lần "In lại nhãn nhỏ/lớn" sẽ ghi đè icon tương ứng bằng bản vừa render.

**Fix 4 — "Bỏ qua, bắt đầu lô mới" giờ có gợi ý số lô kế tiếp, cho sửa tay, chặn khi trùng**:

- RPC thêm tham số `p_override_start_num INTEGER DEFAULT NULL` — chỉ áp dụng ở nhánh KHÔNG continue (fresh-start); validate trùng (`NOT EXISTS` trong `lots` và `lot_prediction_lots` loại `abandoned`) trước khi dùng, raise exception rõ ràng nếu trùng.
- `actions.ts` thêm `suggestNextLotNum(factoryId, loaiCsr, loaiBanh, year)` (mirror đúng công thức fallback MAX+1 của RPC) và `checkLotNumTaken(factoryId, suffix, year, num)` (kiểm tra trùng cả `lots` lẫn `lot_prediction_lots`) để UI validate live trước khi submit; RPC vẫn validate lại lần nữa ở server để tránh race.
- `predict/page.tsx`: input "Số lô bắt đầu (tuỳ chọn)" hiện bất cứ khi nào `carryResolution === "skip"` (cả khi có `pendingCarry` và chọn "Bỏ qua, bắt đầu lô mới" lẫn khi không có `pendingCarry` nào — mặc định vốn đã là "skip"). Effect tự điền gợi ý (chỉ khi người dùng chưa gõ tay, track qua `overrideStartNumTouchedRef`, reset mỗi khi đổi CSR/bành/hậu tố), debounce 400ms kiểm tra trùng, chặn `canCreate` nếu trùng hoặc đang kiểm tra. `overrideStartNum` chỉ được forward cho ngăn ĐẦU TIÊN trong `createLotPredictionBatchMulti` (các ngăn sau trong cùng thao tác luôn tự "continue" nối tiếp, không có khái niệm bắt đầu lại).

**`deletePredictionBatch` (actions.ts) cũng được mở rộng theo `kien_X_batch_id`**: trước đây chỉ chặn xóa khi dòng do CHÍNH batch đó tạo (`origin_batch_id`) có `real_lot_id`, và chỉ heal `last_batch_id` cho FK-safety (không đụng dữ liệu kiện). Giờ tìm thêm "kienTouchedLots" — dòng do batch KHÁC tạo nhưng có kiện được batch đang xóa "nối tiếp" (`kien_X_batch_id = batchId`) — chặn xóa nếu dòng đó đã có `real_lot_id`; nếu chưa, **hoàn tác đúng phần kiện** batch này đã gán (trả `kien_X_ngan_id`/`kien_X_batch_id` về NULL, tính lại `carry_over_status` — về `'pending'` nếu sau khi gỡ còn kiện trống chưa `unassignable`), reset `last_batch_id = origin_batch_id`. Ví dụ: xóa batch N4 (đã continue kiện D của `1083cs/26` do N5 tạo) → kiện D của `1083cs/26` trả về chưa gán, `carry_over_status` về `'pending'` → `findPendingCarryLot` sẽ gợi ý lại đúng lô này ở lần tạo dự đoán kế tiếp cùng series.

**Chưa test tay** — toàn bộ nội dung trên mới qua `npx tsc --noEmit` + `npx eslint` + `npm run build` (đều sạch), chưa chạy `npm run dev` xác nhận trên trình duyệt/dữ liệu thật. Cần đặc biệt:
- Chạy migration `20260714_lot_prediction_fixes.sql` trên Supabase SQL Editor trước — kiểm tra kỹ log backfill không báo lỗi FK (2-hop heuristic dựa vào `ngan_id` của `origin_batch_id`/`last_batch_id` vẫn còn tồn tại trong `lot_prediction_batches`).
- Test đúng kịch bản gốc: dự đoán N5 kết thúc `1083cs/26 C`, dự đoán N4 chọn "Tiếp tục" → xác nhận PDF N4 bắt đầu đúng `1083cs/26 D`; quay lại "In lại nhãn lớn" của N5 → xác nhận KHÔNG còn nhãn phantom D, chỉ dừng đúng ở `1083cs/26 C`.
- Test 2 icon PDF cố định: in nhãn nhỏ/lớn cho 1 batch → icon tương ứng bật lên, mở đúng file vừa tải, không đổi khi dữ liệu sau đó thay đổi (regenerate qua "In lại" mới ghi đè).
- Test cảnh báo vượt 110% khi in (giả lập bằng cách sửa `tong_kho` ngăn sau khi đã dự đoán, rồi in lại).
- Test "Bỏ qua, bắt đầu lô mới": xác nhận số gợi ý đúng, sửa tay được, nhập trùng số đã có bị chặn kèm thông báo rõ mã lô trùng.
- Test xóa batch đã continue từ batch khác: xác nhận kiện được hoàn tác đúng, `findPendingCarryLot` gợi ý lại đúng lô đó ở lần tạo tiếp theo.

### Cập nhật 2026-07-15 — 7 cải tiến module "Quét QR xác nhận sản xuất" (`product/confirm/`)

**1. Giảm round-trip Supabase**:

- `resolveKienForConfirm` (`confirm/actions.ts`): query `lot_prediction_batches` lấy `day_chuyen` giờ chỉ chạy khi thực sự cần (`!lot || !lot.day_chuyen`), không còn vô điều kiện. Nhánh `lot` tồn tại: `lot_transactions` + tra ngăn cho cả 2 khả năng (`lot.ngan_id` và `nganIdForPartial`) chạy song song qua `Promise.all` thay vì tuần tự (2 lookup ngăn chỉ thực sự tốn round-trip khi 2 giá trị khác nhau, trường hợp hiếm). Nhánh `predicted` (lô mới): gộp `loadNganInfo` + `loadSuggestedChiThiForNewLot` bằng `Promise.all`.
- `confirmKienProduction`: 3 query đọc đầu tiên (`lots` theo `ma_lo`, `ngans` theo `nganId`, `getExistingRealKg`) không phụ thuộc lẫn nhau — gộp `Promise.all` thay vì tuần tự. Lookup `lot_prediction_lots` (kiểm tra có dòng dự đoán khớp `ma_lo` không) chạy song song với chính `saveLotTransaction()` thay vì đợi nó xong (chỉ thực sự cần `lotId` từ kết quả save ở bước `markLotPredictionRealized` sau đó).
- `saveLotTransaction()` (`product/actions.ts`) — `.select()` của upsert `lot_transactions` thêm cột `created_at`, `confirmKienProduction` dùng thẳng giá trị này thay vì query lại riêng.
- **Migration `20260715_sync_lot_master_snapshot_returns_row.sql`** (cần chạy thủ công): RPC `sync_lot_master_snapshot` đổi từ `RETURNS void` sang `RETURNS TABLE(...)` — trả thẳng snapshot ngay trong cùng lệnh gọi, bỏ hẳn round-trip `SELECT lots` theo sau mà `product/actions.ts` từng phải làm riêng. Đổi return type bắt buộc `DROP FUNCTION` trước `CREATE` (Postgres không cho `CREATE OR REPLACE` đổi kiểu trả về); `delete_lot_transaction()` gọi hàm này qua `PERFORM` nên không cần sửa gì thêm (PERFORM chạy được với hàm trả về table/setof, chỉ bỏ qua kết quả).
- `getExistingRealKg` (`predict/actions.ts`, dùng chung bởi cả module Dự đoán số lô lẫn `confirmKienProduction`) thêm phân trang `.range()` — trước đây query không giới hạn, rủi ro bug cắt 1000 dòng của PostgREST nếu 1 ngăn tích lũy quá 1000 giao dịch trong vòng đời (xem `.claude/rules/04-code-patterns.md`).

**2. Sửa dữ liệu quét sai (thêm nút Sửa, trước đây chỉ có Xóa)**:

- Server action mới `editShiftHistoryEntry()` (`confirm/actions.ts`) — sửa `ngan_id/ca/ngay_nhap/kien_X/so_banh/so_kg/boc/pallet/chi_thi` của 1 dòng `lot_transactions`, re-validate đầy đủ ở server (không tin cờ phía client): tổng bành của đúng kiện (trừ phần đóng góp của chính dòng đang sửa) không vượt `max_per_kien`, và capacity 110% của ngăn đích (trừ phần `so_kg` cũ nếu vẫn ở cùng ngăn). Ghi xong gọi lại RPC `sync_lot_master_snapshot` để đồng bộ `lots`.
- Quyền: **user thường** chỉ sửa được khi lô vẫn `"Dở dang"` (mirror đúng điều kiện `canDelete` sẵn có). **Admin** sửa được ở MỌI trạng thái, TRỪ KHI lô đồng thời (1) đã `"Xuất hàng"` VÀ (2) đã có `qc_results` gắn vào (đối chiếu cả `lot_id` lẫn `ma_lo` — dữ liệu cũ có thể có nhiều bản ghi `lots` cùng `ma_lo`, xem `pickCanonicalLot`) — cả 2 điều kiện phải CÙNG đúng mới chặn.
- `ShiftHistoryEntry` (`loadShiftHistory`) thêm `canEdit` (tính theo đúng rule trên, cần `isAdmin` truyền vào hàm) và snapshot đầy đủ của giao dịch (`nganId/nganMa/nganTen/ca/ngaySx/boc/pallet/chiThi/loaiCsr/loaiBanh/dayChuyen`) để modal Sửa pre-fill không cần load lại riêng. `nganMa/nganTen` tra theo batch 1 lần cho toàn bộ danh sách (không query riêng từng dòng).
- UI: icon `Pencil` cạnh icon `Trash2` trong "Lịch sử ca" (Hub), chỉ hiện khi `h.canEdit`. Modal `EditEntryModal` (`confirm/page.tsx`) — form đầy đủ Ngày/Ca/Số chỉ thị/Số bành/Bọc/Loại pallet/Ngăn nguồn (dropdown ngăn dùng `loadActiveNgansForFactory` + luôn giữ ngăn hiện tại của giao dịch làm 1 option dù ngăn đó không còn "Chờ/Đang sản xuất").

**3. Cảnh báo "nhảy lô" (bỏ sót kiện khi trực ca chuyển sang lô khác)**:

- 2 server action mới, cả 2 đọc thẳng `lots.kien_a-d` (luôn đồng bộ sẵn qua `sync_lot_master_snapshot`, không tự `SUM` lại `lot_transactions`):
  - `checkLotCompleteness(factoryId, maLo)` — 1 lô có còn thiếu kiện không (null nếu không tồn tại/đã qua "Dở dang"/đã đủ 4 kiện).
  - `checkIncompleteLotsForDay(factoryId, ngaySx)` — quét mọi lô có giao dịch trong 1 ngày (mọi ca), trả về danh sách lô còn "Dở dang" kèm kiện thiếu.
- **Lúc quét, phát hiện đổi mã lô** (`confirm/page.tsx`, effect lookup): dùng `lastSubmittedMaLoRef` (ref, không phải state — tránh re-trigger effect chính) lưu mã lô vừa gửi thành công gần nhất trong phiên. Khi resolve 1 mã lô MỚI khác giá trị này, gọi `checkLotCompleteness` cho mã lô CŨ, hiện banner amber non-blocking ("Lô X còn thiếu kiện Y") ngay trên form — không chặn thao tác.
- **Lúc "Kết thúc ca"**: `handleEndShiftFirstConfirm` gọi `checkIncompleteLotsForDay` TRƯỚC khi build PDF — nếu có lô dở dang, modal chuyển sang giai đoạn `"warning"` liệt kê từng lô + kiện thiếu, yêu cầu bấm rõ ràng "Vẫn kết thúc ca" (nút riêng, không phải nút mặc định) mới cho tiếp tục xuất phiếu.

**4. Sắp xếp "Lịch sử ca" theo lô thay vì theo thời gian quét**:

- `loadShiftHistory()` đổi sort từ `createdAt DESC` (mới nhất lên đầu) sang theo `num` (số lô, tách từ `ma_lo` bằng regex `/^(\d+)/`) tăng dần, rồi `maLo` (tie-break), rồi kiện A→D — quét kiện D trước A/B/C không còn bị đẩy xuống cuối danh sách, dễ theo dõi tiến độ theo lô hơn. `loadShiftReportData` (phiếu PDF) giữ nguyên sort cũ theo `hoanThanhAt` trong từng section — không đổi, chỉ áp dụng cho danh sách Hub.

**5. Phân công trực ca cố định theo nhà máy**:

- Bảng mới `production_shift_assignments` (migration `20260715_production_shift_assignments.sql`, cần chạy thủ công) — `(factory_id, ca)` unique, `assigned_user_id` (FK `auth.users`, nullable) + `assigned_name` (text dự phòng khi chưa có tài khoản) + `ghi_chu` + `is_active`. Cố ý ĐƠN GIẢN, không có lịch sử `effective_from/to` như `dispatch_vehicle_driver_assignments` — mỗi ca chỉ có 1 dòng active tại một thời điểm.
- RLS: SELECT `USING (true)` (mirror "Allow all" đã dùng cho `ngans`/`lots`/`lot_prediction_lots` — mọi user cần tự tra "mình trực ca nào"); ghi qua Supabase browser client trong Cài đặt, gate bằng permission `settings.manage_config` ở tầng UI (không tạo permission riêng).
- Quản trị: sub-tab mới **"Phân công trực ca"** trong `Cài đặt → Cấu hình nhà máy` (cạnh "Mục tiêu chất lượng") — component `src/app/dashboard/settings/_components/shift-assignments-tab.tsx`, đúng 3 dòng cố định (Ca A/B/C), mỗi dòng chọn tài khoản (dropdown từ `activeProfilesForLink` đã có sẵn trong `settings/page.tsx`) hoặc chỉ ghi tên hiển thị nếu chưa có tài khoản.

**6. Gợi ý đúng Ca sản xuất khi mở form quét** (thay hard-code `"A"`):

- Đã hỏi người dùng cách fallback khi tài khoản chưa được gán ca nào (vd nhiều người dùng chung 1 máy quét) — **chốt: nhớ Ca đã dùng gần nhất TRÊN CHÍNH THIẾT BỊ/trình duyệt đó** (không đoán theo khung giờ ca).
- `loadUserShiftAssignment(factoryId, userId)` (`confirm/actions.ts`) tra `production_shift_assignments` theo `assigned_user_id + is_active=true`.
- `confirm/page.tsx`: `getDefaultCa()` ưu tiên `assignedCa` (bảng phân công) → `loadStoredCa()` (localStorage key `product_confirm_last_ca`) → `"A"`. Áp dụng khi effect lookup set `ca` mặc định cho mỗi lần quét mới (thay `setCa("A")` cứng). Sau khi gửi thành công, `storeCa(ca)` — nhưng CHỈ khi `!assignedCa` (không ghi đè gợi ý ưu tiên cao hơn từ bảng phân công bằng lựa chọn tay tạm thời).
- Cố ý **không đổi** giá trị mặc định của `historyCa` (bộ lọc "Lịch sử ca" trong Hub, dùng để browse/filter chứ không phải nhập mới) — giữ khởi tạo trung lập `"A"`.

**7. Xem trước PDF trước khi chia sẻ/tải + nút "Xem phiếu PDF" ở header ngày (module Thành phẩm)**:

- `shift-report-pdf.ts`: bỏ hẳn `shareOrDownloadShiftReportPdf()` (share/download thẳng không cho xem trước), thay bằng 3 hàm tách biệt: `openShiftReportPdfInNewTab(doc)` (dùng `doc.output("bloburl")`, mở tab mới bằng trình xem PDF gốc của trình duyệt — không cần thư viện nhúng), `downloadShiftReportPdfDoc(doc, fileName)`, `shareShiftReportPdfDoc(doc, fileName)` — cả 2 hàm sau nhận thẳng `jsPDF` đã dựng sẵn, không tự build lại.
- Component dùng chung mới `shift-report-preview-bar.tsx` (`ShiftReportPreviewBar`) — thanh 2 nút Chia sẻ/Tải xuống, tái sử dụng ở cả `confirm/page.tsx` (Hub "Xem/Tạo lại phiếu" + modal "Kết thúc ca" giai đoạn `"preview"`) lẫn modal mới trong `product/page.tsx`.
- `handleGenerateReportNow`/`proceedGenerateEndShiftReport` (`confirm/page.tsx`) giờ: build PDF 1 lần → `openShiftReportPdfInNewTab` → lưu `{doc, fileName}` vào state → hiện `ShiftReportPreviewBar`. "Kết thúc ca" chỉ thực sự đóng modal + điều hướng khi người dùng bấm "Hoàn tất, quay lại Thành phẩm" (`handleFinishEndShift`) — có thêm nút "Ở lại trang này" để đóng modal không điều hướng.
- `product/page.tsx`: nút mới **"Xem phiếu PDF"** trong header mỗi nhóm ngày (cạnh "Thêm"/"Sửa"/"Xóa", luôn hiển thị kể cả khi đang ở chế độ xóa, ẩn khi `date === "Chưa có ngày"`) — `openReportPdfModal(date)` gọi `loadShiftReportData(factoryId, date)` rồi cùng luồng xem-trước-rồi-mới-chia-sẻ ở trên, hiển thị trong `ModalShell`.

**Chưa test tay** — toàn bộ nội dung mục "Cập nhật 2026-07-15" mới qua `npx tsc --noEmit` + `npx eslint` + `npm run build` (đều sạch), chưa chạy `npm run dev` xác nhận trên trình duyệt/dữ liệu thật. Cần đặc biệt:
- Chạy 2 migration `20260715_sync_lot_master_snapshot_returns_row.sql` và `20260715_production_shift_assignments.sql` trên Supabase SQL Editor TRƯỚC khi deploy code — nếu chưa chạy migration đầu, MỌI lần lưu/sửa/xóa giao dịch thành phẩm (cả nhập tay lẫn quét QR) sẽ lỗi ngay lập tức vì `syncLotMasterSnapshot()` giờ mong đợi RPC trả về hàng dữ liệu thay vì `void`.
- Test tốc độ thực tế trước/sau trên mạng chậm (throttle DevTools) để xác nhận cảm nhận được sự khác biệt.
- Test nút Sửa: user thường chỉ sửa được lô "Dở dang"; admin sửa được lô "Hoàn thành"; admin BỊ CHẶN sửa lô "Xuất hàng" đã có KN, admin sửa ĐƯỢC lô "Xuất hàng" chưa có KN.
- Test cảnh báo nhảy lô: quét dở 1 lô (còn thiếu kiện) rồi quét sang lô khác → banner amber hiện đúng; quét đủ 4 kiện rồi mới đổi lô → không có banner.
- Test "Kết thúc ca" với ngày có lô dở dang → modal chuyển giai đoạn "warning" đúng, danh sách lô/kiện thiếu đúng; bấm "Vẫn kết thúc ca" → sang giai đoạn "preview" bình thường.
- Test phân công trực ca: gán tài khoản A vào Ca B trong Cài đặt → đăng nhập tài khoản đó, mở form quét QR → dropdown "Ca sản xuất" tự chọn "Ca B"; tài khoản chưa gán → dùng đúng Ca đã lưu localStorage lần quét trước trên máy đó.
- Test nút "Xem phiếu PDF" mới ở header ngày trong module Thành phẩm — mở đúng phiếu của đúng ngày, xem trước ở tab mới, Chia sẻ/Tải xuống hoạt động.

### Kế hoạch phiên sau (chưa làm) — Quét theo lượt: "Lưu tạm" nhiều kiện rồi "Gửi" 1 lần

**Bối cảnh**: người dùng quan sát thói quen thực tế — trực ca quét vài kiện liên tục rồi ngưng, vài
tiếng sau quay lại quét tiếp. Đề xuất: mỗi lần quét xong 1 kiện, xem thông tin rồi bấm **"Lưu tạm"**
(không ghi DB thật ngay) thay vì "Gửi" ngay lập tức; lặp lại cho nhiều kiện/nhiều lô; cuối lượt bấm
**"Gửi"** một lần duy nhất — các kiện CÙNG lô có CÙNG toàn bộ thông tin (ngăn/bọc/pallet/ngày/ca/chỉ
thị) sẽ gộp thành 1 dòng `lot_transactions` (giống cách module Thành phẩm nhập tay multi-kiện trước
khi có tính năng quét QR), thay vì mỗi kiện luôn là 1 dòng riêng như hiện tại.

**Đánh giá**: ý tưởng hợp lý, giảm số lần chờ round-trip mỗi kiện, chịu được mạng yếu giữa các lượt
quét (Lưu tạm không cần validate tồn kho ngay). Rủi ro chính đã lường trước và đã chốt hướng xử lý
với người dùng qua 2 câu hỏi:

1. **Nơi lưu nháp — đã chốt: bảng nháp trên server** (không dùng localStorage) — bền hơn khi đổi
   máy/trình duyệt, đồng bộ được nếu nhiều người dùng chung ca. Đánh đổi: mỗi lần "Lưu tạm" vẫn tốn
   1 round-trip nhẹ (nhưng KHÔNG có validate tồn kho/capacity — chỉ ghi nhận, xem mục RPC bên dưới).
2. **Xử lý lỗi khi Gửi cả lượt — đã chốt: chặn toàn bộ (all-or-nothing)** — nếu bất kỳ dòng nào
   trong lượt gửi bị từ chối (ngăn đã đầy, kiện đã có người khác nhập giữa lúc chờ...), KHÔNG dòng
   nào được ghi, giữ nguyên toàn bộ nháp để người dùng sửa rồi gửi lại. Không có khái niệm "gửi được
   phần nào hay phần đó" — nhất quán, đơn giản hơn cho người dùng hiểu, tránh trạng thái nửa vời.

**Thiết kế đề xuất (chưa code, cần rà lại đầu phiên sau trước khi bắt tay)**:

- Bảng mới `product_confirm_drafts` — `factory_id`, `created_by` (auth.uid()), `ma_lo`, `kien`,
  `is_new_lot`, `ngan_id`, `loai_csr`, `loai_banh`, `day_chuyen`, `so_banh`, `ngay_sx`, `ca`, `boc`,
  `pallet text[]`, `chi_thi`, `tham`, `ghi_chu`, `created_at`. RLS: chỉ chủ nháp (`created_by =
  auth.uid()`) đọc/sửa/xóa nháp của chính mình — đây là staging cá nhân, không phải dữ liệu chung.
- Action `saveDraftKien(input)` — chỉ INSERT, KHÔNG chạy check tồn kho/max_per_kien (đó là lý do
  "Lưu tạm" nhanh hơn "Gửi" hiện tại) — vẫn có thể chạy `resolveKienForConfirm` lúc quét để hiển thị
  thông tin tham khảo, nhưng phải ghi rõ trên UI đây là thông tin **tại thời điểm quét, không đảm
  bảo còn đúng lúc Gửi thật** (đặc biệt vì có thể cách nhau vài tiếng).
- Action `loadDrafts(factoryId, userId)` / `deleteDraft(draftId)` — cho khối UI mới "Đang chờ gửi"
  trong Hub (tách biệt hẳn với "Lịch sử ca" — khối đó chỉ hiện dữ liệu ĐÃ gửi thật).
- **RPC atomic mới** (bắt buộc — không được viết bằng N lệnh gọi `saveLotTransaction()` tuần tự từ
  JS, vì sẽ tái tạo đúng loại race/partial-write mà `sync_lot_master_snapshot`/`delete_lot_transaction`/
  `create_lot_prediction_batch` đã từng phải sửa): `submit_confirm_draft_batch(p_draft_ids uuid[])`
  chạy trong 1 transaction Postgres duy nhất:
  1. Khóa các dòng `lots` liên quan (`FOR UPDATE`), gộp draft theo khóa `(ma_lo, ngan_id, ngay_sx,
     ca, boc, pallet, chi_thi)` — chỉ gộp khi TẤT CẢ các trường này giống hệt nhau; khác bất kỳ
     trường nào (kể cả 2 kiện cùng lô nhưng khác ngăn/bọc/pallet — vẫn là tình huống hợp lệ theo
     rule cũ "khác kiện được phép khác bọc/pallet") thì giữ thành dòng riêng.
  2. Trong mỗi nhóm, 1 chữ cái kiện (A/B/C/D) không được xuất hiện quá 1 lần — nếu trùng (quét lại
     cùng kiện 2 lần trong cùng lượt chưa gửi), coi là lỗi cần người dùng tự xóa bớt nháp trùng
     trước khi gửi lại (không tự động cộng dồn hay tự chọn dòng nào "đúng hơn").
  3. Re-validate TỪNG dòng đã gộp bằng ĐÚNG logic hiện có của `confirmKienProduction`: tổng bành
     mỗi kiện so với `max_per_kien` (cộng dồn với dữ liệu thật hiện có), và capacity 110% của ngăn
     đích — **capacity phải cộng dồn TÍCH LŨY qua toàn bộ các dòng trong CÙNG 1 lượt gửi cùng chạm
     1 ngăn** (2 lô khác nhau nhưng cùng ngăn trong 1 lượt gửi, mỗi dòng tự nó "vừa" nhưng cộng lại
     có thể vượt 110% — phải tính lũy kế khi duyệt tuần tự trong transaction, mirror kỹ thuật đã
     dùng ở `create_lot_prediction_batch`).
  4. Nếu BẤT KỲ dòng nào không hợp lệ → `RAISE EXCEPTION` với thông tin rõ ràng (mã lô + kiện + lý
     do) → toàn bộ transaction rollback, KHÔNG dòng nào được ghi, nháp giữ nguyên (đúng quyết định
     "chặn toàn bộ" đã chốt).
  5. Nếu tất cả hợp lệ → ghi từng dòng gộp vào `lot_transactions` (tạo lô mới nếu cần, giống nhánh
     insert của `saveLotTransaction`), gọi `sync_lot_master_snapshot` cho từng lô bị ảnh hưởng, rồi
     XÓA toàn bộ draft đã tiêu thụ trong `p_draft_ids` — tất cả trong cùng transaction.
- UI: nút "GỬI DỮ LIỆU" ở form quét đổi thành "LƯU TẠM" (primary trong luồng quét); Hub có thêm
  block "Đang chờ gửi (N)" liệt kê nháp + nút xóa từng dòng + nút to "Gửi tất cả (N)" gọi RPC trên.
  Khi Gửi thất bại, hiện danh sách lỗi rõ theo từng dòng (mã lô/kiện/lý do), giữ nguyên toàn bộ nháp.
- **Cần rà lại tương tác với 3 tính năng vừa làm ở phiên 2026-07-15**:
  - Cảnh báo "nhảy lô" (`checkLotCompleteness`) hiện chỉ đọc `lots.kien_a-d` (dữ liệu ĐÃ gửi thật) —
    cần cân nhắc có nên cộng thêm cả kiện đang nằm trong nháp CHƯA gửi hay không (advisory, vì nháp
    chưa chắc gửi thành công) trước khi coi 1 lô là "đã đủ kiện".
  - "Kết thúc ca" nên cảnh báo/chặn nếu vẫn còn nháp chưa gửi (rất dễ quên bấm "Gửi tất cả" cuối
    ca) — gợi ý hỏi rõ "Còn N nháp chưa gửi — gửi ngay bây giờ?" trước khi cho xuất phiếu.
  - Rule "cùng kiện lần sau phải cùng bọc/pallet với lần trước" (`existingKienBoc/existingKienPallet`)
    hiện chỉ so với `lot_transactions` thật trong DB — nếu 2 nháp CHƯA gửi của cùng kiện có bọc/pallet
    khác nhau, cần phát hiện mismatch ngay lúc "Lưu tạm" (không đợi tới lúc Gửi mới báo lỗi).
- **Quy mô**: đây là thay đổi kiến trúc lớn hơn hẳn 7 mục đã làm ở phiên 2026-07-15 (bảng DB mới +
  RPC atomic phức tạp xử lý gộp/validate/ghi nhiều dòng trong 1 transaction + UI rework luồng Lưu
  tạm/Gửi/Đang chờ gửi). Nên cân nhắc tách làm 2 phiên: (1) DB + RPC + action lớp server trước, test
  kỹ logic gộp/validate bằng script; (2) UI sau khi backend đã ổn định.

### Fix 2026-07-15 (bug người dùng báo, trước kế hoạch "Lưu tạm") — 2 bug đã fix

**Bug 1 — "GỬI DỮ LIỆU" báo lỗi "Khong dong bo duoc lo: structure of query does not match function result type"**:
migration `20260715_sync_lot_master_snapshot_returns_row.sql` khai báo `RETURNS TABLE(kien_a numeric,
kien_b numeric, kien_c numeric, kien_d numeric, tong_banh numeric, ...)` nhưng 5 cột này trong bảng
`lots` thật là `INTEGER` (`supabase/schema.sql`). `RETURN QUERY SELECT lots.kien_a, ...` select thẳng
từ bảng nên trả về `integer` thật — PL/pgSQL yêu cầu kiểu trả về phải binary-coercible với khai báo
`RETURNS TABLE`, và `int4 → numeric` chỉ là assignment-cast (không binary-coercible) nên Postgres
raise đúng lỗi trên. Lỗi này chặn cả `saveLotTransaction()`/`confirmKienProduction()` (nút "GỬI DỮ
LIỆU") lẫn `delete_lot_transaction()` (gọi `PERFORM sync_lot_master_snapshot(...)`), vì exception
xảy ra ngay khi Postgres build tuple descriptor, trước khi `PERFORM` kịp bỏ qua kết quả.

Đã fix bằng migration mới `supabase/migrations/20260715_fix_sync_lot_master_snapshot_kien_types.sql`
— `DROP FUNCTION` + `CREATE FUNCTION` lại y hệt logic cũ, chỉ sửa `RETURNS TABLE` đổi 5 cột
`kien_a/b/c/d/tong_banh` từ `numeric` sang `integer` cho khớp đúng kiểu thật của `lots`. **Migration
này CẦN CHẠY THỦ CÔNG trên Supabase SQL Editor** — nếu chưa chạy, lỗi vẫn y nguyên trên production.

**Bug 2 — Cột "Trực ca" trong PDF "Phiếu báo thành phẩm nhập kho" bị chồng chữ**: trong
`src/app/dashboard/product/confirm/shift-report-pdf.ts`, `didParseCell` set `hookData.cell.text = []`
cho cột Trực ca (coi cell rỗng) khiến `autoTable` tính `rowHeight` chỉ đủ 1 dòng, trong khi
`drawTrucCaCell()` vẽ `line1` (ngày+giờ ghép 1 chuỗi) bằng `doc.text(..., {maxWidth})` — chuỗi
`"dd/mm/yyyy hh:mm:ss"` (~19 ký tự) vượt quá `maxTextWidth` (~16.5mm) nên jsPDF tự wrap thành 2 dòng
con, nhưng `line2` (tên người) vẫn vẽ ở offset Y cố định tuyệt đối, không biết `line1` vừa chiếm
thêm 1 dòng → dòng giờ đè lên dòng tên.

Đã fix: thêm hàm dùng chung `computeTrucCaLines(doc, raw, cellWidth)` đo số dòng THẬT của cả 2 phần
(ngày-giờ, tên) bằng `doc.splitTextToSize()` trước khi vẽ; `drawTrucCaCell()` vẽ tuần tự từng dòng
theo `cursorY` tăng dần (không còn offset cố định). Cả 2 hook đều dùng chung
`COLUMN_WIDTHS[TRUC_CA_COL_INDEX]` làm `cellWidth` (không đọc từ `cell.width`) để đảm bảo kết quả đo
số dòng khớp nhau tuyệt đối giữa 2 lần gọi. Không đổi `COLUMN_WIDTHS`/độ rộng cột nào khác.

**Fix vòng 2 (cùng ngày, sau khi người dùng test lại và vẫn thấy chồng chữ — ảnh `cung_cap_dl/3.jpg`)**:
bản fix đầu tiên set `hookData.cell.text = [...line1, ...line2]` (nội dung thật) trong `didParseCell`
— đây là bug MỚI do chính fix đầu gây ra: `autoTable` luôn tự vẽ mặc định bất kỳ text nào còn lại
trong `cell.text` (bằng font/màu mặc định của `bodyStyles`, gần đen) **trước khi** `didDrawCell`
chạy — nên set `cell.text` thành nội dung thật khiến nó bị vẽ **2 lần chồng nhau**: 1 lần mặc định
màu đen (không có badge, không đúng vị trí) + 1 lần màu xanh/xám tự vẽ tay ở `didDrawCell`. Đã sửa
lại: `didParseCell` giờ set `cell.text = Array(line1.length + line2.length).fill(" ")` (placeholder
rỗng đúng SỐ LƯỢNG dòng cần thiết) — vẫn giữ đúng `rowHeight` như tính toán từ `computeTrucCaLines`,
nhưng không còn nội dung nhìn thấy được để `autoTable` vẽ mặc định, chỉ còn đúng 1 lớp vẽ tay của
`drawTrucCaCell` (dấu tích xanh + dòng ngày-giờ xanh + dòng tên xám/đen bên dưới, không chồng nhau).

`npx tsc --noEmit` + `npx eslint` sạch. **Chưa test tay** — cần mở lại "Xem phiếu PDF" cho 1 ngày có
dữ liệu quét, xác nhận cột "Trực ca" chỉ còn đúng 1 lớp chữ (dấu tích xanh, dòng ngày-giờ xanh, dòng
tên bên dưới), không còn chồng chữ hay chồng 2 lớp màu.

### Fix 2026-07-15 (bug người dùng báo, tiếp) — "Kết thúc ca" báo nhầm kiện đã đủ vẫn còn thiếu

**Bug 3 (hệ quả của Bug 1, không phải bug code mới)**: người dùng test "Kết thúc ca" thấy modal cảnh
báo "Còn 2 lô dở dang chưa đủ kiện" liệt kê `1117cs/26 — Kiện A, B, C, D` (báo thiếu CẢ 4 kiện), dù
log "Lịch sử ca" cùng lúc đó hiện rõ `1117cs/26 - Kiện B - 36 bành` đã được quét/gửi thành công (xem
`cung_cap_dl/1.jpg` và `cung_cap_dl/2.jpg`) — tức kiện B đã đủ 36/36 bành, không nên bị liệt vào
danh sách thiếu.

**Nguyên nhân xác nhận**: `checkIncompleteLotsForDay()`/`checkLotCompleteness()`
(`confirm/actions.ts`) đọc thẳng `lots.kien_a/b/c/d` (đã đồng bộ sẵn qua RPC — logic của 2 hàm này
hoàn toàn đúng, không cần sửa) để so với `max_per_kien`. Nhưng đúng lúc lô `1117cs/26` được quét kiện
B, RPC `sync_lot_master_snapshot` đang gặp Bug 1 (type-mismatch) — `saveLotTransaction()` INSERT
`lot_transactions` thành công (round-trip độc lập, đã commit) nhưng lệnh gọi RPC theo sau để đồng bộ
`lots.kien_b` luôn ném lỗi, khiến `lots.kien_b` của lô này bị "kẹt" ở `0` dù `lot_transactions` đã có
đủ 36 bành thật. Vì không có giao dịch mới nào cho lô này kể từ đó để tự kích hoạt resync, dữ liệu
`lots` vẫn sai cho tới khi được resync thủ công.

**Fix — data repair, không phải code fix**: migration mới
`supabase/migrations/20260715_resync_dodang_lots_kien.sql` — vòng lặp `PERFORM
sync_lot_master_snapshot(lot.id)` cho **mọi lô `trang_thai IN ('Dở dang', 'Do dang')`**, tính lại
đúng `kien_a-d`/`tong_banh`/`trang_thai` từ `lot_transactions` thật. **Migration này CẦN CHẠY THỦ
CÔNG trên Supabase SQL Editor, và PHẢI chạy SAU migration
`20260715_fix_sync_lot_master_snapshot_kien_types.sql`** (RPC phải đã có chữ ký đúng trước, nếu
không sẽ gặp lại đúng lỗi type-mismatch cho mọi lô). **Cố ý KHÔNG resync lô `Hoàn thành`/`Xuất
hàng`** — `sync_lot_master_snapshot()` tự tính lại `trang_thai` chỉ giữa `'Hoàn thành'`/`'Dở dang'`,
không biết về `'Xuất hàng'`, nên gọi trên lô đã xuất hàng sẽ hạ nhầm về `'Hoàn thành'`.

**Chưa test tay** — cần chạy đủ 3 migration theo đúng thứ tự (`..._returns_row.sql` đã có từ trước →
`..._fix_sync_lot_master_snapshot_kien_types.sql` → `..._resync_dodang_lots_kien.sql`), sau đó vào
lại "Kết thúc ca" cho đúng ngày/lô `1117cs/26` xác nhận modal chỉ còn báo thiếu kiện A/C/D (không còn
B), và xác nhận lô `Xuất hàng` bất kỳ khác trong hệ thống không bị đổi trạng thái sau khi chạy
migration repair.

### Cập nhật 2026-07-15 (tiếp) — Phase 1 backend cho "Lưu tạm nhiều kiện rồi Gửi 1 lần" (ĐÃ CODE, CHƯA CHẠY MIGRATION)

Đã triển khai đúng thiết kế ở mục "Kế hoạch phiên sau" phía trên, phần Phase 1 (DB + RPC + server
actions). Phase 2 (UI: đổi nút "GỬI DỮ LIỆU" → "LƯU TẠM", khối "Đang chờ gửi" trong Hub, cảnh báo
"còn nháp chưa gửi" ở "Kết thúc ca") **cố ý chưa làm** — dừng đúng theo yêu cầu tách 2 bước.

**Quyết định thiết kế quan trọng, khác 1 chi tiết so với mô tả gốc ở "Kế hoạch phiên sau"**:
KHÔNG gộp nhiều kiện (A/B/C/D) khác nhau của cùng 1 lô vào chung 1 dòng `lot_transactions` khi Gửi
cả lượt (mô tả gốc nói "các kiện cùng lô có cùng ngăn/bọc/pallet/... sẽ tự gộp thành 1 dòng"). Lý
do: `editShiftHistoryEntry()` giả định mỗi dòng `lot_transactions` chỉ thuộc đúng 1 kiện
(`kienKeyEntries.find(([, v]) => v > 0)` — chỉ lấy kiện khác-0 đầu tiên); nếu gộp 2 kiện vào 1
dòng, nút "Sửa" trong "Lịch sử ca" sẽ âm thầm mất dữ liệu của kiện thứ 2. Mỗi nháp luôn tạo đúng 1
dòng `lot_transactions` khi Gửi (khớp 100% cách `confirmKienProduction` đang ghi hôm nay).

**Migration `supabase/migrations/20260716_product_confirm_drafts.sql` (CẦN CHẠY THỦ CÔNG, CHƯA CHẠY)**:

- Bảng `product_confirm_drafts` — nháp cá nhân trên thiết bị quét, RLS chỉ chủ nháp
  (`created_by = auth.uid()`), không có ngoại lệ admin (khác `operation_notes`). Thực tế mọi truy
  cập đi qua server actions dùng `getSupabaseAdmin()` (bypass RLS) nên quyền sở hữu được enforce
  chính bằng tham số `p_user_id` tường minh trong RPC, RLS chỉ là lớp phòng vệ bổ sung.
- RPC atomic `submit_confirm_draft_batch(p_draft_ids UUID[], p_user_id UUID, p_recomputed JSONB)`
  — validate + ghi toàn bộ nháp đã chọn trong 1 transaction, all-or-nothing (1 nháp lỗi thì rollback
  toàn bộ, giữ nguyên mọi nháp kể cả các nháp hợp lệ đứng trước trong cùng batch). Nội dung:
  - Pre-check `p_draft_ids` không rỗng/không trùng/tất cả tồn tại và thuộc `p_user_id`.
  - Lock trước `ngans`/`lots` liên quan (order theo `id`/`ma_lo`) để tránh deadlock khi nhiều thiết
    bị cùng "Gửi tất cả" chạm chung ngăn/lô — mirror `create_lot_prediction_batch`, mở rộng cho
    nhiều dòng/1 lệnh gọi.
  - Trong vòng lặp từng nháp: `pg_advisory_xact_lock` theo `(factory_id, ma_lo)` trước khi tạo lô
    mới (bảng `lots` không có UNIQUE constraint thật trên `(factory_id, ma_lo)` — rủi ro có sẵn ở
    `saveLotTransaction`, batch làm tăng khả năng va chạm nên khóa thêm ở đây); resolve/tạo lô
    (parse `ma_lo` bằng `regexp_match`, chặn nếu lô đã tồn tại và không phải "Dở dang"/"Do dang");
    check tổng bành đúng kiện so với `max_per_kien` LẤY TỪ `p_recomputed` (không tin cột
    `max_per_kien` đã lưu ở bảng nháp từ lúc Lưu tạm — RPC luôn nhận giá trị JS tính lại NGAY
    TRƯỚC khi gọi, tránh lệch nếu mapping `loai_csr/loai_banh → max_per_kien` từng đổi giữa lúc Lưu
    tạm và Gửi, có thể cách nhau cả ca); check đồng nhất Bọc/Pallet với dòng gần nhất của đúng kiện
    (dùng `IS DISTINCT FROM`, không dùng `<>` vì `<>` trả `NULL` khi 1 vế `NULL` sẽ im lặng bỏ qua
    lỗi); check 110% ngăn. Cả 2 phép SUM (tổng bành theo kiện, tổng kg theo ngăn) tự động lũy kế
    đúng trong batch nhờ Postgres "read-your-own-writes" trong cùng transaction, không cần biến
    accumulator riêng.
  - `INSERT lot_transactions` (chỉ 1 cột kiện khác 0) + `DELETE` nháp vừa xử lý ngay trong vòng lặp
    — nếu 1 nháp sau đó fail, transaction rollback tự khôi phục cả các `DELETE`/`INSERT` trước đó.
  - Sau vòng lặp: `sync_lot_master_snapshot()` cho từng lô DISTINCT đã chạm.
- `src/app/dashboard/product/confirm/actions.ts` thêm (không sửa hàm cũ): `saveDraftKien()` (ghi 1
  nháp, chỉ validate field bắt buộc, KHÔNG validate tồn kho/capacity — đúng tinh thần "Lưu tạm rẻ"),
  `loadDrafts()`, `deleteDraft()`, `submitConfirmDraftBatch()` (tính lại `max_per_kien` fresh qua
  `getLoaiBanhConfig()` rồi mới gọi RPC; bắt riêng lỗi deadlock Postgres `40P01` thành message thân
  thiện "thử lại"; sau khi RPC thành công, gọi `markLotPredictionRealized()` best-effort cho các lô
  mới tạo trong batch qua `Promise.allSettled`, không chặn kết quả thành công của action).
- `checkLotCompleteness()`/`checkIncompleteLotsForDay()` (cùng file) thêm tham số optional
  `pendingKien`/`pendingByMaLo` — coi kiện đang nằm trong nháp CHƯA gửi là "đã có" khi tính
  `missingKien`, tránh cảnh báo "nhảy lô"/"còn thiếu kiện" sai. Backward-compatible 100% (default
  rỗng giữ nguyên hành vi cũ) — Phase 2 (UI) sẽ truyền danh sách nháp thật vào 2 tham số này.
- `scripts/test-confirm-draft-batch.mjs` — script kiểm tra RPC trên dữ liệu thật (tự tạo 1 ngăn tạm
  + các lô/nháp test riêng biệt, mã lô luôn có suffix `test` + năm `99` để không đụng dữ liệu sản
  xuất thật, tự cleanup trong `finally` kể cả khi có test fail giữa chừng). 4 kịch bản: (1) batch
  hợp lệ 3 kiện khác nhau → đúng 1 lô + 3 dòng + nháp bị xóa hết; (2) vượt `max_per_kien` lũy kế
  trong batch → rollback toàn bộ, không lô nào được tạo, cả 3 nháp còn nguyên; (3) lệch Bọc giữa 2
  lần nhập cùng kiện trong batch → rollback toàn bộ; (4) gọi RPC với `p_user_id` không khớp
  `created_by` thật → bị chặn ở ownership pre-check, không ghi gì.

**Trạng thái xác nhận**: `npx tsc --noEmit` và `npx eslint` sạch trên `confirm/actions.ts` và script
mới. **CHƯA chạy migration `20260716_product_confirm_drafts.sql` trên Supabase** (không có Supabase
CLI/kết nối Postgres trực tiếp trong môi trường này, đúng convention dự án — mọi migration DDL đều
phải chạy tay qua Supabase SQL Editor) — do đó **`scripts/test-confirm-draft-batch.mjs` cũng CHƯA
được chạy thật**, chỉ mới viết xong và qua lint/tsc. Việc cần làm trước khi coi Phase 1 hoàn tất:

1. Chạy `supabase/migrations/20260716_product_confirm_drafts.sql` trong Supabase SQL Editor.
2. Chạy `node --env-file=.env.local scripts/test-confirm-draft-batch.mjs`, xác nhận cả 4 test PASS
   (đặc biệt test 2/3 — bài test all-or-nothing rollback là quan trọng nhất).
3. Sau khi Phase 1 xác nhận ổn định, mới làm Phase 2 (UI) — xem mô tả Phase 2 ở mục "Kế hoạch phiên
   sau" phía trên (chưa cần sửa lại mục đó, vẫn còn đúng làm phác thảo cho Phase 2).

**Bug đã fix sau lần chạy thử đầu tiên (2026-07-15, cùng ngày)**: chạy migration + script lần đầu
báo lỗi `column reference "ma_lo" is ambiguous` ở test 1. Nguyên nhân: `RETURNS TABLE(draft_id,
lot_id, ma_lo, kien, so_kg)` tự khai báo các OUT parameter cùng tên với cột thật của `lots`/
`lot_transactions`/`product_confirm_drafts` — bất kỳ tham chiếu **không qualify alias** tới
`ma_lo`/`lot_id` bên trong thân hàm đều bị Postgres coi là ambiguous (đúng landmine đã gặp và ghi
lại ở `delete_lot_transaction`, xem `20260714_fix_delete_lot_transaction_ambiguous_column.sql`) —
tôi đã đọc bug đó trước khi viết RPC này nhưng vẫn bỏ sót 3 chỗ. Đã sửa (qualify bằng alias
`lk`/`pcdk`/`l`/`ltk`) ở 3 vị trí trong `20260716_product_confirm_drafts.sql`: (1) câu lock trước
`lots` theo `ma_lo` (dùng alias `lk` cho `lots`, `pcdk` cho `product_confirm_drafts`); (2) câu
resolve/tìm lô theo `ma_lo` trong vòng lặp (alias `l`); (3) câu SUM tổng bành theo kiện từ
`lot_transactions` (alias `ltk`). Đồng thời đã siết lại `scripts/test-confirm-draft-batch.mjs` —
test 2/3/4 giờ **assert cả nội dung message lỗi** (không chỉ `error` truthy), vì phát hiện ra rằng
bug ambiguous-column này có thể khiến các test đó "PASS nhầm lý do" (lỗi bất kỳ nào cũng thỏa mãn
`assert(!!error)`, kể cả lỗi SQL không liên quan gì đến business logic đang test).

**Bug thứ 2 phát hiện ngay sau đó (cùng ngày, lần chạy tiếp theo)**: sau khi fix ambiguous-column,
cả 3 test 1/2/3 đều fail với cùng lỗi `Mã lô "899001test1083a/99" không hợp lệ.` — hóa ra là bug
trong CHÍNH SCRIPT TEST, không phải RPC: `maLoFor()` bản đầu nhúng timestamp (`RUN_SUFFIX = "test" +
Date.now()...`) vào giữa phần suffix của mã lô, tạo ra chuỗi như `"899001test1083a"` — phần sau số
gốc lẫn cả chữ lẫn số, không khớp `^(\d+)([a-z]*)\/(\d{2,4})$` (suffix phải là chữ thường THUẦN
TÚY). RPC từ chối đúng theo thiết kế; bug là ở dữ liệu test tự tạo, không phải logic RPC. Đã sửa
`maLoFor()` để mã lô test luôn hợp lệ: `${RUN_ID}${testIndex}test/99` — toàn bộ phần số (RUN_ID +
testIndex) đứng trước, suffix cố định `"test"` (chữ thường thuần túy) đứng sau, năm cố định `"99"`.

**Trạng thái cuối cùng — ĐÃ XÁC NHẬN PASS trên dữ liệu thật**: chạy lại
`node --env-file=.env.local scripts/test-confirm-draft-batch.mjs` sau cả 2 fix trên, kết quả
**"Tất cả 4 test PASS"** — bao gồm cả assertion nội dung message lỗi đã siết ở test 2/3/4 (không
chỉ "có lỗi" mà đúng lỗi kỳ vọng: test 2 nhắc "vượt quá...bành", test 3 nhắc "Bọc", test 4 nhắc
"quyền"). Script tự cleanup dữ liệu test sau khi chạy (đã xác nhận log "Đã dọn dẹp xong."). Migration
`20260716_product_confirm_drafts.sql` đã chạy thành công trên Supabase — **Phase 1 hoàn tất**,
chuyển sang Phase 2 (UI) khi được yêu cầu.

### Cập nhật 2026-07-15 (tiếp) — Phase 2 (UI) cho "Lưu tạm nhiều kiện rồi Gửi 1 lần" (ĐÃ CODE)

Đã triển khai đúng phác thảo Phase 2 ở mục "Kế hoạch phiên sau" phía trên, trên nền Phase 1 đã xác
nhận PASS:

- **`confirm/page.tsx` — form quét**: nút "GỬI DỮ LIỆU" đổi thành **"LƯU TẠM"**, gọi `saveDraftKien()`
  thay vì `confirmKienProduction()` (hàm cũ vẫn giữ nguyên trong `confirm/actions.ts`, không xóa —
  chỉ không còn được gọi từ UI này). Điều kiện enable nút đổi tên `canSubmit` → `canSaveDraft`,
  **giữ nguyên y hệt** các điều kiện cũ (không có gì để "bỏ 110%/max_per_kien" thật sự — client vốn
  chưa từng tự check 110% ngăn, chỉ có `stepperMax` là clamp `max_per_kien` phía client, vẫn giữ).
  Toast thành công đổi sang key `daLuuTamThanhCong`.
- **Hub — khối mới "Đang chờ gửi (N)"**: đặt ngay dưới nút "Quét QR", trên khối "Log dữ liệu đã gửi"
  (nền amber để phân biệt "cần hành động" khỏi phần lịch sử). Danh sách từ `loadDrafts()` (tự refetch
  mỗi khi vào Hub, cùng effect pattern với `refreshHistory`), mỗi dòng có nút xóa (`deleteDraft`).
  Nút "Gửi tất cả (N)" gọi `submitConfirmDraftBatch()` — khi lỗi hiện đúng 1 message (đúng bản chất
  all-or-nothing của RPC), giữ nguyên toàn bộ danh sách nháp để sửa/xóa rồi thử lại; khi thành công
  refetch cả `pendingDrafts` lẫn `history` (dòng vừa gửi hiện ngay trong "Lịch sử ca" nếu đang xem
  đúng ngày/ca đó).
- **"Kết thúc ca" — thêm giai đoạn mới `"pendingDrafts"`** (chèn giữa `"confirm"` và `"warning"` cũ,
  `endShiftPhase` giờ có 4 giá trị): `handleEndShiftFirstConfirm()` tái dùng thẳng state `pendingDrafts`
  đã được Hub tải sẵn (không fetch lại — vì modal này luôn mở trong lúc `view` vẫn là `"hub"`) — nếu
  còn nháp, chặn ở giai đoạn này với 2 lựa chọn: **"Gửi nháp ngay"** (gọi `submitConfirmDraftBatch`
  rồi tự động tiếp tục sang bước kiểm tra lô dở dang cũ) hoặc **"Bỏ qua, vẫn kết thúc ca"** (bỏ qua
  nháp, dữ liệu trong các nháp đó sẽ KHÔNG có trong phiếu vì chưa từng ghi DB — đúng cảnh báo đã hiện
  rõ trong modal). Logic kiểm tra lô dở dang cũ được tách thành hàm dùng chung
  `continueEndShiftAfterDrafts()`, gọi lại từ cả nhánh "không có nháp" lẫn 2 nhánh xử lý nháp trên.
- **i18n**: thêm 12 key mới (cả `vi`/`km`) — `luuTam`, `dangLuu`, `daLuuTamThanhCong`,
  `pendingDraftsTitle`, `noPendingDrafts`, `submitAllDrafts`, `submittingAllDrafts`,
  `submitAllSuccess`, `pendingDraftsBlockingTitle`, `pendingDraftsBlockingBody`, `sendDraftsNow`,
  `endShiftIgnorePending`. 3 key cũ (`guiDuLieu`, `dangGui`, `daGuiThanhCong`) giữ nguyên trong từ
  điển dù không còn được gọi từ `page.tsx` (không xóa — chỉ là data trong `DICT`, không phải code
  chết cần dọn, và vẫn hữu ích nếu sau này có nơi khác dùng lại `confirmKienProduction`).

**Quyết định cố ý KHÔNG làm trong Phase 2 này**: "cảnh báo nhảy lô" (`lotJumpWarning`,
`checkLotCompleteness` gọi trong lookup effect khi đổi `maLo`) **giữ nguyên hoàn toàn không đụng
tới** — không wire tham số `pendingKien` mới (đã thêm ở Phase 1) vào đây, và **không** cập nhật
`lastSubmittedMaLoRef.current` trong `handleSaveDraft`. Lý do: nếu cập nhật ref này mà không đồng
thời wire `pendingKien`, cảnh báo sẽ **luôn báo sai** mỗi lần đổi lô sau một lần Lưu tạm (vì
`lots.kien_a-d` trong DB chưa đổi, chỉ có nháp chưa gửi) — tệ hơn cả việc không có cảnh báo. Chọn
phương án an toàn nhất: để cảnh báo này ở trạng thái "ngủ" (không còn gì kích hoạt nó từ form quét
nữa, vì hành động chính giờ là Lưu tạm chứ không phải Gửi ngay) thay vì sửa nó sai. Đây là thay đổi
hành vi cần lưu ý — nếu người dùng muốn khôi phục cảnh báo này, cần thiết kế lại có wire pendingKien
(đã có sẵn tham số ở `checkLotCompleteness`/`checkIncompleteLotsForDay`, chỉ chưa có nơi gọi truyền
vào).

**Trạng thái xác nhận**: `npx tsc --noEmit`, `npx eslint` (toàn bộ `confirm/page.tsx`,
`confirm/i18n.ts`, `confirm/actions.ts`), và `npm run build` đều sạch/pass. **CHƯA test tay trên
trình duyệt/điện thoại thật** — cần: quét 1 kiện → Lưu tạm → xác nhận toast + quay về Hub + khối
"Đang chờ gửi" hiện đúng dòng vừa lưu; lặp lại 2-3 kiện khác lô → bấm "Gửi tất cả" → xác nhận thành
công, khối "Đang chờ gửi" trống, "Lịch sử ca" hiện các dòng mới; cố tình tạo 1 nháp vượt
max_per_kien/110% rồi Gửi tất cả cùng các nháp hợp lệ khác → xác nhận TOÀN BỘ bị từ chối với đúng 1
message rõ ràng, danh sách nháp vẫn còn nguyên; bấm "Kết thúc ca" khi còn nháp chưa gửi → xác nhận
đúng giai đoạn cảnh báo mới hiện ra, thử cả 2 nhánh "Gửi nháp ngay" và "Bỏ qua, vẫn kết thúc ca".

### Cập nhật 2026-07-15 (tiếp) — Cảnh báo vượt hạn mức + tiến độ ca trước (nháp chưa gửi, cross-user)

Sau khi test tay Phase 1+2, người dùng phát hiện 1 gap thật: `resolveKienForConfirm()` (hàm tính
giới hạn bành khi quét) chỉ đọc `lot_transactions` (đã gửi), **không biết gì về `product_confirm_drafts`
(nháp chưa gửi)** — kể cả nháp của chính người đang quét. Và `loadDrafts()` chỉ trả nháp của đúng
`created_by = userId`, nên ca sau không thấy nháp ca trước để lại nếu ca trước chỉ Lưu tạm mà chưa
Gửi. Ví dụ cụ thể: ca A Lưu tạm lô 1081cs kiện A 15 bành (chưa Gửi) → ca B quét đúng kiện A phải bị
chặn không vượt quá 21 bành (36−15), nhưng hệ thống cũ cho phép tới 36 vì không biết có nháp đó.

**2 tính năng đã thêm** (`confirm/actions.ts` + `confirm/page.tsx`, không đổi schema DB):

1. **`resolveKienForConfirm()` giờ "draft-aware"** — hàm mới `loadPendingDraftAggregateForKien(factoryId,
   maLo, kien)` SUM `so_banh` từ `product_confirm_drafts` của đúng `(ma_lo, kiện)` **từ TẤT CẢ người
   dùng trong nhà máy** (không filter theo `created_by`), kèm tên hiển thị của những người đang có
   nháp đó. Cả 2 nhánh (`lot` tồn tại và chỉ có `predicted`) giờ tính `totalClaimed = existingBanh
   (đã gửi) + pendingDraftBanh (đang chờ gửi, mọi người)` để suy ra `remainingBanh` (clamp stepper)
   và trạng thái:
   - `existingBanh >= maxPerKien` → `"produced"` (không đổi — đã gửi thật, đủ).
   - `totalClaimed >= maxPerKien` (đủ nhưng phần lớn/toàn bộ là nháp chưa gửi) → status **mới
     `"drafted_full"`** — khác `"produced"` để không báo nhầm "đã sản xuất"; UI hiện CardMessage +
     nút "Quét kiện khác", không cho nhập thêm.
   - Còn lại → `"partial"`/`"partial_kien"` như cũ, nhưng `isPartialKien` giờ dựa vào
     `totalClaimed > 0` (không chỉ `existingBanh > 0`) — một lô CHƯA TỪNG tồn tại trong `lots`
     (chỉ có `lot_prediction_lots`) nhưng đã có nháp chưa gửi cũng chuyển sang `partial_kien` thay
     vì `predicted` thuần túy, để bắt buộc đồng nhất Bọc/Pallet với nháp đó.
   - `existingKienBoc`/`existingKienPallet` (dùng để pre-fill + chặn lệch Bọc/Pallet khi top-up)
     giờ ưu tiên dữ liệu nháp MỚI NHẤT nếu có, fallback về dữ liệu đã gửi gần nhất — đóng luôn 1 gap
     khác đã phát hiện lúc thiết kế: trước đây 2 ca dùng Bọc khác nhau cho cùng kiện có thể "lách"
     qua nhau nếu 1 bên chỉ Lưu tạm (không được RPC Gửi kiểm tra vì chỉ so với `lot_transactions`).
   - `ConfirmKienLookup` thêm 2 field: `pendingDraftBanh: number`, `pendingDraftBy: string[]`.
2. **`saveDraftKien()` chặn cứng vượt `max_per_kien` ngay lúc Lưu tạm** (khác 110% ngăn/hạn mức tổng
   thể — vẫn để RPC Gửi validate cuối) — tính `committedBanh` (query `lots`+`lot_transactions`) +
   `pendingAgg.totalBanh` (nháp mọi người) trước khi cho phép insert; từ chối với message rõ ràng
   nếu `totalClaimed + soBanh > maxPerKien`. Đây là bài test race hiếm gặp duy nhất còn tồn tại
   (2 người Lưu tạm cùng lúc trong vài mili-giây) — chấp nhận được vì RPC Gửi vẫn là nguồn chân lý
   cuối cùng, atomic, sẽ rollback toàn batch nếu thực sự vượt.
3. **`checkOtherIncompleteLotsForCategory(factoryId, loaiCsr, dayChuyen, excludeMaLo)`** — hàm mới,
   không chặn thao tác: quét TẤT CẢ lô khác (không phải lô đang quét) cùng `loai_csr` (+ `day_chuyen`
   nếu có) đang `Dở dang`, **bất kể làm ngày nào** (dù cùng ngày hay khác ngày với lô đang quét) —
   tính cả nháp chưa gửi (mọi người) khi xác định kiện nào thực sự còn thiếu bao nhiêu bành, để
   không báo sai nếu thực ra đã có người Lưu tạm. Gọi song song mỗi lần quét 1 kiện (không đợi, chạy
   độc lập với `lookupLoading`), hiện banner màu sky **thường trực** (không tự tắt, chỉ đổi khi đổi
   `maLo`) liệt kê từng lô + kiện + số bành còn thiếu — đúng ví dụ người dùng đưa ra ("lô 1080cs
   đang dở dang kiện D thiếu 15 bành"), không chặn thao tác của kiện đang quét.

**i18n mới**: `kienDaCoMotPhanWithPending`, `kienDaDuNhap`, `otherIncompleteLotsTitle`,
`missingBanhLabel` (cả `vi`/`km`) — `kienDaCoMotPhan` cũ giữ nguyên, chỉ dùng khi
`pendingDraftBanh === 0` (thuần túy dữ liệu đã gửi, không có nháp liên quan).

**Trạng thái xác nhận**: `npx tsc --noEmit`, `npx eslint`, `npm run build` toàn bộ project đều
sạch/pass. **Chưa test tay** — cần đúng kịch bản người dùng mô tả: ca A Lưu tạm lô 1081cs kiện A 15
bành (KHÔNG Gửi) → ca B (tài khoản khác) quét đúng kiện A → xác nhận stepper chỉ cho tối đa 21 bành
và banner "Kiện A: 0 bành đã gửi + 15 bành đang chờ gửi (bởi Ca A)" hiện đúng; thử nhập 22 bành →
bị chặn ngay khi bấm "Lưu tạm" (không chờ tới lúc Gửi); quét 1 kiện của lô 1081cs trong khi lô
1080cs (cùng `loai_csr`) đang dở dang kiện D thiếu 15 bành → xác nhận banner sky-blue hiện đúng,
không biến mất dù không thao tác gì thêm, và không chặn việc quét/Lưu tạm kiện đang làm.

### Cập nhật 2026-07-16 — Fix 3 bug thật đã xác nhận: kiện dở dang bị báo "Đã sản xuất", song ngữ trang Tra cứu, dọn cảnh báo "nhảy lô" chết + đơn giản hóa filter cảnh báo lô khác

**Bug 1 (nghiêm trọng nhất, đã fix) — `resolveProductLabelLookupTarget` (`src/lib/product-label.ts`)**:
hàm này (dùng bởi trang công khai `/product-label`, trang worker thấy ĐẦU TIÊN khi quét QR vật lý
trên nhãn) xác định trạng thái kiện chỉ bằng `.find(row => kien_X > 0)` — "có tồn tại giao dịch nào
> 0" — thay vì SUM tất cả giao dịch rồi so với `max_per_kien` như `resolveKienForConfirm` (hàm tương
đương dùng cho form nhập liệu thật, vốn đã đúng từ trước). Hệ quả: kiện có `kien_c = 8/36` bị coi là
`"produced"` (đã sản xuất) chỉ vì có 1 giao dịch > 0, dù còn thiếu 28 bành — và vì nút "Xác nhận sản
xuất" ở `ProductLabelClient` chỉ hiện khi `status === "predicted" || "partial"`, worker bị kẹt hoàn
toàn, không có đường vào form nhập liệu tiếp. Đã fix: thêm status mới `"partial_kien"` (mirror đúng
tên `ConfirmKienStatus` ở `confirm/actions.ts`), tính `existingBanh` bằng SUM (không phải `.find()`),
so với `maxPerKien` qua `getLoaiBanhConfig(lot.loai_csr, lot.loai_banh)` — `existingBanh >= maxPerKien`
mới là `"produced"`; `0 < existingBanh < maxPerKien` là `"partial_kien"` (mới); `existingBanh === 0`
vẫn là `"partial"` như cũ. `ProductLabelLookupResult` thêm `existingBanh: number`, `maxPerKien: number
| null`.

**Bug 2 (yêu cầu, đã làm) — song ngữ Việt/Khmer cho `/product-label` + hiển thị rõ số bành đã có**:
`ProductLabelClient` trước đây thuần Việt, không có cơ chế song ngữ nào — đã tái dùng trực tiếp hệ
thống `Lang`/`t(lang,key,vars)`/`LANG_OPTIONS`/`loadStoredLang`/`storeLang` sẵn có ở
`confirm/i18n.ts` (đang dùng cho module quét QR), thêm 17 key mới (`plPageTitle`, `plStatusPartialKien`,
`plDaSanXuatBanhCa`...) vào cả `DICT.vi`/`DICT.km`, đặt `LangToggle` góc trên card. Khi
`status === "partial_kien"`, card hiện ngay dòng amber "Đã sản xuất {existingBanh} bành — Ca {ca}"
ngay dưới header "{maLo} — Kiện {kien}" đúng thứ tự người dùng yêu cầu; nút "Xác nhận sản xuất" và
khối Ngày SX/Ca SX thật giờ mở rộng điều kiện hiện thị bao gồm cả `"partial_kien"` (trước chỉ
`"produced"`).

**Bug 3 (2 vấn đề độc lập, đã fix) — cảnh báo "lô khác còn dở dang" không nhất quán giữa 2 lần quét**:
- **3a. Code chết đã xóa hẳn**: cơ chế "cảnh báo nhảy lô" (`lastSubmittedMaLoRef`, `lotJumpWarning`,
  `checkLotCompleteness`) không bao giờ chạy được từ khi refactor sang luồng "Lưu tạm" (commit
  `565fcf9` xóa nhầm dòng `lastSubmittedMaLoRef.current = maLo` — xác nhận qua `git log -p -S`), vì
  điều kiện `if (lastSubmittedMaLoRef.current && ...)` mãi mãi `false`. Đã xóa hẳn: state + effect
  logic + JSX banner trong `confirm/page.tsx`, hàm `checkLotCompleteness` trong `confirm/actions.ts`
  (xác nhận qua grep đây là call site duy nhất trong `src/`), 2 key i18n `lotJumpWarningTitle`/
  `lotJumpWarningBody`. **Giữ nguyên** type `LotCompletenessWarning` (vẫn dùng bởi
  `checkIncompleteLotsForDay`, cơ chế cảnh báo lúc "Kết thúc ca" — độc lập, không đụng).
- **3b. Filter `day_chuyen` dư thừa đã bỏ**: cảnh báo người dùng THỰC SỰ thấy đến từ
  `checkOtherIncompleteLotsForCategory` (đang hoạt động, không phải code chết) — hàm này có filter
  phụ `if (dayChuyen) query = query.eq("day_chuyen", dayChuyen)`. Vì `loai_csr` đã tự nhiên phân tách
  Mủ tạp/Mủ nước, filter `day_chuyen` gần như dư thừa và là nguồn gây kết quả không nhất quán giữa
  các lần gọi (dữ liệu `day_chuyen` cũ/nhập tay có thể không đồng nhất). Đã bỏ tham số `dayChuyen` và
  điều kiện filter này — chữ ký hàm đổi thành `checkOtherIncompleteLotsForCategory(factoryId,
  loaiCsr, excludeMaLo)`, chỉ còn lọc theo `loai_csr`.

`npx tsc --noEmit`, `npx eslint` (6 file: `product-label.ts`, `product-label-client.tsx`,
`product-label/page.tsx`, `confirm/i18n.ts`, `confirm/actions.ts`, `confirm/page.tsx`), và
`npm run build` toàn bộ project đều sạch/pass. **Chưa test tay** — cần đúng 2 kịch bản người dùng đã
báo cáo:
- Mở `/product-label?f=...&lo=1078cs/26&kien=C` (kiện C = 8/36 bành thật) → phải thấy badge "Dở
  dang" (không phải "Đã sản xuất"), dòng "Đã sản xuất 8 bành — Ca ...", nút "Xác nhận sản xuất" hiển
  thị và dẫn đúng sang form nhập liệu với giới hạn tối đa 28 bành còn lại; toggle VI/KM đổi đúng toàn
  bộ chữ, không vỡ layout.
- Quét 2 kiện liên tiếp của cùng 1 lô (vd A rồi B của `1079cs/26`) → banner sky-blue "lô khác còn dở
  dang" phải liệt kê NHẤT QUÁN cùng danh sách ở cả 2 lần quét (không còn hiện tượng lúc có lúc không);
  xác nhận không còn banner amber "nhảy lô" nào xuất hiện; "Kết thúc ca" vẫn hoạt động bình thường.

**Xác nhận bổ sung (cùng ngày, tiếp)**: sau khi fix trên được ship, đã dùng thêm 2 Explore agent độc
lập audit lại toàn bộ giả thuyết bug 3 (1 agent đọc lại `resolveKienForConfirm` + tìm dead code sót
lại, 1 agent audit chuyên sâu khả năng race condition/stale-state ở tầng React trong effect gọi
`checkOtherIncompleteLotsForCategory`) để loại trừ khả năng còn nguyên nhân khác trước khi coi bug 3
là đã đóng hẳn. Cả 2 đều xác nhận: (1) effect gọi hàm này (`confirm/page.tsx`) đã có đầy đủ pattern
chuẩn — `alive` flag, reset `setOtherIncompleteLots([])` đồng bộ trước await, cleanup khi effect
re-run — không có race condition; (2) `resolveKienForConfirm` trả `loai_csr` ổn định, không đổi giữa
2 lần quét cùng lô; (3) filter `day_chuyen` đã bỏ đúng là root cause duy nhất và đã đủ giải quyết,
không cần sửa thêm logic nghiệp vụ nào. Nếu tương lai còn quan sát thấy banner "lô khác dở dang"
khác nhau giữa 2 lần quét CÙNG tham số, nguyên nhân hợp lý nhất KHÔNG phải bug mà là dữ liệu thật đã
đổi giữa 2 thời điểm — `checkOtherIncompleteLotsForCategory` cố ý tính cả `product_confirm_drafts`
(nháp "Lưu tạm") của **mọi người dùng**, không chỉ người đang quét, để cảnh báo real-time đa người
dùng (đúng thiết kế, không phải bug).

Đã dọn thêm 1 comment mồ côi ở `confirm/actions.ts` (nhắc tới hàm `checkLotCompleteness` đã xóa) —
đổi thành mô tả tự đủ nghĩa cho tham số `pendingByMaLo` của `checkIncompleteLotsForDay`, không đổi
hành vi. `npx tsc --noEmit`/`npx eslint` sạch sau thay đổi này.

### Cập nhật 2026-07-21 — Fix toggle ngôn ngữ bị cắt chữ Khmer, tỷ lệ Ca/Chỉ thị, gộp dòng hiển thị, bug thật Bọc/Số chỉ thị trống với lô nhập tay

**1. Toggle ngôn ngữ trên `/product-label` bị cắt mất nút "ខ្មែរ"** (`product-label-client.tsx`):
root cause là classic CSS bug — `LangToggle` có `overflow-hidden` trên chính div flex-item của nó
trong hàng header `flex items-start justify-between`; khi tiêu đề dài đủ chiếm hết chỗ (đặc biệt màn
hình hẹp), trình duyệt tự đặt `min-width: 0` cho flex-item có `overflow != visible`, cho phép nó co
lại nhỏ hơn nội dung thật và CẮT (không phải wrap) nút thứ 2. Fix: bọc `<LangToggle>` trong
`<div className="shrink-0">` (ngăn co lại) + đổi header sang `flex-col sm:flex-row` (tự xuống dòng
trên mobile thay vì chen chúc cùng hàng với tiêu đề dài).

**2. Tỷ lệ cột "Ca sản xuất"/"Số chỉ thị"** (`confirm/page.tsx`, cả form quét chính lẫn
`EditEntryModal`): đổi từ `grid-cols-2` (50/50) sang `grid-cols-5` với Ca chiếm `col-span-3` (60%),
Số chỉ thị `col-span-2` (40%) — lý do: "Ca sản xuất" có thể dài hơn nhiều khi nhà máy đặt tên ca
(`"Ca A — Sok Khum"`), "Số chỉ thị" thường chỉ 1-2 ký tự.

**3+4. Danh sách "Đang chờ gửi" (pending drafts) — thêm Ca + gộp dòng cùng lô/pallet/bành/chủng
loại/bọc**: hàm mới `groupPendingDrafts()` (`confirm/page.tsx`) gộp các nháp CHƯA gửi theo khóa
`(ma_lo, loai_csr, loai_banh, boc, pallet đã sort)` thành 1 dòng hiển thị — kiện gộp dạng "A, B",
tổng bành cộng dồn, ngăn/Ca hiển thị dạng danh sách distinct (`"N5, N8"`, `"A/B"`). **Chỉ gộp ở tầng
hiển thị** — mỗi kiện vẫn là 1 draft riêng trong DB, không đổi cách lưu/gửi. Nút xóa của 1 dòng đã
gộp giờ xóa NGUYÊN NHÓM (`handleDeleteDraft` đổi tham số từ `draftId: string` sang
`draftIds: string[]`, lặp xóa tuần tự rồi refresh 1 lần).

**5. Gộp dòng tương tự trong bảng "Danh sách" của Thành phẩm** (`product/page.tsx`) — theo yêu cầu
"đẩy lên thành phẩm cũng hiển thị tương tự nhưng không làm gãy logic cảnh báo/tính toán hiện tại":
hàm mới `groupContributionsForDisplay(caContribs, resolveNganLabel)` (module-level, thuần hàm) gộp
các dòng trong bảng chi tiết theo `ngày → ca` (cùng khóa `ma_lo/loai_csr/loai_banh/boc/pallet` như
mục 3+4) thành 1 dòng hiển thị — cộng dồn `tong_banh_cua_ca/tong_kg_cua_ca` và từng `disp_a/b/c/d`,
gộp danh sách ngăn nguồn (nếu 2 kiện của cùng lô đến từ 2 ngăn khác nhau — case hợp lệ theo mục
"Kiện dở dang một phần"), chọn đúng `trang_thai` thật của lô (chỉ 1 thành viên trong nhóm mang giá
trị khác "Dở dang" — xem `contributions` useMemo, giao dịch không phải cuối cùng luôn hiện "Dở
dang"). **Tuyệt đối không đụng** `contributions`/`filteredContribs`/`groupedByDateAndCa`/`stats`/
`nganKgMap`/mọi cảnh báo khác — tất cả vẫn tính trên dữ liệu gốc từng giao dịch, hàm gộp chỉ nhận
`caContribs` (mảng đã lọc sẵn) làm input và trả về nhóm hiển thị cho riêng phần render bảng, không
ghi ngược lại state nào. Checkbox chế độ Xóa theo ngày đổi từ so khớp 1 `uid` sang
`g.uids.every(id => selectedDeleteIds.has(id))` (toàn nhóm), toggle add/remove tất cả `uids` trong
nhóm cùng lúc — logic xóa thật sự (`handleDeletePreCheck`) không đổi, vẫn nhận `Set<string>` các uid
riêng lẻ như trước. Đã bỏ icon `Lock` khỏi cột "Kiện" (trường `locked_a/b/c/d` trên `LotContribution`
thực ra luôn `undefined` ở render này — `Lot` type từ DB không có field này, chỉ tồn tại ở
`LotDraft`/form tạo mới — nên trước đây các icon khóa này chưa từng hiển thị; xác nhận bằng đọc code,
không phải hành vi mới).

**6. Bug thật đã xác nhận qua dữ liệu — "Lịch sử ca" và "Phiếu báo thành phẩm" hiện trống Bọc/Pallet/
Số chỉ thị cho MỌI lô có giao dịch nhập tay** (`confirm/actions.ts`, hàm `loadShiftHistory` và
`loadShiftReportData`): đã verify trực tiếp trên DB thật (factory `phuochoa_kt`, script Node qua
service role) — **0/1100 lô có `lots.boc` hoặc `lots.chi_thi` rỗng** (cột lot-level luôn được điền
đúng, kể cả khi TOÀN BỘ giao dịch của lô là nhập tay và `lot_transactions.boc/chi_thi` = NULL cho tất
cả — đúng thiết kế `COALESCE(v_last_boc, lots.boc)` trong RPC `sync_lot_master_snapshot`, xem mục
"Cập nhật 2026-07-15"). Nhưng 2 hàm trên đọc **trực tiếp `row.boc`/`row.pallet`/`row.chi_thi`** (cấp
giao dịch — `lot_transactions`) **KHÔNG có fallback** về giá trị lot-level khi null — vì nhập tay qua
`product/page.tsx` không bao giờ gửi 3 cột này ở cấp giao dịch (chỉ ghi ở cấp `lots` lúc tạo lô mới,
xem `product/actions.ts` dòng ~174-177), mọi lô có bất kỳ giao dịch nhập tay nào sẽ hiện Bọc/Pallet/
Số chỉ thị TRỐNG trong "Lịch sử ca" (Hub) và "Phiếu báo thành phẩm" (PDF) — kể cả khi `lots.boc` thật
sự có giá trị đúng. Bug này độc lập với mọi bug đã fix trước đó, chưa từng được phát hiện vì các
điều tra trước chỉ kiểm tra `lots.boc`/`confirm/actions.ts`'s `resolveKienForConfirm` (hàm đó ĐÃ có
fallback `?? lot.boc` đúng từ trước, không phải nguồn bug).

Fix: thêm `boc,pallet,chi_thi` vào `lots!inner(...)` trong cả 2 câu SELECT của `loadShiftTransactions`
và `loadDayTransactions` (kiểu `ShiftTxLotInfo` mới); `loadShiftHistory` đổi
`boc: row.boc ?? lotInfo?.boc ?? null` (tương tự pallet/chiThi); `loadShiftReportData` đổi
`rowBoc = row.boc || lotInfo?.boc || ""` (tương tự pallet), và `chiThiSet` giờ cộng cả
`lotInfo?.chi_thi` khi `row.chi_thi` rỗng. `EditEntryModal` (sửa giao dịch trong Hub) tự động nhận
đúng giá trị pre-fill vì đọc từ `ShiftHistoryEntry` do `loadShiftHistory` trả về — không cần sửa
thêm ở tầng UI.

`npx tsc --noEmit`, `npx eslint` (4 file: `product-label-client.tsx`, `confirm/page.tsx`,
`confirm/actions.ts`, `product/page.tsx`), và `npm run build` đều sạch/pass. **Chưa test tay** — cần:
- Mở `/product-label` trên điện thoại/màn hình hẹp, xác nhận nút "ខ្មែរ" hiện đầy đủ, không bị cắt.
- Form quét QR: xác nhận cột "Ca sản xuất" rộng hơn rõ rệt so với "Số chỉ thị", không tràn khi chọn
  ca có tên dài.
- Lưu tạm 2+ kiện cùng lô/pallet/bành/bọc → xác nhận "Đang chờ gửi" gộp thành 1 dòng, hiện đúng Ca
  (dạng "A/B" nếu khác ca), xóa dòng gộp xóa đúng hết các draft liên quan.
- Vào Thành phẩm, mở 1 ngày có lô nhiều kiện cùng bọc/pallet/bành/CSR (cả nhập tay lẫn quét QR) →
  xác nhận bảng chi tiết gộp đúng 1 dòng, tổng bành/kg đúng, cột "Kiện (A/B/C/D)" đúng số thật; bật
  chế độ Xóa, tick 1 dòng gộp → xác nhận xóa đúng toàn bộ giao dịch liên quan, không sót.
- Xác nhận các cảnh báo/tính toán khác (banner ngăn dở dang, KPI tổng bành/kg đầu trang, tab Thống
  kê...) không đổi so với trước khi gộp hiển thị.
- Mở "Lịch sử ca" (Hub, confirm/page.tsx) cho 1 ngày+ca có giao dịch nhập tay từ `product/page.tsx`
  → xác nhận cột Bọc/Số chỉ thị hiện đúng giá trị (không còn trống); mở modal Sửa 1 dòng đó → xác
  nhận pre-fill đúng. Mở "Xem/Tạo lại phiếu PDF" cho cùng ngày → xác nhận PDF hiện đúng Bọc/Pallet/
  Số chỉ thị cho các dòng nhập tay.

### Kế hoạch phiên sau (2026-07-21) — 5 mục CHƯA LÀM, mới khảo sát + định vị code

Người dùng báo 5 vấn đề/yêu cầu tiếp theo sau đợt fix ở trên. Phiên này **chỉ khảo sát và định vị
chính xác vị trí code liên quan**, chưa sửa gì — ghi lại đầy đủ để phiên sau bắt tay ngay không phải
dò lại từ đầu.

#### 1. Dự đoán số lô — tỷ lệ % hiển thị lúc chọn ngăn KHÔNG cộng phần lô dở dang sẽ "tiếp tục"

**ĐÃ FIX (2026-07-21)** — đúng theo hướng fix đề xuất bên dưới:

- `PredictPreviewInput` (`predict/actions.ts`) thêm `continuationKienCount?: number`;
  `previewLotPrediction()` cộng `continuationKienCount * kienW` vào `usedKg` TRƯỚC khi tính
  `availableKg`/`suggestedLotCount`.
- `PendingCarryLot` thêm field `unassignable_kien: string[]` (đã bổ sung vào `SELECT` của
  `findPendingCarryLot()`); hàm mới `countPendingCarryOpenKien(pending)` mirror đúng điều kiện
  của nhánh `v_continue` trong RPC (`kien_X_ngan_id IS NULL AND kien X không nằm trong
  unassignable_kien`) để đếm đúng số kiện sẽ thực sự được gán khi "Tiếp tục". Hàm này **không**
  đặt trong `predict/actions.ts` (file `"use server"` — mọi export ở đây bắt buộc phải là async
  function theo ràng buộc build-time của Next.js Server Actions, `npm run build` chặn cứng nếu
  vi phạm dù `tsc`/`eslint` không phát hiện) — tách sang file thuần mới
  `predict/lot-prediction-utils.ts`, import `type PendingCarryLot` từ `actions.ts`.
- `predict/page.tsx`: `useMemo` `continuationOpenKienCount` (chỉ > 0 khi `pendingCarry` tồn tại
  VÀ `carryResolution === "continue"`) truyền vào `previewLotPrediction()` **chỉ cho
  `orderedNganIds[0]`** (ngăn tiêu thụ đầu tiên theo đúng thứ tự `createLotPredictionBatchMulti`
  sẽ dùng) — các ngăn khác trong lựa chọn nhiều-ngăn truyền `0`, đúng quy tắc "carry-over chỉ áp
  dụng cho ngăn đầu tiên". Effect tính preview thêm `continuationOpenKienCount`/`orderedNganIds`
  vào dependency array — đổi lựa chọn "Tiếp tục"/"Bỏ qua" giờ tự động tính lại % ngay lập tức,
  không cần đợi tạo xong mới thấy đúng số.
- Thêm banner breakdown màu amber ngay dưới dòng "Tỷ lệ ngăn sau khi tạo" khi
  `continuationOpenKienCount > 0`: "Đã cộng ~X kg (N kiện) tiếp tục lô dở dang {ma_lo} vào ngăn
  {ma_ngan} ở trên." — giải thích tại sao % tăng đột ngột sau khi chọn "Tiếp tục", đúng yêu cầu ở
  mục "Hướng fix đề xuất".

`npx tsc --noEmit`/`npx eslint` sạch. **Chưa test tay** — cần đúng kịch bản gốc: ngăn có lô dở
dang cùng series đang chờ tiếp tục (banner amber "Có lô dở dang... đang chờ nối tiếp" xuất hiện)
→ preview % TRƯỚC khi bấm "Tiếp tục" phải khớp đúng con số cũ (không tính continuation) → bấm
"Tiếp tục lô dở dang" → preview % phải NHẢY LÊN NGAY LẬP TỨC phản ánh đúng phần cộng thêm, kèm
banner breakdown giải thích rõ; bấm lại "Bỏ qua, bắt đầu lô mới" → % phải quay về đúng số cũ. Đối
chiếu số cuối cùng sau khi bấm "Tạo dự đoán" (đọc qua tab Lịch sử hoặc lúc in nhãn) phải khớp với
số preview đã hiển thị trước đó.

**Triệu chứng thật (mô tả bug gốc, tham chiếu lịch sử)** (người dùng mô tả): ngăn 5.1, `tong_kho` quy khô 19.220 kg. Dự đoán 3 lô mới
(mỗi lô 4 kiện) = 16.380 kg → hiện đúng 85,22%. Khi hệ thống phát hiện có lô dở dang `1140` cùng
series (đã có kiện A, còn thiếu B/C/D) và người dùng chọn "Tiếp tục lô dở dang", RPC
`create_lot_prediction_batch` **thực sự cộng thêm** 3 kiện của lô 1140 vào cùng đợt tạo — tổng tiêu
thụ thật của ngăn lên tới 104,89% — nhưng **con số 85,22% không được cập nhật lại** ở bất kỳ đâu
trong lúc người dùng còn đang thao tác; chỉ tới khi in nhãn (đọc lại state ngăn thật sự) mới thấy
đúng 104,89%. Người dùng ra quyết định (số lô muốn tạo, số kiện lẻ...) dựa trên con số sai suốt cả
quá trình.

**Root cause đã xác định chính xác qua đọc code** (`src/app/dashboard/product/predict/`):

- `actions.ts`, hàm `previewLotPrediction()` (~dòng 308-324): tính `availableKg = capKg -
  existingRealKg - existingPredictedKg - reservedKg` — **hoàn toàn không biết gì về lô dở dang đang
  chờ tiếp tục** (`findPendingCarryLot()`/`findRealContinuationForSeries()`, cũng trong file này,
  không được gọi ở đây).
- `page.tsx`, biến `liveCalc` (~dòng 380-396): `livePct` tính thuần từ `preview.availableKg` —
  thừa hưởng đúng lỗ hổng trên vì không có input nào về continuation.
- Quyết định "Tiếp tục lô dở dang" (biến `carryResolution`/banner hỏi người dùng) diễn ra **sau**
  khi ngăn/CSR đã chọn và preview đã hiển thị — về mặt luồng, thời điểm hỏi carry-over và thời điểm
  tính preview % là 2 bước tách rời, preview không "biết trước" người dùng sẽ chọn continue.
  Nhánh `v_continue` trong RPC (SQL, xem mục "4.6" phần trên) mới là nơi DUY NHẤT cộng đúng số kiện
  còn thiếu của lô dở dang vào tổng — không có bản sao logic này ở phía client để preview trước.
- Con số ĐÚNG cuối cùng chỉ xuất hiện khi in nhãn, qua `loadNganCumulativeBaselines()`
  (`actions.ts` ~dòng 901) — hàm này đọc lại **trạng thái ngăn thật sau khi đã tạo xong** (real +
  predicted + reserved kg), nên luôn đúng nhưng luôn TRỄ (sau khi đã tạo, không phải lúc còn xem
  trước).

**Hướng fix đề xuất cho phiên sau** (chưa code, cần rà lại kỹ trước khi làm):

- Trước hoặc trong `previewLotPrediction()`, gọi thêm `findPendingCarryLot()` (và/hoặc
  `findRealContinuationForSeries()`) cho đúng `(loaiCsr, loaiBanh, year)` đang preview — nếu có kết
  quả, cộng thêm ước tính KL của các kiện còn thiếu (`openLetters.length × kienWeightKg`) vào
  `usedKg` TRƯỚC khi tính `availableKg`/`suggestedLotCount`, để `livePct` hiển thị đúng ngay từ đầu.
- Cẩn thận: continuation chỉ áp dụng cho **ngăn ĐẦU TIÊN** trong 1 lần tạo nhiều ngăn (xem mục 4.6
  "Chọn nhiều ngăn cùng lúc" — carry-over giữa các ngăn trong CÙNG thao tác tự "continue", không hỏi
  lại) — logic cộng thêm vào preview phải khớp đúng quy tắc này, không cộng nhầm cho ngăn thứ 2 trở
  đi nếu ngăn đó không phải là nơi tiếp nhận continuation.
- Cần UI hiển thị rõ ràng breakdown (vd "16.380 kg lô mới + 3.024 kg tiếp tục lô 1140 dở dang =
  19.404 kg / 19.220 kg (~104,89%)") thay vì chỉ 1 con số gộp, để người dùng hiểu tại sao % tăng đột
  ngột sau khi chọn "Tiếp tục" — tránh gây hoang mang giống lý do bug này bị phát hiện.

#### 2. Cài đặt → Phân công trực ca — ĐÃ FIX (2026-07-21), giờ multi-select nhiều người/ca

**Trước đây**: `production_shift_assignments` có `UNIQUE (factory_id, ca)` — đúng 1 dòng/ca, chỉ
gán được đúng 1 tài khoản cho mỗi ca. `ShiftAssignmentsTab` chỉ có 1 form/ca.

**Đã fix**:

- Migration `supabase/migrations/20260721_production_shift_assignments_multi.sql` — `DROP
  CONSTRAINT production_shift_assignments_factory_id_ca_key` (đúng tên constraint mặc định
  Postgres sinh ra cho `UNIQUE (factory_id, ca)` khai báo inline trong `CREATE TABLE`). Không
  thêm bảng con — mỗi dòng vốn đã độc lập theo người, chỉ cần bỏ ràng buộc unique cứng. **Cần
  chạy thủ công trên Supabase SQL Editor.**
- `ShiftAssignmentsTab` (`src/app/dashboard/settings/_components/shift-assignments-tab.tsx`) viết
  lại hoàn toàn: state đổi từ `Record<ca, CaFormState>` (1 form/ca) sang `Record<ca,
  EditableRow[]>` (danh sách nhiều dòng/ca). Mỗi ca có nút "+ Thêm người" (thêm 1 dòng trắng chỉ
  tồn tại phía client, đánh dấu `isNew`, temp `id` qua `crypto.randomUUID()`), mỗi dòng có nút
  "Lưu" riêng (INSERT nếu `isNew`, UPDATE theo `id` nếu không) và nút Xóa (dòng chưa lưu → chỉ bỏ
  khỏi state; dòng đã lưu → confirm inline trong dòng rồi `DELETE` + reload). Dropdown chọn tài
  khoản disable (không chặn cứng) các user đã được gán ở dòng khác CÙNG ca, để giảm khả năng gán
  trùng ngoài ý muốn.
- `loadUserShiftAssignment()` (`confirm/actions.ts`) đổi `.maybeSingle()` → `.order("created_at",
  { ascending: true }).limit(1)`, lấy `data?.[0]?.ca` — an toàn hơn: kể cả TRƯỚC migration này, 1
  user vẫn có thể được gán cho nhiều ca khác nhau cùng lúc (unique cũ chỉ ràng buộc theo
  `(factory_id, ca)`, không ràng buộc `assigned_user_id` là duy nhất), nên `.maybeSingle()` vốn đã
  không an toàn nếu gặp đúng trường hợp đó — không phải lỗi mới phát sinh do migration.
- Đã grep toàn repo `production_shift_assignments` — không còn nơi nào khác giả định quan hệ 1-1.

**Test tay 2026-07-21 (đã deploy + verify thật)**: xác nhận hoạt động đúng — nhưng phát hiện 1 bug
UI: bấm "Lưu" cho 1 dòng thì badge "Đã lưu" hiện đúng dưới dòng đó; bấm "Lưu" tiếp cho dòng KHÁC
(người khác, kể cả khác ca) thì badge "Đã lưu" nhảy sang dòng vừa lưu, còn dòng đã lưu trước đó bị
mất badge dù dữ liệu của nó vẫn đúng trong DB (xem ảnh chụp: Ca B có "Tô Thành Lộc" không hiện "Đã
lưu" trong khi "Danh Ngàn" hiện, dù cả 2 đều đã lưu thành công).

**Root cause đã fix (cùng ngày)**: `savedRowId` là 1 state `string | null` DÙNG CHUNG cho toàn bộ
các dòng của cả 3 ca — mỗi lần lưu ghi đè giá trị này, nên chỉ dòng lưu gần nhất mới khớp điều kiện
render `savedRowId === row.id`. Đã đổi sang `savedRowIds: Set<string>` — mỗi dòng lưu thành công tự
thêm `id` của nó vào Set (không xóa của dòng khác); badge "Đã lưu" check qua `savedRowIds.has(row.id)`
nên nhiều dòng cùng hiện "Đã lưu" độc lập nhau. Bổ sung thêm: `updateRow()` tự gỡ `id` khỏi Set
ngay khi người dùng sửa lại BẤT KỲ field nào của dòng đó (tránh hiện "Đã lưu" sai khi form đã khác
dữ liệu thật trong DB do chưa bấm Lưu lại); `handleDeleteRow()` cũng gỡ khỏi Set khi xóa dòng đã
lưu (dọn dẹp, không ảnh hưởng hành vi vì dòng đã biến mất khỏi UI).

`npx tsc --noEmit`, `npx eslint` sạch sau fix. **Chưa test tay lại fix này** — cần: lưu 2 dòng khác
nhau (khác ca hoặc cùng ca) → xác nhận CẢ 2 cùng hiện "Đã lưu"; sửa 1 field của dòng đã có "Đã lưu"
(chưa bấm Lưu lại) → xác nhận badge biến mất ngay; bấm Lưu lại → badge quay lại.

#### 3. Phiếu báo thành phẩm — "Ca 1"/"Ca 2" phải sắp theo THỜI GIAN SẢN XUẤT THẬT trong ngày — ĐÃ FIX (2026-07-21)

**Bug gốc** (`src/app/dashboard/product/confirm/actions.ts`): hằng số `CA_ORDER = ["A", "B", "C"]`
và `compareCaCode()` sắp xếp section theo **chỉ số cố định trong mảng này** — Ca A luôn được gán
nhãn "Ca 1" nếu có mặt trong ngày, bất kể ca đó thực tế làm buổi sáng hay buổi tối hôm đó.

**Yêu cầu thật** (người dùng đưa 2 ví dụ đối xứng): "Ca 1" trong phiếu phải là ca nào **thực sự sản
xuất trước trong ngày hôm đó** — nếu hôm nay Ca A làm ca ngày (5h-16h) và Ca B làm ca đêm
(16h30-5h hôm sau), thì Ca A = "Ca 1". Nhưng nếu lịch đảo ngược (Ca B làm ca ngày, Ca A làm ca đêm)
thì Ca B phải là "Ca 1" — tức **không được hard-code A luôn là Ca 1**, phải suy ra động theo dữ liệu
sản xuất thật của đúng ngày đang in phiếu.

**Đã fix** (`loadShiftReportData()`) — đúng phương án dùng `created_at` làm proxy, đã xác nhận lại
với người dùng trước khi code:

- Thêm `earliestCreatedAtByCa: Map<string, string>` — trong CHÍNH vòng lặp đang duyệt qua `rows`
  để build `byGroupKey` (không thêm vòng lặp/query nào mới): với mỗi `row`, nếu ca đó chưa có
  trong map thì ghi `row.created_at`. Vì `loadDayTransactions()` đã `.order("created_at", {
  ascending: true })` từ trước, dòng ĐẦU TIÊN gặp của mỗi ca trong vòng lặp chính là dòng sớm nhất
  — không cần `MIN()`/sort riêng.
- `[...bySection.keys()].sort(compareCaCode)` đổi thành sort theo `earliestCreatedAtByCa.get(ca)`
  tăng dần (so sánh chuỗi ISO timestamp bằng `localeCompare`), `compareCaCode` chỉ còn là
  tie-breaker phụ khi 2 ca trùng/thiếu mốc thời gian (gần như không xảy ra vì `created_at` chính
  xác tới mili-giây). `caLabel: "Ca ${idx+1}"` giữ nguyên logic, chỉ khác nguồn thứ tự `idx`.
- Rủi ro đã biết và chấp nhận: nếu trực ca nhập liệu trễ/dồn cuối ca (quét QR sau khi đã sản xuất
  xong nhiều giờ), `created_at` không phản ánh đúng giờ sản xuất thật — đây là hạn chế cố hữu vì
  `lot_transactions` không có cột giờ sản xuất khai báo riêng, chỉ có `created_at` (thời điểm ghi
  nhận). Chấp nhận được vì đây là dữ liệu thời gian thực tế DUY NHẤT đang có.

`npx tsc --noEmit`, `npx eslint`, và `npm run build` đều sạch. **Chưa test tay** — cần: 1 ngày có
cả Ca A và Ca B, Ca B có giao dịch đầu tiên SỚM HƠN Ca A (giả lập lịch đảo ca ngày/đêm) → xác nhận
phiếu in ra đúng "Ca 1: B..." đứng trước "Ca 2: A...". Trường hợp thường ngày (Ca A làm trước Ca B
như thường lệ) → xác nhận vẫn ra đúng "Ca 1: A" như trước, không có regression.

**⚠️ Cập nhật quan trọng (2026-07-22) — bug vẫn tái hiện trên bản deploy, nghi ngờ do CHƯA PUSH/DEPLOY**:
người dùng gửi phiếu PDF thật `cung_cap_dl/ptp.pdf` (sinh ngày 21/07/2026) chứng minh bug vẫn còn:
Ca A (Sok Khum) có giao dịch đầu tiên lúc `18:50:51` nhưng vẫn bị in thành "Ca 1", trong khi Ca B
(Binh Ban) có giao dịch đầu tiên SỚM HƠN nhiều — `10:40:21` cùng ngày — lại bị xuống "Ca 2" (ngược
hoàn toàn với thứ tự thời gian thật, đúng kịch bản lỗi mục này mô tả).

Đã đối chiếu lại code hiện tại (`loadShiftReportData()` trong `confirm/actions.ts`) — logic
`earliestCreatedAtByCa` + sort theo thời gian sớm nhất **vẫn đang có mặt trong working tree và đọc
đúng về mặt logic** (đã trace lại thủ công với đúng 2 mốc giờ trên: `"...T10:40:21..."` <
`"...T18:50:51..."` nên Ca B phải ra "Ca 1" — khớp đúng kỳ vọng, không phát hiện lỗi logic mới).
Nhưng `git log origin/main..HEAD` cho thấy **không có commit nào chưa push** — tức 5 commit gần nhất
(kể cả `d61e1ec`) đã lên `origin/main` — trong khi `git status` lại cho thấy **chính đoạn code fix
này (và nhiều thay đổi khác) vẫn đang nằm ở working tree CHƯA COMMIT**. Kết luận nhiều khả năng nhất:
bản deploy production (nơi sinh ra `ptp.pdf`) đang chạy code **CŨ hơn** cả commit `d61e1ec`, tức fix
này chưa từng được commit + push + deploy — không phải lỗi logic tái phát. Session sau cần xác minh
lại giả thuyết này trước khi sửa code thêm (xem chi tiết việc cần làm ở cuối file, mục "Kế hoạch
phiên sau").

#### 4. UX "Đang chờ gửi" — không có lối vào trực tiếp sau khi thoát app, và Sửa chỉ áp dụng cho giao dịch đã gửi (chưa áp dụng cho draft)

**4a. ĐÃ FIX (2026-07-21)** — thêm nút "Quét QR xác nhận SX" (icon `ScanLine`, `bg-teal-600`) vào
header `/dashboard/product/page.tsx`, cạnh nút "Dự đoán số lô", dẫn thẳng tới `/dashboard/product/confirm`
(bare, không tham số) — chỉ hiện khi `hasPermission(currentUser, "product.confirm_scan")`. Mô tả bug
gốc bên dưới vẫn giữ nguyên làm lịch sử; chỉ phần "Hướng fix đề xuất" ở cuối mục này là đã triển khai,
không còn là đề xuất. `npx tsc --noEmit`/`npx eslint` sạch. **Chưa test tay** — cần xác nhận nút hiện
đúng theo quyền, click vào mở đúng Hub (không có `lo`/`kien` trên URL nên vào thẳng `view: "hub"`).

**Không có lối tắt quay lại Hub (mô tả bug gốc, tham chiếu lịch sử)**: `/dashboard/product/confirm` **bỏ qua hoàn toàn sidebar**
(`dashboard/layout.tsx` dòng 427: `pathname.startsWith("/dashboard/product/confirm")` → render
thẳng `{children}`, không có nav). Đã verify: **không có bất kỳ link/nút nào trong app** (sidebar,
`/dashboard/product`, hay nơi khác) trỏ tới `/dashboard/product/confirm` mà không kèm `?lo=&kien=`.
Lối vào DUY NHẤT là quét QR vật lý trên nhãn — mà QR luôn mã hóa `lo`/`kien` cụ thể
(`buildProductLabelLookupUrl`) nên luôn nhảy thẳng vào `view: "form"` của đúng kiện đó (xem
bootstrap trong `confirm/page.tsx` dòng ~289-298: có `paramLo` → `setView("form")`; không có →
`setView("hub")`). Vì trang này không có sidebar để bấm "quay lại danh sách", người dùng không rành
công nghệ không biết làm sao để tới thẳng "hub" (nơi có "Đang chờ gửi") — phải quét nhầm 1 nhãn bất
kỳ trước, xem lookup xong mới có nút "← quay lại" để vào form rồi mới về hub được.

Hướng fix đề xuất: thêm 1 nút/link rõ ràng, dễ thấy dẫn tới `/dashboard/product/confirm` (bare, không
tham số) — đặt ở `/dashboard/product/page.tsx` (trang "Thành phẩm" chính, có sidebar, mọi người dùng
đã biết cách vào) — ví dụ nút "Quét QR xác nhận sản xuất" trong header, cạnh các nút hành động khác.
Cân nhắc thêm: PWA "Thêm vào màn hình chính" hoặc hướng dẫn bookmark cho công nhân xưởng (nằm ngoài
phạm vi code, chỉ là gợi ý vận hành).

**4b. ĐÃ FIX (2026-07-21)**:

- `confirm/actions.ts` thêm `updateDraftKien(input)` — re-validate `soBanh > 0`, `nganId`, `boc`,
  `pallet.length > 0`, và re-check `max_per_kien` (cộng bành đã gửi thật qua `lots` +
  `lot_transactions` LẪN nháp KHÁC của bất kỳ ai cho cùng `(ma_lo, kien)`, TRỪ chính nháp đang
  sửa — mirror đúng công thức `totalClaimed` của `saveDraftKien`) trước khi `UPDATE
  product_confirm_drafts`. Re-check `created_by === userId` và `factory_id` ở server, không tin
  caller. Không cần gọi `sync_lot_master_snapshot`/check trạng thái lô như
  `editShiftHistoryEntry()` — nháp chưa từng ghi `lot_transactions`.
- `confirm/page.tsx`: state `editingDraft`/`draftEditSaving`/`draftEditError`, handler
  `openEditDraft()`/`handleSaveEditDraft()`. Component mới `EditDraftModal` (cuối file) mirror gần
  như y hệt `EditEntryModal` (cùng field: Ngày SX/Ca SX/Số chỉ thị/Số bành/Bọc/Loại pallet/Ngăn
  nguồn), chỉ khác nguồn dữ liệu (`ConfirmDraftRow`) và action gọi (`updateDraftKien` thay
  `editShiftHistoryEntry`).
- Nút "Sửa" (icon `Pencil`, màu amber) trong khối "Đang chờ gửi" (`HubView`) **chỉ hiện khi nhóm
  hiển thị đúng 1 draft gốc** (`g.draftIds.length === 1`) — `groupPendingDrafts()` có thể gộp
  nhiều kiện khác nhau (mỗi kiện có ngăn/số bành/ca riêng) vào 1 dòng hiển thị, sửa nhiều kiện
  cùng lúc qua 1 form đơn không có ý nghĩa. Nhóm gộp ≥2 draft vẫn xóa được cả nhóm như cũ, chỉ
  không sửa được — người dùng phải xóa rồi quét lại nếu cần sửa 1 kiện trong nhóm gộp.
- Không có gate theo trạng thái lô (khác `editShiftHistoryEntry`'s `canEdit`) — đúng nhận định đã
  chốt: draft luôn thuộc lô chưa tròn theo bản chất, mặc định luôn cho sửa.

**Lưu ý kỹ thuật quan trọng phát hiện khi build**: `countPendingCarryOpenKien()` (mục 1 phía trên)
ban đầu đặt trong `predict/actions.ts` — `tsc`/`eslint` sạch nhưng `npm run build` fail vì mọi
export ở file `"use server"` bắt buộc phải là async function (ràng buộc Next.js Server Actions,
không phải TypeScript). Đã tách hàm thuần này sang file mới `predict/lot-prediction-utils.ts`
(không có `"use server"`), import `type PendingCarryLot` từ `actions.ts`. Xem thêm
`feedback_code.md` trong memory — bài học áp dụng cho MỌI file `"use server"` trong repo, không
chỉ module này: khi thêm 1 hàm thuần đồng bộ cần import trực tiếp vào client component, luôn kiểm
tra bằng `npm run build`, không chỉ `tsc`/`eslint`.

`npx tsc --noEmit`, `npx eslint`, và `npm run build` đều sạch. **Chưa test tay** — cần: Lưu tạm 1
kiện → bấm "Sửa" trong "Đang chờ gửi" → đổi Số bành/Bọc/Ngăn → Lưu → xác nhận danh sách cập nhật
đúng; thử sửa vượt `max_per_kien` (tính cả nháp khác của người khác cho cùng kiện) → bị chặn đúng
message; Lưu tạm 2+ kiện cùng lô/pallet/bành/bọc (gộp thành 1 dòng hiển thị) → xác nhận nút "Sửa"
KHÔNG hiện (chỉ Xóa còn hoạt động).

#### 5. Quét QR — ĐÃ FIX (2026-07-21), nhưng khác hẳn ý định ban đầu ghi ở mục này

**Đính chính quan trọng**: 3 câu hỏi thiết kế đặt ra ở phiên trước ("ảnh gắn theo kiện hay lô",
"bắt buộc hay tùy chọn", "camera trực tiếp hay cho chọn từ thư viện") đều dựa trên cách hiểu SAI
ý định người dùng — phiên trước tưởng đây là tính năng "đính kèm ảnh bằng chứng hiện trường" (như
Bảo trì/Kiểm soát quá trình). Khi hỏi lại (2026-07-21), người dùng làm rõ: **đây là tính năng cho
màn hình QUÉT QR** — thêm khả năng **tải lên 1 ảnh chụp sẵn CHỨA MÃ QR** (ví dụ công nhân đã chụp
ảnh nhãn từ trước để tiện thao tác) và **giải mã QR trực tiếp từ ảnh tĩnh đó**, thay vì bắt buộc
phải đưa camera trực tiếp vào đúng vị trí nhãn thật. Đây là bổ sung cho bước QUÉT (trước khi vào
form nhập liệu), không phải thêm trường ảnh bằng chứng vào `product_confirm_drafts`/
`lot_transactions` — 3 câu hỏi cũ về schema ảnh-theo-kiện/theo-lô vì vậy không còn áp dụng, không
đụng tới schema nào cả.

**Đã cài đặt**:

- `src/app/dashboard/product/confirm/qr-scanner.tsx` (`QrScanner` component, dùng `html5-qrcode`
  — đã có sẵn từ trước cho camera live) — dùng thêm API tĩnh `Html5Qrcode.scanFile(file,
  showImage): Promise<string>` của cùng thư viện để giải mã QR từ 1 file ảnh, không cần camera.
  Cần 1 `Html5Qrcode` **instance riêng** (không phải `scannerRef` đang chạy camera) gắn vào 1
  `<div id={FILE_REGION_ID} className="hidden">` luôn tồn tại trong DOM (constructor của thư viện
  bắt buộc phải có element tồn tại sẵn, kể cả khi `showImage=false` không thực render ảnh) — tránh
  tranh chấp canvas nội bộ với luồng camera đang chạy song song.
- Nút **"Tải ảnh chứa QR"** (icon `ImageUp`) đặt **luôn hiển thị** ở cuối màn quét, dưới 1 divider
  "hoặc" ngăn cách với khung camera — **không đặt trong nhánh `cameraError`** mà đặt ngoài điều
  kiện đó, để nút này vừa là lối vào thay thế lúc camera hoạt động bình thường, vừa là lối thoát
  khi camera bị từ chối quyền/lỗi mở (trước đây nhánh lỗi camera chỉ có 1 nút "Hủy quét", giờ có
  thêm lối này). Nhánh lỗi camera bỏ bớt nút "Hủy quét" cục bộ (đã trùng với nút chung ở footer).
  Input file dùng `<input type="file" accept="image/*">` **không** có `capture` — để trình duyệt
  mở đúng picker cho phép chọn cả Camera lẫn Thư viện ảnh có sẵn (đã chốt "Cả 2" khi hỏi lại).
  `e.target.value = ""` reset ngay sau khi đọc `file` để chọn lại đúng file cũ (ảnh không đổi) vẫn
  kích hoạt `onChange` lần nữa.
  - `handleFileChange()`: decode xong gọi **chung `onDecoded()`** với luồng camera — mọi validate
    ở `confirm/page.tsx` (`parseScannedQr`, kiểm tra đúng định dạng URL, đúng `factory_id`) áp
    dụng đồng nhất cho cả 2 nguồn ảnh, không viết lại logic riêng. Lỗi giải mã (không tìm thấy QR
    trong ảnh, hoặc file không phải ảnh hợp lệ) hiện banner đỏ riêng `fileScanError` (tách khỏi
    `scanError` của luồng camera) với message `uploadQrImageNotFound`.
  - `decodedRef` (cờ chống double-decode, đã có sẵn cho luồng camera) được dùng chung — tự reset
    sau 1.5s giống hệt cơ chế cũ, để không khoá cứng nếu người dùng thử ảnh khác ngay sau đó.
- 4 key i18n mới (cả `vi`/`km`) trong `confirm/i18n.ts`: `uploadQrImage`, `uploadQrImageScanning`,
  `uploadQrImageNotFound`, `orDivider`.
- `confirm/page.tsx` truyền 4 prop mới (`uploadButtonText/uploadScanningText/uploadNotFoundText/
  orDividerText`) vào `<QrScanner>` — không đổi gì ở `handleDecoded()` (dùng chung).

`npx tsc --noEmit`, `npx eslint`, và `npm run build` đều sạch. **Chưa test tay trên thiết bị
thật** — cần: mở màn quét QR → xác nhận nút "Tải ảnh chứa QR" hiện đúng ngay cả khi camera đang
hoạt động bình thường lẫn khi camera bị từ chối quyền; chọn 1 ảnh chụp sẵn nhãn QR hợp lệ từ thư
viện → xác nhận decode đúng và chuyển sang form nhập liệu giống hệt luồng camera; chọn 1 ảnh không
chứa QR (hoặc QR không đúng định dạng URL của app) → xác nhận banner đỏ hiện đúng, không crash,
thử lại được ngay; xác nhận trên Android/iOS trình duyệt thật hiện đúng lựa chọn "Camera"/"Thư
viện ảnh" khi bấm nút (không bị ép thẳng vào camera do thiếu `capture`).

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

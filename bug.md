# Tổng Hợp Lỗ Hổng Logic (Bugs) & Yêu Cầu Nghiệp Vụ Mở Rộng
**Phân hệ**: Đề nghị mua vật tư (`purchase`) ↔ Biên bản bảo trì (`maintenance`) ↔ Nhập/Xuất kho (`inventory`) ↔ Gia công ngoài (`gia_cong`)  
**Ngày rà soát**: 31/10/2026

---

## PHẦN I — CÁC MONG MUỐN NGHIỆP VỤ CỦA NGƯỜI DÙNG & PHÂN TÍCH GIẢI PHÁP

### Mong muốn 1: Khi Đề nghị mua đã nhập kho (`hoan_tat`) và Biên bản bảo trì đã phê duyệt (`da_duyet`), phát hiện SAI GIÁ thì điều chỉnh như thế nào?

#### 1. Hiện trạng trên code hiện tại (Vì sao đang bị vướng?)
Khi Đề nghị mua đã nhập đủ hàng (`trang_thai = 'hoan_tat'`) và Biên bản bảo trì đã ký duyệt xong (`trang_thai = 'da_duyet'`, đã tự động sinh phiếu xuất kho `X-BT-...` ở trạng thái `posted`), nếu kế toán/mua hàng phát hiện **sai đơn giá**:

- **Không thể lập Phiếu điều chỉnh trực tiếp**:
  - API [`POST /api/purchase/requests/[id]/adjust`](src/app/api/purchase/requests/[id]/adjust/route.ts#L45-L47) chặn chỉ cho phép điều chỉnh khi phiếu gốc ở trạng thái `da_duyet` hoặc `dang_mua` (`isPurchaseBuying`). Khi đã nhập đủ (`hoan_tat`), nút **Lập phiếu điều chỉnh** bị khoá.
  - Ngoài ra ở [dòng 88](src/app/api/purchase/requests/[id]/adjust/route.ts#L88), dòng nào đã nhập đủ (`eff.received >= eff.so_luong`) cũng bị chặn: *"Dòng n: đã nhập đủ, không điều chỉnh được"*.
- **Không thể Huỷ ngay Phiếu nhập kho (`N-MH-...`)**:
  - Vì Biên bản bảo trì đã duyệt và xuất kho (`X-BT-...`) số vật tư đó ra khỏi kho, tồn kho hiện tại (`on_hand`) thường bằng `0` (hoặc nhỏ hơn số lượng phiếu nhập).
  - Nếu thủ kho bấm huỷ phiếu nhập `N-MH-...`, hàm `inventory_cancel_document` sẽ trừ ngược lại `on_hand` và bị chặn bởi trigger chống âm kho [`inventory_prevent_negative_stock`](supabase/migrations/20260725_fix_inventory_prevent_negative_stock.sql#L28-L44).
- **Quy trình bắt buộc hiện tại (Rất bất tiện — phải huỷ ký cả Biên bản bảo trì)**:
  1. **Bước 1**: Admin phải vào **Biên bản bảo trì** (`da_duyet`) bấm **"Huỷ ký duyệt"** ([`/api/maintenance/reverse-approval`](src/app/api/maintenance/reverse-approval/route.ts)) → Hệ thống huỷ phiếu xuất kho `X-BT-...`, hoàn trả lại số lượng `on_hand` vào kho, nhưng **xoá mất toàn bộ chữ ký đã duyệt của Biên bản bảo trì** (đưa biên bản về `nhap`).
  2. **Bước 2**: Thủ kho vào **Nhập kho** (`/dashboard/inventory/receipts`) **Huỷ phiếu nhập `N-MH-...`** → Nhờ trigger [`trg_purchase_on_inventory_doc_status`](supabase/migrations/20261008_purchase_receive_adjust.sql#L294-L299), Phiếu đề nghị mua tự động trừ `sl_da_mua` và lùi từ `hoan_tat` về `da_duyet` (hoặc `dang_mua`).
  3. **Bước 3**:
     - Nếu giá đúng chỉ lệch **≤ 10%** so với giá dự kiến trên Đề nghị mua: Bấm **"Ghi nhận mua / Nhập kho"** lại trên Đề nghị mua với đơn giá thực tế đúng.
     - Nếu giá đúng lệch **> 10%** so với giá dự kiến: Phải lập **Phiếu điều chỉnh** (`loai = 'dieu_chinh'`), trình ký lại đủ 3 bước (Người đề nghị → Giám đốc → Kế toán), sau đó mới bấm **"Ghi nhận mua / Nhập kho"** lại.
  4. **Bước 4**: Phải gửi ký và **ký duyệt lại từ đầu Biên bản bảo trì** để hệ thống sinh lại phiếu xuất kho `X-BT-...`.
- **Đặc biệt nghiêm trọng với Dịch vụ Gia công ngoài (`gia_cong` / `la_dich_vu = true`)**:
  - Bảng `purchase_service_completions` hiện tại **không có API hay nút Huỷ xác nhận hoàn thành**. Một khi đã bấm xác nhận hoàn thành dịch vụ gia công làm phiếu chuyển sang `hoan_tat`, người dùng **hoàn toàn không có cách nào sửa lại đơn giá thực tế** (kể cả có huỷ duyệt Biên bản bảo trì).

#### 2. Giải pháp đề xuất để đáp ứng mong muốn người dùng (Điều chỉnh giá KHÔNG cần đụng tới Biên bản bảo trì)
Bản chất của **Biên bản bảo trì** và **Phiếu xuất kho bảo trì (`X-BT-...`)** trong hệ thống hiện tại chỉ quản lý **Số lượng (`so_luong` / `quantity`)**, không lưu và không bị ảnh hưởng bởi đơn giá mua (ngoại trừ trường hợp người dùng gõ tay giá tham khảo trên biên bản). Do đó, việc sai giá chỉ nằm ở **Đề nghị mua (`purchase_requests`)**, **Lịch sử mua (`purchase_receipts` / `purchase_service_completions`)** và **Dòng phiếu nhập kho (`inventory_document_lines.unit_cost`)**.

Cần thiết kế cơ chế **"Điều chỉnh giá sau nhập kho / hoàn tất"** theo 2 mức:
1. **Mức 1 — Sửa giá thực tế trong phạm vi dung sai ±10% (so với giá đã duyệt)**:
   - Cho phép người đề nghị (hoặc Admin / Kế toán) bấm **"Sửa đơn giá thực tế"** trực tiếp trên lần nhập kho (`purchase_receipts`) hoặc lần xác nhận dịch vụ (`purchase_service_completions`) ngay cả khi phiếu đã `hoan_tat` và biên bản bảo trì đã `da_duyet`.
   - Hệ thống cập nhật nguyên tử:
     - `purchase_receipts.don_gia_thuc_te` + `inventory_document_lines.unit_cost` (không cần huỷ phiếu nhập kho `N-MH-...`, không đụng chạm biến động số lượng `on_hand` hay phiếu xuất `X-BT-...`), HOẶC `purchase_service_completions.don_gia_thuc_te`.
     - Ghi log kiểm toán vào `purchase_request_logs`.
2. **Mức 2 — Điều chỉnh giá lệch > 10% sau khi đã nhập kho (`hoan_tat`)**:
   - Mở khoá cho phép lập **Phiếu điều chỉnh đơn giá (`loai = 'dieu_chinh'`)** ngay cả khi phiếu gốc đang ở `hoan_tat` (hoặc dòng đã nhập đủ `eff.received == eff.so_luong`), với điều kiện: **Số lượng giữ nguyên (`soLuong == eff.so_luong`), Mã vật tư giữ nguyên (`itemId == eff.item_id`), chỉ thay đổi `donGia`**.
   - Khi Phiếu điều chỉnh đơn giá này được ký duyệt đủ 3 bước (`hoan_tat`):
     - Tự động cập nhật `don_gia_thuc_te` trên `purchase_receipts` / `purchase_service_completions` và `unit_cost` trên `inventory_document_lines` của phiếu nhập `N-MH-...` tương ứng (hoặc cho phép cập nhật lại giá thực tế theo khung giá mới đã duyệt).
     - **Hoàn toàn không cần Huỷ phiếu nhập kho và không cần Huỷ ký duyệt Biên bản bảo trì.**
3. **Bổ sung nút "Huỷ xác nhận hoàn thành" cho Dịch vụ gia công (`purchase_service_completions`)**:
   - Tương tự như huỷ phiếu nhập kho, cho phép huỷ bản ghi `purchase_service_completions` (khi Biên bản bảo trì liên kết chưa duyệt, hoặc khi Admin cho phép) và gọi `purchase_recompute_request` để lùi trạng thái phiếu đề nghị.

---

### Mong muốn 2: Một Đề nghị mua tạo từ Biên bản bảo trì có số lượng nhiều hơn và số mã vật tư nhiều hơn biên bản (phần thừa nhập kho, biên bản vẫn chạy theo logic cũ)

#### 1. Mong muốn cụ thể của người dùng
Từ một Biên bản bảo trì (ví dụ cần 2 vật tư: `VT1` số lượng 2, `VT2` số lượng 3), khi bấm **"Lập đề nghị mua"**, người mua hàng muốn sửa Phiếu đề nghị nháp đó để:
- **Tăng số lượng lớn hơn nhu cầu của biên bản** (ví dụ: `VT1` mua 10 cái thay vì 2 cái — 2 cái xuất cho biên bản này, **8 cái thừa nằm lại trong kho** để dùng dần).
- **Thêm các mã vật tư khác ngoài biên bản** (ví dụ: tiện chuyến mua thêm `VT3`, `VT4`, `VT5` để nhập kho dự trữ hoặc dùng cho Biên bản bảo trì khác).
- Khi hàng về: **Toàn bộ số lượng và toàn bộ mã vật tư trên Đề nghị mua đều được nhập vào kho**.
- **Biên bản bảo trì gốc vẫn hoạt động đúng theo logic cũ**: Khi đủ số lượng của riêng nó (`VT1 >= 2`, `VT2 >= 3`) thì cho gửi ký duyệt ngay, khi ký xong chỉ tự động xuất kho đúng phần của biên bản (`VT1`: 2, `VT2`: 3), phần dư còn lại nằm trong kho.

#### 2. Đánh giá trên code hiện tại: Đã làm được gì và Đang bị vướng ở đâu?

| Khía cạnh | Trạng thái hiện tại trên Code | Chi tiết hoạt động / Điểm nghẽn |
| :--- | :---: | :--- |
| **A. Tăng số lượng (`so_luong`) của vật tư trong Đề nghị mua nhiều hơn Biên bản** | ✅ **ĐÃ CHẠY TỐT** (với vật tư kho `ben_ngoai`) | - `POST /api/purchase/requests` cho phép sửa tăng `so_luong` thoải mái khi phiếu ở `nhap`/`tra_ve`.<br>- Khi nhập kho 10 cái (`purchase_receive`), cả 10 cái vào `inventory_stock_balances`.<br>- `computeKtStatuses` chỉ kiểm tra `available >= need` (`10 >= 2` → đủ hàng).<br>- Khi Biên bản ký duyệt, [`issueMaintenanceStock`](src/lib/maintenance-stock-issuance.ts#L160-L163) chỉ xuất đúng `mat.so_luong = 2` cái. **8 cái thừa nằm lại trong kho đúng như mong muốn.** |
| **B. Sửa tăng số lượng ngay cả khi mới nhập 1 phần (nhưng đã đủ cho Biên bản)** | ⚠️ **Lưu ý nhỏ** | - Nếu Biên bản cần 2 cái, Đề nghị mua đặt 10 cái. Đợt 1 hàng về 3 cái (nhập kho 3 cái → phiếu đề nghị ở trạng thái `dang_mua`, tồn kho = 3).<br>- Vì `available = 3 >= need = 2` (`shortage = 0`), **Biên bản bảo trì gửi ký và xuất kho 2 cái được ngay** mà không cần chờ Đề nghị mua nhập nốt 7 cái còn lại! |
| **C. Thêm mã vật tư mới (`VT3`, `VT4`, `VT5`) vào Đề nghị mua để nhập kho dự trữ** | ✅ **ĐÃ CHẠY TỐT cho Biên bản gốc (`BB1`)** | - Khi sửa Đề nghị mua thêm `VT3..VT5`, [`computeKtStatuses`](src/lib/maintenance-kt.ts#L322-L384) của `BB1` chỉ lặp qua danh sách vật tư có trong `BB1` (`VT1`, `VT2`), bỏ qua `VT3..VT5`.<br>- Khi nhập kho, cả `VT1..VT5` đều vào kho. `BB1` chỉ xuất `VT1`, `VT2`; còn `VT3..VT5` nằm nguyên trong kho. |
| **D. Điểm nghẽn 1: Nếu `VT1` vừa nhập dư xong, Biên bản tiếp theo chọn `VT1` là "Trong kho" hay "Mua ngoài"?** | ⚠️ **Khác biệt kho (`KT` vs Kho chính)** | - Nếu `VT1` lúc nhập kho được chọn nhập vào **Kho chính (`is_primary`)** của `VT1`: Biên bản sau chọn `VT1` là **Trong kho (`trong_kho`)** hay **Mua ngoài (`ben_ngoai`)** đều thấy tồn kho và xuất được.<br>- Nhưng nếu `VT1` lúc nhập kho được chọn nhập vào **Kho tạm `KT`** (trong khi kho chính `is_primary` của `VT1` là Kho Cơ Khí): Biên bản sau nếu chọn nguồn **Trong kho (`trong_kho`)** sẽ chỉ tìm ở Kho Cơ Khí (thấy tồn = 0), buộc phải chọn nguồn **Mua ngoài (`ben_ngoai`)** hoặc phải chuyển kho từ `KT` về Kho Cơ Khí. |
| **E. Điểm nghẽn 2: Nếu `VT3`, `VT4`, `VT5` thêm vào là để mua gộp cho Biên bản 2 (`BB2` đang mở)** | ❌ **BỊ ĐỨT LIÊN KẾT ở `BB2`** | - Vì `purchase_requests.maintenance_record_id` chỉ lưu `BB1.id`:<br>  1. Lúc chưa nhập kho: `BB2` không biết `VT3..VT5` đã nằm trong Đề nghị mua của `BB1`, nên `BB2` vẫn báo *"Cần lập đề nghị mua"* (dễ dẫn tới bấm lập đề nghị trùng).<br>  2. Lúc đã nhập kho: Nếu `VT3..VT5` nhập vào kho khác với kho `is_primary` của chúng, `BB2` không tìm thấy kho đã nhập.<br>  3. Nếu trong `VT3..VT5` có **Dịch vụ gia công (`gia_cong`)** của `BB2`: `BB2` bị **kẹt vĩnh viễn** không gửi ký được vì `completedByRecord` chỉ tính dịch vụ của phiếu có `maintenance_record_id = BB2.id`. |

#### 3. Giải pháp đề xuất để hoàn thiện 100% Mong muốn 2
1. **Giữ nguyên cơ chế cho phép sửa tăng số lượng và thêm dòng vật tư** trên Phiếu đề nghị mua tạo từ biên bản (`PurchaseForm`).
2. **Hỗ trợ liên kết Đa Biên bản (hoặc cấp Dòng `purchase_request_lines.maintenance_record_id`)**:
   - Thêm cột tuỳ chọn `maintenance_record_id UUID REFERENCES maintenance_records(id)` trên bảng `purchase_request_lines` (mặc định kế thừa từ `purchase_requests.maintenance_record_id`, hoặc cho phép gắn/tự động nhận diện từ các biên bản đang thiếu vật tư đó).
   - Hoặc trong [`resolveExternalWarehouses`](src/lib/maintenance-kt.ts#L88-L173) và [`computeKtStatuses`](src/lib/maintenance-kt.ts#L254-L313):
     - Cho phép Tầng 1 của `resolveExternalWarehouses` tìm kho nhập gần nhất của `itemId` từ bất kỳ phiếu nhập mua hàng nào nếu biên bản không có phiếu đề nghị riêng.
     - Cho phép người dùng (hoặc hệ thống tự gợi ý) liên kết thêm Biên bản `BB2` vào cùng Phiếu đề nghị mua `P1` (bảng trung gian `purchase_request_maintenance_links(request_id, maintenance_record_id)` hoặc mảng `maintenance_record_ids`) để khi gộp nhiều biên bản vào 1 Đề nghị mua, cả `BB1` và `BB2` đều thấy `linkedRequests`, `pendingRequested`, kho nhập và kết quả hoàn thành gia công `gia_cong`.

---

## PHẦN II — DANH SÁCH 7 BUG / LỖ HỔNG LOGIC PHÁT HIỆN TRONG CODE

### Bug 1 [Mức độ: Cao / Deadlock]: Lỗ hổng giữ chỗ FIFO (`reservedByOthers`) làm Biên bản cũ (chưa mua hàng) chiếm đoạt tồn kho của Biên bản mới (đã mua & nhập kho)
- **File & Dòng code**: [`src/lib/maintenance-kt.ts` (dòng 319, 347–353)](src/lib/maintenance-kt.ts#L347-L353)
- **Nguyên nhân**:
  ```ts
  for (const e of earlier) {
    if ((whByPair.get(`${e.id}:${itemId}`) || null) !== whId) continue
    reserved += needByRecord.get(e.id)?.get(itemId) || 0
  }
  const available = Math.max(0, onHand - reserved)
  ```
  Hệ thống sắp xếp các biên bản chưa duyệt theo `created_at ASC` và lấy **toàn bộ nhu cầu (`need`)** của mọi biên bản tạo trước để trừ vào `onHand` của biên bản tạo sau, **không cần biết biên bản tạo trước đã mua hàng về kho hay chưa**.
- **Kịch bản tái hiện**:
  1. **Biên bản A** tạo lúc 08:00, cần **5 cái** Vòng bi (nguồn `ben_ngoai`, tồn kho = 0). Biên bản A chưa mua hàng.
  2. **Biên bản B** tạo lúc 10:00, cần **3 cái** Vòng bi (cùng mã, cùng kho). Biên bản B cần gấp nên lập Đề nghị mua, duyệt và **nhập kho 3 cái** (`onHand = 3`).
  3. Do Biên bản A tạo trước (`earlier`), A giữ chỗ `reserved = 5`. Tồn khả dụng của Biên bản B bị tính thành `available = max(0, 3 - 5) = 0`, `shortage = 3`!
  4. **Hậu quả**: Biên bản B (người mua hàng về) bị chặn không cho gửi ký; Biên bản A cũng chưa đủ 5 cái nên không ký được (**Deadlock cả 2 biên bản**). Nếu Biên bản A chỉ cần 3 cái, Biên bản A có thể bấm gửi ký và xuất kho lấy mất 3 cái mà Biên bản B vừa mua về!
- **Hướng khắc phục**:
  - Tồn kho nhập từ phiếu đề nghị có `maintenance_record_id = rec.id` phải được **ưu tiên phân bổ (earmark) cho chính `rec.id` đó trước**, phần tồn kho dư ra (không gắn biên bản hoặc dư sau khi đáp ứng biên bản chủ sở hữu) mới đưa vào bể tồn chung chia theo FIFO `created_at`.

---

### Bug 2 [Mức độ: Cao / Kẹt trạng thái]: Mâu thuẫn giữa UI và API khiến Phiếu đề nghị mua ở trạng thái `da_duyet` (chưa nhập kho lần nào) không thể Đóng và cũng không thể Huỷ
- **File & Dòng code**:
  - [`src/app/api/purchase/requests/[id]/close/route.ts` (dòng 33–38)](src/app/api/purchase/requests/[id]/close/route.ts#L33-L38)
  - [`src/app/api/purchase/requests/[id]/cancel/route.ts` (dòng 33–43)](src/app/api/purchase/requests/[id]/cancel/route.ts#L33-L43)
  - [`src/app/api/purchase/requests/[id]/route.ts` (dòng 200–203)](src/app/api/purchase/requests/[id]/route.ts#L200-L203)
  - [`src/app/dashboard/purchase/[id]/page.tsx` (dòng 594)](src/app/dashboard/purchase/[id]/page.tsx#L594)
- **Nguyên nhân**:
  - API `close/route.ts` chỉ cho phép đóng phiếu ở trạng thái `dang_mua` (đã nhập ít nhất 1 phần); nếu phiếu đang ở `da_duyet` (chưa nhập gì), API trả lỗi hướng dẫn: *"Phiếu chưa nhập kho lần nào — nếu không mua nữa, nhờ admin huỷ phiếu"*.
  - API `cancel/route.ts` đã cho phép Admin huỷ phiếu ở trạng thái `da_duyet`.
  - **NHƯNG** tại `GET /api/purchase/requests/[id]/route.ts` dòng 202, biến `perms.canCancel` lại viết:
    ```ts
    (actor.isAdmin && status !== "huy" && status !== "hoan_tat" && status !== "da_duyet" && status !== "dang_mua" && status !== "dong")
    ```
    Và tại `purchase/[id]/page.tsx` dòng 594 lại chặn `(detail.perms.canCancel && !isApproved)`.
- **Hậu quả**: Khi phiếu đã duyệt (`da_duyet`) nhưng huỷ kế hoạch mua (chưa nhập kho lần nào), **cả người tạo lẫn Admin đều không thấy nút "Huỷ phiếu" và cũng không có nút "Đóng phiếu"** trên giao diện. Phiếu bị treo vĩnh viễn ở trạng thái `da_duyet`.
- **Hướng khắc phục**:
  - Bỏ điều kiện `status !== "da_duyet"` đối với `actor.isAdmin` trong `perms.canCancel` tại [`requests/[id]/route.ts` dòng 202](src/app/api/purchase/requests/[id]/route.ts#L202).
  - Sửa điều kiện hiển thị nút Huỷ tại [`purchase/[id]/page.tsx` dòng 594](src/app/dashboard/purchase/[id]/page.tsx#L594) thành `detail.perms.canCancel` (vì `canCancel` từ server đã tính toán đầy đủ cho cả người tạo và Admin).

---

### Bug 3 [Mức độ: Cao / Lệch pha dữ liệu]: Biên bản bảo trì bị kẹt ở trạng thái "Đã ký hoàn tất (`yeu_cau_ky = hoan_tat`) nhưng Biên bản vẫn Chờ duyệt (`maintenance_records = cho_duyet`)" khi lỗi xuất kho bước cuối
- **File & Dòng code**:
  - [`src/lib/signing/requests.ts` (dòng 498–546)](src/lib/signing/requests.ts#L498-L546)
  - [`src/app/api/maintenance/reverse-approval/route.ts` (dòng 40)](src/app/api/maintenance/reverse-approval/route.ts#L40)
- **Nguyên nhân**:
  - Khi Giám đốc ký bước cuối cùng của Biên bản bảo trì:
    1. Code cập nhật `yeu_cau_ky.trang_thai = 'hoan_tat'` và đóng dấu chữ ký lên PDF trước ([dòng 498–512](src/lib/signing/requests.ts#L498-L512)).
    2. Sau đó trong khối `try`, gọi `await issueMaintenanceStock(...)` rồi mới chạy `UPDATE maintenance_records SET trang_thai = 'da_duyet'` ([dòng 520–539](src/lib/signing/requests.ts#L520-L539)).
  - Nếu `issueMaintenanceStock` ném lỗi (ví dụ vật tư `trong_kho` vừa bị phiếu khác xuất hết làm không đủ tồn kho), khối `catch` bắt lỗi và trả về `maintenanceIssueError`, bỏ qua lệnh update `maintenance_records`.
  - Lúc này `yeu_cau_ky` đã là `hoan_tat` (không ký lại được nữa), nhưng `maintenance_records.trang_thai` vẫn là `cho_duyet`. Khi Admin bấm **"Huỷ ký duyệt"** (`/api/maintenance/reverse-approval`), API lại chặn `if (record.trang_thai !== "da_duyet") return 400`!
- **Hậu quả**: Biên bản bị kẹt cứng giữa 2 trạng thái, không xuất kho lại được và cũng không huỷ duyệt được.
- **Hướng khắc phục**:
  - Thực hiện kiểm tra tồn kho vật tư `trong_kho` (hoặc chạy `issueMaintenanceStock`) **trước khi** chốt `yeu_cau_ky.trang_thai = 'hoan_tat'`, hoặc nếu `issueMaintenanceStock` lỗi thì phải rollback trạng thái bước ký cuối.
  - Đồng thời trong `reverse-approval/route.ts`, cho phép Admin huỷ duyệt cả khi `record.trang_thai === 'cho_duyet'` nhưng `yeu_cau_ky.trang_thai === 'hoan_tat'`.

---

### Bug 4 [Mức độ: Trung bình - Cao]: Không cộng dồn số lượng theo mã vật tư `trong_kho` khi Lưu và Gửi ký Biên bản bảo trì có nhiều thiết bị
- **File & Dòng code**: [`src/app/dashboard/maintenance/records/[id]/page.tsx` (dòng 1196–1205)](src/app/dashboard/maintenance/records/[id]/page.tsx#L1196-L1205) và [`src/app/api/signing/create-request/route.ts` (dòng 94–102)](src/app/api/signing/create-request/route.ts#L94-L102)
- **Nguyên nhân**:
  - Trong `handleSave` của Biên bản bảo trì, code chỉ kiểm tra từng dòng đơn lẻ: `if (item && parseFloat(mat.so_luong) > item.currentStock)`.
  - Nếu trong cùng 1 biên bản, Thiết bị 1 dùng 2 cái lọc nhớt (`trong_kho`), Thiết bị 2 dùng 2 cái lọc nhớt (`trong_kho`), trong khi tồn kho còn 3 cái:
    - Lúc Lưu biên bản: `2 <= 3` và `2 <= 3` → Cho lưu!
    - Lúc Gửi ký duyệt: `create-request/route.ts` chỉ kiểm tra `computeKtStatuses` (vật tư `ben_ngoai` và `gia_cong`), không kiểm tra tổng tồn vật tư `trong_kho` → Cho gửi ký!
    - Lúc Giám đốc ký bước cuối: `issueMaintenanceStock` cộng dồn `2 + 2 = 4 > 3` → Nổ lỗi xuất kho vượt tồn và kích hoạt **Bug 3**!
- **Hướng khắc phục**:
  - Cộng dồn tổng `so_luong` theo `inventory_item_id` cho các dòng `trong_kho` trên toàn bộ các hạng mục thiết bị của biên bản khi kiểm tra trong `handleSave` và kiểm tra chặn server-side ngay tại `POST /api/signing/create-request`.

---

### Bug 5 [Mức độ: Trung bình]: Tính sai `pendingRequested` và tiến độ mua khi có Phiếu điều chỉnh giảm số lượng
- **File & Dòng code**:
  - [`src/lib/maintenance-kt.ts` (dòng 301–313)](src/lib/maintenance-kt.ts#L301-L313)
  - [`src/app/api/purchase/requests/route.ts` (dòng 126–170)](src/app/api/purchase/requests/route.ts#L126-L170)
- **Nguyên nhân**:
  - Khi Phiếu điều chỉnh (`loai = 'dieu_chinh'`) được duyệt hoàn tất, cột `so_luong` trên dòng của phiếu gốc (`purchase_request_lines`) được giữ nguyên bất biến; số lượng hiệu lực mới chỉ lấy được qua RPC `purchase_effective_lines`.
  - Tuy nhiên, `computeKtStatuses` và danh sách `GET /api/purchase/requests` lại đọc trực tiếp `l.so_luong` từ dòng của phiếu gốc đang ở trạng thái `dang_mua` / `da_duyet`.
- **Hậu quả**: Nếu phiếu gốc đề nghị 10 cái, đã nhập 2 cái (`dang_mua`), sau đó lập Phiếu điều chỉnh giảm từ 10 xuống 5 cái: `computeKtStatuses` vẫn tính `pending = 10 - 2 = 8` (thay vì `5 - 2 = 3`), làm Biên bản bảo trì tưởng rằng đang có đủ hàng chờ về nên không bật cảnh báo `needsRequest`.
- **Hướng khắc phục**:
  - Sử dụng số lượng hiệu lực (hoặc áp dụng bản ghi điều chỉnh `loai = 'dieu_chinh', trang_thai = 'hoan_tat'` mới nhất theo `parent_line_id`) khi tính `pendingRequested` trong `maintenance-kt.ts` và tiến độ trong `purchase/requests/route.ts`.

---

### Bug 6 [Mức độ: Trung bình]: Người tạo Biên bản bảo trì không có quyền `purchase.create` bị chặn sửa Phiếu đề nghị nháp nhưng lại bấm "Gửi ký duyệt" được (với đơn giá 0đ)
- **File & Dòng code**:
  - [`src/app/api/purchase/requests/[id]/route.ts` (dòng 194–195)](src/app/api/purchase/requests/[id]/route.ts#L194-L195)
  - [`src/app/api/purchase/requests/[id]/approvers/route.ts` (dòng 39–41)](src/app/api/purchase/requests/[id]/approvers/route.ts#L39-L41)
  - [`src/app/api/purchase/requests/[id]/submit/route.ts` (dòng 27–33)](src/app/api/purchase/requests/[id]/submit/route.ts#L27-L33)
- **Nguyên nhân**:
  - Nhân viên bảo trì (chỉ có quyền `maintenance.create`, không có quyền `purchase.create`) bấm *"Lập đề nghị mua"* trên biên bản bảo trì → được gán làm `nguoi_de_nghi_id` (`isOwner = true`), các dòng vật tư mới có `don_gia_du_kien = 0`.
  - Ở `perms.canEdit`: hệ thống kiểm tra `hasCreatePerm` (`purchase.create`) nên nhân viên bảo trì **không sửa được giá/nhà cung cấp**.
  - Nhưng ở `perms.canSubmit`, `approvers/route.ts` và `submit/route.ts`: hệ thống chỉ kiểm tra `isOwner` mà **quên kiểm tra `hasCreatePerm` (`purchase.create`)**.
- **Hậu quả**: Nhân viên bảo trì không có quyền lập phiếu mua hàng và không điền được giá nhưng lại thấy nút **"Gửi ký duyệt"** và có thể đẩy phiếu đề nghị đơn giá `0đ` đi trình ký Giám đốc.
- **Hướng khắc phục**:
  - Bắt buộc kiểm tra `hasCreatePerm` (`purchase.create`) trong `perms.canSubmit`, `PATCH /api/purchase/requests/[id]/approvers` và `POST /api/purchase/requests/[id]/submit`.

---

### Bug 7 [Mức độ: Thấp / UX]: Hai điểm thiếu đồng bộ trên giao diện Đề nghị mua vật tư
1. **Modal "+ Tạo vật tư mới" trong form Đề nghị mua không hỗ trợ tạo Dịch vụ gia công (`la_dich_vu`)**:
   - File: [`src/app/api/purchase/items/route.ts` (dòng 93–102)](src/app/api/purchase/items/route.ts#L93-L102) và [`src/app/dashboard/purchase/_components/purchase-form.tsx`](src/app/dashboard/purchase/_components/purchase-form.tsx).
   - Khác với `ExtMaterialModal` bên Biên bản bảo trì (cho phép chọn Vật tư kho hoặc Dịch vụ gia công ngoài `la_dich_vu = true`), modal tạo nhanh vật tư trong Phiếu đề nghị mua luôn mặc định `la_dich_vu = false`.
2. **Câu thông báo cứng về "Kho tạm KT" trên trang chi tiết Phiếu đề nghị mua**:
   - File: [`src/app/dashboard/purchase/[id]/page.tsx` (dòng 370)](src/app/dashboard/purchase/[id]/page.tsx#L370).
   - Hiển thị câu chữ cũ: *"vật tư mua ngoài, nhập kho vào kho tạm KT; biên bản chỉ gửi ký được khi kho tạm đủ hàng"*, trong khi hệ thống đã cho phép nhập vào bất kỳ kho nào và tự động tra cứu qua `resolveExternalWarehouses`.


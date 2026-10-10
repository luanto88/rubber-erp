# Thiết kế Kỹ thuật: Phân hệ Hỗ trợ Kỹ thuật Sản lượng (Output Converter Engine)

> **Tài liệu tham chiếu chuẩn bị triển khai**  
> Dựa trên kiến trúc Hỗ trợ Kỹ thuật đã áp dụng thành công tại phân hệ **Kiểm nghiệm (`quality`)**.

---

## 1. Mục tiêu và Bối cảnh

### 1.1. Hiện trạng nghiệp vụ
Hiện tại, phân hệ Sản lượng (`src/app/dashboard/output/`) đang tiếp nhận dữ liệu qua 2 hình thức:
1. **Nhập thủ công từng phiếu**: Qua modal `OutputForm` (nhập từng xe, chuyến, đội, 5 bộ khối lượng/DRC).
2. **Nhập bảng tính Excel**: Qua modal `OutputImport` (yêu cầu người dùng tải file mẫu `SLRpt_SanLuongNgay_TongHop.xlsx` hoặc file Excel chuẩn trạm cân, điền dữ liệu và tải lên lại).

### 1.2. Mục tiêu cải tiến
Tích hợp tính năng **Hỗ trợ Kỹ thuật** trực tiếp vào thanh công cụ của module Sản lượng:
- Cho phép người dùng kéo thả trực tiếp **Báo cáo sản lượng ngày (PDF)** từ nông trường/nhà máy hoặc **File Excel trạm cân**.
- Backend tự động bóc tách các dòng sản lượng bằng Python Engine chuyên dụng (`parse_san_luong.py`).
- Hiển thị màn hình làm việc chuyên biệt (`OutputConverterView`) với **Ma trận Đối soát Thông minh (Smart Matching Matrix)** kết nối 2 chiều với phân hệ **Điều xe (`dispatch`)**.
- Cung cấp hành động **"Đẩy thẳng lên phân hệ Sản lượng"**: Tự động lưu dữ liệu vào `production_records` và cập nhật khối lượng thực tế ngược sang bảng `dispatch_entries.rows` và `dispatch_entry_rows` (`writeBackToDispatch`), không yêu cầu tải về rồi upload lại thủ công.
- Cung cấp hành động **"Tải file Excel đối chiếu"**: Xuất file Excel chuẩn hóa phục vụ lưu trữ ngoại tuyến hoặc kiểm toán.
- Giữ nguyên các chức năng cũ (Tải mẫu, Nhập Excel truyền thống) làm phương án dự phòng.

---

## 2. Giao diện Người dùng (UI/UX) & Nút Action Header

### 2.1. Nút Action trên Header Banner
- **Vị trí**: Thanh `PageHeaderBanner` của trang Sản lượng (`src/app/dashboard/output/page.tsx`), nằm cạnh các nút chức năng hiện có.
- **Phong cách**: Nút bo góc viên thuốc `rounded-xl`, hiệu ứng kính mờ `bg-white/15 border border-white/40 hover:bg-white/25 active:scale-95 transition-all`.
- **Biểu tượng (Icon)**: Hàm toán học chuyển đổi sang bảng tính Excel: $f(x) \rightarrow$ [icon Excel] (`FxToExcelIcon`).
- **Quy tắc bất biến**: **Tuyệt đối không có text chú thích bên cạnh icon** (đảm bảo thanh header gọn gàng, tinh tế và đồng bộ phong cách với module Kiểm nghiệm).
- **Phân quyền**: Chỉ hiển thị khi người dùng là Admin hoặc có mã quyền `output.tech_support`:
  ```tsx
  {(hasPermission(currentUser, "output.tech_support") || currentUser?.role === "admin") && (
    <button
      onClick={() => setView(view === "converter" ? "list" : "converter")}
      title="Hỗ trợ kỹ thuật sản lượng (Chuyển đổi báo cáo PDF/Excel sang dữ liệu sản lượng)"
      className={`p-2.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center ${
        view === "converter"
          ? "bg-amber-500/30 border-amber-300 text-amber-200 shadow-sm"
          : "bg-white/15 border-white/40 text-white hover:bg-white/25"
      }`}
    >
      <FxToExcelIcon className="w-5 h-5 text-current" />
    </button>
  )}
  ```

### 2.2. View Chuyên biệt (`OutputConverterView`)
- Không sử dụng modal pop-up nhỏ; chuyển toàn trang sang giao diện chuyên biệt `view === "converter"`.
- Cấu trúc các khối:
  1. **Thanh điều hướng quay lại & Tiêu đề**: Nút quay về danh sách sản lượng + tiêu đề "Hỗ trợ Kỹ thuật: Bóc tách & Đối soát Sản lượng".
  2. **Khu vực Tải tệp (Dropzone)**: Hỗ trợ kéo thả PDF / Excel báo cáo sản lượng ngày.
  3. **Thanh Bộ lọc & Tùy chọn**:
     - Lọc theo Đội (Tất cả / Thu mua / Đội 1..12).
     - Lọc theo Chủng loại mủ hiển thị (Mủ nước, Mủ chén, Mủ đông chén, Mủ đông khối, Mủ dây).
     - Trạng thái đối soát (Khớp hoàn toàn, Có cảnh báo, Lỗi).
  4. **Bảng Ma trận Đối soát Thông minh**:
     - Cột Checkbox chọn dòng (mặc định chọn tất cả các dòng Khớp hoàn toàn).
     - STT, Ngày, Đội, Số xe (biển số gốc + chuẩn hóa), Chuyến.
     - Tài xế & Điểm giao nhận (đối chiếu tự động từ Điều xe).
     - 5 bộ chỉ tiêu mủ: Tươi (kg) • DRC (%) • Quy khô (kg).
     - Trạng thái đối soát: Huy hiệu màu trực quan (Xanh: Khớp / Vàng: Cảnh báo / Đỏ: Lỗi).
     - Ghi chú phân loại.
  5. **Thanh Tác vụ Bottom Bar**:
     - Tổng số dòng, tổng kg tươi, tổng kg quy khô đã chọn.
     - Nút phụ: **"Tải file Excel đối chiếu"** (Xuất .xlsx).
     - Nút chính: **"Đẩy thẳng lên phân hệ Sản lượng"** (Button xanh/emerald có icon tia sét/mũi tên).

---

## 3. Phân quyền Hệ thống & Cơ sở Dữ liệu

### 3.1. Bảng `permissions` và `role_permissions` trong Supabase
Thực thi migration SQL để thêm mã quyền mới:
```sql
-- 1. Thêm permission vào bảng permissions
INSERT INTO public.permissions (code, module_name, action_name, description)
VALUES ('output.tech_support', 'output', 'tech_support', 'Quyền sử dụng công cụ hỗ trợ kỹ thuật bóc tách và đối soát sản lượng')
ON CONFLICT (code) DO NOTHING;

-- 2. Gán quyền mặc định cho vai trò admin
INSERT INTO public.role_permissions (role, permission_code)
VALUES ('admin', 'output.tech_support')
ON CONFLICT DO NOTHING;
```

### 3.2. Cấu hình Code Frontend & Auth
1. **`src/lib/auth.ts`**:
   - Thêm `"output.tech_support"` vào mảng `DEFAULT_PERMISSION_CODES`.
2. **`src/app/dashboard/settings/page.tsx`**:
   - Thêm `"output.tech_support": "hỗ trợ kỹ thuật sản lượng"` vào `PERMISSION_CODE_LABELS`.
   - `PERMISSION_ACTION_LABELS["tech_support"]` đã có giá trị `"hỗ trợ kỹ thuật"`.

---

## 4. Kiến trúc Engine Xử lý (Thuần TypeScript / Node.js Serverless)

### 4.1. TypeScript Parser Engine (`src/lib/output-parser.ts`)
- **Nguyên tắc môi trường Serverless**: Do hệ thống triển khai trên Vercel, Node.js runtime không hỗ trợ Python. Toàn bộ logic bóc tách tài liệu phải viết bằng **thuần TypeScript / Node.js** để tránh lỗi `spawn python ENOENT`.
- **Nhiệm vụ bóc tách**:
  - Nhận diện định dạng tệp: PDF (bằng `pdfjs-dist/legacy/build/pdf.mjs`) hoặc Excel (bằng `exceljs`/`xlsx`).
  - Trích xuất các cột: Ngày (`ngay`), Đội (`doi`: 0 cho Thu mua 'TM', 1-12 cho Đội 1..12), Số xe (`so_xe`), Chuyến (`chuyen`), Ghi chú (`ghi_chu`).
  - Chuẩn hóa biển số xe qua logic tách số xe (`base_xe`) và chuyến tương tự helper `parseVehicleCode`.
  - Bóc tách 5 bộ chỉ tiêu mủ:
    1. **Mủ nước**: `mn_tuoi`, `mn_drc`, `mn_kho`.
    2. **Mủ chén**: `ct_tuoi`, `ct_drc`, `ct_kho`.
    3. **Mủ đông chén**: `dct_tuoi`, `dct_drc`, `dct_kho`.
    4. **Mủ đông khối**: `dkt_tuoi`, `dkt_drc`, `dkt_kho`.
    5. **Mủ dây**: `dt_tuoi`, `dt_drc`, `dt_kho`.
  - Tự động bù trừ/tính quy khô nếu thiếu: `kho = round(tuoi * drc / 100, 2)` khi `kho == 0` nhưng `tuoi > 0` và `drc > 0`.
  - Thực thi trực tiếp trong tiến trình Node.js không qua subprocess, thời gian hoàn tất dưới 50ms.

### 4.2. API Route (`src/app/api/output/parse-report/route.ts`)
- **Bảo mật**:
  - Nhận header `Authorization: Bearer <accessToken>`.
  - Xác thực qua `requireAuthUser(req)`.
  - Kiểm tra quyền: Admin hoặc có quyền `output.tech_support` / `output.import` trong `user_permissions` hoặc `role_permissions`.
- **Thực thi phân tích**:
  - Gọi trực tiếp hàm parse từ `src/lib/output-parser.ts`.
  - Trả về payload cấu trúc: `{ success: true, rows: ParsedSlRow[], metadata: { totalRows, detectedDate, ... } }`.


---

## 5. Ma trận Đối soát Thông minh (Smart Matching Matrix)

### 5.1. Khóa nhận diện bản ghi
Mỗi dòng sản lượng được định danh duy nhất qua hàm:
```typescript
buildProductionRecordKey({
  ngay: row.ngay,
  doi: row.doi,
  so_xe: row.base_xe,
  chuyen: row.chuyen,
  ma_nguon: row.ma_nguon || (row.doi === 0 || row.ghi_chu === "TM" ? "m" : "cs"),
})
```

### 5.2. Liên kết 2 chiều với Phân hệ Điều xe (`dispatch`)
- Truy vấn dữ liệu chuyến xe từ `dispatch_entries` và bảng vật lý `dispatch_entry_rows` theo Ngày và Nhà máy (`factory_id`).
- Tự động ánh xạ:
  - Ghép tên **Tài xế (`tai_xe`)** phụ trách chuyến xe.
  - Đối chiếu **Điểm giao nhận (`diem_gn`)** của chuyến xe trong lệnh điều xe với Đội ghi trên phiếu sản lượng.

### 5.3. Phân loại trạng thái đối soát
| Trạng thái | Mã cảnh báo | Ý nghĩa nghiệp vụ | Hành vi mặc định trên UI |
| :--- | :--- | :--- | :--- |
| 🟢 **Khớp hoàn toàn** | Không có | Khớp ngày, xe, chuyến, đội và khớp lệnh điều xe tương ứng. | ✅ **Tự động tick chọn** sẵn sàng lưu. |
| 🟡 **Cảnh báo** | `DUPLICATE_IN_SYSTEM` | Đã tồn tại bản ghi sản lượng của xe/chuyến này trong ngày. | ⚠️ Hiển thị cảnh báo ghi đè, cho phép người dùng tick nếu muốn cập nhật. |
| 🟡 **Cảnh báo** | `NO_DISPATCH_DATE` / `VEHICLE_NOT_FOUND` / `CHUYEN_NOT_FOUND` | Không tìm thấy chuyến điều xe tương ứng trong ngày. | ⚠️ Hiển thị cảnh báo thiếu điều xe, cho phép lưu sản lượng độc lập. |
| 🟡 **Cảnh báo** | `DOI_MISMATCH` | Đội trên báo cáo sản lượng khác với điểm giao nhận được giao trong điều xe. | ⚠️ Yêu cầu kiểm tra chéo giữa trạm cân và điều xe. |
| 🟡 **Cảnh báo** | `ZERO_KL` | Khối lượng tươi và khô đều bằng 0. | ⚠️ Bỏ chọn mặc định. |
| 🔴 **Lỗi** | `INVALID_DATE` / `INVALID_VEHICLE` / `INVALID_DRC` | Lỗi cú pháp dữ liệu hoặc DRC bất thường. | ⛔ Không cho phép lưu dòng này. |

---

## 6. Cơ chế Ghi Dữ liệu Kép (Dual Write Action)

Khi người dùng nhấn **"Đẩy thẳng lên phân hệ Sản lượng"**:

1. **Khởi tạo Lô nhập**:
   Sinh mã batch: `const importBatchId = "batch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)`.
2. **Ghi vào `production_records`**:
   - Chèn hoặc cập nhật các dòng hợp lệ đã được tick chọn vào bảng `production_records`.
   - Gắn kèm `factory_id`, `created_by = currentUser.id`, `nguoi_upload = currentUser.full_name`, `import_batch_id`.
3. **Đồng bộ ngược sang Điều xe (`writeBackToDispatch`)**:
   - Tự động gọi helper `writeBackToDispatch(supabase, factoryId, date, updatedRows)`.
   - Cập nhật khối lượng mủ thực tế (`kl_thuc_te`) và trạng thái hoàn thành chuyến xe trong cả `dispatch_entries.rows` và bảng vật lý `dispatch_entry_rows`.
4. **Thông báo và Chuyển view**:
   - Hiển thị Toast thông báo kết quả (ví dụ: *"Đã nạp thành công 28 bản ghi sản lượng, đồng bộ 14 chuyến điều xe"*).
   - Làm mới bộ đệm dữ liệu sản lượng.
   - Tự động chuyển hiển thị về giao diện bảng danh sách (`view = "list"`).

---

## 7. Kế hoạch Triển khai theo từng Bước (Checklist)

- [ ] **Bước 1**: Khởi tạo bản ghi quyền `output.tech_support` trong DB Supabase và cấu hình nhãn tiếng Việt trong `settings/page.tsx` + `auth.ts`.
- [ ] **Bước 2**: Xây dựng script Python parser `src/server/scripts/parse_san_luong.py` với chuẩn stdout marker `__OUTPUT_JSON_START__ ... __OUTPUT_JSON_END__`.
- [ ] **Bước 3**: Viết API Route `src/app/api/output/parse-report/route.ts` hỗ trợ xác thực Bearer token và thực thi an toàn.
- [ ] **Bước 4**: Xây dựng component `OutputConverterView` tại `src/app/dashboard/output/_components/output-converter-view.tsx` tích hợp dropzone, ma trận đối soát và 2 tác vụ nạp DB / xuất Excel.
- [ ] **Bước 5**: Thêm nút Action $f(x) \rightarrow$ [Excel] vào `PageHeaderBanner` trong `src/app/dashboard/output/page.tsx` và điều phối chuyển view.
- [ ] **Bước 6**: Kiểm thử toàn diện với các mẫu file sản lượng thực tế và kiểm tra tính năng đồng bộ ngược Điều xe.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Quy ước nghiệp vụ hiện tại

- Phiếu thành phẩm ở `src/app/dashboard/product/page.tsx` hiển thị chung một danh sách ngăn. Các mã chuẩn `N1` đến `N24` và các mã nhập tay như `BN`, `10.2`, `MN` không tách thành 2 khu riêng.
- Khi chọn ngăn cho phiếu thành phẩm, chỉ hiển thị các ngăn có trạng thái `Chờ sản xuất` hoặc `Đang sản xuất`. Ngăn `Đã sản xuất`, `Đóng`, `Đang nhận` không được hiện trong form nhập thành phẩm.
- Không đặt nút đổi trạng thái ngăn trong vùng chọn ngăn của phiếu thành phẩm.
- Nút đổi trạng thái ngăn phải nằm ở hàng icon header của thẻ ngăn trong module Kho nguyên liệu tại `src/app/dashboard/storage/page.tsx`.
- Trạng thái ngăn được suy ra theo mốc ngày như sau:
- Nếu ngăn đã có `Từ ngày` nhưng chưa có `Đến ngày` thì trạng thái là `Đang nhận`.
- Nếu ngăn đã có cả `Từ ngày` và `Đến ngày` thì trạng thái nền là `Đóng`, nghĩa là không nhận thêm nguyên liệu.
- Nếu ngăn đã có cả `Từ ngày` và `Đến ngày`, đồng thời `ngày hiện tại - Từ ngày` lớn hơn hoặc bằng `21`, thì tự động chuyển sang `Chờ sản xuất`.
- Admin được phép chuyển tay từ `Đóng` sang `Chờ sản xuất` khi `Ngày lưu` lớn hơn hoặc bằng `6`.
- Sau khi thành phẩm đạt tỷ lệ từ `100%` đến `110%`, người dùng có thể lưu và admin có thể đánh dấu ngăn sang `Đã sản xuất`.
- Khi ngăn đang là `Đã sản xuất`, nếu dữ liệu thành phẩm đồng bộ làm tỷ lệ xuống dưới `100%` thì tự động chuyển về `Đang sản xuất`.
- Khi ngăn đang là `Đã sản xuất` và tỷ lệ sau đồng bộ vẫn nằm trong khoảng `100%` đến `110%` thì giữ nguyên `Đã sản xuất`.
- Khi ngăn đang là `Đang sản xuất` và tỷ lệ nằm trong khoảng `100%` đến `110%`, admin có thể chuyển tay sang `Đã sản xuất`.
- Chỉ khi admin chuyển tay ngăn từ `Đã sản xuất` về `Đang sản xuất` thì ngăn mới xuất hiện lại trong danh sách chọn của phiếu thành phẩm.
- Cảnh báo “nhảy lô” cho các dải giữ code hợp lệ như `347CS/26` đến `351CS/26` vẫn chưa được xử lý dứt điểm.

## Quy ước EUDR hiện tại

- Luồng upload file EUDR phải giữ fix `sanitize` cho path/tên file. Ký tự có dấu, khoảng trắng hoặc ký tự đặc biệt không được đẩy nguyên trạng lên storage key.
- Route fallback server upload ở `src/app/api/eudr/upload/route.ts` vẫn được giữ để dự phòng khi policy bucket `eudr-files` lệch giữa các môi trường.
- Panel debug file đính kèm trong `src/app/dashboard/eudr/EudrClient.tsx` không hiển thị mặc định. Chỉ bật khi có cờ `NEXT_PUBLIC_EUDR_DEBUG=1`.
- Dữ liệu lô vườn trên màn EUDR phải ưu tiên `forest_plots` cho geometry và metadata đã seed trong DB, nhưng vẫn cần ghép thêm thuộc tính từ GeoJSON chuẩn `Lo cao su - 2026_Full.geojson` theo mã `Ten` để không mất các field như giống, năm trồng, năm mở cạo, đội nhỏ, tổng cây KK, mặt cạo, tọa độ.
- Popup và thẻ chi tiết lô trên map EUDR phải dùng bộ field đã merge nói trên để hiển thị gần tương đương module `ban_do_lo`.
- Không render thẻ overlay HTML thường bên trong cây con của `MapContainer`. Các panel như legend, chi tiết lô, trạng thái tải phải nằm ngoài `MapContainer` để tránh lỗi runtime kiểu Leaflet `appendChild`.
- Các callback truyền vào `GeoJSON` như `style` và `onEachFeature` nên giữ ổn định bằng `useCallback` nếu state UI bên ngoài map có thể thay đổi khi click/chọn lô.

## Quy ước ISO & Nhân bản chữ ký / tên hiện tại

- **Luồng ký ISO theo Cấp tài liệu**:
  - **Cấp 1 (3 bước)**: Soạn thảo (Ký & Gửi xem xét) → Xem xét (Ký xem xét & Gửi phê duyệt) → Phê duyệt (Ký phê duyệt & Ban hành).
  - **Cấp 2 (2 bước)**: Gửi phê duyệt (Người soạn ký & Gửi phê duyệt trực tiếp, bỏ qua bước Xem xét) → Phê duyệt (Ký phê duyệt & Ban hành). Giao diện Cấp 2 hiển thị nhãn `Cấp 2 (2 bước: Gửi phê duyệt → Phê duyệt)` và ẩn vùng thông tin xem xét.
- **Quy tắc Nhân bản Chữ ký và Tên người ký (Signature & Name Duplication)**:
  - Nút icon `+` (Nhân bản chữ ký và tên) hiển thị trên cả ô chữ ký gốc lẫn ô tên người ký gốc trong giao diện đặt vị trí ký (`SignPlacementModal`).
  - Khi bấm `+`: Tạo ra cặp ô chữ ký bản sao và ô tên bản sao mới, vị trí khởi tạo nằm lệch 30px so với ô gốc để kéo-thả.
  - Các bản sao được trang bị icon mắt (`👁`) để ẩn/hiện và nút xóa (`×`) để tắt/xóa nếu bấm nhầm.
  - **Chỉ ô gốc (bản chính) mới có nút icon `+`** để tiếp tục nhân bản; các bản sao KHÔNG có nút `+`.
  - Trong React JSX, mảng các bản sao `extraSigBoxes` phải dùng `<Fragment key={box.id}>` (không dùng wrapper `<div>`) và component kéo-thả `ExtraDraggableBox` phải đặt ở top-level scope ngoài Modal, chỉ dùng handler `onStop` (không dùng `onDrag` cập nhật state) để tránh `bounds="parent"` bị lỗi reset tọa độ `y = 0` hoặc nổ lỗi `findDOMNode` trên React 19.
  - Phía backend (`generate-pdf`, `documents/sign`, `iso/forms/finalize`), đối với mọi loại file PDF (cả file chính và file phụ), đều tiếp nhận mảng `extraPlacements` để đóng dấu đầy đủ toàn bộ các bản sao chữ ký & tên lên file PDF kết quả.

## Quy ước Phân quyền (Permissions) & Việt hóa nhãn

- Khi tạo hoặc khai báo 1 điều kiện / mã phân quyền mới (`permission_code`), BẮT BUỘC phải dịch nhãn sang tiếng Việt rõ nghĩa và ngắn gọn trong hệ thống (ví dụ: `quality.import` dịch thành `tải lên phiếu KN`, `quality.create` dịch thành `tạo phiếu KN`, không dùng tên tiếng Anh thô hay nhãn không rõ nghĩa trong giao diện Cài đặt phân quyền người dùng).
- Việc kiểm tra phân quyền trên giao diện người dùng phải sử dụng hàm chuẩn `hasPermission(currentUser, "module.action")` thay vì hardcode so sánh vai trò `userRole === "admin"`, để đảm bảo các tài khoản không phải admin được cấp quyền tương ứng vẫn thao tác được bình thường.

## Quy ước UI/UX Detail View chuẩn cho các module (Mắt xem chi tiết)

- **File-First (Tệp luôn ở trên cùng)**: Tất cả các màn hình chi tiết có tệp đính kèm (PDF, Office .docx/.xlsx, hình ảnh) BẮT BUỘC phải đưa khối hiển thị Tệp tài liệu lên đầu trang (Top Card) với icon định dạng, tên file, dung lượng, nút Xem file và Tải về trực quan.
- **Card Container**: Sử dụng thẻ nền trắng `bg-white`, bo góc mềm `rounded-2xl`, viền mỏng `border-slate-200/90`, đổ bóng êm `shadow-sm`. Header mỗi card có khối vuông bo góc màu pastel (`w-8 h-8 rounded-xl`) chứa icon đại diện + Tiêu đề nhóm in đậm (`text-base font-extrabold text-slate-800`) + Phụ đề mô tả (`text-xs text-slate-500 font-medium`).
- **Icon màu & Nhãn trường (Field Item)**:
  - Cấu trúc: Icon pastel tượng trưng bên trái + (Label phía trên + Giá trị in đậm phía dưới).
  - Phân màu icon theo ngữ nghĩa: Mã hiệu/Tag (Đỏ `rose-50`), Nhân sự/Người (Hồng/Xanh `pink-50` / `blue-50`), Ngày/Giờ (Xanh lá `emerald-50` / Cam `amber-50`), Đơn vị/Phòng ban (Xanh lam `blue-50`), Cấp bậc/Phân loại (Hổ phách `amber-50`), Đã duyệt/Hoàn thành (Xanh lục `emerald-50`).
- **Responsive 50-50 trên Mobile**: Các trường ngắn trên mobile bắt buộc chia 2 cột đều nhau (Grid `grid-cols-2` 50%-50%), cân đối lề trên-dưới và trái-phải. Các trường dài (ghi chú, trích yếu, URL tra cứu, mã QR) chiếm trọn 1 dòng (`col-span-2`).
- **Tái sử dụng**: Khuyến khích sử dụng bộ component chuẩn trong `src/app/dashboard/_components/detail-view-ui.tsx` để đồng bộ toàn bộ hệ thống (ISO, Văn bản nội bộ, Bảo trì, Điều xe, Mua sắm, Kho...).

## Quy ước Kiến trúc & Nghiệp vụ Hỗ trợ Kỹ thuật (Technical Support / Converter Engine)

Hệ thống Hỗ trợ Kỹ thuật (Converter Engine) chuẩn hóa luồng tiếp nhận tài liệu số (PDF kết quả thí nghiệm, file báo cáo tổng hợp...), tự động bóc tách chỉ số bằng engine Python chuyên dụng, đối soát nghiêm ngặt với dữ liệu vận hành hiện có và cho phép đẩy thẳng vào cơ sở dữ liệu hệ thống mà không bắt buộc người dùng phải tải về / nhập lại thủ công.

Kiến trúc này đã hoàn thiện cho phân hệ **Kiểm nghiệm (`quality`)** và được chuẩn hóa để áp dụng cho phân hệ **Sản lượng (`output`)** theo các quy ước bất biến dưới đây:

### 1. Nút Action trên Header Banner
- **Vị trí**: Đặt trực tiếp trên thanh header banner (`PageHeaderBanner`) của module tương ứng (`quality/page.tsx`, `output/page.tsx`).
- **Thiết kế**: Dạng nút bo góc viên thuốc `rounded-xl`, phong cách kính mờ `bg-white/15 border border-white/40 hover:bg-white/25 active:scale-95 transition-all`.
- **Nguyên tắc nhãn**: **Tuyệt đối không có text chú thích bên cạnh icon** (đảm bảo thanh header gọn gàng, tinh tế và đồng bộ phong cách).
- **Biểu tượng (Icon)**: Sử dụng biểu tượng hàm toán học sang bảng tính Excel: $f(x) \rightarrow$ [icon Excel] (`FxToExcelIcon`).
- **Phân quyền kích hoạt**: Nút chỉ hiển thị khi người dùng có quyền `<module>.tech_support` hoặc là `admin` (`hasPermission(currentUser, "<module>.tech_support") || currentUser?.role === "admin"`).
- **Điều hướng View**: Nhấp vào nút sẽ chuyển trạng thái hiển thị của trang sang view chuyên biệt `view === "converter"` (như `QualityConverterView`, `OutputConverterView`) thay vì mở modal nhỏ, đảm bảo không gian làm việc rộng rãi và trực quan.

### 2. Phân quyền Cơ sở Dữ liệu & Việt hóa Nhãn
- **Database Permissions**: BẮT BUỘC phải INSERT bản ghi quyền vào bảng `permissions` trong cơ sở dữ liệu Supabase:
  - Kiểm nghiệm: `code = 'quality.tech_support'`, `module_name = 'quality'`, `action_name = 'tech_support'`.
  - Sản lượng: `code = 'output.tech_support'`, `module_name = 'output'`, `action_name = 'tech_support'`.
- **Gán quyền mặc định**: Luôn cấp quyền mặc định cho vai trò `admin` trong bảng `role_permissions`.
- **Đồng bộ mã quyền hệ thống**: Khai báo mã quyền trong mảng `DEFAULT_PERMISSION_CODES` tại `src/lib/auth.ts`.
- **Việt hóa nhãn (Bắt buộc theo quy ước chung)**:
  - Khai báo hành động chung trong `PERMISSION_ACTION_LABELS` tại `src/app/dashboard/settings/page.tsx`:
    `tech_support: "hỗ trợ kỹ thuật"`
  - Khai báo nhãn hiển thị chi tiết trong `PERMISSION_CODE_LABELS` tại `src/app/dashboard/settings/page.tsx`:
    `"quality.tech_support": "hỗ trợ kỹ thuật KQKN"`
    `"output.tech_support": "hỗ trợ kỹ thuật sản lượng"`

### 3. Kiến trúc Engine Xử lý Tài liệu (Thuần TypeScript / Node.js Serverless)
- **Nguyên tắc môi trường Production**: Hệ thống deploy trên nền tảng Serverless (Vercel Node.js runtime) **không có sẵn môi trường Python**. Việc gọi `spawn("python", ...)` sẽ dẫn đến lỗi nghiêm trọng: `spawn python ENOENT`.
- **Kiến trúc Chuẩn hóa**: Toàn bộ backend parser script và logic bóc tách tài liệu phải được viết **thuần TypeScript / Node.js**:
  - Kiểm nghiệm (`quality`): Module `src/lib/kqkn-parser.ts` sử dụng `pdfjs-dist/legacy/build/pdf.mjs` để đọc text/tọa độ bảng, thuật toán thống kê nội suy mẫu chi tiết bằng TypeScript, và `exceljs` để sinh file `.xlsx` trong bộ nhớ.
  - Sản lượng (`output`): Module parser bóc tách tương tự bằng TypeScript/Node.js, xử lý file PDF bằng `pdfjs-dist` và bảng Excel trạm cân bằng `exceljs`/`xlsx`.
- **Không phụ thuộc tiến trình ngoài**: Tuyệt đối không spawn child process Python hay tạo file tạm trên ổ cứng server. Chạy trực tiếp trong luồng Node.js của Serverless Function với thời gian phản hồi siêu tốc (<100ms).
- **DOMMatrix Polyfill**: Môi trường Node.js trên Vercel thiếu Web API `DOMMatrix` của trình duyệt. Mọi module dùng `pdfjs-dist` trên server BẮT BUỘC phải khai báo class polyfill `DOMMatrixPolyfill` trước khi gọi `import("pdfjs-dist/legacy/build/pdf.mjs")`.


### 4. Xác thực API Route & Bảo mật Phân quyền
- **Đính kèm Bearer Token**: Client khi gọi `fetch` lên API `/api/<module>/parse-...` BẮT BUỘC phải đính kèm header xác thực:
  `Authorization: Bearer ${accessToken}` (lấy từ `supabase.auth.getSession()`).
- **Xác thực Server**: API Route sử dụng `requireAuthUser(req)`.
- **Kiểm tra quyền**:
  - Người dùng là `admin` $\rightarrow$ Cho phép thực thi.
  - Người dùng thông thường $\rightarrow$ Kiểm tra bảng `user_permissions` (theo `user_id`, `permission_code = "<module>.tech_support"` hoặc `<module>.import`, và `granted = true`). Nếu không có dòng ghi đè, fallback về `role_permissions`.

---

### 5. Chi tiết Nghiệp vụ Hỗ trợ Kỹ thuật cho Phân hệ KIỂM NGHIỆM (`quality`)
- **Tài liệu nguồn**: File PDF "Biểu Kết Quả Kiểm Nghiệm Cao Su" phát hành từ phòng thí nghiệm/KCS (chứa bảng tổng hợp số lô, hạng đăng ký, kết quả các chỉ tiêu cơ lý hóa).
- **Bộ lọc động tại View**:
  - Cho phép chọn Tiêu chuẩn: **TCCS 112:2022** hoặc **TCVN 3769:2016**.
  - Cho phép chọn Số lượng mẫu kiểm nghiệm: **6 mẫu**, **10 mẫu**, hoặc **14 mẫu** để engine tự động tái tạo bảng số liệu chi tiết từng mẫu thử.
- **Tự động nhận diện Đa Chủng loại**: Parser bóc tách cột "Hạng ĐK" trên từng dòng bản ghi (ví dụ: `CSR10`, `CSR20`, `CSRL`, `CSR3L`...), không ép cứng 1 chủng loại cho cả trang.
- **Tiêu chí Đối soát 4 Yếu tố**:
  1. Số lô (`so_lo`)
  2. Chủng loại (`chung_loai` / `hang_dk`)
  3. Ngày sản xuất (`ngay_san_xuat`)
  4. Ngày kiểm nghiệm (`ngay_kiem_nghiem`)
- **Tác vụ Kép (Dual Actions)**:
  - **"Đẩy thẳng lên phân hệ kiểm nghiệm"**: Tự động đánh giá Đạt/Không đạt theo tiêu chuẩn đã chọn, lưu trực tiếp vào bảng `chat_luong_lo` / `chat_luong_lo_samples`, thông báo thành công và chuyển về danh sách kiểm nghiệm.
  - **"Tải file Excel đối chiếu"**: Xuất file `.xlsx` đầy đủ 6/10/14 mẫu chi tiết đã tái tạo để lưu trữ hoặc đối soát ngoại tuyến.
- **Duy trì chức năng cũ**: Vẫn giữ nguyên nút "Tải mẫu" và "Nhập KQKN" (file Excel mẫu truyền thống) làm fallback.

---

### 6. Chi tiết Nghiệp vụ Hỗ trợ Kỹ thuật cho Phân hệ SẢN LƯỢNG (`output`)
*(Chuẩn bị áp dụng theo đúng quy chuẩn kiến trúc của hệ thống)*

- **Tài liệu nguồn**:
  - File PDF Báo cáo sản lượng ngày từ nông trường / nhà máy (bảng tổng hợp theo đội, xe, chuyến, các loại mủ).
  - Hoặc file Excel xuất từ trạm cân / phần mềm thống kê nông trường (mẫu `SLRpt_SanLuongNgay_TongHop` hoặc tương đương).
- **Engine Xử lý (`src/server/scripts/parse_san_luong.py`)**:
  - Bóc tách tự động các trường thông tin: Ngày thu nhận (`ngay`), Đội (`doi`), Biển số xe (`so_xe`), Chuyến (`chuyen`), Ghi chú (`ghi_chu`).
  - Chuẩn hóa biển số xe bằng helper `parseVehicleCode` (tách `base_xe` và số chuyến).
  - Phân loại Đội: `0` tương ứng với Thu mua (`TM`), `1` đến `12` tương ứng với các Đội nông trường từ Đội 1 đến Đội 12.
  - Bóc tách đầy đủ 5 nhóm chỉ tiêu mủ:
    1. **Mủ nước**: Khối lượng tươi (`mn_tuoi`), DRC (`mn_drc`), Khối lượng quy khô (`mn_kho`).
    2. **Mủ chén**: Khối lượng tươi (`ct_tuoi`), DRC (`ct_drc`), Khối lượng quy khô (`ct_kho`).
    3. **Mủ đông chén**: Khối lượng tươi (`dct_tuoi`), DRC (`dct_drc`), Khối lượng quy khô (`dct_kho`).
    4. **Mủ đông khối**: Khối lượng tươi (`dkt_tuoi`), DRC (`dkt_drc`), Khối lượng quy khô (`dkt_kho`).
    5. **Mủ dây**: Khối lượng tươi (`dt_tuoi`), DRC (`dt_drc`), Khối lượng quy khô (`dt_kho`).
  - Tự động tính quy khô nếu thiếu: `kho = round(tuoi * drc / 100, 2)` khi `kho == 0` nhưng `tuoi > 0` và `drc > 0`.
  - Xuất JSON kết quả cô lập giữa cặp marker `__OUTPUT_JSON_START__` và `__OUTPUT_JSON_END__`.
- **Ma trận Đối soát Thông minh Sản lượng (Smart Matching Matrix)**:
  - Khóa bản ghi duy nhất: `buildProductionRecordKey({ ngay, doi, so_xe: base_xe, chuyen, ma_nguon })`.
  - **Liên kết 2 chiều với Điều xe (`dispatch`)**: Tự động tra cứu `dispatch_entries` và `dispatch_entry_rows` theo Ngày, Số xe, Chuyến để:
    + Tự động ghép tên Tài xế (`tai_xe`).
    + Đối chiếu Điểm giao nhận (`diem_gn`) của chuyến xe với Đội trong báo cáo sản lượng.
  - **Phân loại trạng thái đối soát**:
    - 🟢 **Khớp hoàn toàn**: Khớp ngày, xe, chuyến, đội và khớp chính xác chuyến trong phân hệ Điều xe $\rightarrow$ Tự động chọn sẵn sàng nhập.
    - 🟡 **Cảnh báo nghiệp vụ** (cho phép người dùng kiểm tra và quyết định):
      + `DUPLICATE_IN_SYSTEM`: Đã tồn tại bản ghi sản lượng của xe/chuyến này trong ngày $\rightarrow$ Cảnh báo ghi đè dữ liệu.
      + `NO_DISPATCH_DATE` / `VEHICLE_NOT_FOUND` / `CHUYEN_NOT_FOUND`: Chuyến xe này chưa được khai báo trong Điều xe ngày hôm đó.
      + `DOI_MISMATCH`: Đội ghi trên phiếu sản lượng không khớp với điểm giao nhận đã phân công trên lệnh điều xe.
      + `ZERO_KL`: Dòng dữ liệu không có phát sinh khối lượng mủ nào.
      + `UNKNOWN_NOTE`: Ghi chú nằm ngoài danh mục ghi chú bắt buộc (`required_notes`).
    - 🔴 **Lỗi nghiêm trọng**: Thiếu ngày, số xe không hợp lệ, hoặc chỉ số DRC vượt ngưỡng sinh lý mủ.
- **Cơ chế Ghi Dữ liệu Kép (Dual Write Action)**:
  - Khi người dùng bấm **"Đẩy thẳng lên phân hệ Sản lượng"**:
    1. Sinh mã lô nạp duy nhất (`import_batch_id = batch_${Date.now()}_...`).
    2. Ghi/Cập nhật các bản ghi hợp lệ vào bảng `production_records` trong Supabase, gắn kèm `factory_id`, `created_by`, `nguoi_upload`.
    3. Tự động gọi cơ chế **đồng bộ ngược sang Điều xe (`writeBackToDispatch`)**: Cập nhật khối lượng thực tế và trạng thái của các chuyến tương ứng trong cả `dispatch_entries.rows` và bảng vật lý `dispatch_entry_rows`.
    4. Hiển thị Toast thông báo kết quả (số bản ghi thành công, số chuyến điều xe đã liên kết), dọn cache và tự động quay về view danh sách sản lượng.
  - Nút phụ **"Tải file Excel đối chiếu"**: Cho phép tải file bảng tính Excel chuẩn hóa chứa toàn bộ dữ liệu đã bóc tách và trạng thái đối soát để đối chiếu ngoại tuyến.
- **Bảo toàn chức năng truyền thống**: Nút "Tải file mẫu" và "Nhập Excel" (`output-import.tsx`) vẫn được giữ nguyên vẹn để người dùng có nhiều phương thức thao tác linh hoạt.






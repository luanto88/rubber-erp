---
description: Mục tiêu chất lượng theo năm + Báo cáo thống kê chất lượng (module Kiểm nghiệm)
---

# Mục tiêu chất lượng & Báo cáo thống kê chất lượng

## Phạm vi

Bổ sung cho module Kiểm nghiệm (`qc_results`):

1. Cấu hình **Mục tiêu chất lượng theo năm** trong `Cài đặt`.
2. **Báo cáo 1** — Bảng thống kê chất lượng tháng (tỷ lệ đạt theo chỉ tiêu, so với mục tiêu, cột Tháng + Lũy kế năm).
3. **Báo cáo 2** — Phân tích SPC riêng từng (sản phẩm × chỉ tiêu): bảng dữ liệu mẫu theo ngày, Cp/Cpk, biểu đồ phân bố (histogram + đường cong chuẩn overlay trong 1 chart, xem mục "Cập nhật 2026-07-06"), biểu đồ kiểm soát X/R.

Cả 2 báo cáo in **một lần ra nhiều trang** (không in riêng từng chỉ tiêu), qua trang in HTML `window.print()`.

## Bảng `quality_targets`

Migration: `supabase/migrations/20260705_quality_targets.sql`; bổ sung `target_value` bằng `supabase/migrations/20260706_quality_targets_value.sql`.

```sql
id, factory_id, nam INTEGER,
chi_tieu TEXT,   -- 'tap_chat'|'tro'|'bay_hoi'|'nito'|'po'|'pri'|'mooney'|'mau_sac'|'tccs_tong'
san_pham TEXT,   -- '10'|'20'|'L'|'3L'|'5'|'CV50'|'CV60' (= chung_loai)
nguong_min NUMERIC, nguong_max NUMERIC,
tieu_chuan TEXT,          -- chỉ dùng khi chi_tieu='tccs_tong'
ty_le_muc_tieu NUMERIC,   -- % mục tiêu
noi_dung_muc_tieu TEXT,   -- câu mô tả tự sinh, cho sửa tay
target_value NUMERIC,     -- giá trị "trọng tâm" lý tưởng (2026-07-06) — chỉ vẽ đường tham chiếu, KHÔNG dùng để tính đạt/không đạt
sort_order, is_active, created_at, updated_at
UNIQUE(factory_id, nam, chi_tieu, san_pham)
```

### Quy tắc chốt

- **Ngưỡng mục tiêu độc lập với ngưỡng chấm KN chính thức.** Mỗi dòng mục tiêu tự khai báo `nguong_min`/`nguong_max` riêng (vd tạp chất mục tiêu ≤0,05% dù tiêu chuẩn TCCS/TCVN cho phép tới 0,07-0,08%), hệ thống tính lại trực tiếp từ `qc_results.samples` thô — **không** dùng `grade`/`trang_thai` đã chấm sẵn cho các dòng chỉ tiêu riêng lẻ.
- Riêng `chi_tieu = 'tccs_tong'` (mục tiêu dạng "đạt TCCS/TCVN trên tổng sản phẩm") thì lấy thẳng `qc_results.trang_thai === 'dat'`, lọc thêm theo `tieu_chuan` đã khai báo trong mục tiêu.
- **Fallback năm trước**: nếu năm hiện tại chưa nhập mục tiêu (thường nhập vào tháng 4 hàng năm), báo cáo các tháng đầu năm tạm dùng mục tiêu năm liền trước. Không cần snapshot lịch sử — mỗi lần tính báo cáo chỉ cần query "mục tiêu năm X, nếu rỗng thì X-1" (`buildTargetResolver` trong `lib/quality-stats.ts`). Sau khi nhập mục tiêu năm mới, mọi tháng trong năm đó tự động tính lại theo mục tiêu mới.
- Business rule bắt buộc: mỗi chỉ tiêu tính đạt/không đạt **độc lập** theo đúng công thức riêng của `calcGrade` gốc (X̄+3SD cho tạp chất/tro; Max cho bay hơi/nitơ; Min cho Po/PRI; Min-Max cho Mooney) — một lô rớt hạng do 1 chỉ tiêu vẫn phải tính đạt cho các chỉ tiêu khác nó đạt.
- **`target_value` (2026-07-06) tách biệt hoàn toàn với `nguong_min`/`nguong_max`**: đây là giá trị "trọng tâm" mà nhà máy muốn nhắm tới (vd tâm phân bố lý tưởng), chỉ dùng để vẽ 1 đường tham chiếu thẳng đứng màu xanh dương trên biểu đồ phân bố (Báo cáo 2) — không tham gia bất kỳ phép tính đạt/không đạt hay Cp/Cpk nào. Optional, có thể để trống.

### Quản trị

- `Cài đặt → Cấu hình nhà máy → Mục tiêu chất lượng`.
- Component tách riêng `src/app/dashboard/settings/_components/quality-targets-tab.tsx` (không nhúng trực tiếp vào state machine chung `configModal`/`configEditId` của `settings/page.tsx` — cố ý tách để giảm rủi ro sửa file settings khổng lồ).
- Form có cấu trúc (chọn chỉ tiêu, sản phẩm, ngưỡng, %) + nút "Tự sinh mô tả" gọi `buildMucTieuText()`, cho sửa tay câu mô tả trước khi lưu.
- Field "Giá trị trọng tâm (Target)" (2026-07-06): input optional, **ẩn khi `chi_tieu = 'tccs_tong'`** (không có ý nghĩa với tỷ lệ đạt tổng hợp); hiển thị thêm 1 cột trong bảng danh sách mục tiêu.
- Mutate gate bằng permission `settings.manage_config` (dùng chung với các tab Cấu hình nhà máy khác, không tạo permission riêng).

## Thư viện tính toán: `src/lib/quality-stats.ts`

Cố ý **không** tái dùng `calcGrade`/công thức trong `quality/page.tsx` hay `quality-analytics/page.tsx` (đã bị duplicate 2 lần) — thêm bản thứ 3 tối giản riêng cho 2 báo cáo mới, tránh động vào code đang chạy ổn định.

### Domain chỉ tiêu

`CHI_TIEU_META`: 8 field cố định theo engine chấm điểm gốc (`tap_chat`, `tro`, `bay_hoi`, `nito`, `po`, `pri`, `mooney`, `mau_sac`) + `tccs_tong` (tỷ lệ đạt tổng hợp, luôn thêm cuối mỗi sản phẩm, không cho bỏ chọn). Mỗi chỉ tiêu có `bound`: `max` | `min` | `range` | `rate`, quyết định ngưỡng nào áp dụng và Cp/Cpk tính 1 hay 2 phía.

`chiTieuDisplayLabel(chiTieu, sanPham)`: field `mooney` hiển thị **"Độ nhớt"** khi `sanPham` là `10`/`20` (mủ tạp), hiển thị **"Mooney"** khi là `CV50`/`CV60` (mủ nước) — cùng field DB, khác tên nghiệp vụ theo ngữ cảnh sản phẩm.

### Báo cáo 1 — `buildMonthlyQualityReport`

- Tính theo từng `(chi_tieu, san_pham)` độc lập, cho cả kỳ Tháng và Lũy kế năm (01/01 → hết tháng chọn).
- KL tử số = tổng `lots.tong_kg` các lô đạt chỉ tiêu; KL mẫu số = tổng `lots.tong_kg` các lô có kiểm nghiệm chỉ tiêu đó trong kỳ.
- Nếu không có mục tiêu cấu hình cho `(chi_tieu, san_pham, nam)` → dùng ngưỡng chuẩn TCCS 112:2022/TCVN 3769:2016 theo bộ lọc "Tiêu chuẩn" người dùng chọn khi in, nhãn dòng không có "(MT xx%)".
- Nếu có mục tiêu → nhãn "(MT xx%)", dùng ngưỡng mục tiêu.
- 3 nhóm sản phẩm cố định để chia bảng: `mu_tap` (10, 20) — `mu_nuoc_cv` (CV50, CV60) — `mu_nuoc_khac` (L, 3L, 5).
- Tổng SP theo nhóm/toàn nhà máy và Tỉ lệ đạt toàn nhà máy tính trên **toàn bộ** lô có KN trong kỳ, không phụ thuộc chỉ tiêu/sản phẩm người dùng đang chọn hiển thị.
- **Bắt buộc dùng `fetchAllQcResults()` (phân trang `.range()`)** khi query `qc_results` theo kỳ — không được query không giới hạn (rủi ro cắt 1000 dòng, xem `.claude/rules/04-code-patterns.md`).

### Báo cáo 2 — `buildCriterionSpcReport`

**Gộp theo vị trí mẫu, không flatten thô (đã fix 2026-07-05)**: khi 1 ngày có nhiều lô/phiếu, mỗi "cột Mẫu N" trong bảng là **trung bình vị trí mẫu thứ N qua tất cả lô cùng ngày** — không gộp/flatten toàn bộ giá trị thô của mọi lô thành 1 mảng dài (bug cũ gây tràn cột, có ngày hiện tới 45+ cột khi ngày đó có 10 lô). Số cột tối đa = `so_mau` lớn nhất của MỘT phiếu trong tháng (thường 6, có thể 14 nếu kiểm ngặt), **không** phụ thuộc số lô/ngày.

Cơ sở dữ liệu cho Mean/SD/Min/Max/Cp/Cpk/histogram = **tập hợp các giá trị cột đã trung bình theo ngày** (`allValues`), khớp đúng với số liệu hiển thị trong bảng "MẪU" phía trên nó — không dùng giá trị thô chưa gộp.

**Công thức đã verify khớp 100% với file mẫu thật** (`tc_10.pdf`, tạp chất CSR10: Mean=0,034, STD=0,003, USL=0,08 → UCL=Mean+3×STD=0,043 ✓, Cp=(USL-LSL)/(6×STD)=3,333 ✓, Cpk=min(Cpu,Cpl)=1,556 ✓):

- `calcProcessCapability(values, usl, lsl)`: Mean/SD population (÷N, đồng nhất `calcGrade`/`quality-analytics`), UCL/LCL = Mean±3×SD.
- **Cp/Cpk 1 phía cho chỉ tiêu chỉ có 1 giới hạn thật** (tạp chất/tro/bay hơi/nitơ chỉ có USL; Po/PRI chỉ có LSL) — **không bịa thêm biên giả định cho phía còn lại** (quyết định đã chốt qua trao đổi với người dùng, khác hành vi file mẫu Excel cũ vốn tự chọn 1 mốc LSL/USL tùy tiện để vẽ Cp 2 phía). Chỉ Mooney có 2 phía thật (vd 73-93) nên Cp 2 phía tính bình thường.
- `buildHistogramBins`: bin thật từ `allValues` (không dùng đường cong Gauss giả lập như `quality-analytics/page.tsx` cũ).
- USL/LSL của Báo cáo 2 luôn lấy từ **tiêu chuẩn chuẩn TCCS/TCVN** (không lấy ngưỡng mục tiêu) — SPC dùng giới hạn kỹ thuật thật, Mục tiêu chỉ dùng cho Báo cáo 1.
- `buildCpkNhanXet()`: 5 mức đánh giá theo thang phổ biến SPC/Six Sigma (tham chiếu AIAG SPC Manual: `<1.0` không đạt / `1.0-1.33` tối thiểu / `1.33-1.67` đạt yêu cầu (mốc AIAG khuyến nghị) / `1.67-2.0` rất tốt / `≥2.0` mức Six Sigma), mỗi câu gắn tên chỉ tiêu + CSR sản phẩm cụ thể để không lặp nguyên văn khi in nhiều chỉ tiêu cùng đợt.
- `targetValue` (2026-07-06): resolve qua `buildTargetResolver(targetRows, nam)(chiTieu, sanPham)?.target_value` — dùng đúng rule fallback năm trước như mục tiêu chính. `CriterionSpcReportData.targetValue` là `number | null`, expose ra để trang in vẽ đường tham chiếu, không ảnh hưởng `calcProcessCapability`/`buildCpkNhanXet`.

## UI cấu hình & in — module Kiểm nghiệm

- `src/app/dashboard/quality/reports/page.tsx` — cấu hình bộ lọc: Tháng/Năm (single), Loại CSR (multi, `FilterMultiSelect`), Tiêu chuẩn (single), Chỉ tiêu (multi, mặc định = hợp của chỉ tiêu đã có mục tiêu ∪ chỉ tiêu áp dụng theo `getVisibleChiTieu`), toggle "Bao gồm Bảng thống kê tháng", chọn cặp Loại CSR × Chỉ tiêu cho Báo cáo 2.
- **Giám đốc nhà máy**: dropdown lấy từ `maintenance_staff` lọc `chuc_vu` chứa "giám đốc" (tự bao gồm "phó giám đốc" vì là substring, giống pattern `bgdStaff` ở module Bảo trì) — không phải free text.
- **Người lập báo cáo / Nhân viên kỹ thuật**: luôn là **người dùng đang đăng nhập** (`full_name`/`username` từ session), không có ô nhập tay — dùng chung 1 giá trị cho cả vai trò "Lập bảng" (Báo cáo 1) và "Nhân viên kỹ thuật" (Báo cáo 2).
- Nút "Xem trước & In báo cáo" → `<Link target="_blank">` sang `reports/print` với toàn bộ tham số qua query string.

### Trang in `src/app/dashboard/quality/reports/print/page.tsx`

- Bypass sidebar tự động (layout check `pathname.includes("/print")`).
- **Mỗi chỉ tiêu in ra đúng 2 trang, cùng tiêu đề** ("CHỈ TIÊU {label} CSR{sp} NÔNG TRƯỜNG"), khớp cấu trúc 2 trang của file mẫu gốc:
  1. `CriterionDataTablePage` — bảng dữ liệu theo ngày + bảng thống kê (không biểu đồ, không ký tên).
  2. `CriterionChartsPage` — "1. BIỂU ĐỒ PHÂN BỐ" (1 `ComposedChart` duy nhất, xem mục "Cập nhật 2026-07-06" bên dưới) + "2. BIỂU ĐỒ KIỂM SOÁT" (X-chart + R-chart) + Nhận xét + chữ ký "Nhân viên kỹ thuật".
- Thứ tự trang: Báo cáo 1 (nếu bật) → lặp lại (trang dữ liệu, trang biểu đồ) cho từng combo Loại CSR × Chỉ tiêu đã chọn — tất cả trong **1 lần `window.print()`**.
- **Ngắt trang dùng inline `style={{ pageBreakBefore: "always" }}`** trên từng trang (trừ trang đầu tiên) — **không dùng CSS sibling selector** (`.report-page + .report-page`) vì đã test thực tế không đáng tin cậy khi in thật (trang không tách, nội dung chảy liên tục). Hàm `pageBreakStyle(pageBreak: boolean)` áp dụng thống nhất.
- **Chữ ký**: Báo cáo 1 (`SignatureRow`, 2 cột) — Giám đốc nhà máy bên trái, Lập bảng bên phải. Báo cáo 2 (`SignatureRight`) — chỉ 1 chữ ký "Nhân viên kỹ thuật", canh **góc phải trang** (không dùng `SignatureRow` căn giữa cho trường hợp 1 người ký).
- Biểu đồ dùng Recharts (SVG, in nét sắc) — **không** dùng jsPDF/rasterize, khác với `storage-pdf.ts`/`dispatch-pdf.ts` (những file đó không có tiền lệ nhúng biểu đồ).

### Cập nhật 2026-07-06 — Khổ dọc, biểu đồ nổi bật hơn, chống ngắt trang chữ ký

**Khổ trang đổi sang portrait**: `@page` đổi từ `A4 landscape` sang `A4 portrait; margin: 10mm 8mm`. Container preview thu hẹp còn `maxWidth: 780px` (khớp bề ngang A4 dọc) thay vì `1100px` cũ (dựng cho landscape). Để không tràn trang khi bề ngang hẹp lại:

- 3 bảng rộng (bảng nhóm sản phẩm ở Báo cáo 1, bảng mẫu theo ngày + bảng thống kê ở Báo cáo 2) đều thêm `tableLayout: "fixed"` vào style của `<table>` và bọc trong `<div className="overflow-x-auto">` — `table-layout: fixed` đảm bảo bảng không bao giờ vượt quá `width: 100%` của container dù có tới ~18 cột (bảng mẫu theo ngày khi `maxSamplesInDay` lên tới 14), `overflow-x-auto` chỉ là lớp phòng vệ cho preview trên màn hình hẹp.
- Font bảng mẫu theo ngày + bảng thống kê SPC giảm xuống `text-[8px]`; bảng nhóm sản phẩm (Báo cáo 1) giảm xuống `text-[10px]`.
- **Không** đổi bố cục `grid grid-cols-2` của biểu đồ X/R (biểu đồ tự co giãn theo `ResponsiveContainer`, không tràn trang ở khổ dọc).

**Biểu đồ phân bố nổi bật hơn + thêm số liệu**:

- Cột histogram đổi màu từ xám nhạt gần như vô hình (`#f1f5f9`) sang xanh dương đậm có viền (`fill="#38bdf8" stroke="#0284c7"`); đường cong chuẩn overlay đổi sang cam (`#f97316`) để tương phản với cột (trước đó cùng tông xanh lá gây khó phân biệt).
- Thêm nhãn số đếm ngay trên đỉnh mỗi cột bằng `<LabelList dataKey="count" position="top" formatter={...} />` (con của `<Bar>`), ẩn nhãn khi count = 0.
- Thêm 2 đường tham chiếu **UCL/LCL** (`data.overall.ucl`/`lcl` = Mean±3×SD) màu hổ phách — trước đây biểu đồ phân bố chỉ có USL/LSL/Target, thiếu hẳn UCL/LCL.
- **Tất cả** đường tham chiếu (USL, LSL, Target, UCL, LCL) trên cả 3 biểu đồ (phân bố, X, R) giờ hiển thị kèm giá trị số trong nhãn (vd `label={{ value: \`UCL ${fmt3(data.overall.ucl)}\` }}`) thay vì chỉ hiện tên đường — áp dụng luôn cho `CL`/`R̄` vốn trước đây chỉ có chữ.
- Biểu đồ X (BIỂU ĐỒ X) trước đây **thiếu hẳn** đường UCL/LCL (chỉ có CL/USL/LSL) — đã bổ sung 2 đường này dùng đúng `data.overall.ucl`/`lcl` (control limits theo giá trị đơn lẻ, khác với USL/LSL là giới hạn kỹ thuật theo tiêu chuẩn).
- Mọi `<ReferenceLine>` đều thêm `ifOverflow="extendDomain"` để trục tự giãn chứa đủ các đường tham chiếu thay vì bị `discard` (ẩn) khi giá trị nằm ngoài domain mặc định tính từ dữ liệu — nhờ vậy không cần tự tính domain thủ công bao gồm USL/LSL/UCL/LCL/Target.

**Tiêu đề công ty/nhà máy chuyển sang góc trái**: `CompanyHeader` đổi `text-center` → `text-left`; các tiêu đề báo cáo/chỉ tiêu bên dưới (`CriterionHeader`, tiêu đề "BẢNG THỐNG KÊ...") vẫn giữ căn giữa, không đổi.

**Chống ngắt trang giữa chức danh và tên người ký**: thêm hằng `avoidBreakStyle = { breakInside: "avoid", pageBreakInside: "avoid" }`, áp cho cả `SignatureRow` (Báo cáo 1) và `SignatureRight` (Báo cáo 2) — nếu trình duyệt định ngắt trang ngay trong khối chữ ký, cả khối (chức danh + khoảng ký + tên) bị đẩy nguyên vẹn sang trang sau thay vì tách đôi.

**Mobile-friendly preview**: padding container đổi `p-8` cố định → `p-3 sm:p-8 print:p-2` (giảm padding lãng phí khi in vì `@page margin` đã chừa lề); nút "In" nổi góc trên co nhỏ trên mobile (`px-3 py-1.5 text-sm sm:px-4 sm:py-2 sm:text-base`); bỏ `maxWidth: "1100px"` cứng từng gây tràn ngang khi xem trước trên điện thoại.

## Permissions

- Đọc/tạo Mục tiêu: `settings.manage_config` (đã có sẵn).
- Xem/in báo cáo: `quality.view` + `quality.print` (2 permission đã tồn tại sẵn trong seed gốc `20260429_auth_profiles_permissions.sql`, không cần seed thêm).

## Ngoài phạm vi (chưa làm, cần hỏi lại nếu phát sinh)

- Không tách riêng "nguyên liệu nông trường vs thu mua" trong báo cáo — mẫu T04 không thể hiện tách riêng, và `qc_results`/`lots` không có field nguồn gốc trực tiếp.
- Không refactor `calcGrade` (`quality/page.tsx`) hay công thức trong `quality-analytics/page.tsx` để dùng chung 1 nguồn — vẫn giữ 3 bản song song có chủ đích.

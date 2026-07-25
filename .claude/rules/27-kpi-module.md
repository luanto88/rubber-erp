# Module Quản lý công việc & Đánh giá KPI nhân viên (`/dashboard/kpi`)

## Phạm vi

Module giao việc (cá nhân/nhiều người, theo dõi tiến độ %, chuyển giao khi về tua),
đánh giá 5S theo khu vực bằng QR (người dọn/người chấm tách biệt), khung tiêu chí
KPI theo từng nhóm/vị trí chấm hàng ngày, và bảng tổng hợp điểm KPI hàng tháng. Mục
tiêu xuyên suốt: công bằng, minh bạch, hiện đại — có bằng chứng, có log bất biến,
có cơ chế khiếu nại.

Route: `/dashboard/kpi`. Permissions: `kpi.view`, `kpi.assign`, `kpi.evaluate`,
`kpi.view_all`, `kpi.manage_config`.

File này là **bản thay thế hoàn toàn** mọi mô tả KPI trước đó — quy mô rất lớn,
triển khai theo nhiều phase độc lập tương đối, cập nhật file này sau mỗi phase.

## Quyết định thiết kế then chốt

### "Nhóm nhân sự" TÁI DÙNG `personnel_groups`, không có bảng riêng

Không có bảng `kpi_groups`/`kpi_group_members` — mọi "nhóm" trong module này chính
là `personnel_groups`/`personnel_group_members` đã có sẵn tại **Cài đặt → Hệ thống
→ Nhân sự** (comment gốc trong UI: "dùng chung cho Nhân sự, Bảo trì và các module
sau này"). Chỉ ALTER thêm 1 cột:

```sql
personnel_group_members.is_primary BOOLEAN NOT NULL DEFAULT false
-- UNIQUE INDEX ... ON personnel_group_members(staff_id) WHERE is_primary
```

Form Nhân sự (`settings/page.tsx`) có dropdown **"Nhóm chính"** ngay dưới checklist
tick nhóm, chỉ liệt kê các nhóm đã tick.

### `is_primary` KHÔNG loại trừ các nhóm khác khỏi tính điểm

Thiết kế đầu tiên (chỉ 1 nhóm chính mới tính KPI) đã SAI với thực tế: nhà máy có
nhân sự đi tua (về nhà 3 lần/tháng, mỗi lần 6 ngày), người ở lại phải đảm nhận đầy
đủ nhiều nhóm cùng lúc, không thể coi 1 bên là "phụ". Đã sửa: **mọi nhóm đã tick
đều tính điểm chuyên môn đầy đủ** — chỉ khác hệ số:

- Nhóm `is_primary = true` ("nhóm chính") → hệ số **×10**.
- Các nhóm khác đã tick ("nhóm choàng") → hệ số **×5 MỖI nhóm** (không giới hạn số
  lượng nhóm choàng được chấm cùng ngày).

### Không có module lịch nghỉ/tua

Đã chốt với người dùng: lịch tua tự đăng ký, không cố định theo chu kỳ — **không**
xây dựng hệ thống lịch nghỉ/tua, **không** có tính năng nhắc nhở tự động trước khi
về tua. Nhân viên tự chịu hoàn toàn trách nhiệm chủ động bấm "Chuyển giao" trước
khi đi. Không được tự ý thêm lại tính năng nhắc nhở này ở phase sau nếu không có
yêu cầu mới.

### Nhưng công việc có deadline THÌ PHẢI có lịch + nhắc nhở tự động (mới, 2026-07-24)

**Khác hẳn** mục "lịch nghỉ/tua" ở trên (đã loại bỏ) — đây là yêu cầu MỚI, áp dụng
cho chính `kpi_tasks` (giao việc có deadline, mục B), không liên quan gì đến lịch
tua cá nhân:

- **Lịch công việc**: tab "Công việc" phải có 1 view dạng lịch (theo tháng/tuần),
  mỗi ngày hiện các task có `han_hoan_thanh` rơi vào ngày đó, màu theo `trang_thai`
  (mới giao/đang thực hiện/chờ nghiệm thu/hoàn thành/trễ hạn/hủy). Click 1 ngày →
  danh sách task đến hạn ngày đó; click 1 task → mở chi tiết. Đây là 1 cách xem bổ
  sung cho danh sách "Việc của tôi"/"Tất cả công việc" đã có, không thay thế.
- **Nhắc nhở tự động khi deadline sắp đến**: bắt buộc có, cho cả người được giao
  lẫn người giao việc. Kênh và ngưỡng thời gian nhắc **chưa chốt** — xem "Việc cần
  làm ở phiên sau".

### Khu vực 5S KHÁC nhóm chuyên môn

`kpi_5s_zones` là bảng độc lập với `personnel_groups` — 1 người có thể thuộc nhóm
chuyên môn "KT Lương" nhưng phụ trách khu vực 5S "VP Kế Toán". Không liên kết 2
khái niệm này.

## Công thức tính điểm

```
KPI tháng = (A%×Hoàn thành + B%×Đúng hạn + C%×5S + D%×Chuyên môn) × Hệ số chuyên cần
```

A/B/C/D% cấu hình ở Settings (`kpi_score_weights`), mặc định **30/25/20/25**, tổng
phải = 100 (validate tầng app). Hệ số chuyên cần nhân lên TOÀN BỘ điểm tổng.

### Ví dụ đối chiếu khi build engine (Phase 4)

```
KPI THÁNG 7 — CHỊ RYTA:
A. Hoàn thành (30%):  76.0/100
B. Đúng hạn (25%):    75.0/100
C. 5S (20%):          66.7/100
D. Chuyên môn (25%):  68.7/100

KPI trước hệ số = 30%×76 + 25%×75 + 20%×66.7 + 25%×68.7 = 72.07
Hệ số chuyên cần: 24/24 ngày → ×1.000
KPI THÁNG = 72.07 × 1.000 = 72.1
```

### A — Điểm hoàn thành

```
A = Trung bình % nghiệm thu cuối cùng của TẤT CẢ giao việc trong tháng
  - Chỉ tính việc mà "người phụ trách hiện tại" = đúng nhân viên đó (việc đã
    chuyển giao thành công KHÔNG tính cho người chuyển đi, tính cho người nhận)
  - Việc chưa nghiệm thu: lấy % tiến độ tự báo cáo hiện tại
  - Không có giao việc nào trong tháng: không tính A (hoặc mặc định 100 — admin
    cấu hình hành vi này ở Settings)
```

### B — Điểm đúng hạn

```
B = (Số việc nộp đúng/trước hạn ÷ Số việc ĐÃ ĐẾN HẠN trong tháng) × 100
  - Chỉ tính việc đã đến deadline (chưa đến hạn thì bỏ hẳn khỏi tử số lẫn mẫu số)
  - Việc đã chuyển: tính cho người phụ trách hiện tại
  - "Nộp" = mốc lần đầu nhân viên bấm "Nộp" (không phải lúc quản lý chốt nghiệm thu)
```

### C — Điểm 5S

```
C (tháng) = Trung bình các lần chấm khu vực mà NGƯỜI ĐÓ chịu trách nhiệm
            (nguoi_don_id SNAPSHOT của đúng tuần đó), chia cho SỐ LẦN người đó
            thực sự chịu trách nhiệm trong tháng — KHÔNG chia cho tổng số tuần.

Ví dụ: RyTa phụ trách VP Kế Toán — Tuần 1 Lan dọn thay (không tính), Tuần 2 Đạt
(100), Tuần 3 Không đạt (0), Tuần 4 Đạt (100) → C = (100+0+100)÷3 = 66.7 (chia 3)
```

### D — Điểm chuyên môn (chấm theo NGÀY, không theo tháng)

```
%đạt(1 nhóm, 1 ngày) = Σ(Đạt×1.0 + Tương_đối×0.5 + Chưa_đạt×0) ÷ số tiêu chí đã chấm

Điểm ngày = %chính×10 + Σ(%choàng_i×5)   -- +5 cho MỖI nhóm choàng có chấm ngày đó

Max ngày = 10 + 5×(số nhóm choàng CÓ BẢN CHẤM ngày đó)   -- KHÔNG phải hằng số cố định

Điểm % ngày = (Điểm ngày ÷ Max ngày) × 100

D (tháng) = Trung bình (Điểm % ngày) qua các ngày có chấm việc chính trong tháng
```

**Tại sao không chia cố định 1 hằng số (vd 15)**: người không bao giờ choàng sẽ có
trần điểm chỉ 10/15 ≈ 66.7% dù làm tốt 100% — bất công. Chia theo max của ĐÚNG ngày
đó đảm bảo ai cũng đạt được 100% nếu làm tốt phần việc được giao hôm đó.

"Ngày có mặt/có chấm" = ngày có ít nhất 1 bản chấm **việc chính**. Không cần hệ
thống chấm công riêng.

### Hệ số chuyên cần

```
Hệ số chuyên cần = CLAMP(Số ngày có chấm D trong tháng ÷ Ngày chuẩn, 0.75, 1.10)
```

`Ngày chuẩn` mặc định 24 (cấu hình Settings). Sàn 0.75, trần 1.10. Bảng tham chiếu:
≤18 ngày → 0.75 · 20 → 0.833 · 22 → 0.917 · 24 → 1.000 · 26 → 1.083 · ≥27 → 1.10.

## Database Schema

Tất cả bảng có `factory_id`.

### Nhóm & Chuyên môn (D) — chưa build

```sql
kpi_criteria_templates (
  id, factory_id, group_id → personnel_groups, ten_tieu_chi TEXT NOT NULL,
  mo_ta TEXT, sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at, updated_at
)

kpi_daily_evaluations (   -- 1 dòng = 1 lượt chấm 1 nhóm, 1 người, 1 ngày
  id, factory_id, user_id, ngay DATE NOT NULL,
  group_id UUID NOT NULL → personnel_groups,
  loai TEXT NOT NULL CHECK (loai IN ('chinh','choang')),  -- snapshot is_primary TẠI THỜI ĐIỂM CHẤM
  nguoi_cham_id UUID NOT NULL, ghi_chu TEXT, created_at, updated_at,
  UNIQUE(factory_id, user_id, ngay, group_id)   -- không giới hạn số nhóm choàng/ngày
)
-- Index: (factory_id, user_id, ngay)

kpi_daily_evaluation_items (
  id, evaluation_id → kpi_daily_evaluations ON DELETE CASCADE,
  criteria_id → kpi_criteria_templates,
  ket_qua TEXT NOT NULL CHECK (ket_qua IN ('dat','tuong_doi','chua_dat')),
  created_at, UNIQUE(evaluation_id, criteria_id)
)
```

### Giao việc (A + B) — chưa build

```sql
kpi_tasks (
  id, factory_id, ma_cong_viec TEXT,   -- CV-ddmmyy/XXX, đếm tuần tự theo ngày
  tieu_de TEXT NOT NULL, mo_ta TEXT, nguoi_giao_id UUID NOT NULL,
  ngay_giao DATE NOT NULL, han_hoan_thanh TIMESTAMPTZ NOT NULL,
  yeu_cau_bao_cao TEXT[] DEFAULT '{}',  -- 'anh'|'file'|'dinh_vi'|'van_ban'
  da_chuyen_giao BOOLEAN DEFAULT false, -- chặn chuyển tiếp lần 2
  trang_thai TEXT DEFAULT 'moi_giao'
    CHECK (trang_thai IN ('moi_giao','dang_thuc_hien','cho_nghiem_thu','hoan_thanh','tra_ve','huy')),
  created_at, updated_at
)
-- KHÔNG có assignee_user_id/assignee_group_id/loai_giao — người nhận việc nằm hết ở
-- kpi_task_members. "Giao theo nhóm" chỉ là tiện ích UI mở rộng thành viên nhóm tại
-- thời điểm tạo (snapshot, không giữ liên kết sống).
-- Index: (factory_id, han_hoan_thanh), (nguoi_giao_id)

kpi_task_members (
  id, task_id → kpi_tasks ON DELETE CASCADE, user_id NOT NULL,
  tien_do INTEGER DEFAULT 0, tien_do_nghiem_thu INTEGER NULL, da_nop_luc TIMESTAMPTZ NULL,
  is_active BOOLEAN DEFAULT true,   -- false nếu đã chuyển giao thành công
  created_at, updated_at, UNIQUE(task_id, user_id)
)
-- Index: (user_id)

kpi_task_logs (   -- audit trail BẤT BIẾN — insert-only, không sửa/xóa
  id, task_id → kpi_tasks ON DELETE CASCADE, member_user_id NOT NULL, nguoi_thuc_hien_id NOT NULL,
  hanh_dong TEXT NOT NULL
    CHECK (hanh_dong IN ('cap_nhat_tien_do','nop','nghiem_thu','dieu_chinh','tra_ve','yeu_cau_bo_sung')),
  tien_do_truoc INTEGER, tien_do_sau INTEGER,
  noi_dung TEXT,   -- bắt buộc khi hanh_dong='cap_nhat_tien_do'
  image_urls TEXT[] DEFAULT '{}', file_urls TEXT[] DEFAULT '{}',
  vi_do NUMERIC NULL, kinh_do NUMERIC NULL, dia_diem_text TEXT NULL, created_at
)
-- Index: (task_id, created_at DESC)

kpi_task_transfers (
  id, factory_id, task_id → kpi_tasks, tu_nguoi_id NOT NULL, den_nguoi_id NOT NULL,
  tien_do_luc_chuyen INTEGER, ghi_chu TEXT,
  trang_thai TEXT DEFAULT 'cho_duyet' CHECK (trang_thai IN ('cho_duyet','da_nhan','tu_choi')),
  ngay_chuyen TIMESTAMPTZ DEFAULT now(), phan_hoi_luc TIMESTAMPTZ NULL, created_at
)
-- Chặn tạo mới nếu: han_hoan_thanh đã qua, HOẶC kpi_tasks.da_chuyen_giao=true, HOẶC
-- đã có 1 dòng 'cho_duyet' chưa xử lý cho đúng (task_id, tu_nguoi_id). Khi 'da_nhan':
-- set kpi_task_members(tu_nguoi_id).is_active=false, upsert cho den_nguoi_id (copy
-- tien_do), set kpi_tasks.da_chuyen_giao=true. KHÔNG có nhắc nhở tự động đi kèm.
```

### 5S (C) — chưa build

```sql
kpi_5s_zones (
  id, factory_id, ma_khu_vuc TEXT, ten_khu_vuc TEXT NOT NULL, vi_tri_mo_ta TEXT,
  nguoi_don_id UUID,   -- người chịu trách nhiệm HIỆN TẠI (standing, sửa bất cứ lúc nào)
  nguoi_cham_id UUID,  -- người chấm HIỆN TẠI (standing)
  is_active BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at, updated_at,
  UNIQUE(factory_id, ma_khu_vuc),
  CHECK (nguoi_don_id IS NULL OR nguoi_cham_id IS NULL OR nguoi_don_id <> nguoi_cham_id)
)
-- Khi về tua: quản lý sửa trực tiếp nguoi_don_id trong Settings — KHÔNG có cơ chế
-- "phân công lại mỗi tuần" riêng.

kpi_5s_evaluations (
  id, factory_id, zone_id → kpi_5s_zones, tuan_bat_dau DATE NOT NULL,
  nguoi_don_id UUID NOT NULL,   -- SNAPSHOT người chịu trách nhiệm ĐÚNG TUẦN ĐÓ (mặc định lấy
                                 -- từ zones.nguoi_don_id lúc chấm, sửa được nếu có người dọn thay)
  nguoi_cham_id UUID NOT NULL,
  ket_qua TEXT NOT NULL CHECK (ket_qua IN ('dat','khong_dat')),
  ly_do TEXT,   -- bắt buộc khi ket_qua='khong_dat'
  image_urls TEXT[] DEFAULT '{}',   -- khuyến khích, KHÔNG bắt buộc
  danh_gia_luc TIMESTAMPTZ DEFAULT now(), created_at, UNIQUE(zone_id, tuan_bat_dau)
)
```

### Trọng số & bảng điểm tháng — chưa build

```sql
kpi_score_weights (
  id, factory_id, group_id → personnel_groups NULL,  -- NULL = mặc định toàn nhà máy
  trong_so_hoan_thanh NUMERIC DEFAULT 30, trong_so_dung_han NUMERIC DEFAULT 25,
  trong_so_5s NUMERIC DEFAULT 20, trong_so_chuyen_mon NUMERIC DEFAULT 25,
  ngay_chuan_chuyen_can NUMERIC DEFAULT 24,
  he_so_chuyen_can_min NUMERIC DEFAULT 0.75, he_so_chuyen_can_max NUMERIC DEFAULT 1.10,
  created_at, updated_at, UNIQUE(factory_id, group_id)
)
-- UNIQUE INDEX ON kpi_score_weights(factory_id) WHERE group_id IS NULL

kpi_monthly_scores (   -- snapshot bất biến sau khóa sổ
  id, factory_id, user_id, nam INTEGER, thang INTEGER,
  diem_hoan_thanh NUMERIC, diem_dung_han NUMERIC, diem_5s NUMERIC, diem_chuyen_mon NUMERIC,
  he_so_chuyen_can NUMERIC, so_ngay_co_cham INTEGER,
  diem_tong NUMERIC, chi_tiet JSONB,
  trang_thai TEXT DEFAULT 'nhap' CHECK (trang_thai IN ('nhap','da_khoa')),
  khoa_boi UUID, khoa_luc TIMESTAMPTZ, created_at, updated_at,
  UNIQUE(factory_id, user_id, nam, thang)
)

kpi_score_adjustments ( id, monthly_score_id → kpi_monthly_scores, ly_do TEXT NOT NULL,
  diem_truoc NUMERIC, diem_sau NUMERIC, nguoi_dieu_chinh_id, created_at )

kpi_appeals ( id, monthly_score_id NULL, task_id NULL, zone_evaluation_id NULL,
  nguoi_khieu_nai_id, noi_dung TEXT NOT NULL,
  trang_thai TEXT DEFAULT 'cho_xu_ly' CHECK (trang_thai IN ('cho_xu_ly','da_giai_quyet','tu_choi')),
  phan_hoi TEXT, nguoi_xu_ly_id, created_at, updated_at )
```

## RLS (áp dụng khi build từng bảng)

- Đọc rộng trong `factory_id`: `kpi_criteria_templates`, `kpi_score_weights`,
  `kpi_5s_zones`, `kpi_5s_evaluations`, `kpi_daily_evaluations`,
  `kpi_daily_evaluation_items`. Ghi giới hạn `kpi.evaluate` (2 bảng chấm) hoặc
  `kpi.manage_config`/admin (còn lại).
- `kpi_monthly_scores`: `user_id = auth.uid() OR admin OR
  current_profile_has_permission('kpi.view_all')` (tái dùng hàm có sẵn từ
  `20260721_production_records_permission_rls.sql`).
- **`kpi_tasks` ↔ `kpi_task_members` cần `SECURITY DEFINER`** — 2 bảng tham chiếu
  chéo RLS gây "infinite recursion", mirror `operation_notes`/`operation_note_shares`
  (`.claude/rules/26-operation-notes-module.md`). Hàm
  `is_kpi_task_owner(p_task_id, p_user_id)` cho chiều `kpi_task_members` tra ngược
  `kpi_tasks`; chiều ngược lại giữ `EXISTS` trực tiếp.
- `kpi_task_logs`/`kpi_task_transfers`: đọc giới hạn theo người liên quan (thành
  viên, người giao, `tu_nguoi_id`/`den_nguoi_id`) hoặc `kpi.evaluate`/
  `kpi.view_all`/admin.

## UI (chưa build, trừ Phase 0)

### Cài đặt

- Hệ thống → Nhân sự (đã có sẵn): dropdown **"Nhóm chính"** trong form Nhân sự,
  chỉ liệt kê nhóm đã tick.
- Tab mới **KPI & 5S** (icon `Target`) → 3 sub-tab: Khung tiêu chí KPI (theo
  `personnel_groups`), Trọng số công thức (A/B/C/D% + ngày chuẩn/hệ số chuyên cần
  min-max), Khu vực 5S (CRUD `kpi_5s_zones` + nút "In QR hàng loạt").

### Module `/dashboard/kpi`

1. **Tổng quan** ✅ (Phase 0) — hiện card "Nhóm chính" của bản thân + roadmap "Sắp
   có". Sẽ bổ sung: việc đang làm/quá hạn/chờ nghiệm thu, 5S cần chấm tuần này,
   điểm KPI tháng (tạm tính) + hệ số chuyên cần.
2. **Công việc** — "Việc của tôi"/"Tất cả công việc"; chi tiết task có timeline log
   bất biến; nút Cập nhật tiến độ/Nộp/Chuyển giao/Nghiệm thu/Điều chỉnh/Trả về/Yêu
   cầu bổ sung theo vai trò.
3. **Đánh giá 5S** — mỗi khu vực có URL cố định `/dashboard/kpi/5s/zone/{zone_id}`
   (bắt buộc đăng nhập, redirect login nếu chưa). QR encode thẳng URL này. Trang
   khu vực: lịch sử Đạt/Không đạt công khai trong factory; chỉ hiện nút "Chấm điểm
   tuần này" nếu user = `nguoi_cham_id` VÀ tuần hiện tại chưa có bản chấm. Form
   chấm: `nguoi_don_id` mặc định = giá trị hiện tại của khu vực (sửa được nếu có
   người dọn thay), Đạt/Không đạt, lý do bắt buộc khi Không đạt, ảnh khuyến khích.
4. **Chấm điểm chuyên môn** — nhập theo ngày, gộp nhiều ngày/lần, hỗ trợ nhiều nhóm
   choàng cùng ngày.
5. **Bảng điểm KPI** — cá nhân + toàn nhà máy (`kpi.view_all`), breakdown A/B/C/D +
   hệ số chuyên cần, nút "Tính điểm tháng"/"Khóa sổ" (admin/`kpi.manage_config`).

## Roadmap

- **Phase 0 — Nền tảng** ✅ Đã xong (2026-07-24): permissions `kpi.*` + seed;
  `personnel_group_members.is_primary` + dropdown "Nhóm chính" trong form Nhân sự;
  route `/dashboard/kpi` (shell + tab Tổng quan); sidebar entry (`Target`, gate
  `kpi.view`).
- **Phase 1a — Giao việc cơ bản (A+B, chưa chuyển giao)** ✅ Đã code xong
  (2026-07-24, xem mục "Cập nhật Phase 1a" bên dưới) — `tsc`/`eslint`/`npm run
  build` đều sạch, **chưa test tay**.
- **Phase 1a.1 — "Gắn bản ghi tại chỗ" (in-context evidence linking)** ✅ Đã code
  xong (2026-07-25, xem mục "Cập nhật Phase 1a.1" bên dưới) — THAY THẾ hoàn toàn ý
  tưởng "tự động dò hành động nghiệp vụ để đóng việc ngầm" đã bị loại bỏ khỏi thiết
  kế. `tsc`/`eslint`/`npm run build` đều sạch, **chưa test tay**.
- **Phase 1b — Chuyển giao việc**: `kpi_task_transfers`; UI chuyển giao/nhận/từ
  chối, chặn chuyển quá hạn/lần 2. (Không có nhắc nhở tự động trước khi VỀ TUA —
  khác với nhắc nhở deadline ở Phase 1a, xem phân biệt ở mục trên.)
- **Phase 2 — Đánh giá 5S**: `kpi_5s_zones`+`kpi_5s_evaluations`; Settings Khu vực
  5S + in QR hàng loạt; trang `/dashboard/kpi/5s/zone/{zone_id}`; tab "Đánh giá 5S".
- **Phase 3 — Khung tiêu chí KPI + Chấm điểm chuyên môn theo ngày**:
  `kpi_criteria_templates`+`kpi_daily_evaluations`+`kpi_daily_evaluation_items`;
  Settings Khung tiêu chí; tab "Chấm điểm chuyên môn".
- **Phase 4 — Trọng số + Hệ số chuyên cần + Engine tính điểm (bản nháp)**:
  `kpi_score_weights`+`kpi_monthly_scores`; engine 1 RPC/transaction `GROUP BY`
  (không loop-per-user), `UPSERT ... WHERE trang_thai <> 'da_khoa'`; tab "Bảng
  điểm KPI"; điểm luôn `nhap` (chưa khóa) — chạy nháp 1-2 tháng quan sát thực tế.
- **Phase 5 — Khóa sổ, khiếu nại & minh bạch**: `kpi_score_adjustments`+
  `kpi_appeals`; khóa sổ, điều chỉnh (audit), khiếu nại; điểm tạm tính real-time,
  bảng xếp hạng ẩn danh theo nhóm/phòng ban.

## Rủi ro/quy tắc bắt buộc

- **"Nhóm chính" KHÔNG loại trừ nhóm khác khỏi tính điểm** — chỉ khác hệ số (chính
  ×10, choàng ×5 mỗi nhóm). Đây là lỗi thiết kế v1 đã bị phát hiện và sửa — không
  lặp lại khi build Phase 3.
- **Điểm chuyên môn chuẩn hóa theo max của ĐÚNG ngày đó** (10 + 5×số choàng ngày
  đó), tuyệt đối không chia cố định 1 hằng số.
- Engine tính điểm tháng (Phase 4) PHẢI là 1 RPC/transaction dùng `GROUP BY`,
  không loop-per-user.
- `kpi_score_weights` cần partial unique index cho dòng mặc định
  (`group_id IS NULL`).
- Không có module lịch nghỉ/tua, không nhắc nhở tự động — đã chốt, không tự ý
  thêm lại.
- Mọi query bảng lớn (log, chấm ngày, 5S) phải phân trang `.range()` nếu có khả
  năng vượt 1000 dòng (`.claude/rules/04-code-patterns.md`).
- **Không được quay lại ý tưởng "code tự dò hành động nghiệp vụ để tự đóng việc
  ngầm"** (auto-detect/auto-complete không cần xác nhận người dùng) — đã bị loại
  bỏ hoàn toàn khỏi thiết kế (2026-07-25), thay bằng "Gắn bản ghi tại chỗ" (mục
  "Cập nhật Phase 1a.1"): người dùng LUÔN phải tự xác nhận bằng 1 cú click, bằng
  chứng luôn là con trỏ tới bản ghi thật (module_code + record_id), không phải suy
  luận ngầm.

## Cập nhật Phase 1a (2026-07-24) — Giao việc cơ bản, đã code xong

Đã chốt với người dùng qua AskUserQuestion trước khi code: kênh nhắc nhở deadline
**chỉ badge Bell** (không Telegram/Email, không cần hạ tầng cron — repo hiện chưa có
gì chạy theo lịch); ngưỡng "sắp đến hạn" **cố định 24h trước hạn** (không cho admin
cấu hình riêng).

### Schema (migration `supabase/migrations/20260724_kpi_tasks_phase1a.sql`, **cần
chạy thủ công** trên Supabase SQL Editor)

- `kpi_tasks`, `kpi_task_members`, `kpi_task_logs` đúng schema đã phác thảo ở mục
  "Database Schema" phía trên, với 1 lệch nhỏ: **`kpi_task_logs` có thêm cột
  `factory_id`** (rule gốc không liệt kê) — tuân thủ invariant "mọi bảng đều có
  `factory_id`" (CLAUDE.md), tránh phải JOIN qua `kpi_tasks` mỗi lần lọc theo nhà
  máy trong RLS SELECT.
- RLS: 2 hàm `SECURITY DEFINER` (`kpi_is_task_owner`, `kpi_is_task_active_member`)
  phá vỡ chu trình tham chiếu chéo giữa `kpi_tasks`↔`kpi_task_members` (mirror đúng
  pattern `operation_notes`/`operation_note_shares`, xem
  `.claude/rules/26-operation-notes-module.md`). `kpi_tasks`/`kpi_task_members`
  SELECT dùng thêm `current_profile_has_permission('kpi.view_all')` (hàm có sẵn từ
  `20260721_production_records_permission_rls.sql`).
- **`kpi_task_members` và `kpi_task_logs` KHÔNG có policy UPDATE/INSERT-cho-client
  (trừ `kpi_task_members_insert` lúc tạo task)** — mọi thay đổi `tien_do`/
  `tien_do_nghiem_thu`/`da_nop_luc` đều bắt buộc đi qua 2 RPC `SECURITY DEFINER`
  bên dưới, đảm bảo mỗi lần đổi số liệu luôn kèm đúng 1 dòng `kpi_task_logs` bất
  biến tương ứng — không có đường nào âm thầm sửa tiến độ mà không để lại vết
  (đúng tinh thần "công bằng, minh bạch, có log bất biến" của mục tiêu module).
- **RPC 1 — `kpi_task_member_update(p_task_id, p_hanh_dong, p_tien_do, p_noi_dung,
  p_image_urls, p_file_urls, p_vi_do, p_kinh_do, p_dia_diem_text)`**: dùng cho
  `cap_nhat_tien_do`/`nop`, chỉ chính người đang là thành viên `is_active=true`
  (định danh bằng `auth.uid()` trong hàm, không tin tham số) mới gọi được cho
  chính mình. `cap_nhat_tien_do` bắt buộc `p_noi_dung`. `nop` chỉ set
  `da_nop_luc = now()` **nếu đang NULL** (giữ mốc "lần đầu nộp" cho công thức B —
  không bị ghi đè khi nộp lại sau khi bị trả về/yêu cầu bổ sung). Task tự chuyển
  `moi_giao`/`tra_ve` → `dang_thuc_hien`, hoặc → `cho_nghiem_thu` khi `nop`.
- **RPC 2 — `kpi_task_evaluate(p_task_id, p_member_user_id, p_hanh_dong,
  p_tien_do, p_noi_dung)`**: dùng cho `nghiem_thu`/`dieu_chinh`/`tra_ve`/
  `yeu_cau_bo_sung`, chỉ `nguoi_giao_id` hoặc admin. `nghiem_thu` set
  `tien_do_nghiem_thu`; nếu **tất cả** thành viên `is_active` đã có
  `tien_do_nghiem_thu` thì task → `hoan_thanh` (hỗ trợ task nhiều người, mỗi người
  nghiệm thu độc lập). `dieu_chinh` sửa thẳng `tien_do` (không đổi `trang_thai`,
  dùng khi người giao cần sửa số tự báo cáo sai của thành viên). `tra_ve`/
  `yeu_cau_bo_sung` bắt buộc `p_noi_dung` (lý do/yêu cầu) — `tra_ve` đưa task về
  `tra_ve`, `yeu_cau_bo_sung` đưa về `dang_thuc_hien` (nhẹ hơn, không đánh dấu "bị
  từ chối").
- Không tạo `kpi_task_transfers` ở phase này (đúng roadmap, để Phase 1b).

### `src/lib/kpi-tasks.ts`

- Người "phụ trách"/"người giao" hiển thị tên qua **`maintenance_staff`** (không
  phải `profiles` trực tiếp) — vì RLS `profiles` chỉ cho admin đọc toàn bộ hồ sơ
  trong nhà máy (xem `.claude/rules/16-iso-vanban-module.md`), trong khi
  `maintenance_staff`/`personnel_groups`/`personnel_group_members` không bị RLS
  hạn chế (đã verify: `settings/page.tsx`, `export/page.tsx` query trực tiếp từ
  client cho các bảng này). `loadKpiTaskCandidates(factoryId)` trả về
  `{ people, groups }` — `people` là `maintenance_staff` có `active !== false` và
  `profile_id` không NULL (id dùng làm `kpi_task_members.user_id` chính là
  `profile_id`), `groups` là `personnel_groups` đã mở rộng sẵn danh sách
  `memberUserIds` qua `personnel_group_members` — dùng cho nút "Thêm nhanh theo
  nhóm" trong modal tạo việc (chỉ là tiện ích UI mở rộng tại thời điểm tạo, snapshot
  — không lưu liên kết nhóm nào trên `kpi_tasks`).
- `generateKpiTaskCode(factoryId, ngayGiao)`: `CV-ddmmyy/XXX`, đếm tuần tự theo
  `LIKE` prefix trong `kpi_tasks.ma_cong_viec`, cùng phong cách các module khác
  (Bảo trì, Kiểm soát quá trình).
- `createKpiTask()`: 2 lần gọi Supabase tuần tự (insert `kpi_tasks` rồi insert
  `kpi_task_members`) — **không dùng RPC atomic** cho bước tạo, vì không có race
  condition thật (chỉ chính người gọi tạo task + thành viên của chính task đó,
  không tranh chấp số lượng/tồn kho như các RPC atomic khác trong repo) và mirror
  đúng tiền lệ "header rồi tới rows" đã dùng ở Kiểm soát quá trình
  (`quick_measurements`+`quick_measurement_rows`).
- `isTaskOverdue()`/`isTaskDueSoon()`: `KPI_DUE_SOON_HOURS = 24` (hằng số duy nhất,
  dùng chung cả UI lẫn `module-tasks.ts`).

### UI

- `/dashboard/kpi/tasks` (`page.tsx`): tab "Việc của tôi" (mặc định) / "Tất cả công
  việc" (chỉ hiện khi `kpi.view_all`/admin); toggle "Danh sách"/"Lịch"; filter
  trạng thái multi-select (`FilterMultiSelect`); nút "Giao việc mới" gate
  `kpi.assign`; đọc `?tab=all` từ query string (link Bell trỏ `?tab=mine`, không
  ép `all` — người dùng tự chuyển tab nếu có quyền). Card danh sách hiện mã, tiêu
  đề, tên người thực hiện, thanh % tiến độ trung bình (`averageTaskProgress`, ưu
  tiên điểm nghiệm thu nếu đã có), badge trạng thái, hạn (đỏ nếu quá hạn, amber nếu
  sắp đến hạn).
- `_components/kpi-task-form-modal.tsx`: modal tạo việc — `FilterMultiSelect` chọn
  nhiều người trực tiếp + chip "Thêm nhanh theo nhóm" (không xóa được người đã
  chọn qua nút nhóm, chỉ cộng thêm — bỏ người vẫn qua ô chọn chính); toggle chọn
  "Yêu cầu báo cáo kèm theo" (Ảnh/File/Định vị/Văn bản) — **không enforce cứng
  server-side**, chỉ là tag hiển thị + soft-warning ở form cập nhật tiến độ (xem
  dưới) vì rule gốc không mô tả cơ chế bắt buộc theo loại bằng chứng.
- `_components/kpi-task-calendar.tsx`: lưới tháng thuần Tailwind (repo chưa có thư
  viện calendar) — chấm tròn đỏ/tím theo ngày có task đến hạn (đỏ = quá hạn), click
  1 ngày mở panel danh sách task ngày đó bên dưới lưới, click task vào chi tiết.
- `_components/kpi-evidence-picker.tsx`: ảnh (tối đa 6, mirror `NoteImagePicker`)
  + file bất kỳ (tối đa 4, `kpi_task_logs.file_urls` tách riêng `image_urls`) —
  upload bucket `order-files`, path `{factory_id}/kpi/tasks/{taskId}/...`.
- `/dashboard/kpi/tasks/[id]` (`page.tsx`): header (mã/tiêu đề/badge trạng
  thái/hạn có cảnh báo màu/nút "Hủy công việc" — chỉ người giao/admin, đơn giản là
  `UPDATE trang_thai='huy'` trực tiếp qua RLS `kpi_tasks_update`, không qua RPC vì
  là ghi đè 1 cột không cần tính toán); danh sách "Người thực hiện" — mỗi dòng hiện
  % tự báo cáo + % nghiệm thu (nếu có) + mốc nộp, kèm 4 nút hành động
  Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung (chỉ người giao/admin, chỉ khi task
  còn mở) mở `EvaluateModal`; form "Cập nhật tiến độ của bạn" (chỉ hiện nếu đang
  đăng nhập là thành viên `is_active` của task) — slider %, textarea mô tả bắt
  buộc, `KpiEvidencePicker`, nút "Lấy vị trí hiện tại" (`navigator.geolocation`,
  chỉ hiện khi task yêu cầu `dinh_vi`) rồi 2 nút "Cập nhật tiến độ"/"Nộp"; cuối
  trang là "Nhật ký xử lý" — timeline từ `kpi_task_logs` (icon theo `hanh_dong`,
  tên người thực hiện/người liên quan resolve qua `maintenance_staff` + fallback
  chính session user, ảnh/file/định vị đính kèm nếu có).
- `kpi-shell.tsx`: thêm tab "Công việc" (`ClipboardList`, `matchPrefixes:
  ["/dashboard/kpi/tasks"]`).

### Bell + widget Dashboard

- `module-tasks.ts`'s `getKpiTasks(factoryId, user)`: 4 mục — "Việc cần cập
  nhật/nộp" (mình đang là thành viên active, task ở `moi_giao`/`dang_thuc_hien`/
  `tra_ve`), "Việc chờ nghiệm thu" (mình là `nguoi_giao_id` HOẶC admin — mirror
  đúng kiểu "admin thấy toàn bộ hàng chờ duyệt" đã dùng ở `getDocumentsTasks`),
  "Việc sắp đến hạn (24h)", "Việc đã quá hạn" (2 mục sau chỉ tính task mà mình là
  thành viên HOẶC người giao — không mở rộng cho admin, vì đây là nhắc nhở cá nhân
  chứ không phải hàng chờ duyệt). Đã đăng ký vào `getModuleTasks()` (route prefix
  `/dashboard/kpi`) và vào `tasks-summary-widget.tsx` (gate `kpi.view`) — widget
  "Việc cần làm" trên Dashboard chính giờ gộp cả Công việc & KPI, không tạo widget
  riêng mới.
- Không tạo widget Dashboard riêng cho "Công việc của tôi" — theo đúng roadmap chỉ
  yêu cầu tích hợp vào widget tổng hợp sẵn có.

### Đã xác nhận

- `npx tsc --noEmit`: sạch.
- `npx eslint` (toàn bộ file mới/đã sửa): sạch (đã fix 1 warning
  `eslint-disable-next-line` đặt sai vị trí trong timeline log — chuyển thành
  `/* eslint-disable @next/next/no-img-element */` ở đầu file `[id]/page.tsx`,
  mirror `note-image-picker.tsx`).
- `npm run build`: sạch, cả `/dashboard/kpi/tasks` (static) và
  `/dashboard/kpi/tasks/[id]` (dynamic) build đúng.

### Chưa test tay — cần làm ở phiên sau trước khi coi Phase 1a hoàn tất

1. Chạy migration `20260724_kpi_tasks_phase1a.sql` trên Supabase SQL Editor.
2. Tài khoản có `kpi.assign` (admin/manager mặc định) mở "Giao việc mới" → chọn 2-3
   người trực tiếp + thử nút "Thêm nhanh theo nhóm" → lưu → xác nhận mã
   `CV-ddmmyy/XXX` sinh đúng, vào đúng trang chi tiết vừa tạo.
3. Đăng nhập 1 trong các người được giao → vào `/dashboard/kpi/tasks` tab "Việc của
   tôi" → thấy đúng task vừa tạo → mở chi tiết → "Cập nhật tiến độ" (thử thiếu mô
   tả để xác nhận bị chặn) → xác nhận `trang_thai` chuyển `dang_thuc_hien` và log
   xuất hiện đúng ở timeline.
4. Cùng tài khoản đó bấm "Nộp" → xác nhận `trang_thai` → `cho_nghiem_thu`, mốc nộp
   hiện đúng; thử "Nộp" thêm lần nữa (sau khi bị trả về ở bước 6) để xác nhận mốc
   nộp KHÔNG bị ghi đè lần 2.
5. Đăng nhập lại tài khoản người giao → thấy nút Nghiệm thu/Điều chỉnh/Trả về/Yêu
   cầu bổ sung → thử "Điều chỉnh" (sửa % không đổi trạng thái) → thử "Yêu cầu bổ
   sung" (task về `dang_thuc_hien`, thành viên thấy lại form cập nhật) → thử "Trả
   về" (task về `tra_ve`, lý do bắt buộc) → cuối cùng "Nghiệm thu" với 1 điểm cụ
   thể → xác nhận task chuyển `hoan_thanh` khi đã nghiệm thu hết thành viên active.
6. Test task nhiều người: nghiệm thu người A xong, xác nhận task VẪN `cho_nghiem_thu`
   cho tới khi nghiệm thu nốt người B.
7. Test "Hủy công việc" (owner/admin) → xác nhận `trang_thai=huy`, không còn hành
   động nào khả dụng (mở lại trang không thấy form cập nhật/nút nghiệm thu).
8. Xem tab "Lịch" — xác nhận task hiện đúng ngày (theo `han_hoan_thanh`), chấm đỏ
   cho task quá hạn, click ngày/task điều hướng đúng.
9. Test Bell: tạo 1 task hạn trong vòng 24h tới → xác nhận badge "Việc sắp đến hạn
   (24h)" xuất hiện đúng số khi đứng ở `/dashboard/kpi*`; kiểm tra widget "Việc cần
   làm" trên Dashboard chính cũng cộng đúng số liệu Công việc & KPI.
10. Test quyền: tài khoản `role=user` (không có `kpi.assign`/`kpi.view_all` mặc
    định) không thấy nút "Giao việc mới"/tab "Tất cả công việc"; thử gọi thẳng RPC
    `kpi_task_evaluate` cho 1 task không phải mình giao (qua devtools) → phải bị
    chặn với đúng lỗi "Chỉ người giao việc mới được xử lý bước này."
11. Test "Lấy vị trí hiện tại" trên thiết bị thật (cần HTTPS + quyền định vị trình
    duyệt) — xác nhận toạ độ ghi đúng vào log và hiển thị lại được ở timeline.

## Cập nhật Phase 1a.1 (2026-07-25) — "Gắn bản ghi tại chỗ" (in-context evidence linking)

Thay thế hoàn toàn hướng "auto-complete ngầm" (code tự dò hành động nghiệp vụ để tự đóng việc,
đã bàn ở phiên trước dưới dạng plan chưa triển khai) — bị loại bỏ vì không minh bạch (code
"đoán ý định" thay vì người dùng tự xác nhận). Cơ chế mới: sau khi lưu 1 bản ghi nghiệp vụ
(phiếu điều xe, phiếu sản lượng, phiếu KN, ngăn lưu, giao dịch thành phẩm), UI hỏi người dùng
có muốn GẮN bản ghi đó vào 1 công việc KPI đang mở của chính họ hôm nay không — luôn cần 1 cú
click xác nhận, bằng chứng lưu lại là con trỏ tới bản ghi thật (module_code + record_id +
record_url), không phải suy luận/ảnh chụp màn hình.

**Quyết định phạm vi đã chốt qua AskUserQuestion trước khi code**: bảng `kpi_task_templates`
("Việc định kỳ", xem plan cũ chưa triển khai) CHƯA tồn tại — cơ chế này xây độc lập, hoạt động
trên `kpi_tasks`/`kpi_task_members` hiện có (Phase 1a). Component luôn cho người dùng TỰ CHỌN
từ dropdown việc đang mở hôm nay (không có nhánh "gợi ý khớp sẵn" — nhánh đó cần
`kpi_task_templates.auto_action_type` để so khớp, sẽ nối thêm khi bảng đó ra đời, không đổi
props/API của component).

### Migration `supabase/migrations/20260725_kpi_task_evidence_links.sql` (**cần chạy thủ công**)

- Bảng `kpi_task_evidence_links` (`factory_id`, `task_id`, `member_user_id`, `module_code`,
  `record_id`, `record_label`, `record_url`, `created_at`), `UNIQUE(task_id, module_code,
  record_id)` — 1 bản ghi chỉ gắn 1 lần vào 1 việc. RLS SELECT mirror đúng
  `kpi_task_logs_select` (owner/active member/admin/`kpi.view_all`); **không có** policy
  INSERT/UPDATE/DELETE cho client — chỉ RPC `SECURITY DEFINER` mới ghi được.
- Thêm `'gan_ban_ghi'` vào CHECK constraint `kpi_task_logs.hanh_dong` (`DROP CONSTRAINT` rồi
  `ADD CONSTRAINT` lại — Postgres không có `ALTER CHECK`, tên constraint tự sinh
  `kpi_task_logs_hanh_dong_check` vì CHECK khai báo inline không đặt tên tường minh trong
  migration gốc `20260724_kpi_tasks_phase1a.sql`).
- RPC `kpi_task_link_and_complete(p_task_id, p_module_code, p_record_id, p_record_label,
  p_record_url)` — `SECURITY DEFINER`, chỉ chính người đang là thành viên `is_active=true`
  của task (`auth.uid()`, không tin tham số nào về danh tính) mới gọi được cho chính mình.
  INSERT evidence link (`ON CONFLICT DO NOTHING` — gắn lại cùng bản ghi không lỗi), set
  `tien_do=100, tien_do_nghiem_thu=100, da_nop_luc=COALESCE(...,now())`, ghi log
  `hanh_dong='gan_ban_ghi'`, chuyển thẳng `kpi_tasks.trang_thai='hoan_thanh'` — **không** qua
  `cho_nghiem_thu` (đã chốt: bản ghi nghiệp vụ thật là bằng chứng đủ mạnh, không cần người
  giao duyệt lại).

### `src/lib/kpi-tasks.ts`

- `fetchOpenKpiTasksForUser(factoryId, userId)` — mọi việc ĐANG MỞ (`trang_thai NOT IN
  (hoan_thanh,huy)`) của thành viên `is_active`, sắp theo hạn gần nhất trước. **Không** lọc
  theo `ngay_giao` (xem mục "Cập nhật 2026-07-25 (tiếp)" — bug thật đã fix). Chưa JOIN
  `kpi_task_templates` (bảng chưa tồn tại) — TODO nối thêm khi "Việc định kỳ" ra đời.
- `linkKpiTaskEvidenceAndComplete()` — wrapper gọi RPC trên.
- `fetchKpiTaskEvidenceLinks(taskId)` — cho trang chi tiết hiển thị bằng chứng.
- `getKpiCachedUserId()` — đọc `id` từ `localStorage.erp_user` (`SessionUser`), dùng ở các
  module KHÔNG giữ sẵn `user.id` trong state (Điều xe/Kho nguyên liệu hiện chỉ cache role/tên
  qua bootstrap Pattern A, không phải toàn bộ `SessionUser`).
- `KpiTaskLogAction` thêm `'gan_ban_ghi'`, `KPI_ACTION_LABEL['gan_ban_ghi'] = "Gắn bằng
  chứng"`.

### Component dùng chung `src/app/dashboard/_components/kpi-link-prompt.tsx`

Đặt tại `_components/` chung của dashboard (không phải `src/components/kpi/` như đề xuất ban
đầu trong yêu cầu) — mirror đúng chỗ ở của mọi component dùng-chung-nhiều-module khác trong
repo (`note-image-picker.tsx`, `required-note-select.tsx`, `filter-multi-select.tsx`...), vì
component này được nhúng vào 6 trang khác nhau ngoài phạm vi `/dashboard/kpi/`.

- Props: `factoryId`, `moduleCode`, `recordId`, `recordLabel`, `recordUrl?`, `onDone?`.
- Tự lấy `userId` qua `getKpiCachedUserId()`, gọi `fetchOpenKpiTasksForUser()`. Không có
  việc mở nào → `render null` im lặng. Có việc → banner tím: dropdown chọn việc + nút "Gắn &
  hoàn thành" + nút "Bỏ qua". Bấm gắn thành công → banner xanh "Đã hoàn thành việc: ..." tự ẩn
  sau 3s (gọi `onDone()`), có nút X đóng ngay.
- **Fail-silent tuyệt đối**: mọi lỗi query/RPC/thiếu userId đều bị `catch` — không bao giờ
  `throw` ra ngoài làm gãy trang cha. Lỗi RPC lúc gắn (vd task đã bị người khác đóng) hiện
  dòng đỏ nhỏ trong chính banner, không phá UI.

### 6 điểm đã gắn (5 module nghiệp vụ + luồng quét QR riêng của Thành phẩm)

| Module | File | Hook vào | `moduleCode` |
|---|---|---|---|
| Điều xe | `dispatch/page.tsx` | `handleSave()`, chỉ nhánh **tạo mới** (insert `dispatch_entries`) | `dispatch:create` |
| Sản lượng | `output/page.tsx` | `handleSave()`, **cả** nhánh update lẫn insert `production_records` (thêm `.select("id").single()` để lấy id) — "cập nhật sản lượng" tính cả sửa lại số liệu hôm nay, không chỉ tạo mới | `output:save` |
| Kiểm nghiệm | `quality/page.tsx` | `handleSaveBatch()` cả 2 nhánh (sửa 1 phiếu + tạo batch nhiều lô), và `handleImport()` (import Excel hàng loạt) — **KHÔNG** gắn ở `handleSaveTKH` (hàm đó lưu `qc_custom_std`, không phải phiếu KN — sai chỗ nếu gắn, đã tự sửa lại so với yêu cầu gốc) | `quality:create` |
| Kho nguyên liệu | `storage/page.tsx` | `handleSave()`, chỉ nhánh **tạo mới** (`!editId`, insert `ngans`) | `storage:create` |
| Thành phẩm (nhập tay) | `product/page.tsx` | `handleSave()` (form nhiều block) — track `firstSavedLot` từ `saveResult.lotId` của lần lưu đầu tiên thành công trong vòng lặp, set prompt sau khi TOÀN BỘ block đã lưu xong (không phải mỗi block 1 banner) | `product:create` |
| Thành phẩm (quét QR) | `product/confirm/page.tsx`, `HubView` | `handleSubmitAllDrafts()` ("Gửi tất cả" — nơi `product_confirm_drafts` thật sự ghi vào `lot_transactions`) — dùng `result.touchedLots[0]` làm đại diện, thêm hậu tố "(+N lô khác)" nếu gửi nhiều lô cùng lượt. **Cố ý KHÔNG gắn** ở luồng "Gửi nháp ngay" bên trong modal "Kết thúc ca" (`handleEndShiftSendDraftsAndContinue`) — tránh chèn banner giữa 1 flow modal đang tiến tới xuất PDF, UX không phù hợp | `product:create` |
| Kiểm soát quá trình (Đo nhanh chỉ tiêu) | `process/measurements/page.tsx` | `handleSave()`, nhánh **tạo phiếu mới** VÀ nhánh **thêm mẫu vào phiếu đã có** (`addRowsMode`) — không gắn ở nhánh "sửa toàn bộ phiếu" (thuần chỉnh sửa, không phải work mới) | `process:measurement` |

**Lý do 2 hàm `saveLotTransaction()`/`confirmKienProduction()`/`submitConfirmDraftBatch()`
KHÔNG gọi hook bên trong chính chúng**: cả 3 đều là Server Action chạy bằng
`getSupabaseAdmin()` (service role) — không có `auth.uid()` của người dùng thật trong ngữ
cảnh đó, nên RPC `kpi_task_link_and_complete` (dựa vào `auth.uid()` để xác định actor) sẽ
không hoạt động đúng nếu gọi từ trong server action. Hook luôn đặt ở **phía client**, ngay
sau khi server action trả về thành công.

**Chỉ hook nhánh TẠO MỚI** (không hook nhánh sửa) ở Điều xe/Kho nguyên liệu — đúng ngữ nghĩa
"tạo phiếu điều xe"/"tạo ngăn" trong yêu cầu gốc. Sản lượng là ngoại lệ có chủ đích (tính cả
sửa) vì bản chất công việc "cập nhật sản lượng trước 17h" là 1 "duty" theo ngày, không phải
hành động tạo-một-lần.

### Trang chi tiết `/dashboard/kpi/tasks/[id]/page.tsx`

Thêm khối "Bằng chứng gắn kèm" (icon `Link2`) giữa `ProgressForm` và "Nhật ký xử lý" — chỉ
hiện khi có ít nhất 1 `kpi_task_evidence_links`, mỗi dòng có nút "Xem" (`ExternalLink`) nhảy
thẳng tới `record_url` nếu có. `ACTION_ICON` map thêm `gan_ban_ghi: Link2` để timeline log
hiển thị đúng icon cho hành động này.

### Đã xác nhận

- `npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa: `kpi-tasks.ts`,
  `kpi-link-prompt.tsx`, `dispatch/page.tsx`, `output/page.tsx`, `quality/page.tsx`,
  `storage/page.tsx`, `product/page.tsx`, `product/confirm/page.tsx`,
  `kpi/tasks/[id]/page.tsx`): sạch — các warning/error còn lại trong `dispatch/page.tsx` và
  `quality/page.tsx` đã xác nhận là pre-existing (so `git stash` trước/sau, cùng 18
  problems), không liên quan thay đổi lần này.
- `npm run build`: sạch.

### Chưa test tay — cần làm ở phiên sau

1. Chạy `20260725_kpi_task_evidence_links.sql` trên Supabase SQL Editor (SAU
   `20260724_kpi_tasks_phase1a.sql`).
2. Tạo 1 công việc KPI giao cho chính tài khoản đang test, hạn hôm nay. Vào Điều xe tạo 1
   phiếu mới → xác nhận banner tím hiện đúng, chọn đúng việc, bấm "Gắn & hoàn thành" → task
   chuyển `hoan_thanh` ngay (không qua `cho_nghiem_thu`), banner xanh hiện tên việc.
3. Vào `/dashboard/kpi/tasks/[id]` xác nhận khối "Bằng chứng gắn kèm" hiện đúng, nút "Xem"
   nhảy đúng `/dashboard/dispatch`; timeline có dòng "Gắn bằng chứng".
4. Lặp lại tương tự cho Sản lượng (cả tạo mới lẫn sửa), Kiểm nghiệm (cả `handleSaveBatch` lẫn
   import Excel), Kho nguyên liệu (tạo ngăn), Thành phẩm (nhập tay nhiều block VÀ luồng quét
   QR "Gửi tất cả").
5. Test đăng nhập tài khoản KHÔNG có việc KPI nào mở hôm nay → lưu 1 bản ghi bất kỳ → xác nhận
   không có banner nào hiện ra (im lặng hoàn toàn).
6. Test fail-silent: tạm thời đặt sai tên RPC hoặc ngắt mạng lúc gọi → xác nhận module nghiệp
   vụ (Điều xe/Sản lượng/...) vẫn lưu và hoạt động bình thường, không có lỗi nào lộ ra ngoài
   banner của chính `KpiLinkPrompt`.
7. Test gắn lại đúng 1 bản ghi vào 2 việc khác nhau (nếu có ≥2 việc mở cùng lúc) — xác nhận
   `UNIQUE(task_id, module_code, record_id)` không chặn (vì `task_id` khác nhau), cả 2 việc
   đều hoàn thành với cùng 1 bằng chứng.
8. Test quyền: gọi thẳng RPC `kpi_task_link_and_complete` cho 1 task mà mình KHÔNG phải thành
   viên `is_active` → phải bị chặn đúng lỗi "Bạn không phải người đang phụ trách công việc
   này."

## Cập nhật 2026-07-25 (tiếp) — Bug thật đã fix: dropdown thiếu việc do lọc nhầm `ngay_giao`

Test tay đầu tiên trên `npm run dev` phát hiện đúng bug: giao việc "Tạo phiếu điều xe" cho
Chau Nho với hạn 25/07/2026 17:00, nhưng khi Chau Nho tạo phiếu điều xe ngày 25/07 thật, banner
gợi ý hiện ra nhưng dropdown chỉ thấy việc "Đo nhanh chỉ tiêu Po Mo CSR10" (hạn tận 28/07),
**không thấy** việc "Tạo phiếu điều xe" — dù việc đó đang mở và đúng là việc cần gắn.

**Nguyên nhân**: `fetchOpenKpiTasksForUserToday()` (tên cũ) lọc cứng
`.eq("ngay_giao", today)` — nhưng `ngay_giao` là **ngày TẠO/giao việc** (mặc định
`getTodayISODate()` lúc bấm "Giao việc mới"), hoàn toàn khác với `han_hoan_thanh` (ngày CẦN
LÀM). Việc "Tạo phiếu điều xe" nhiều khả năng được giao từ hôm trước (chuẩn bị sẵn cho
25/07) nên `ngay_giao` ≠ hôm nay → bị lọc mất, trong khi việc "Đo nhanh..." được tạo ĐÚNG lúc
test (hôm nay) nhưng hạn những 3 ngày sau lại lọt qua bộ lọc — hoàn toàn ngược với kỳ vọng
người dùng ("việc tôi cần làm bây giờ" phải ưu tiên theo hạn, không phải theo ngày tạo).

**Fix**: bỏ hẳn điều kiện lọc theo ngày. Hàm đổi tên thành `fetchOpenKpiTasksForUser()` (bỏ
"Today" vì không còn ý nghĩa "chỉ hôm nay") — chỉ còn lọc theo `trang_thai NOT IN
(hoan_thanh,huy)` + thành viên `is_active`, sắp xếp theo `han_hoan_thanh` tăng dần (việc gấp
nhất luôn nổi lên đầu dropdown). Đổi tên tại cả nơi định nghĩa (`kpi-tasks.ts`) và nơi gọi
(`kpi-link-prompt.tsx`), sửa luôn 2 câu chữ trong component còn nhắc "hôm nay" (doc-comment
+ text banner "gắn vào công việc KPI đang mở hôm nay?" → "...KPI nào đang mở?") cho khớp hành
vi mới. Xóa import `getTodayISODate` không còn dùng trong `kpi-tasks.ts`.

**Bug thứ 2 (thiếu tính năng, không phải lỗi logic)**: "quay lại đo mẫu tại module Kiểm soát
quá trình và lưu không có banner nào hiển thị" — đúng như thiết kế TẠI THỜI ĐIỂM ĐÓ, vì
Kiểm soát quá trình (`process/measurements/page.tsx`) chưa từng nằm trong 5 module được gắn
`KpiLinkPrompt` ở phiên trước (chỉ Điều xe/Sản lượng/Kiểm nghiệm/Kho nguyên liệu/Thành phẩm).
Vì người dùng đã thực tế giao việc "Đo nhanh chỉ tiêu" — đã bổ sung module này làm điểm gắn
thứ 7 (xem bảng ở mục "Cập nhật Phase 1a.1" — đã cập nhật thêm dòng
`process:measurement`): hook ở `handleSave()`'s nhánh **tạo phiếu mới** và nhánh **thêm mẫu
vào phiếu đã có** (`addRowsMode`), dùng `editingSheet?.ma_phieu`/`maPhieu` làm nhãn hiển thị,
`recordUrl` trỏ `/dashboard/process/measurements`. Không gắn ở nhánh "sửa toàn bộ phiếu đã có"
(thuần chỉnh sửa dữ liệu cũ, không phải "đang làm việc mới" — nhất quán với cách Điều xe/Kho
nguyên liệu chỉ hook nhánh tạo mới).

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch sau 2 fix trên. **Chưa test tay
lại** — cần: (1) đăng nhập lại Chau Nho, tạo phiếu điều xe 25/07 → xác nhận dropdown giờ có cả
2 việc "Tạo phiếu điều xe" và "Đo nhanh chỉ tiêu Po Mo CSR10", chọn đúng "Tạo phiếu điều xe" →
gắn thành công → task chuyển Hoàn thành; (2) vào Kiểm soát quá trình → Đo nhanh chỉ tiêu, lưu
1 phiếu mới → xác nhận banner xuất hiện, dropdown có việc "Đo nhanh chỉ tiêu Po Mo CSR10" →
gắn → xác nhận hoàn thành đúng; (3) test thêm mẫu vào phiếu đã có (không phải tạo mới) cũng
hiện banner đúng.

## Chưa test tay (Phase 0)

- Chạy migration `20260724_kpi_module_phase0.sql` + `20260724_kpi_seed_groups.sql`
  trên Supabase SQL Editor.
- Cài đặt → Hệ thống → Nhân sự → sửa 1 nhân sự tick ≥2 nhóm → chọn "Nhóm chính" từ
  dropdown mới (chỉ liệt kê nhóm đã tick) → lưu → mở lại xác nhận giữ đúng lựa
  chọn; bỏ tick đúng nhóm đang là chính → xác nhận tự gỡ trước khi lưu.
- Đăng nhập tài khoản đã liên kết `maintenance_staff.profile_id` và có nhóm chính
  → `/dashboard/kpi` → xác nhận banner xanh hiện đúng tên nhóm + nội dung "hệ số
  ×10 / nhóm khác ×5". Tài khoản chưa có nhóm chính → banner amber đúng nội dung
  mới.
  Tài khoản không có `kpi.view` → sidebar ẩn "Công việc & KPI", truy cập thẳng URL
  bị redirect `/dashboard`.
- `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch.

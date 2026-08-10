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

### 5S (C) — ĐÃ BUILD, mô hình 2 TẦNG (đổi tên 2026-08-05 — xem mục "Cập nhật
2026-08-05" cuối file để biết lý do và migration cần chạy)

**Tầng 1 — "Vị trí 5S"** (nhỏ, đơn vị được QR-hoá để chấm điểm hàng tuần — vd
PGĐ, PH01):

```sql
kpi_5s_locations (   -- tên cũ: kpi_5s_zones (đã RENAME 2026-08-05)
  id, factory_id, ma_vi_tri TEXT, ten_vi_tri TEXT NOT NULL, mo_ta TEXT,
  nguoi_don_id UUID,   -- người chịu trách nhiệm HIỆN TẠI (standing, sửa bất cứ lúc nào)
  nguoi_cham_id UUID,  -- người chấm HIỆN TẠI (standing)
  zone_id UUID → kpi_5s_zones(id) ON DELETE SET NULL,  -- khu vực (tầng 2) chứa vị trí này, optional
  is_active BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at, updated_at,
  UNIQUE(factory_id, ma_vi_tri),
  CHECK (nguoi_don_id IS NULL OR nguoi_cham_id IS NULL OR nguoi_don_id <> nguoi_cham_id)
)
-- Khi về tua: quản lý sửa trực tiếp nguoi_don_id trong Settings — KHÔNG có cơ chế
-- "phân công lại mỗi tuần" riêng (trừ khi dùng "Phân công thông minh", xem UI).

kpi_5s_evaluations (
  id, factory_id, location_id → kpi_5s_locations,   -- tên cũ: zone_id
  tuan_bat_dau DATE NOT NULL,
  nguoi_don_id UUID NOT NULL,   -- SNAPSHOT người chịu trách nhiệm ĐÚNG TUẦN ĐÓ (mặc định lấy
                                 -- từ locations.nguoi_don_id lúc chấm, sửa được nếu có người dọn thay)
  nguoi_cham_id UUID NOT NULL,
  ket_qua TEXT NOT NULL CHECK (ket_qua IN ('dat','tuong_doi','khong_dat')),  -- 3 mức (thêm 'tuong_doi' 2026-07-25)
  ly_do TEXT,   -- bắt buộc khi ket_qua IN ('tuong_doi','khong_dat')
  image_urls TEXT[] DEFAULT '{}',   -- khuyến khích, KHÔNG bắt buộc
  danh_gia_luc TIMESTAMPTZ DEFAULT now(), created_at, UNIQUE(location_id, tuan_bat_dau)
)
```

**Tầng 2 — "Khu vực"** (lớn, vd Văn phòng, Kho 1, Kho 2, Ca SX mủ tạp, Ca SX mủ
nước — CHỈ dùng để giới hạn pool ứng viên khi "Phân công thông minh" random chỉ
trong nội bộ 1 khu vực; **không** liên quan `personnel_groups`, xem đầy đủ ở mục
"Cập nhật 2026-08-05"):

```sql
kpi_5s_zones (   -- tên MỚI (tái dùng tên bảng vừa giải phóng ở lần rename trên) —
                  -- KHÔNG nhầm với `personnel_groups` (nhóm CHUYÊN MÔN, dùng cho D)
  id, factory_id, ten TEXT NOT NULL, is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0, created_at, updated_at,
  UNIQUE(factory_id, lower(ten))
)

kpi_5s_zone_members (
  id, factory_id, zone_id → kpi_5s_zones ON DELETE CASCADE,
  user_id UUID → auth.users, created_at,
  UNIQUE(zone_id, user_id)
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

kpi_appeals ( id, monthly_score_id NULL, task_id NULL, location_evaluation_id NULL,  -- tên cũ: zone_evaluation_id
  nguoi_khieu_nai_id, noi_dung TEXT NOT NULL,
  trang_thai TEXT DEFAULT 'cho_xu_ly' CHECK (trang_thai IN ('cho_xu_ly','da_giai_quyet','tu_choi')),
  phan_hoi TEXT, nguoi_xu_ly_id, created_at, updated_at )
```

## RLS (áp dụng khi build từng bảng)

- Đọc rộng trong `factory_id`: `kpi_criteria_templates`, `kpi_score_weights`,
  `kpi_5s_locations`, `kpi_5s_zones`, `kpi_5s_zone_members`, `kpi_5s_evaluations`,
  `kpi_daily_evaluations`, `kpi_daily_evaluation_items`. Ghi giới hạn
  `kpi.evaluate` (chấm điểm 5S) hoặc `kpi.manage_config`/admin (còn lại) —
  riêng `kpi_5s_evaluations` INSERT chỉ đúng người đang là `nguoi_cham_id` của
  vị trí đó, không có ngoại lệ admin (xem "Cập nhật Phase 2").
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
- Tab **KPI & 5S** (icon `Target`) — hiện có 2 sub-tab đã build: **"Vị trí 5S"**
  (CRUD `kpi_5s_locations` + dropdown chọn "Khu vực" + nút "Phân công thông
  minh" + nút "In QR hàng loạt") và **"Khu vực"** (CRUD `kpi_5s_zones` + "Quản lý
  thành viên" mỗi khu vực → `kpi_5s_zone_members`). Sub-tab "Khung tiêu chí
  KPI"/"Trọng số công thức" (Phase 3/4) vẫn **chưa build**.

### Module `/dashboard/kpi`

1. **Tổng quan** ✅ (Phase 0) — hiện card "Nhóm chính" của bản thân + roadmap "Sắp
   có". Sẽ bổ sung: việc đang làm/quá hạn/chờ nghiệm thu, 5S cần chấm tuần này,
   điểm KPI tháng (tạm tính) + hệ số chuyên cần.
2. **Công việc** — "Việc của tôi"/"Tất cả công việc"; chi tiết task có timeline log
   bất biến; nút Cập nhật tiến độ/Nộp/Chuyển giao/Nghiệm thu/Điều chỉnh/Trả về/Yêu
   cầu bổ sung theo vai trò.
3. **Đánh giá 5S** — mỗi vị trí (tầng nhỏ, vd PGĐ/PH01) có URL cố định
   `/dashboard/kpi/5s/location/{location_id}` (đổi từ `/zone/` 2026-08-05, bắt
   buộc đăng nhập, redirect login nếu chưa). QR encode thẳng URL này. Trang vị
   trí: lịch sử Đạt/Tương đối/Không đạt công khai trong factory; chỉ hiện nút
   "Chấm điểm tuần này" nếu user = `nguoi_cham_id` VÀ tuần hiện tại chưa có bản
   chấm. Form chấm: `nguoi_don_id` mặc định = giá trị hiện tại của vị trí (sửa
   được nếu có người dọn thay), Đạt/Tương đối/Không đạt, lý do bắt buộc khi khác
   "Đạt", ảnh khuyến khích. "Khu vực" (tầng lớn, vd Văn phòng/Kho 1) chỉ dùng để
   giới hạn pool ứng viên của "Phân công thông minh" — không có trang chi tiết
   riêng, quản lý trong Cài đặt → KPI & 5S → "Khu vực".
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
- **Phase 1b — Chuyển giao việc** ✅ Đã code xong VÀ đã test tay (2026-07-25 code,
  2026-07-26 test) — `kpi_task_transfers`; UI chuyển giao/nhận/từ chối/hủy, chặn
  chuyển quá hạn/lần 2. Luồng chính (gửi/chấp nhận/từ chối) đã xác nhận đúng trên
  localhost. (Không có nhắc nhở tự động trước khi VỀ TUA — khác với nhắc nhở
  deadline ở Phase 1a, xem phân biệt ở mục trên.)
- **Người thay thế tạm thời + Việc định kỳ theo nhóm** ✅ Đã code xong (2026-07-26,
  xem mục "Việc định kỳ theo nhóm + Người thay thế tạm thời" và "Cập nhật
  2026-07-26 (tiếp 2)" bên dưới) — `kpi_task_templates` + `kpi_user_substitutions`
  + RPC "sinh lười" `kpi_ensure_today_task_instances`; tab mới
  `/dashboard/kpi/templates`, kèm nút "Sinh việc hôm nay ngay" (bỏ qua cờ
  sessionStorage) + auto-trigger sau khi Lưu template/đăng ký thay thế — fix
  đúng bug thật đã xác nhận bằng DB (0 task từng sinh do cờ sessionStorage kẹt).
  `tsc`/`eslint`/`npm run build` đều sạch, **chưa test tay** (đã điều tra bằng
  query DB thật, chưa test qua UI thật).
- **Phase 2 — Đánh giá 5S** ✅ Đã code xong (2026-07-26, xem mục "Cập nhật
  Phase 2" bên dưới) — kiến trúc gốc 1 tầng (`kpi_5s_zones`+`kpi_5s_evaluations`,
  route `/dashboard/kpi/5s/zone/{id}`) đã bị **đổi tên toàn bộ thành 2 tầng**
  ngày 2026-08-05 (xem mục "Cập nhật 2026-08-05" cuối file) — schema/route hiện
  tại là `kpi_5s_locations`+`kpi_5s_zones` (bảng mới)+`kpi_5s_zone_members`,
  route `/dashboard/kpi/5s/location/{id}`. `tsc`/`eslint`/`npm run build` đều
  sạch, **chưa test tay** (cả bản gốc lẫn bản đổi tên).
- **Phase 3 — Khung tiêu chí KPI + Chấm điểm chuyên môn theo ngày** ✅ Đã code xong
  (2026-08-11 (system), 2026-07-29 (repo timeline nội bộ) — xem mục "Cập nhật Phase
  3" bên dưới): `kpi_criteria_templates`+`kpi_daily_evaluations`+
  `kpi_daily_evaluation_items` (migration
  `20260811_kpi_criteria_daily_evaluations.sql`, **CHƯA CHẠY**); RPC atomic
  `kpi_submit_daily_evaluation`/`kpi_delete_daily_evaluation`; sub-tab "Khung
  tiêu chí KPI" (Cài đặt → KPI & 5S) + tab "Chấm điểm chuyên môn"
  (`/dashboard/kpi/evaluate`). `tsc`/`eslint`/`npm run build` đều sạch, **chưa
  chạy migration, chưa test tay**.
- **Phase 4 — Trọng số + Hệ số chuyên cần + Engine tính điểm (bản nháp)** ✅ Đã
  code xong (xem mục "Cập nhật Phase 4" bên dưới): `kpi_score_weights`+
  `kpi_monthly_scores` (migration
  `20260813_kpi_score_weights_monthly_scores.sql`, **CHƯA CHẠY**); engine 1
  RPC/transaction `GROUP BY` (không loop-per-user), `UPSERT ... WHERE
  trang_thai <> 'da_khoa'`; sub-tab "Trọng số công thức" (Cài đặt → KPI & 5S) +
  tab "Bảng điểm KPI" (`/dashboard/kpi/scores`); điểm luôn `nhap` (chưa khóa) —
  chạy nháp 1-2 tháng quan sát thực tế. `tsc`/`eslint`/`npm run build` đều
  sạch, **chưa chạy migration, chưa test tay**.
- **Phase 5 — Khóa sổ, khiếu nại & minh bạch** ✅ Đã code xong (xem mục "Cập nhật Phase 5" bên
  dưới): RPC `kpi_monthly_score_lock` (khóa sổ, không có "mở khóa"); bảng `kpi_score_adjustments`
  + RPC `kpi_monthly_score_adjust` (audit điều chỉnh điểm đã khóa, chỉ hoạt động qua khiếu nại
  hoặc admin điều chỉnh trực tiếp); nối `kpi_appeals.monthly_score_id` (khiếu nại điểm tháng, chỉ
  tạo được khi đã khóa sổ); 2 RPC `kpi_score_ranking_by_group`/`kpi_score_ranking_by_department`
  (bảng xếp hạng ẩn danh, chỉ trả rank+điểm+is_me, không lộ tên). Điểm tạm tính real-time đã
  hiện thực hóa sớm hơn qua sub-tab "Chi tiết cách tính điểm" (mục "Cập nhật (phiên sau Phase 4,
  tiếp)"). Migration `20260814_kpi_score_lock_adjust_rank.sql`, **CHƯA CHẠY, chưa test tay**.
- **Hạn chấm điểm 5S + Random riêng từng vị trí + Bỏ qua đợt phân công + Redesign mobile toàn
  module** ✅ Đã code xong (xem mục "Cập nhật (phiên sau Phase 5)" bên dưới): `kpi_5s_locations`
  thêm `deadline_weekdays`/`deadline_time` (Thứ + Giờ, tuỳ chọn theo vị trí) + badge quá hạn/sắp
  hạn ở cả danh sách lẫn chi tiết; nút "Random vị trí này" trên mỗi thẻ Vị trí 5S (Cài đặt); toggle
  "Bỏ qua đợt này" từng dòng trong modal "Phân công thông minh"; redesign responsive mobile cho cả
  6 trang KPI + thanh tab `KpiShell` (nhãn rút gọn, gradient cuộn, dời dropdown "Theo phòng ban"
  lên header chính của Bảng điểm KPI, bọc 5 bảng bằng `ResponsiveTableWrapper`). Migration
  `20260815_kpi_5s_deadline.sql`, **CHƯA CHẠY, chưa test tay**.

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

## Cập nhật 2026-07-25 (tiếp 2) — Bug thật đã fix: "việc mục tiêu số lượng chung" đóng ngay
khi có 1 người gắn 1 bằng chứng, dù chưa đủ số lượng/chưa đủ người

### Bug đã phát hiện

Người dùng test: giao "Nhóm kỹ thuật-chất lượng đo 4 mẫu trong ngày" cho 2 người (Nho, Thọ).
Chỉ cần 1 người đo 1 mẫu (gắn 1 bằng chứng) là **cả task đóng "Hoàn thành" ngay lập tức**, dù
mới có 1/4 mẫu và người còn lại chưa làm gì.

**Nguyên nhân**: RPC gốc `kpi_task_link_and_complete` (từ migration
`20260725_kpi_task_evidence_links.sql`, mục "Cập nhật Phase 1a.1") không có khái niệm "mục
tiêu số lượng" — bất kỳ 1 bằng chứng nào từ bất kỳ thành viên nào cũng set thẳng
`tien_do=100, tien_do_nghiem_thu=100` cho CHÍNH NGƯỜI ĐÓ và chuyển `kpi_tasks.trang_thai =
'hoan_thanh'` ngay, không quan tâm còn thành viên khác hay còn thiếu số lượng. Đúng cho task
1-người-1-hành-động ("Tạo phiếu điều xe"), nhưng sai hoàn toàn cho task nhiều người cùng làm
1 việc cần đạt tổng số lượng ("đo 4 mẫu").

### Thiết kế đã chốt — tách biệt "việc chung hoàn thành" khỏi "điểm A cá nhân"

Đây là điểm mấu chốt cần nhớ khi đụng lại phần này: **2 khái niệm độc lập nhau**, không được
nhầm lẫn hay gộp chung logic:

1. **"Việc chung hoàn thành"** (`kpi_tasks.trang_thai = 'hoan_thanh'`) — chỉ phụ thuộc TỔNG số
   bằng chứng đã gắn (`COUNT(kpi_task_evidence_links) >= kpi_tasks.muc_tieu_so_luong`), **không
   quan tâm ai đóng góp bao nhiêu** trong tổng đó. Task "đo 4 mẫu" xong khi tổng 4 mẫu đã đo,
   bất kể tỷ lệ đóng góp giữa Nho/Thọ là 3-1, 2-2, hay 4-0.
2. **"Điểm A cá nhân"** (`kpi_task_members.tien_do_nghiem_thu`, dùng cho công thức A — Điểm
   hoàn thành, xem mục "A — Điểm hoàn thành" phía trên) — tính KHÁC NHAU theo `phan_loai`:
   - **`choang`** (thành viên phụ): **luôn được 100%** ngay khi việc chung hoàn thành, không
     có ngưỡng, không bị phạt — kể cả nếu họ đóng góp 0. Lý do nghiệp vụ: người "choàng" chỉ
     là hỗ trợ thêm, không phải người chịu trách nhiệm chính cho việc đó.
   - **`chinh`** (đúng 1 người/task, chọn lúc giao việc): có **ngưỡng tối thiểu riêng = 50%
     "kỳ vọng"** của họ. Kỳ vọng = `muc_tieu_so_luong / số thành viên active`. Ngưỡng =
     `FLOOR(kỳ vọng × 0.5)`, tối thiểu 1 nếu kỳ vọng ≥ 1. Điểm A của chính =
     `MIN(100, ROUND(đóng góp thật của chính / ngưỡng × 100))` — công thức này **luôn tính
     trên đóng góp THẬT của chính**, không được "cứu" thành 100% chỉ vì việc chung đã xong
     nhờ người khác đóng góp bù. Đây chính là cơ chế phạt nếu người chính bỏ bê phần việc của
     mình — ví dụ: đo 0/4 thì điểm A = 0% dù việc chung đã hoàn thành nhờ người khác đo đủ.

**Ví dụ đúng theo bug gốc người dùng nêu** (mục tiêu 4 mẫu, 2 thành viên, Nho = chính, Thọ =
choàng): kỳ vọng mỗi người = 4/2 = 2, ngưỡng của Nho = FLOOR(2×0.5) = 1.
- Nho đo 3, Thọ đo 1 → tổng 4 = đủ mục tiêu → việc chung Hoàn thành. Điểm A của Nho =
  MIN(100, 3/1×100) = 100%. Điểm A của Thọ = 100% (choàng, không tính ngưỡng).
- Nho đo 0, Thọ đo 4 → tổng 4 = đủ mục tiêu → việc chung Hoàn thành. Điểm A của Nho =
  MIN(100, 0/1×100) = **0%** (bị phạt vì không đóng góp gì, dù việc chung đã xong). Điểm A
  của Thọ = 100%.

### Migration `supabase/migrations/20260725_kpi_task_quantity_target.sql` (**CẦN CHẠY THỦ CÔNG
trên Supabase SQL Editor — CHƯA CHẠY**)

- Thêm `kpi_tasks.muc_tieu_so_luong INTEGER` (`CHECK > 0`, nullable — `NULL` = giữ nguyên hành
  vi cũ "1 bằng chứng là xong", dùng cho task 1-người-1-hành-động).
- Thêm `kpi_task_members.phan_loai TEXT` (`CHECK IN ('chinh','choang')`, nullable). **Lưu ý
  quan trọng**: cột này TRÙNG TÊN với `phan_loai` đã phác thảo cho Phase "Việc định kỳ"
  (`kpi_task_templates`, xem plan `tr-c-khi-ti-p-t-c-delegated-moonbeam.md`) nhưng Ý NGHĨA
  KHÁC — ở đó `phan_loai` so nhóm việc với nhóm chính (`is_primary`) CỦA NGƯỜI NHẬN; ở đây
  `phan_loai` là vai trò của người đó TRONG PHẠM VI 1 task cụ thể (chọn tay lúc giao việc,
  không liên quan `personnel_groups`). Khi Phase "Việc định kỳ" triển khai thật, phải đối
  chiếu lại xem 2 ý nghĩa có xung đột không trước khi tái sử dụng cột này cho template.
- `CREATE OR REPLACE FUNCTION kpi_task_link_and_complete(...)` — viết lại hoàn toàn theo đúng
  công thức ở trên. Nhánh `muc_tieu_so_luong IS NULL` giữ nguyên hành vi cũ (backward-compat
  với mọi task đã tạo trước migration này, và task 1-người vẫn tạo mặc định không đặt mục
  tiêu). Nhánh có mục tiêu: cập nhật `tien_do` thô của MỌI thành viên active (tham khảo, không
  phải điểm cuối), tính lại điểm A của đúng người `chinh` MỖI LẦN có bằng chứng mới (không chỉ
  khi chính chính họ gắn — vì điểm của chính chỉ phụ thuộc đóng góp của chính họ + kỳ vọng
  chung, độc lập với ai vừa thao tác), rồi kiểm tra tổng có đủ mục tiêu chưa để chốt `choang`
  = 100% + `trang_thai = 'hoan_thanh'`. Thành viên `phan_loai IS NULL` (dữ liệu cũ, task tạo
  trước migration nhưng lỡ có `muc_tieu_so_luong`) được xử lý như `choang` để tránh kẹt
  `tien_do_nghiem_thu` NULL vĩnh viễn.

### `src/lib/kpi-tasks.ts`

- `KpiTask.muc_tieu_so_luong: number | null`, `KpiPhanLoai = "chinh" | "choang"`,
  `KpiTaskMember.phan_loai: KpiPhanLoai | null`.
- `createKpiTask()` nhận thêm `mucTieuSoLuong?: number | null`, `nguoiChinhId?: string | null`
  — validate: nếu đặt mục tiêu thì `nguoiChinhId` bắt buộc và phải nằm trong
  `memberUserIds`. Member insert payload set `phan_loai` = `"chinh"` cho đúng
  `nguoiChinhId`, `"choang"` cho các thành viên còn lại, `null` nếu không đặt mục tiêu.
- Hàm mới `computeChinhThreshold(mucTieuSoLuong, activeMemberCount)` — mirror chính xác công
  thức SQL (`FLOOR(kỳ vọng × 0.5)`, sàn 1 nếu kỳ vọng ≥ 1) để hiển thị ngưỡng ngay trên UI
  form tạo việc (live preview) và trang chi tiết, không cần round-trip DB chỉ để xem số này.

### `KpiTaskFormModal` (`kpi-task-form-modal.tsx`)

- Field mới "Số lượng mục tiêu chung (tuỳ chọn)" (number input) — để trống = task thường (1
  hành động là xong). Có giá trị → hiện thêm khối "Người chính (chịu trách nhiệm chính) *"
  (dropdown chỉ trong số `memberIds` đã chọn), kèm giải thích ngưỡng 50% + số ngưỡng tính live
  qua `computeChinhThreshold`.
- `useEffect` tự quản `nguoiChinhId`: tự gỡ nếu người đó bị bỏ khỏi danh sách thành viên; tự
  chọn sẵn nếu danh sách chỉ còn đúng 1 người (đỡ 1 bước bấm khi task chỉ giao 1 người nhưng
  vẫn muốn dùng mục tiêu số lượng — hiếm nhưng hợp lệ).
- `handleSave` chặn lưu nếu đã nhập mục tiêu số lượng nhưng chưa chọn người chính.

### Trang chi tiết `/dashboard/kpi/tasks/[id]/page.tsx`

- Card "Người thực hiện" thêm badge tổng "Việc chung: X/N" (X = `evidenceLinks.length`, N =
  `muc_tieu_so_luong`) ngay cạnh tiêu đề card, kèm 1 dòng giải thích ngắn về ngưỡng của người
  chính.
- Mỗi member card: badge "Chính"/"Choàng" theo `phan_loai`; khi có mục tiêu số lượng, đổi hiển
  thị từ "Tự báo cáo: X%" sang "Đóng góp: X" (đếm qua `evidenceCountByUser`, gom từ
  `evidenceLinks` theo `member_user_id`), với người chính hiện thêm "/ N tối thiểu"
  (`chinhThreshold`); "Điểm A" (`tien_do_nghiem_thu`) tô đỏ nếu là người chính và điểm < 100%
  (dấu hiệu bị phạt), tô xanh emerald cho các trường hợp còn lại.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (3 file: `kpi-tasks.ts`, `kpi-task-form-modal.tsx`,
`kpi/tasks/[id]/page.tsx`), và `npm run build` đều sạch.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy migration trước

1. Chạy `supabase/migrations/20260725_kpi_task_quantity_target.sql` trên Supabase SQL Editor
   (migration này CHƯA từng chạy — nếu bỏ qua, mọi lần gắn bằng chứng cho task có/không có
   mục tiêu số lượng đều lỗi vì RPC cũ không còn khớp cột `muc_tieu_so_luong`/`phan_loai`).
2. Tạo lại đúng kịch bản gốc: giao "Đo 4 mẫu" cho 2 người (Nho = chính, Thọ = choàng) → xác
   nhận form hiện đúng ngưỡng preview (kỳ vọng 2, ngưỡng 1).
3. Đăng nhập Nho, gắn 1 bằng chứng → xác nhận task **VẪN MỞ** (không tự đóng), card hiện
   "Việc chung: 1/4", Nho "Đóng góp: 1 / 1 tối thiểu", Điểm A Nho tạm thời chưa hiện (task
   chưa xong nên `tien_do_nghiem_thu` vẫn NULL cho tới khi việc chung hoàn thành).
4. Đăng nhập Thọ, gắn 3 bằng chứng liên tiếp (tổng 4/4) → xác nhận task chuyển "Hoàn thành"
   NGAY sau lần gắn thứ 4 của TOÀN task (không phải của riêng Thọ). Card hiện đúng: Nho Đóng
   góp 1/1, Điểm A = 100% (1 ≥ ngưỡng 1); Thọ Đóng góp 3, Điểm A = 100% (choàng).
5. Test case phạt: tạo task khác cùng cấu hình, Nho (chính) đóng góp 0, Thọ (choàng) đóng góp
   đủ 4/4 → xác nhận việc chung vẫn Hoàn thành (đúng thiết kế — không chặn việc chung vì
   chính bỏ bê), nhưng Điểm A của Nho = 0% (tô đỏ), Điểm A Thọ = 100%.
6. Test task KHÔNG đặt mục tiêu số lượng (giữ nguyên hành vi cũ) — gắn 1 bằng chứng bất kỳ →
   xác nhận vẫn đóng thẳng "Hoàn thành" ngay như trước migration, không bị ảnh hưởng bởi thay
   đổi này (regression check).
7. Test edge case kỳ vọng < 1 (mục tiêu số lượng nhỏ hơn số thành viên, ví dụ mục tiêu 2 cho 3
   người) → xác nhận người chính không bị phạt vô lý (RPC có nhánh `v_nguong_chinh <= 0 →
   score = 100` phòng hờ chia 0).

## Cập nhật 2026-07-25 (tiếp 3) — Bug thật đã fix sau test tay lần 1: thanh tiến độ tổng sai
công thức + không đổi trạng thái + không hiện cho người giao

### Bug đã phát hiện qua test tay trên localhost

Người dùng giao "Đo 4 mẫu" cho Thọ (chính) và Nho (choàng), hạn 18:00 25/07/2026, **chỉ dùng
nút "Gắn & hoàn thành"** ở banner (không bao giờ dùng form "Cập nhật tiến độ"/"Nộp" thủ công).
Kết quả quan sát được qua nhiều bước (Nho đo 1 → Thọ đo 1 → Nho đo 1 nữa → Thọ đo 1 nữa):

- Thanh tiến độ hiện **sai số** ở mọi bước (vd sau khi Nho đo 1/4 mẫu, hiện 50% thay vì đúng
  25%; sau khi Thọ đo thêm 1 mẫu — tổng 2/4 — hiện 0% thay vì đúng 50%).
- Ảnh chụp thẻ task trong danh sách (`cung_cap_dl/mau.png`) cho thấy thanh tím gần như ĐẦY
  trong khi badge trạng thái vẫn ghi **"Mới giao"** — task chưa từng chuyển
  "Đang thực hiện" dù đã có người đo mẫu nhiều lần.
- Người giao việc mở trang chi tiết ("Việc của tôi") **luôn thấy đúng 1 giá trị cố định** bất
  kể hai người kia đã đo bao nhiêu mẫu; Thọ luôn thấy thanh tiến độ bằng 0 dù đã đo.

### Root cause 1 (đã xác nhận qua trace tay từng bước) — sai mẫu số của `tien_do`

Bản RPC đầu tiên (viết trong phiên trước) tính `tien_do` (raw, mỗi thành viên) theo công thức
`đóng góp của người đó / kỳ vọng CÁ NHÂN của họ` (`kỳ vọng = muc_tieu_so_luong / số thành viên
active`, vd 4/2=2 mỗi người) — **không phải** theo tổng mục tiêu chung. Hệ quả: mỗi người chạm
mốc 100% RẤT SỚM (chỉ cần đúng phần chia đều của họ, ở đây 2 mẫu/người) dù việc chung còn lâu
mới xong (cần đủ 4). `averageTaskProgress()` khi đó lại lấy TRUNG BÌNH CỘNG các giá trị này
qua số thành viên — 2 sai số cộng dồn khiến thanh hiển thị nhảy vọt/lệch hẳn khỏi tiến độ thật.

Đã trace tay khớp đúng 100% với 4 bước người dùng báo cáo khi đổi mẫu số:

- **Sửa 1 — `tien_do` chia cho TỔNG mục tiêu chung** (`v_task.muc_tieu_so_luong`, không phải
  `v_ky_vong`), áp dụng đồng nhất cho MỌI thành viên (cả chính lẫn choàng — khác hẳn
  `tien_do_nghiem_thu` của người chính, vẫn giữ nguyên công thức phạt riêng theo `v_ky_vong`).
  Vì mỗi người giờ có `tien_do = đóng góp của họ / TỔNG mục tiêu × 100`, CỘNG DỒN (SUM, không
  chia trung bình) qua tất cả thành viên active ra ĐÚNG % hoàn thành thật của cả việc — cộng
  tính chất cơ bản của phân số cùng mẫu số.
- **Sửa 2 — `averageTaskProgress(task, members)`** (`src/lib/kpi-tasks.ts`, đổi chữ ký nhận
  thêm `task`): khi `task.muc_tieu_so_luong !== null` → `SUM(tien_do)` (không chia số người);
  khi `null` (task thường) → giữ nguyên hành vi cũ (trung bình `tien_do_nghiem_thu ?? tien_do`).
  Verify lại đúng 4 bước gốc với công thức mới, muc_tieu=4, 2 người:
  - Nho đo 1 (choàng): Nho.tien_do=round(1/4×100)=25, Thọ.tien_do=0 → SUM=**25%** ✓ (đúng như
    người dùng kỳ vọng "phải là 25%").
  - Thọ đo 1 (chính, tổng 2/4): Nho.tien_do=25, Thọ.tien_do=25 → SUM=**50%** ✓.
  - Nho đo tiếp 1 (tổng 3/4): Nho.tien_do=50, Thọ.tien_do=25 → SUM=**75%** ✓.
  - Thọ đo tiếp 1 (tổng 4/4=đủ mục tiêu): SUM=**100%**, task chuyển Hoàn thành ✓.
- Trong khối "việc chung hoàn thành" của RPC, đã **bỏ việc ghi đè `tien_do=100` cho thành viên
  choàng** — chỉ còn ghi đè `tien_do_nghiem_thu=100` (Điểm A). Lý do: `tien_do` của mọi thành
  viên tại thời điểm hoàn thành đã tự động đúng và tự SUM ra 100% (chứng minh ở trên); ép riêng
  choàng thành 100 sẽ làm SUM vượt quá 100% (vd chính đóng góp 25% thật + choàng bị ép 100% =
  125%), làm sai thanh tiến độ tổng ngay tại thời điểm hoàn thành.

### Root cause 2 — task kẹt mãi "Mới giao" dù đã có bằng chứng

RPC nhánh mục tiêu số lượng trước đây **không bao giờ đụng `kpi_tasks.trang_thai`** cho tới
lúc hoàn thành hẳn — khác với nhánh task thường (`kpi_task_member_update`) vốn tự chuyển
"Đang thực hiện" ngay khi có cập nhật đầu tiên. Đã fix: thêm bước
`IF v_task.trang_thai IN ('moi_giao','tra_ve') THEN UPDATE ... trang_thai = 'dang_thuc_hien'`
ngay sau khi ghi log bằng chứng (trước khi tính `tien_do`), áp dụng cho MỌI lần gắn bằng chứng
đầu tiên của task, không chỉ lần đầu tiên tuyệt đối.

### Migration bị sửa trực tiếp, KHÔNG tạo file mới

`supabase/migrations/20260725_kpi_task_quantity_target.sql` (từ phiên trước) **CHƯA từng
chạy trên Supabase** (đã xác nhận ở phiên trước, ghi rõ "CHƯA CHẠY") — an toàn để sửa trực
tiếp file cũ thay vì tạo migration nối tiếp, đúng convention repo khi migration chưa áp dụng
lần nào (mirror cách xử lý `20260709_lot_predictions.sql` từng làm, xem
`.claude/rules/06-module-production.md` mục 4.6). Không tạo file
`20260725_kpi_task_quantity_target_v2.sql` hay tương tự.

### `src/lib/kpi-tasks.ts` — `averageTaskProgress()`

Chữ ký đổi từ `averageTaskProgress(members)` sang
`averageTaskProgress(task: Pick<KpiTask, "muc_tieu_so_luong">, members)`. Duy nhất 1 call site
trong repo (`src/app/dashboard/kpi/tasks/page.tsx`, thẻ task trong danh sách) — đã cập nhật
theo chữ ký mới.

### `/dashboard/kpi/tasks/[id]/page.tsx` — 3 thay đổi UI/UX bổ sung

1. **Thanh tiến độ tổng thật (không chỉ badge số)**: thêm 1 thanh bar tím ngay dưới tiêu đề
   card "Người thực hiện" (trên badge "Việc chung: X/N" đã có từ phiên trước) — dùng
   `averageTaskProgress(task, members)`, **hiện cho MỌI người xem** (giao/chính/choàng), không
   gate theo vai trò — trả lời trực tiếp yêu cầu "người giao việc phải thấy đc thanh tiến độ".
2. **Ẩn `ProgressForm` (form "Cập nhật tiến độ của bạn" thủ công) khi task có mục tiêu số
   lượng** — thay bằng 1 banner tím hướng dẫn ngắn giải thích tiến độ tự tính qua "Gắn bằng
   chứng", không cần tự nhập %. Lý do: form thủ công cho phép kéo slider % tùy ý rồi gọi RPC
   `kpi_task_member_update` — RPC đó ghi đè thẳng `tien_do` theo giá trị người dùng tự chọn,
   sẽ phá vỡ ngay công thức "SUM đúng bằng % hoàn thành thật" nếu ai đó lỡ dùng nhầm form này
   cho task mục tiêu số lượng. Chặn ở tầng UI (ẩn hẳn form) thay vì chỉ cảnh báo.
3. **Refetch khi tab quay lại `visible`/`focus`** (cả trang chi tiết lẫn trang danh sách
   `/dashboard/kpi/tasks`) — bằng chứng thường được gắn từ MODULE KHÁC (Điều xe/Sản
   lượng/Kiểm nghiệm/Kho nguyên liệu/Thành phẩm/Kiểm soát quá trình), không phải từ chính
   trang KPI — nếu người xem để tab KPI mở nền rồi quay lại mà không có cơ chế này, dữ liệu cũ
   trong React state sẽ không tự đổi. Đây là hướng xử lý phòng vệ cho phần "Đóng góp: 0" hiển
   thị sai sau khi Thọ đã đo mẫu (nghi ngờ do xem trang từ trước khi bằng chứng của Thọ kịp
   ghi nhận) — **chưa xác nhận chắc chắn đây là nguyên nhân duy nhất**, cần test lại sau fix.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (`kpi-tasks.ts`, `kpi/tasks/page.tsx`,
`kpi/tasks/[id]/page.tsx`), và `npm run build` đều sạch.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy lại migration đã sửa

Vì migration vẫn chưa từng chạy, chỉ cần chạy 1 lần bản mới nhất (không cần chạy 2 lần).

1. Chạy `supabase/migrations/20260725_kpi_task_quantity_target.sql` (bản đã sửa) trên
   Supabase SQL Editor.
2. Lặp lại đúng kịch bản test đã thất bại: giao "Đo 4 mẫu" cho Thọ (chính) + Nho (choàng) →
   Nho đo 1 → xác nhận thanh tiến độ (cả ở thẻ danh sách lẫn trang chi tiết) hiện đúng **25%**,
   badge trạng thái đổi từ "Mới giao" sang "Đang thực hiện".
3. Thọ đo 1 (tổng 2/4) → xác nhận thanh tiến độ **50%**; Thọ (đăng nhập chính mình) và giao
   việc (đăng nhập khác) đều thấy CÙNG 1 con số 50% (không còn lệch giữa các người xem).
4. Nho đo tiếp 1 (tổng 3/4) → **75%**. Thọ đo tiếp 1 (tổng 4/4) → **100%**, badge chuyển
   "Hoàn thành" ngay, Điểm A Nho=100% (choàng), Điểm A Thọ tính theo đóng góp thật của Thọ so
   ngưỡng (2 đóng góp / ngưỡng 1 = 100%, vì Thọ đã vượt ngưỡng tối thiểu).
5. Test case phạt lại (đã pass ở thiết kế công thức, cần xác nhận UI hiển thị đúng): chính chỉ
   đóng góp dưới ngưỡng, việc chung vẫn hoàn thành nhờ choàng bù đủ → xác nhận Điểm A của chính
   < 100% (tô đỏ), choàng vẫn 100%.
6. Xác nhận form "Cập nhật tiến độ của bạn" KHÔNG còn hiện ở task mục tiêu số lượng (thay bằng
   banner tím hướng dẫn); task KHÔNG đặt mục tiêu số lượng vẫn hiện form như cũ (regression
   check).
7. Test refetch-on-focus: mở trang chi tiết task ở 1 tab, để nền; ở thiết bị/tài khoản khác
   gắn thêm 1 bằng chứng; quay lại tab đầu (chuyển sang rồi focus lại) → xác nhận số liệu tự
   cập nhật KHÔNG cần bấm F5.

## Cập nhật 2026-07-25 (tiếp 4) — Bug thật đã fix: "Đóng góp" kẹt/mất do trùng `record_id`
cấp PHIẾU thay vì cấp MẪU trong module Kiểm soát quá trình

### Bug đã phát hiện qua test tay lần 2 (sau 2 fix ở "tiếp 2"/"tiếp 3")

Task "Đo 4 mẫu" (Thọ=chính, Nho=choàng): Nho đo mẫu 1/2/3 đều hiện "Đóng góp: 1" (không tăng
lên 2, 3); Thọ đo mẫu thứ 4 vẫn hiện "Đóng góp: 0" — dù khối "Nhật ký xử lý" ghi đủ **4** dòng
"Gắn bằng chứng" (3 của Nho lúc 18:38, 1 của Thọ lúc 18:42), tất cả cùng nhắc
"Phiếu đo nhanh MT-250726/003".

### Root cause — `record_id` dùng ID của cả PHIẾU, không phải từng DÒNG MẪU

`kpi_task_evidence_links` có `UNIQUE(task_id, module_code, record_id)` — đúng 1 bộ 3 khóa này
chỉ được tồn tại **1 dòng duy nhất** trong bảng, bất kể ai là người gắn (constraint không có
`member_user_id`). Đây là thiết kế ĐÚNG cho 5 module hook còn lại (Điều xe/Sản lượng/Kho
nguyên liệu: mỗi lần Lưu tạo 1 document/id MỚI; lưu lại document CŨ = cố ý dedupe, không
credit 2 lần cho cùng 1 hành động).

Nhưng `src/app/dashboard/process/measurements/page.tsx` (`handleSave()`) trước đây set
`recordId = editingSheetId` (nhánh "thêm mẫu vào phiếu đã có") / `recordId = sheetId` (nhánh
"tạo phiếu mới") — tức ID của CẢ PHIẾU (`quick_measurements` header), không phải ID từng dòng
`quick_measurement_rows` (mẫu) vừa lưu. Vì tính năng "thêm mẫu vào phiếu đã có" vốn được thiết
kế để **nhiều người cùng đo chung 1 phiếu trong ngày** (xem comment sẵn có trong chính file
này, mục "Cập nhật phiên 3" ở `.claude/rules/06-module-production.md`), MỌI lần lưu — dù của
Nho hay Thọ, dù mẫu thứ mấy — đều tạo ra CÙNG bộ khóa `(task_id, "process:measurement",
sheetId)`. Chỉ lần INSERT đầu tiên thành công; các lần sau `ON CONFLICT (task_id, module_code,
record_id) DO NOTHING` trong RPC `kpi_task_link_and_complete` âm thầm bỏ qua — **kể cả khi
người gắn là NGƯỜI KHÁC với đóng góp thật khác** (giải thích chính xác vì sao Thọ hiện
"Đóng góp: 0" dù đã đo — INSERT của Thọ bị conflict với dòng Nho đã tạo trước đó, chưa từng
được ghi). `kpi_task_logs` vẫn ghi đủ 4 dòng vì đó là INSERT không điều kiện, độc lập hoàn
toàn với evidence-link — giải thích tại sao log đúng nhưng "Đóng góp" (đếm từ
`kpi_task_evidence_links`) sai.

Đã rà thêm 5 module hook còn lại (Điều xe/Sản lượng/Kho nguyên liệu dùng ID document mới sinh
mỗi lần Lưu — không dính bug này). Kiểm nghiệm (`handleSaveBatch`/`handleImport`, dùng
`batchId` chung cho N lô trong 1 đợt) và Thành phẩm (2 luồng, cố ý chỉ lấy lô đầu tiên đại
diện) có cùng KIỂU giới hạn nhưng **chưa có bằng chứng lỗi thật** — người dùng đã xác nhận
**chỉ sửa Kiểm soát quá trình trong lần này**, không đụng 2 module kia.

### Fix — đổi granularity bằng chứng từ "phiếu" sang "từng dòng mẫu", không đổi schema

Không cần migration mới, không đổi `UNIQUE` constraint — mỗi dòng `quick_measurement_rows` có
`id` (UUID) do Postgres tự sinh, dùng ID DÒNG làm `record_id` sẽ không bao giờ trùng giữa 2
người/2 lượt khác nhau một cách tự nhiên, nên constraint hiện tại vẫn đúng vai trò "chặn
double-credit đúng 1 dòng bị gắn 2 lần" mà không cần sửa.

- `process/measurements/page.tsx`: 2 câu `.insert(rowPayloads)` (nhánh "tạo phiếu mới" và
  nhánh "thêm mẫu vào phiếu đã có") thêm `.select("id")` để lấy lại ID thật của TỪNG dòng vừa
  insert. `kpiPrompt` state đổi từ `{ recordId: string; recordLabel }` sang
  `{ recordId: string[]; recordLabel }` — set bằng `(insertedRows || []).map(r => r.id)`,
  `recordLabel` giữ nguyên theo phiếu (`Phiếu đo nhanh ${maPhieu}`) cho dễ đọc, chỉ khóa định
  danh (`record_id`) đổi cấp độ. Nhánh "sửa toàn bộ phiếu đã có" không đổi (không gọi
  `setKpiPrompt`, đúng từ trước — thuần chỉnh sửa dữ liệu cũ, không phải "đang làm việc mới").
- `src/app/dashboard/_components/kpi-link-prompt.tsx`: prop `recordId: string` đổi thành
  `recordId: string | string[]` — **backward-compatible**, 5 module hook còn lại vẫn truyền
  `string` đơn, không cần sửa gì ở các file đó. `handleConfirm()` chuẩn hoá thành mảng, lặp
  tuần tự gọi `linkKpiTaskEvidenceAndComplete()` cho từng id (cùng 1 `taskId` đã chọn 1 lần).
  Nếu 1 lần gọi giữa chừng lỗi đúng thông điệp chứa "đã kết thúc" (task vừa đạt đủ mục tiêu số
  lượng từ chính batch này) → dừng vòng lặp êm, không coi là lỗi thật (các bản ghi còn lại
  không cần gắn nữa vì việc đã đóng). Banner thành công khi gắn >1 bản ghi thêm hậu tố
  `"(đã gắn N/M bản ghi)"`.

### Dữ liệu test cũ đã hỏng — không migrate, cần task mới để test lại

Task "Đo 4 mẫu" (Thọ/Nho) hiện có đã mang `kpi_task_evidence_links` chỉ 1 dòng (do bug) và
`tien_do` các thành viên bị kẹt sai theo dữ liệu đó — fix code không tự "sửa lại quá khứ".
Không viết script sửa dữ liệu — cần tạo 1 task "Đo N mẫu" MỚI để test lại đúng kịch bản, hoặc
admin xóa/hủy task cũ nếu không cần giữ.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint kpi-link-prompt.tsx process/measurements/page.tsx`, và
`npm run build` đều sạch. Không cần chạy migration nào (không đổi schema).

### Test tay — kết quả (2026-07-25, trên localhost)

**Đã xác nhận PASS**: nhập nhiều mẫu vào CÙNG 1 phiếu (nhiều người/nhiều lượt) và nhập mẫu ở
CÁC PHIẾU TÁCH RIÊNG trong cùng ngày — cả 2 kịch bản đều hiển thị đúng tỷ lệ "Đóng góp"/thanh
tiến độ tổng. Bug chính (mục 1-2 dưới) coi như đã đóng.

**Còn lại — chưa xác nhận riêng, nên test thêm nếu có dịp**:

3. X thêm 2 dòng mẫu trong 1 lần Lưu (dùng nút "+ Thêm dòng" 2 lần rồi Lưu 1 lần) → xác nhận
   CẢ 2 dòng đều được tính (banner hiện "đã gắn 2/2 bản ghi"), "Đóng góp" của X tăng thêm đúng
   2, tổng tiến độ nhảy đúng theo số mẫu thật (không phải chỉ +1 như trước fix).
4. Trường hợp 1 lần Lưu nhiều dòng khiến task đạt đủ mục tiêu GIỮA vòng lặp (vd còn thiếu 1
   mẫu nhưng Lưu 1 lần 2 dòng) → xác nhận banner vẫn hiện đúng số đã gắn thành công, không báo
   lỗi dù dòng thứ 2 bị RPC từ chối vì task đã đóng ở dòng đầu.
5. Test 1 module khác (vd Điều xe, `recordId` vẫn truyền dạng string đơn) — xác nhận không có
   regression, "Gắn & hoàn thành" vẫn hoạt động bình thường (đổi API `KpiLinkPrompt` sang
   `string | string[]` không phá luồng cũ).

## Cập nhật 2026-07-25 (tiếp 5) — Fix qua static review: chặn Nghiệm thu/Điều chỉnh tay cho
việc mục tiêu số lượng + ngưỡng "chính" đổi FLOOR → CEIL (**cần chạy migration mới**)

Rà soát code (không phải test tay) phát hiện thêm 1 bug thật: `kpi_task_evaluate` (RPC xử lý
Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung) hoàn toàn không biết `kpi_tasks.muc_tieu_so_luong`
tồn tại. UI (`kpi/tasks/[id]/page.tsx`) hiển thị 4 nút này **vô điều kiện** cho người giao, kể
cả với việc mục tiêu số lượng chung — người giao có thể bấm "Nghiệm thu" tay cho từng thành
viên với điểm tùy ý, đóng thẳng cả task "Hoàn thành" ngay cả khi tổng bằng chứng thật CHƯA đạt
đủ mục tiêu, vô hiệu hóa hoàn toàn cơ chế công bằng vừa fix ở mục "tiếp 4" phía trên. Ví dụ: giao
"Đo 4 mẫu" cho Thọ (chính) + Nho (choàng), Nho mới gắn 1/4 mẫu (25% thật) — người giao lỡ bấm
"Nghiệm thu" cho cả 2 (điểm tùy chọn) → task nhảy "Hoàn thành" ngay dù thực tế mới 25%.

**Migration `supabase/migrations/20260726_kpi_task_evaluate_quantity_guard.sql` (CẦN CHẠY THỦ
CÔNG, CHƯA CHẠY)** — `CREATE OR REPLACE` lại cả 2 hàm (chữ ký không đổi, chỉ sửa thân hàm):

1. `kpi_task_evaluate`: thêm chặn cứng — nếu `v_task.muc_tieu_so_luong IS NOT NULL` và
   `p_hanh_dong IN ('nghiem_thu', 'dieu_chinh')` → `RAISE EXCEPTION`. "Trả về"/"Yêu cầu bổ sung"
   vẫn cho phép (không đụng `tien_do`/`tien_do_nghiem_thu`, chỉ đổi `trang_thai` của cả task).
   Điểm A/trạng thái hoàn thành của việc mục tiêu số lượng từ nay chỉ đi qua đúng 1 đường:
   `kpi_task_link_and_complete` (gắn bằng chứng).
2. `kpi_task_link_and_complete`: ngưỡng "chính" đổi từ `FLOOR(kỳ_vọng * 0.5)` sang
   `CEIL(kỳ_vọng * 0.5)` — theo yêu cầu người dùng "ngưỡng tối thiểu của người chính phải bằng
   hoặc lớn hơn 50% số việc". `FLOOR` có thể cho ra ngưỡng THẤP HƠN 50% thật khi kỳ vọng lẻ (vd
   kỳ_vọng=3 → `FLOOR(1.5)=1`, chỉ 33.3%; kỳ_vọng=5 → `FLOOR(2.5)=2`, chỉ 40%) — vi phạm đúng
   yêu cầu ">= 50%". `CEIL` đảm bảo toán học `ceil(x) >= x` nên luôn >= đúng 50%, chỉ có thể
   overshoot (kỳ_vọng=3 → `CEIL(1.5)=2` = 66.7%), không bao giờ undershoot. Nhánh "kỳ vọng < 1
   (nhiều thành viên hơn mục tiêu) → chính tự động đạt" tách thành `IF v_ky_vong < 1 THEN` riêng
   thay vì suy ra từ "ngưỡng <= 0" như bản cũ — vì `CEIL` không bao giờ cho ra ngưỡng <= 0 với kỳ
   vọng dương (khác `FLOOR`, có thể ra 0).

**`src/lib/kpi-tasks.ts`'s `computeChinhThreshold()`** đổi theo đúng công thức CEIL mới (dùng để
hiển thị preview ngưỡng ở form tạo việc và trang chi tiết, không round-trip DB).

**`kpi/tasks/[id]/page.tsx`**: 2 nút "Nghiệm thu"/"Điều chỉnh" trong khối hành động của mỗi
thành viên giờ chỉ hiện khi `task.muc_tieu_so_luong === null` — với việc mục tiêu số lượng,
thay bằng dòng chữ nhỏ "Điểm tự tính qua gắn bằng chứng — không nghiệm thu/điều chỉnh tay". Nút
"Trả về"/"Yêu cầu bổ sung" giữ nguyên, luôn hiện.

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay** — cần: chạy
migration trên Supabase SQL Editor trước; tạo 1 việc mục tiêu số lượng, xác nhận 2 nút "Nghiệm
thu"/"Điều chỉnh" không còn hiện cho thành viên của việc đó (chỉ còn "Trả về"/"Yêu cầu bổ sung");
thử gọi thẳng RPC `kpi_task_evaluate` với `p_hanh_dong='nghiem_thu'` cho 1 task có
`muc_tieu_so_luong` (qua devtools) → phải bị chặn đúng lỗi mới; xác nhận việc KHÔNG có mục tiêu
số lượng vẫn Nghiệm thu/Điều chỉnh bình thường (regression check).

## Cập nhật 2026-07-25 (tiếp 6) — Ngưỡng "chính" sửa LẦN 2: tính trên TỔNG mục tiêu, không chia
theo số người (test tay lần 1 của mục "tiếp 5" cho kết quả chưa đúng ý)

Test tay bản "CEIL(kỳ vọng cá nhân × 0.5)" ở mục "tiếp 5" cho đúng kịch bản: mục tiêu 3 mẫu, 2
thành viên (Thọ=chính, Nho=choàng) — ngưỡng hiển thị vẫn ra **1** (kỳ vọng mỗi người = 3/2 = 1.5,
`CEIL(1.5×0.5)=CEIL(0.75)=1`), tức chỉ 33% TỔNG mục tiêu, không đạt "≥ 50% số việc" như yêu cầu.
Nguyên nhân: công thức đó lấy 50% của "kỳ vọng cá nhân" (mục tiêu chia đều cho số người), nên
nhóm càng đông người thì ngưỡng thật của người chính so với TỔNG việc càng tụt xuống thấp (case
cực đoan: mục tiêu 4 chia 10 người choàng, kỳ vọng mỗi người 0.4 < 1 → chính coi như auto-pass dù
0 đóng góp).

**Đã sửa lại đúng theo yêu cầu gốc**: ngưỡng của "chính" giờ tính thẳng trên TỔNG
`muc_tieu_so_luong`, **không** chia theo số thành viên nữa — `ngưỡng = CEIL(muc_tieu_so_luong ×
0.5)`. Người chính phải luôn tự đóng góp ít nhất một nửa TOÀN BỘ việc, bất kể có bao nhiêu người
choàng hỗ trợ. Với ví dụ trên: ngưỡng = `CEIL(3×0.5) = 2` (66.7% tổng, đạt yêu cầu ≥50%).

Vì `muc_tieu_so_luong` luôn nguyên dương (`CHECK > 0`), `CEIL(x×0.5)` luôn ≥ 1 — bỏ hẳn nhánh đặc
biệt "kỳ vọng < 1 → auto-pass" của bản trước (khái niệm "kỳ vọng cá nhân" không còn dùng cho công
thức này nữa).

- **Migration `20260726_kpi_task_evaluate_quantity_guard.sql` được SỬA TRỰC TIẾP** (không tạo file
  mới) — an toàn vì `CREATE OR REPLACE FUNCTION` là idempotent, chạy lại file này (dù trước đó đã
  chạy bản "kỳ vọng cá nhân" hay chưa từng chạy) đều cho đúng kết quả cuối cùng. **Vẫn cần chạy
  (lại) file này trên Supabase SQL Editor.**
- `kpi_task_link_and_complete`: bỏ hẳn biến `v_active_count`/`v_ky_vong` (không còn dùng ở đâu
  trong hàm) — `v_nguong_chinh := CEIL(v_task.muc_tieu_so_luong::numeric * 0.5)` tính thẳng, không
  qua bước chia số người.
- `src/lib/kpi-tasks.ts`'s `computeChinhThreshold()` đổi chữ ký — bỏ tham số `activeMemberCount`
  (không còn cần thiết): `computeChinhThreshold(mucTieuSoLuong: number): number`. Cả 2 call site
  (`kpi-task-form-modal.tsx`, `kpi/tasks/[id]/page.tsx`) đã cập nhật theo chữ ký mới; biến
  `activeMemberCount` ở trang chi tiết đã bỏ hẳn (không còn nơi nào dùng).
- Text giải thích ở form tạo việc (`kpi-task-form-modal.tsx`) đổi từ "50% phần việc kỳ vọng của
  họ" sang "50% TỔNG mục tiêu"; dòng preview ngưỡng đổi từ "(trên tổng X, chia Y người)" sang
  "(= 50% làm tròn lên của tổng X)".

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch.

### Test tay — kết quả (2026-07-26)

**Đã chạy migration `20260726_kpi_task_evaluate_quantity_guard.sql` trên Supabase, đã xác nhận
PASS đúng kịch bản gốc** (mục tiêu 3 mẫu/2 người) — ngưỡng của người chính hiển thị đúng **2**
(không còn 1), khớp yêu cầu "≥ 50% tổng số việc". Coi bug ngưỡng "chính" là đã đóng.

**Còn lại — chưa xác nhận riêng, nên test thêm nếu có dịp** (không chặn tiếp tục các việc khác):

- Case đông người (vd mục tiêu 4, 5 người) → ngưỡng phải ra `CEIL(4×0.5)=2`, không tụt xuống 1
  hay 0 chỉ vì nhóm đông.
- Case cũ "kỳ vọng < 1" (nhiều thành viên hơn mục tiêu, vd mục tiêu 2 cho 5 người) → xác nhận
  không còn auto-pass ngầm, chính vẫn cần đóng góp `CEIL(2×0.5)=1` để đạt 100%.
- 2 nút "Nghiệm thu"/"Điều chỉnh" (mục "tiếp 5") — xác nhận đã biến mất khỏi thành viên của việc
  mục tiêu số lượng, chỉ còn "Trả về"/"Yêu cầu bổ sung"; thử gọi thẳng RPC `kpi_task_evaluate`
  với `p_hanh_dong='nghiem_thu'` cho task có `muc_tieu_so_luong` (qua devtools) → phải bị chặn.
- Task KHÔNG đặt mục tiêu số lượng vẫn Nghiệm thu/Điều chỉnh bình thường (regression check).

## Fix nhỏ 2026-07-25 — Bell badge "Việc chờ nghiệm thu" cho admin

Đã xác nhận qua trao đổi trực tiếp với người dùng (2 câu hỏi quyết định trước khi
code tiếp Phase 1b):

- Bell badge: `getKpiTasks()` đếm `approvalCount` gồm cả task mà admin KHÔNG phải
  `nguoi_giao_id` (admin thấy toàn bộ hàng chờ duyệt qua `isAdmin` OR-condition có
  sẵn), nhưng link luôn trỏ `?tab=mine` — admin bấm vào không thấy đúng việc đó
  trong tab "Việc của tôi" (`visibleTasks` lọc theo `nguoi_giao_id === user.id ||
  myActiveTaskIds.has(t.id)`, không có nhánh admin-thấy-tất-cả). Đã fix: thêm biến
  `approvalLink` — `isAdmin` → `?tab=all`, còn lại giữ `?tab=mine` như cũ. Chỉ đổi
  link của đúng 1 item "Việc chờ nghiệm thu"; 3 item còn lại (`pendingCount`,
  `dueSoonCount`, `overdueCount`) không có vấn đề tương tự (đều lọc theo
  `iAmMember || iAmGiver`, không có nhánh admin-mở-rộng) nên giữ nguyên `?tab=mine`.
- `kpi.evaluate` permission (đã seed/khai báo nhưng chưa nơi nào dùng để gate —
  Nghiệm thu/Điều chỉnh/Trả về hiện chỉ cho `nguoi_giao_id` hoặc admin): **xác nhận
  đây là cố ý, giữ nguyên không dùng permission này** — không mở rộng thêm ai khác
  ngoài đúng người giao việc/admin được xử lý các bước này, dù họ có được cấp
  `kpi.evaluate` hay không. Không cần sửa gì thêm cho quyết định này.

## Cập nhật Phase 1b (2026-07-25) — Chuyển giao việc (`kpi_task_transfers`), đã code xong

Migration `supabase/migrations/20260727_kpi_task_transfers.sql` (**cần chạy thủ
công**, chưa chạy) — theo đúng schema đã phác thảo ở mục "Database Schema" phía
trên, không lệch cột nào.

### RLS quan trọng — người được mời (chưa chấp nhận) phải xem được task

`kpi_tasks_select` trước đây chỉ cho người giao/active member/admin/`kpi.view_all`
đọc — người đang được mời chuyển giao (`den_nguoi_id`, CHƯA phải active member cho
tới khi họ bấm "Chấp nhận") sẽ bị chặn xem trang chi tiết (`fetchKpiTaskDetail`
báo "Không tìm thấy công việc") đúng lúc họ cần xem để quyết định phản hồi. Đã
thêm hàm `SECURITY DEFINER` mới `kpi_is_task_pending_transfer_target(task_id,
user_id)` (mirror `kpi_is_task_owner`/`kpi_is_task_active_member`, tránh vòng
tham chiếu chéo RLS giữa `kpi_tasks` và `kpi_task_transfers`) và OR thêm điều
kiện này vào `kpi_tasks_select` (DROP + CREATE lại policy). Không đụng
`kpi_task_members_select`/`kpi_task_logs_select` — người được mời chưa có dòng
`kpi_task_members` nào nên không cần mở rộng 2 policy đó (đúng, vì họ chưa "làm"
gì trên task để cần xem log/evidence).

### 3 RPC `SECURITY DEFINER`

- `kpi_task_transfer_request(p_task_id, p_den_nguoi_id, p_ghi_chu)` — chỉ chính
  người đang là thành viên `is_active=true` gọi được cho chính mình
  (`auth.uid()`, không tin tham số). Chặn: task đã `hoan_thanh`/`huy`, đã quá
  `han_hoan_thanh`, `kpi_tasks.da_chuyen_giao=true` (mỗi task chỉ chuyển 1 lần —
  đúng cột đã có sẵn từ Phase 1a, trước đó chưa được RPC nào dùng tới), chuyển cho
  chính mình, người nhận không active/khác nhà máy, người nhận đã là active
  member, hoặc đã có 1 yêu cầu `cho_duyet` khác từ chính người gửi cho đúng task
  đó. Trả về `id` của dòng vừa tạo.
- `kpi_task_transfer_respond(p_transfer_id, p_chap_nhan)` — chỉ chính
  `den_nguoi_id = auth.uid()`. Từ chối: chỉ đổi `trang_thai='tu_choi'`. Chấp
  nhận: hạ `is_active=false` dòng `kpi_task_members` của `tu_nguoi_id`, upsert
  dòng cho `den_nguoi_id` (insert mới hoặc update lại nếu đã tồn tại dòng cũ do
  UNIQUE(task_id,user_id) — hiếm nhưng xử lý an toàn cả 2 nhánh), **giữ nguyên
  `phan_loai`** của dòng gốc (chính/choàng gắn với bản chất việc, không phải
  người — đúng quyết định đã ghi sẵn trong plan gốc), set
  `kpi_tasks.da_chuyen_giao=true`, ghi 1 dòng `kpi_task_logs` hành động mới
  `'chuyen_giao'` (`member_user_id = nguoi_thuc_hien_id = den_nguoi_id`, tự resolve
  tên người gửi qua `profiles.full_name`/`username` để nhúng vào `noi_dung`).
- `kpi_task_transfer_cancel(p_transfer_id)` — chỉ chính `tu_nguoi_id = auth.uid()`,
  chỉ khi còn `cho_duyet` — cho phép người gửi tự rút lại yêu cầu trước khi có
  phản hồi (không có trong plan gốc, thêm vì UX: nếu không có cách hủy, 1 yêu cầu
  gửi nhầm sẽ chặn vĩnh viễn khả năng gửi yêu cầu khác cho tới khi người kia phản
  hồi). Dùng chung giá trị `trang_thai='tu_choi'` với nhánh từ chối của người nhận
  — phân biệt bằng RPC nào được gọi, không thêm trạng thái thứ 4 vào CHECK
  constraint.
- Thêm `'chuyen_giao'` vào CHECK constraint `kpi_task_logs.hanh_dong` (DROP +
  ADD CONSTRAINT, cùng kỹ thuật đã dùng ở `20260725_kpi_task_evidence_links.sql`).

### `src/lib/kpi-tasks.ts`

Thêm `KpiTransferStatus`, `KpiTaskTransfer`, `requestKpiTaskTransfer()`,
`respondKpiTaskTransfer()`, `cancelKpiTaskTransfer()`, `fetchTaskTransfers(taskId)`
(toàn bộ yêu cầu của 1 task, mọi trạng thái), `fetchPendingIncomingTransfers(userId)`
(chỉ `cho_duyet`, dùng cho Bell + danh sách). `KpiTaskLogAction`/`KPI_ACTION_LABEL`
thêm `chuyen_giao: "Chuyển giao"`.

### UI trang chi tiết (`kpi/tasks/[id]/page.tsx`)

- Component mới `TransferModal` (mirror `EvaluateModal`) — `<select>` chọn người
  nhận từ `candidates` đã loại trừ các active member hiện tại, ô ghi chú tuỳ chọn.
- Banner tím đầu trang (dưới card thông tin task, trên card "Người thực hiện") khi
  `myIncomingTransfer` tồn tại (tôi là `den_nguoi_id` của 1 yêu cầu `cho_duyet`) —
  hiện tên người gửi, tiến độ giữ nguyên, ghi chú, 2 nút Chấp nhận/Từ chối.
- Mỗi dòng member: nếu có yêu cầu `cho_duyet` đang chờ do đúng người đó gửi
  (`outgoingTransferByMember`, map theo `tu_nguoi_id`) → hiện dòng nhỏ "Đang chờ
  {tên} phản hồi", kèm nút "Hủy yêu cầu" nếu đó là chính mình. Nút "Chuyển giao"
  (mở `TransferModal`) chỉ hiện cho `isMe && m.is_active && open &&
  !task.da_chuyen_giao && !outTransfer` — độc lập với khối nút
  Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung (khối đó vẫn chỉ dành cho
  `isOwner`, không đổi).
- Refetch on focus/visibility (đã có sẵn từ Phase 1a.1) tự động bao gồm
  `fetchTaskTransfers` — không cần thêm effect riêng.

### UI danh sách (`kpi/tasks/page.tsx`)

- `pendingIncomingTaskIds` (Set, từ `fetchPendingIncomingTransfers(uid)`) được
  OR thêm vào điều kiện lọc tab "mine" (`visibleTasks`) — nếu không, người được
  mời (chưa phải active member) sẽ không thấy task đó trong "Việc của tôi" dù RLS
  đã cho phép họ đọc được, và link Bell `?tab=mine` sẽ dẫn tới danh sách trống
  đúng việc họ cần xử lý.
- Card task có badge tím nhỏ "Có lời mời chuyển giao chờ bạn phản hồi" khi
  `pendingIncomingTaskIds.has(t.id)`.

### Bell (`module-tasks.ts`)

Thêm item "Lời mời chuyển giao chờ phản hồi" — đếm qua
`kpi_task_transfers` (`den_nguoi_id=uid AND trang_thai='cho_duyet'`, `count:
"exact", head: true`), độc lập với vòng lặp `kpi_tasks` hiện có (vì người được
mời chưa có dòng `kpi_task_members` active nên không lọt qua các item khác). Link
`?tab=mine` — hoạt động đúng nhờ thay đổi ở `visibleTasks` nêu trên.

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch (đã chạy sau khi hoàn
tất cả 5 phần: migration, `kpi-tasks.ts`, trang chi tiết, trang danh sách, Bell).

### Test tay — kết quả (2026-07-26)

**Đã chạy migration `20260727_kpi_task_transfers.sql` trên Supabase, đã test trên
localhost: chuyển giao và chấp nhận/từ chối hoạt động đúng như ý.** Coi luồng
chính (gửi yêu cầu → chấp nhận → dữ liệu chuyển đúng người; gửi yêu cầu → từ chối
→ giữ nguyên người cũ) là đã xác nhận, không cần lặp lại.

**Còn lại — chưa xác nhận riêng, nên test thêm nếu có dịp** (không chặn tiếp tục
các việc khác): mục 5 ("Hủy yêu cầu" tự rút lại trước khi có phản hồi), mục 6
(chặn đúng khi quá hạn/`da_chuyen_giao=true`), mục 7 (số đếm Bell chính xác), mục
8 (race 2 yêu cầu chuyển giao đồng thời trên task nhiều thành viên).

1. Chạy `supabase/migrations/20260727_kpi_task_transfers.sql` trên Supabase SQL
   Editor.
2. Đăng nhập tài khoản A (đang là active member 1 task một-lần, còn hạn, chưa
   `da_chuyen_giao`) → bấm "Chuyển giao" → chọn tài khoản B → gửi → xác nhận dòng
   member của A hiện "Đang chờ B phản hồi" + nút "Hủy yêu cầu"; nút "Chuyển giao"
   biến mất trong lúc đang chờ.
3. Đăng nhập tài khoản B → vào `/dashboard/kpi/tasks?tab=mine` → xác nhận thấy
   đúng task đó kèm badge "Có lời mời chuyển giao chờ bạn phản hồi" (dù B CHƯA
   phải active member) → mở chi tiết → xác nhận banner tím hiện đúng tên A + tiến
   độ giữ nguyên → bấm "Chấp nhận" → xác nhận: dòng A chuyển "Đã chuyển giao"
   (mờ, `is_active=false`), dòng B xuất hiện active với đúng tiến độ đã giữ, badge
   `phan_loai` (nếu có) giữ nguyên như của A, `kpi_tasks.da_chuyen_giao=true`
   (nút "Chuyển giao" không còn khả dụng cho B nữa), timeline có dòng "Chuyển
   giao — Đã nhận chuyển giao từ {tên A}".
4. Test nhánh Từ chối: lặp lại bước 2-3 nhưng B bấm "Từ chối" → xác nhận A vẫn còn
   active với tiến độ cũ, `da_chuyen_giao` vẫn `false`, nút "Chuyển giao" của A
   xuất hiện lại (được gửi yêu cầu mới).
5. Test "Hủy yêu cầu" (A tự hủy trước khi B phản hồi) → xác nhận trạng thái quay
   về như trước khi gửi, A gửi lại được yêu cầu khác.
6. Test chặn: task đã quá `han_hoan_thanh` → nút "Chuyển giao" không hiện (do
   `open` check ở tầng `isTaskOpen`, cần xác nhận cả trường hợp `open=true`
   nhưng đã quá hạn — RPC vẫn phải tự chặn nếu bằng cách nào đó nút vẫn hiện);
   task đã `da_chuyen_giao=true` (sau bước 3) → không ai còn thấy nút "Chuyển
   giao" nữa dù đổi sang tài khoản khác đang active member (task multi-member).
7. Test Bell: tài khoản B trước khi vào trang chi tiết → xác nhận badge "Lời mời
   chuyển giao chờ phản hồi" hiện đúng số ở mọi route `/dashboard/kpi*`.
8. Test task nhiều thành viên: 2 người cùng active, cả 2 cùng gửi yêu cầu chuyển
   giao cho 2 người khác nhau gần như đồng thời → người nhận đầu tiên chấp nhận
   trước → xác nhận `da_chuyen_giao=true` → người nhận thứ 2 bấm "Chấp nhận" →
   phải bị chặn với lỗi "Công việc này đã được chuyển giao trước đó."; yêu cầu
   thứ 2 vẫn ở trạng thái `cho_duyet` treo lại (không tự động huỷ) — xác nhận đây
   là hành vi chấp nhận được, không phải bug (người giao/admin cần biết để xử lý
   tay nếu cần).

## Cập nhật (2026-07-26) — Việc định kỳ theo nhóm + Người thay thế tạm thời, đã code xong

Migration `supabase/migrations/20260728_kpi_task_templates.sql` (**cần chạy thủ
công, chưa chạy**) — theo đúng schema đã phác thảo ở plan gốc, với 1 lệch có chủ
đích: **KHÔNG có cột `auto_action_type`**. Mục "Tự động hoàn thành khi có thao tác
nghiệp vụ khớp" (mục 3 của plan gốc) đã bị loại bỏ hoàn toàn khỏi thiết kế module
từ trước (thay bằng "Gắn bản ghi tại chỗ", Phase 1a.1) — task sinh từ template
hoạt động HỆT task tạo tay một-lần: người phụ trách tự thao tác ở đúng module
nghiệp vụ rồi bấm "Gắn & hoàn thành" ở banner (`KpiLinkPrompt` đã tự tìm mọi task
đang mở của họ qua `fetchOpenKpiTasksForUser`, không phân biệt nguồn gốc task) —
không cần thêm cơ chế tự động riêng cho việc định kỳ.

### Schema

- `kpi_task_templates` — `group_id` (nhóm quyết định phân loại chính/choàng, KHÔNG
  bắt buộc người nhận phải thuộc nhóm này), `assigned_user_id` (người nhận cố
  định), `tieu_de`/`mo_ta`, `apply_weekdays INTEGER[]` (1=Thứ 2..7=CN, ISODOW),
  `gio_han TIME` (hạn trong ngày), `yeu_cau_bao_cao`, `is_active`, `created_by`.
  RLS: SELECT rộng trong factory (minh bạch); INSERT/UPDATE/DELETE chỉ
  `kpi.manage_config`/admin (seed hiện tại: chỉ `admin` có quyền này, `manager`
  không).
- `kpi_user_substitutions` — `original_user_id`/`substitute_user_id`,
  `template_id` NULL (áp dụng mọi việc định kỳ của người đó) hoặc có giá trị (chỉ 1
  việc cụ thể), `tu_ngay`/`den_ngay`, `ly_do`, `created_by`. RLS SELECT mở rộng
  hơn plan gốc: thêm `created_by = auth.uid()` (không chỉ
  `original_user_id`/`substitute_user_id`/admin/`kpi.view_all`) — để người có
  `kpi.assign` đăng ký HỘ người khác vẫn xem/hủy lại được đăng ký đó sau này, nếu
  không họ sẽ mất quyền nhìn thấy chính đăng ký mình vừa tạo. INSERT: tự đăng ký
  (`original_user_id = auth.uid()`) hoặc admin/`kpi.assign` đăng ký hộ. DELETE:
  `original_user_id`/`created_by`/admin.
- `kpi_tasks.template_id` (nullable, `ON DELETE SET NULL` — xóa template không xóa
  lịch sử task/log đã sinh ra từ nó) + unique index `(template_id, ngay_giao) WHERE
  template_id IS NOT NULL` — chặn sinh trùng cho cùng 1 ngày.

### RPC "sinh lười" `kpi_ensure_today_task_instances(p_factory_id)`

`SECURITY DEFINER`, gọi được bởi bất kỳ profile active nào của đúng nhà máy
(không cần quyền đặc biệt — đây là thao tác "hộ hệ thống"). Với mỗi template
active có `EXTRACT(ISODOW FROM CURRENT_DATE)` nằm trong `apply_weekdays` và chưa
sinh cho hôm nay:

1. Resolve người thay thế — ưu tiên dòng `kpi_user_substitutions` khớp đúng
   `template_id` cụ thể hơn dòng `NULL` (áp dụng chung), trong khoảng
   `tu_ngay <= hôm nay <= den_ngay`. Không có dòng nào khớp → dùng
   `template.assigned_user_id` gốc.
2. Tính `phan_loai` (chính/choàng) bằng cách so `template.group_id` với nhóm
   `is_primary=true` HIỆN TẠI của **người cuối cùng nhận việc** (người thay thế
   nếu có — đúng người thực sự làm việc hôm đó, không phải người gốc).
3. Sinh mã `CV-ddmmyy/XXX` theo đúng counter tuần tự dùng chung với task tạo tay
   (đếm `LIKE prefix/%` trong `kpi_tasks`, không phải mã riêng cho task định kỳ) —
   để task định kỳ và task một-lần cùng chia sẻ 1 dãy số liền mạch, dễ theo dõi.
4. INSERT `kpi_tasks` (`nguoi_giao_id = template.created_by`,
   `han_hoan_thanh = hôm nay lúc gio_han`) + `kpi_task_members` (1 dòng, đúng
   `user_id`/`phan_loai` đã resolve).

Gọi ở đâu: `dashboard/layout.tsx` bootstrap, effect riêng phụ thuộc
`user?.id`/`user?.factory_id` — dynamic `import("@/lib/kpi-templates")` (tránh kéo
thêm code vào bundle chính cho user không dùng module KPI), cờ `sessionStorage`
`kpi_ensured_${factory_id}_${todayISO}` để đỡ round-trip khi mở nhiều trang trong
cùng ngày (RPC tự idempotent qua unique index nên gọi lặp không hại, cờ chỉ tối
ưu). Lỗi bị nuốt im lặng (`.catch(() => {})`) — không được làm chậm/gãy bootstrap
chính.

### `src/lib/kpi-templates.ts` (file mới, tách riêng khỏi `kpi-tasks.ts` đã khá lớn)

Types `KpiTaskTemplate`/`KpiUserSubstitution`/`KpiGroupOption`, hằng số
`KPI_WEEKDAY_OPTIONS`/`KPI_WEEKDAY_LABEL`, CRUD đầy đủ cho cả 2 bảng,
`loadAllPersonnelGroups(factoryId)` (mọi nhóm active — khác
`loadKpiTaskCandidates().groups` vốn lọc chỉ nhóm có thành viên đã liên kết
profile, không phù hợp cho dropdown "Nhóm" của template vì nhóm mới tạo có thể
chưa có ai), `ensureTodayKpiTaskInstances(factoryId)` (wrapper RPC, ném lỗi bình
thường — caller ở `layout.tsx` tự `.catch(() => {})`).

### UI

- `kpi-shell.tsx` thêm tab "Việc định kỳ" (icon `Repeat`) trỏ
  `/dashboard/kpi/templates` — luôn hiển thị (không ẩn theo quyền ở tầng shell,
  trang tự gate nội dung bên trong).
- `/dashboard/kpi/templates/page.tsx` — gate cơ bản `kpi.view` (như mọi trang
  KPI khác), 2 sub-tab:
  - **"Việc định kỳ"**: danh sách card (nhóm, người nhận, tiêu đề, chip 7 thứ,
    giờ hạn, yêu cầu báo cáo, trạng thái Đang áp dụng/Tạm ngưng) — CRUD (Thêm/
    Sửa/Tạm ngưng-Kích hoạt lại/Xóa) chỉ hiện khi `canManageTemplates` (admin
    hoặc `kpi.manage_config`); người không có quyền vẫn xem được danh sách
    (minh bạch, không có nút thao tác).
  - **"Người thay thế tạm thời"**: danh sách đăng ký (người đi vắng → người thay
    thế, khoảng ngày, phạm vi áp dụng, lý do), nút "Đăng ký" luôn hiện cho mọi
    người (tự đăng ký cho chính mình); dropdown "Người đi vắng" chỉ mở khóa chọn
    người khác khi `canChooseOriginal` (admin/`kpi.assign`), còn lại khóa cứng =
    chính mình. Nút "Hủy đăng ký" mỗi dòng chỉ hiện khi
    `isAdmin || original_user_id === mình || created_by === mình`.
  - `TemplateFormModal`/`SubstitutionFormModal` (2 file trong
    `templates/_components/`) — mirror phong cách `KpiTaskFormModal` đã có.
    `SubstitutionFormModal` có 2 effect tự reset: bỏ chọn template không còn
    khớp `originalUserId` mới, và gỡ `substituteUserId` nếu trùng
    `originalUserId` sau khi đổi (tránh bug `<select>` hiển thị sai do value
    không khớp option nào — đã ghi trong `feedback_code.md`).

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa), và `npm run build`
đều sạch — `/dashboard/kpi/templates` build thành công (static).

### Chưa test tay — cần làm ở phiên sau

1. Chạy `supabase/migrations/20260728_kpi_task_templates.sql` trên Supabase SQL
   Editor.
2. Admin tạo 1 việc định kỳ thuộc nhóm "Đội xe cơ khí", giao cho 1 người CÓ nhóm
   chính KHÁC nhóm đó (test nhãn "choàng" khi sinh), thứ áp dụng gồm hôm nay,
   giờ hạn bất kỳ → mở app bằng TÀI KHOẢN BẤT KỲ (không cần là người được giao)
   → xác nhận `kpi_tasks` hôm nay tự sinh đúng 1 task (kiểm tra qua
   `/dashboard/kpi/tasks?tab=all` nếu có quyền, hoặc trực tiếp DB), mở lại nhiều
   lần/nhiều tài khoản không tạo trùng.
3. Sửa nhóm chính của người được giao khớp đúng `group_id` của template rồi xóa
   task hôm nay (hoặc đợi sang ngày khác) → mở app lại → xác nhận task mới sinh
   ra có `phan_loai='chinh'`.
4. Test "về tua": đăng ký `kpi_user_substitutions` cho người đang được giao,
   khoảng ngày phủ từ NGÀY MAI (để không ảnh hưởng task hôm nay đã sinh trước
   khi đăng ký — đúng thiết kế, sửa riêng ngày đó phải dùng "Chuyển giao" ở
   Phase 1b), người thay thế là ai đó khác → giả lập/đợi sang ngày mai, đăng
   nhập TRƯỚC người thay thế mở app → xác nhận instance hôm đó sinh thẳng cho
   người thay thế, `phan_loai` tính theo nhóm chính của NGƯỜI THAY THẾ (không
   phải người gốc). Hết `den_ngay` → xác nhận ngày kế tiếp tự quay lại đúng
   người gốc.
5. Test đăng ký thay thế giới hạn 1 template cụ thể (`template_id` có giá trị) —
   xác nhận chỉ đúng việc định kỳ đó bị ảnh hưởng, các việc định kỳ khác của
   cùng người gốc vẫn sinh bình thường cho người gốc.
6. Test quyền: tài khoản `role=user` không có `kpi.manage_config` → vào tab
   "Việc định kỳ" vẫn xem được danh sách nhưng không thấy nút Thêm/Sửa/Xóa; vẫn
   tự đăng ký "Người thay thế" được cho chính mình (dropdown "Người đi vắng"
   khóa cứng = chính họ).
7. Test xóa 1 template đã từng sinh task — xác nhận các task/log lịch sử cũ vẫn
   còn nguyên (không bị xóa theo), chỉ không sinh thêm task mới từ ngày mai.
8. Đăng nhập đúng người đang phụ trách (gốc hoặc thay thế) của 1 task định kỳ đã
   sinh → vào đúng module nghiệp vụ tương ứng thao tác lưu 1 bản ghi → xác nhận
   banner "Gắn & hoàn thành" xuất hiện đúng như task một-lần bình thường, gắn
   xong task chuyển "Hoàn thành".

## Kế hoạch phiên sau (2026-07-26, tiếp) — Bug/hiểu lầm thật đã phát hiện khi test tay đầu tiên

Người dùng test ngay sau khi code xong (chưa chạy migration `20260728_...` — chỉ
mới đọc code/suy luận, **CHƯA verify bằng dữ liệu DB thật**) và báo lại 2 tình
huống. Cả 2 đều **có lời giải thích hợp lý từ chính logic RPC đã viết**, nhưng
**session này chưa xác nhận bằng cách query DB thật** — việc đầu tiên của phiên
sau là xác nhận đúng nguyên nhân trước khi sửa bất cứ gì.

### Tình huống 1 — "Chưa biết phân việc tự động hay phải lãnh đạo kích hoạt; vừa
tạo xong, đăng xuất/đăng nhập lại liệu có tác dụng không?"

**Trả lời từ code**: phân việc là **hoàn toàn tự động, không có bước "kích
hoạt"** — bất kỳ ai (không riêng lãnh đạo) mở 1 trang Dashboard bất kỳ trong
ngày sẽ tự kích `kpi_ensure_today_task_instances` qua effect trong
`dashboard/layout.tsx`.

Nhưng: **đăng xuất rồi đăng nhập lại KHÔNG có tác dụng re-trigger**, vì cờ chặn
gọi lặp là `sessionStorage` (`kpi_ensured_${factory_id}_${todayISO}`) — cờ này
sống theo **tab trình duyệt**, hoàn toàn độc lập với trạng thái đăng nhập. Nếu
tab đó đã tự sinh việc 1 lần trong ngày (trước khi tạo template mới), việc mới
tạo sau đó **sẽ không được sinh ngay** trong tab đó — phải mở tab mới/trình
duyệt ẩn danh, hoặc đợi sang ngày hôm sau, cờ mới hết hạn.

**Việc cần làm — đã có hướng giải quyết rõ, chỉ cần code**: thêm nút **"Sinh
việc hôm nay ngay"** trong `/dashboard/kpi/templates` (chỉ hiện khi
`canManageTemplates`) — gọi thẳng `ensureTodayKpiTaskInstances(factoryId)`
(không qua cờ `sessionStorage`, không cần tab mới), hiện toast "Đã sinh N việc
mới hôm nay". Giải quyết dứt điểm cả nhu cầu test lẫn nhu cầu thực tế (admin
tạo template lúc 9h sáng, muốn có hiệu lực ngay, không muốn phụ thuộc "may rủi"
ai đó mở tab mới).

### Tình huống 2 — RyTa có việc cố định "Tạo ngăn", đăng ký Hữu Thọ thay thế
RyTa, nhưng Hữu Thọ tạo ngăn xong KHÔNG thấy việc đó trong dropdown "Gắn bằng
chứng"

**Giả thuyết có cơ sở vững nhất từ code (chưa verify DB)**: mỗi template chỉ
sinh **đúng 1 task/ngày**, chặn bằng unique index `(template_id, ngay_giao)` +
điều kiện `IF EXISTS (... WHERE template_id=... AND ngay_giao=hôm nay) THEN
CONTINUE` trong RPC. Khi RyTa "có việc Tạo ngăn" đã được xác nhận nhìn thấy →
nghĩa là task HÔM NAY của template đó **đã được sinh và gán cứng cho RyTa**
(`kpi_task_members.user_id = RyTa`) từ trước. Đăng ký "Người thay thế" SAU thời
điểm đó chỉ ảnh hưởng tới **các task được sinh ra SAU khi đăng ký** (từ ngày
mai, hoặc từ ngay lúc đó nếu hôm nay CHƯA từng sinh) — nó **không** tự động đổi
lại task hôm nay đã tồn tại. Vì Hữu Thọ chưa từng có dòng `kpi_task_members`
cho đúng task đó, `fetchOpenKpiTasksForUser(factoryId, huuThoId)` đúng là sẽ
không trả về nó — dropdown "Gắn bằng chứng" của Hữu Thọ trống đúng theo logic
hiện tại. **Đây nhiều khả năng KHÔNG phải bug code, mà là hành vi đúng thiết kế
nhưng thiếu cảnh báo/lối thoát rõ ràng cho người dùng.**

**Việc cần làm — theo đúng thứ tự**:

1. **Xác nhận bằng dữ liệu thật trước khi sửa gì**: query `kpi_tasks` +
   `kpi_task_members` + `kpi_user_substitutions` của factory test, lọc theo
   `template_id`/`ngay_giao = hôm đó` — xác nhận đúng là task hôm đó đã tồn tại
   và gán cho RyTa TRƯỚC thời điểm `created_at` của dòng
   `kpi_user_substitutions`. Nếu KHÔNG khớp giả thuyết trên (vd task hôm đó
   chưa từng tồn tại, hoặc substitution đăng ký trước khi RyTa từng mở app) thì
   đây là bug thật khác, cần điều tra lại từ đầu — không giả định đúng ngay.
2. **Hỏi lại người dùng để chốt quyết định thiết kế** (chưa tự quyết trong
   phiên trước, xem "Đã chốt với người dùng" ở plan gốc — plan gốc CHỈ nói về
   sinh instance MỚI, không nói rõ trường hợp instance HÔM NAY ĐÃ TỒN TẠI):
   khi đăng ký 1 substitution có `tu_ngay <= hôm nay <= den_ngay`, và phát hiện
   template đó ĐÃ có task hôm nay đang gán cho `original_user_id` — có nên
   **tự động reassign ngay lập tức** (đổi thẳng `kpi_task_members.user_id` từ
   RyTa sang Hữu Thọ, tương tự nhánh "chấp nhận" của `kpi_task_transfer_respond`
   nhưng KHÔNG cần bước "yêu cầu/chấp nhận" vì đây là thao tác admin/kpi.assign
   đã được ủy quyền đăng ký thay thế, không phải thương lượng ngang hàng giữa 2
   nhân viên) hay không? Nếu có, cần 1 RPC mới (hoặc mở rộng
   `kpi_user_substitutions` insert flow) xử lý atomic việc này.
3. Nếu người dùng xác nhận muốn tự động reassign: thêm logic vào ngay bước
   INSERT `kpi_user_substitutions` (hoặc 1 RPC riêng gọi liền sau) — tìm task
   hôm nay (nếu có) của đúng `(template_id nếu chỉ định, hoặc TẤT CẢ template
   của original_user_id)` đang gán cho `original_user_id`, chuyển thẳng sang
   `substitute_user_id` (giữ nguyên `phan_loai`, set `is_active=false` cho
   dòng cũ, tạo/kích hoạt dòng mới cho substitute — mirror đúng đoạn code đã có
   trong `kpi_task_transfer_respond`).
4. Dù chọn hướng nào ở bước 2, **bắt buộc thêm cảnh báo rõ trong
   `SubstitutionFormModal`**: khi `tu_ngay` là hôm nay, hiện dòng chữ giải
   thích rõ ràng (không để người dùng tự suy luận như lần này) — ví dụ: "Nếu
   việc định kỳ hôm nay đã được sinh cho người đi vắng, [tự động chuyển ngay
   cho người thay thế / bạn cần dùng nút Chuyển giao ở trang chi tiết việc đó
   để chuyển tay]" — nội dung câu chữ phụ thuộc quyết định ở bước 2.

## Cập nhật 2026-07-26 (tiếp 2) — Đã điều tra bằng dữ liệu DB thật: giả thuyết
tình huống 2 ở trên SAI, nguyên nhân thật khác hẳn; đã fix cả 2 tình huống

Đã chạy migration `20260728_kpi_task_templates.sql`. Trước khi sửa bất cứ gì,
đã query trực tiếp DB thật (`scripts/investigate-kpi-substitution.mjs`, read-
only, giữ lại trong repo để tái dùng cho lần điều tra KPI khác) theo đúng yêu
cầu "xác nhận bằng dữ liệu thật trước khi sửa gì" ở mục trên.

**Kết quả — KHÔNG khớp giả thuyết gốc**: `kpi_tasks` với `template_id IS NOT
NULL` trả về **0 dòng** — nghĩa là chưa từng có bất kỳ task nào được tự động
sinh ra từ 5 template đang active (kể cả template "Tạo ngăn lưu" gán cho RyTa),
dù các template đã tồn tại ~30-50 phút trước thời điểm điều tra. Vậy task
"Tạo ngăn" **chưa từng tồn tại** cho RyTa lẫn Hữu Thọ ở thời điểm Hữu Thọ tạo
ngăn và tìm nó trong dropdown "Gắn bằng chứng" — hoàn toàn khác giả thuyết ban
đầu ("task đã sinh và gán cứng cho RyTa từ trước"). Kiểm tra chéo bằng cách gọi
thẳng RPC `kpi_ensure_today_task_instances` qua service-role key xác nhận hàm
tồn tại và hoạt động đúng logic (`auth.uid() IS NULL` dưới service role →
return 0 ngay, không lỗi) — không phải bug trong chính RPC.

**Nguyên nhân thật**: đúng như tình huống 1 đã mô tả — cờ `sessionStorage`
(`kpi_ensured_${factory_id}_${todayISO}`) sống theo tab, và rất có thể tab của
RyTa/Hữu Thọ/admin đã tự set cờ này TRƯỚC khi 5 template được tạo (do đã mở
Dashboard sớm hơn trong cùng ngày UTC để test các tính năng KPI khác) — khiến
`kpi_ensure_today_task_instances` chưa từng được một phiên đăng nhập thật nào
gọi lại kể từ lúc tạo template. Tình huống 1 và 2 hóa ra là **cùng một gốc rễ**.

Đã xác nhận thêm 1 điểm không phải nguyên nhân (loại trừ, không cần sửa):
`getTodayISODate()` (`src/lib/date-utils.ts`) và cờ `sessionStorage` trong
`dashboard/layout.tsx` đều dùng `new Date().toISOString().slice(0,10)` — tức
ngày UTC — nhất quán với `CURRENT_DATE` mặc định UTC của Postgres/Supabase.
Không có lệch múi giờ client/server ở đây; chỉ riêng khoảng 00:00–07:00 giờ
Campuchia (UTC+7) thì "ngày lịch" theo UTC vẫn là hôm qua trong khi người dùng
cảm nhận đã sang ngày mới — đã ghi nhận là hạn chế đã biết, không sửa trong đợt
này (rủi ro thấp, không phải nguyên nhân của bug đang xử lý).

**Đã code (không cần hỏi thêm, đúng tình huống 1)**:

- Nút **"Sinh việc hôm nay ngay"** (icon `RefreshCw`, teal) ở đầu trang
  `/dashboard/kpi/templates`, chỉ hiện khi `canManageTemplates` — gọi thẳng
  `ensureTodayKpiTaskInstances(factoryId)` (bỏ qua hoàn toàn cờ
  `sessionStorage`), hiện thông báo "Đã sinh N việc định kỳ mới cho hôm nay."
  hoặc "Không có việc mới nào cần sinh...", rồi `loadData()` lại.
- **Robustness bổ sung** (không có trong plan gốc nhưng tự nhiên nối tiếp tình
  huống 1, không cần hỏi thêm): sau khi Lưu thành công 1 template
  (`TemplateFormModal`) hoặc 1 đăng ký thay thế (`SubstitutionFormModal`),
  `onSaved` giờ gọi `syncTodaySilently(factoryId)` (bọc `ensureTodayKpiTaskInstances`
  trong try/catch im lặng) TRƯỚC khi `loadData()` — nhờ đó admin vừa tạo/sửa
  template hoặc vừa đăng ký thay thế sẽ có việc sinh ra ngay trong chính phiên
  đăng nhập của họ (đã authenticated), không phải chờ ai đó mở tab mới.

**Đã hỏi người dùng (AskUserQuestion) về câu hỏi thiết kế ở mục 2 phía trên —
đã CHỐT: không tự động reassign.** Task "đã sinh cho người gốc trước khi đăng
ký thay thế phủ đúng ngày đó" sẽ **giữ nguyên người gốc** — người đi vắng (hoặc
admin) phải tự bấm "Chuyển giao" ở trang chi tiết việc đó (Phase 1b, đã có sẵn)
nếu muốn chuyển ngay hôm đó. Từ ngày hôm sau, việc định kỳ tự sinh đúng cho
người thay thế như thiết kế ban đầu — không cần code gì thêm cho mục 3.

**Đã code mục 4** — `SubstitutionFormModal` thêm banner cảnh báo màu amber, chỉ
hiện khi khoảng `[tu_ngay, den_ngay]` bao gồm hôm nay
(`getTodayISODate()`, cùng chuẩn UTC như trên) — giải thích rõ: nếu việc định
kỳ hôm nay đã được sinh sẵn cho người đi vắng, đăng ký này **không** tự đổi
người ngay, cần dùng "Chuyển giao" hoặc đợi ngày mai tự động đúng.

`npx tsc --noEmit`, `npx eslint` (các file đã sửa/thêm:
`kpi/templates/page.tsx`, `kpi/templates/_components/substitution-form-modal.tsx`,
`scripts/investigate-kpi-substitution.mjs`), và `npm run build` đều sạch.

**Chưa test tay** — cần, theo đúng kịch bản gốc đã báo lỗi:

1. Đăng nhập tài khoản `canManageTemplates` (admin/`kpi.manage_config`), vào
   `/dashboard/kpi/templates` → bấm "Sinh việc hôm nay ngay" → xác nhận thông
   báo hiện đúng số việc vừa sinh (kỳ vọng 5, khớp 5 template active hiện có,
   nếu chưa từng sinh cho hôm nay) → kiểm tra `kpi_tasks` có task "Tạo ngăn lưu"
   với thành viên là **Hữu Thọ** (không phải RyTa), đúng theo đăng ký thay thế
   đang hiệu lực.
2. Đăng nhập Hữu Thọ, tạo 1 ngăn lưu ở module Kho nguyên liệu → xác nhận banner
   "Gắn bản ghi tại chỗ" giờ hiện đúng việc "Tạo ngăn lưu" trong dropdown, gắn
   xong task chuyển Hoàn thành.
3. Tạo 1 template mới hoặc sửa 1 template có sẵn → xác nhận không cần bấm nút
   "Sinh việc hôm nay ngay" riêng, việc mới đã tự xuất hiện ngay sau khi Lưu
   (kiểm tra qua tab "Việc của tôi" của đúng người được giao, hoặc DB).
4. Đăng ký 1 "Người thay thế" mới có `tu_ngay` = hôm nay cho 1 template CHƯA
   từng sinh việc hôm nay → xác nhận banner amber hiện đúng trong modal trước
   khi lưu, và sau khi lưu, việc hôm nay (được `syncTodaySilently` sinh ngay)
   đã gán đúng cho người thay thế (vì lúc lưu, chưa hề có task cũ nào để giữ
   nguyên — case "chưa sinh" hoạt động đúng như thiết kế ban đầu).
5. Test case "đã sinh trước, đăng ký sau" (đúng câu hỏi thiết kế đã chốt): bấm
   "Sinh việc hôm nay ngay" trước để tạo task cho người gốc → sau đó đăng ký 1
   substitution mới phủ đúng hôm nay cho đúng người/template đó → xác nhận task
   đã sinh **vẫn giữ nguyên người gốc** (không tự đổi) → xác nhận nút "Chuyển
   giao" ở trang chi tiết việc đó vẫn hoạt động bình thường để chuyển tay nếu
   cần.
6. Test qua khung giờ 00:00–07:00 giờ Campuchia (nếu tiện) để xác nhận hạn chế
   UTC-day-boundary đã ghi nhận ở trên không gây hậu quả nghiêm trọng hơn dự
   kiến (task sinh ra với `ngay_giao` là "ngày UTC" có thể trễ hơn ngày lịch
   địa phương 1 ngày trong khung giờ này — chấp nhận được, không chặn gì).

## Cập nhật 2026-07-26 (tiếp 3) — Test tay xác nhận đúng kịch bản "đã sinh trước,
đăng ký sau"; Q&A về ngày kế tiếp (27/07) sau khi hết hạn "đã sinh trước"

### Kết quả test tay của người dùng (khớp mục 1/2/5 của checklist trên)

Kịch bản thật: template "Tạo ngăn lưu" gán cho RyTa được sinh **trước** (task
ngày 26/07 đã tồn tại, gán cho RyTa) → sau đó đăng ký "Người thay thế" RyTa→Thọ,
`tu_ngay=26/07`, `den_ngay=30/07` (bao trùm cả ngày task đã sinh). Kết quả quan
sát được:

- RyTa tạo ngăn lưu ngày 26 → **vẫn thấy** "Tạo ngăn lưu" trong dropdown "Gắn
  bản ghi tại chỗ" → gắn xong, task Hoàn thành.
- Thọ tạo ngăn lưu (cùng ngày 26) → **KHÔNG thấy** "Tạo ngăn lưu" trong dropdown
  của mình.

**Đây là hành vi ĐÚNG theo quyết định đã chốt ở mục "Cập nhật 2026-07-26 (tiếp
2)"** — không phải bug. Task ngày 26 đã sinh và gán cứng cho RyTa TRƯỚC khi
đăng ký thay thế được lưu, nên giữ nguyên người gốc; hệ thống không tự động
reassign. Nếu muốn Thọ làm thay đúng NGÀY 26, RyTa (hoặc admin) phải bấm
"Chuyển giao" ở trang chi tiết task đó — đăng ký "Người thay thế" một mình
không đủ để chuyển 1 task ĐÃ TỒN TẠI, chỉ có tác dụng cho các task SINH MỚI
sau đó.

### Trả lời 2 câu hỏi của người dùng (dự đoán theo đúng logic RPC, xem
`kpi_ensure_today_task_instances` trong `20260728_kpi_task_templates.sql`)

**Câu 1 — "Ngày 27, nếu Thọ tạo ngăn, Thọ có thấy 'Tạo ngăn lưu' trong dropdown
không?"** → **CÓ**, với điều kiện task ngày 27 của template đó đã được sinh ra
(bởi BẤT KỲ ai mở 1 trang dashboard nào trong ngày 27, hoặc bấm "Sinh việc hôm
nay ngay", hoặc sau khi ai đó Lưu 1 template/đăng ký thay thế — tất cả đều gọi
chung `ensureTodayKpiTaskInstances`). Vì tới ngày 27 CHƯA có task nào của
template này tồn tại cho ngày đó (`UNIQUE(template_id, ngay_giao)` chỉ chặn
sinh trùng cho CÙNG 1 ngày, ngày 26 và 27 là 2 dòng độc lập), RPC sẽ chạy đúng
nhánh "sinh mới" (không phải "đã tồn tại, giữ nguyên") — tra `kpi_user_substitutions`
thấy `tu_ngay(26) <= 27 <= den_ngay(30)` vẫn còn hiệu lực → gán thẳng task
ngày 27 cho Thọ ngay từ lúc sinh, không cần "Chuyển giao" gì cả.

**Câu 2 — "RyTa ở nhà mở app, tạo ngăn ngày 27, RyTa còn thấy 'Tạo ngăn lưu'
trong dropdown không?"** → **KHÔNG**. Task ngày 27 (dù do chính RyTa mở app
kích hoạt sinh ra, hay do Thọ/admin) đều được gán cho **Thọ**, không phải
RyTa — vì việc gán người dựa vào tra cứu đăng ký thay thế tại thời điểm SINH
(không phải tại thời điểm AI LÀ NGƯỜI GỌI RPC). RyTa không có trong
`kpi_task_members` của instance ngày 27 nên `fetchOpenKpiTasksForUser(RyTa)`
không trả về nó — dropdown của RyTa sẽ không có "Tạo ngăn lưu" ngày 27. Đây là
đúng thiết kế (RyTa đang trong diện đăng ký "đi vắng" nên không được ghi nhận
việc này).

**Lưu ý kèm theo**: nếu RyTa (dù đang "đi vắng" theo đăng ký) vẫn thực sự tạo
1 ngăn lưu ngày 27 vì lý do nào đó (vd về sớm, hoặc hỗ trợ tay), việc đó KHÔNG
được tính là hoàn thành "Tạo ngăn lưu" cho anh — vì banner "Gắn bản ghi tại
chỗ" sẽ không hiện gợi ý task đó cho anh (không phải thành viên). Đây là hệ
quả tất yếu của thiết kế hiện tại, không phải bug — nhưng cần lưu ý khi hướng
dẫn người dùng thực tế: đăng ký "Người thay thế" nên phản ánh đúng ai THỰC SỰ
làm việc ngày hôm đó.

### Đã xác nhận (2026-07-26, tiếp 4) — kịch bản "sinh MỚI khi thay thế đã có
hiệu lực" đã kiểm chứng bằng lệnh gọi RPC THẬT, không phải suy luận tĩnh

Không đợi được tới ngày thật 27/07 (agent không có khả năng chờ 1 ngày lịch),
và RPC `kpi_ensure_today_task_instances` dùng cứng `CURRENT_DATE` (không nhận
tham số ngày) nên không "giả lập" được bằng cách đổi `tu_ngay`/`den_ngay` sang
tương lai — phải test đúng ngày hôm đó mới trigger được nhánh sinh mới.

Thay vào đó đã dựng lại đúng tiền đề của kịch bản ("đăng ký thay thế đã tồn tại
TRƯỚC khi task lần đầu được sinh") bằng dữ liệu TEST tạo mới hoàn toàn tách biệt
với dữ liệu thật, verify bằng script gọi **thẳng RPC thật** (không mock, không
suy luận logic bằng tay) dưới 1 phiên đăng nhập auth thật (magic link +
`verifyOtp` lấy access token, không dùng service-role vì RPC đòi `auth.uid()`
non-null):

- Tạo 1 `kpi_task_templates` test (gán cho RyTa, nhóm "Nhóm sản lượng" — đúng
  nhóm chính thật của RyTa) + 1 `kpi_user_substitutions` test (RyTa → Thọ, phủ
  đúng hôm nay, gắn riêng `template_id` này) — cả 2 tạo XONG rồi mới gọi RPC,
  đúng thứ tự "đăng ký có trước khi sinh".
- Gọi `kpi_ensure_today_task_instances` thật qua `supabase.rpc(...)` với JWT
  của tài khoản `luanto` (bất kỳ ai active trong nhà máy đều gọi được, không
  cần là RyTa/Thọ — đúng thiết kế "thao tác hộ hệ thống").
- Script: `scripts/verify-kpi-substitution-new-generation.mjs` (giữ lại để tái
  dùng nếu cần kiểm chứng lại sau này; tự dọn sạch toàn bộ dữ liệu test ở cuối,
  kể cả khi lỗi giữa chừng — đã xác nhận DB sạch sau khi chạy, dữ liệu thật của
  RyTa/Thọ không bị đụng).

**Kết quả — 6/6 assertion PASS**:

1. Trước khi gọi RPC: chưa có task nào cho template test hôm nay (đúng tiền đề).
2. RPC sinh đúng 1 task mới cho template test.
3. Task đó chỉ có **đúng 1 thành viên**, và thành viên đó là **Thọ (substitute)**
   — không phải RyTa (original) — khớp đúng dự đoán "Câu 1" ở mục "tiếp 3".
4. `phan_loai` của Thọ trong task này = `'choang'` — đúng vì nhóm template là
   "Nhóm sản lượng" (nhóm chính của RyTa) nhưng KHÔNG phải nhóm chính của Thọ
   (nhóm chính thật của Thọ là "Nhóm kỹ thuật - Chất lượng") — xác nhận
   `phan_loai` được tính theo nhóm chính của **NGƯỜI CUỐI CÙNG nhận việc**
   (người thay thế), đúng thiết kế đã ghi trong RPC comment.

Vì kết quả thật cho thấy task chỉ có **đúng 1 dòng thành viên duy nhất** (Thọ),
"Câu 2" (RyTa không được thấy việc này trong dropdown "Gắn bản ghi tại chỗ") là
**hệ quả tất yếu** của chính kết quả trên — `fetchOpenKpiTasksForUser(RyTa)`
join theo `kpi_task_members.user_id = RyTa` nên chắc chắn không trả về task này
vì RyTa không có mặt trong bảng thành viên của nó. Không cần test UI riêng cho
điều này — đã được chứng minh trực tiếp qua dữ liệu.

**Kết luận**: cơ chế "Việc định kỳ + Người thay thế tạm thời" đã kiểm chứng đầy
đủ cả 2 nhánh — (a) task đã sinh TRƯỚC khi đăng ký thay thế → giữ nguyên người
gốc, cần "Chuyển giao" thủ công (đã test tay UI thật, xem mục "tiếp 3"); (b)
task sinh MỚI SAU khi đăng ký thay thế đã có hiệu lực → tự động gán đúng người
thay thế ngay từ đầu, `phan_loai` tính đúng theo người thay thế (đã kiểm chứng
bằng RPC thật ở mục này). Coi Phase "Việc định kỳ theo nhóm + Người thay thế
tạm thời" là **hoàn tất, không còn hạng mục nào cần test lại**.

## Cập nhật Phase 2 (2026-07-26) — Đánh giá 5S, đã code xong

Đã build đúng theo schema/UI phác thảo sẵn ở mục "Database Schema" (5S) và "UI"
phía trên — không có sai lệch thiết kế nào so với plan gốc, chỉ chốt thêm vài
quyết định nhỏ chưa ghi rõ trong plan (liệt kê dưới).

### Migration `supabase/migrations/20260729_kpi_5s_zones.sql` (**cần chạy thủ
công, CHƯA CHẠY**)

- `kpi_5s_zones` đúng schema đã phác thảo — `nguoi_don_id`/`nguoi_cham_id` là
  "standing" (sửa trực tiếp trong Cài đặt khi về tua, không có cơ chế phân công
  lại theo tuần riêng, đúng comment đã ghi sẵn trong plan).
- `kpi_5s_evaluations` đúng schema — **quyết định thêm** (plan gốc không ghi rõ):
  không có policy UPDATE/DELETE nào cho client (kể cả admin) — bản chấm là log
  bất biến, đúng tinh thần "công bằng, minh bạch, có log bất biến" nêu ở mục
  "Phạm vi" đầu file. `zone_id` **không** `ON DELETE CASCADE` (mặc định `NO
  ACTION`) — xóa 1 khu vực đã có lịch sử chấm điểm sẽ bị chặn bởi FK, buộc dùng
  "Tạm ngưng" (`is_active=false`) thay vì xóa, để không mất lịch sử minh bạch.
- RLS INSERT của `kpi_5s_evaluations`: chỉ đúng người đang là `nguoi_cham_id`
  HIỆN TẠI của khu vực đó (`z.nguoi_cham_id = auth.uid()`) — **không có ngoại lệ
  admin** (khác nhiều bảng khác trong app luôn có nhánh admin bypass) — quyết
  định có chủ đích: nếu admin muốn tự chấm, phải tự gán mình làm `nguoi_cham_id`
  của khu vực trong Cài đặt, để giữ đúng "ai chấm là người đã được phân công".
- CHECK constraint bắt buộc `ly_do` khi `ket_qua='khong_dat'` nằm ngay ở tầng DB
  (không chỉ validate JS) — chặn được cả trường hợp ai đó gọi thẳng API bỏ qua
  UI.

### `src/lib/date-utils.ts` — thêm 3 helper tuần dùng chung

`addDaysISO()`, `getIsoWeekStart()` (Thứ Hai của tuần chứa 1 ngày, tính bằng
thành phần UTC y/m/d giống `getTodayISODate()` để tránh lệch múi giờ — **kế
thừa đúng hạn chế đã biết** "khung giờ 00:00–07:00 giờ Campuchia có thể lệch 1
ngày lịch" đã ghi ở module Thành phẩm/Kiểm soát quá trình, chấp nhận được),
`formatWeekRangeLabel()` (hiển thị "dd/mm/yyyy — dd/mm/yyyy").

### `src/lib/kpi-5s.ts` + `src/lib/kpi-5s-pdf.ts`

- CRUD zones/evaluations đầy đủ + `buildKpi5sZoneUrl(zoneId)` (dùng
  `window.location.origin`, mirror `buildStorageLookupUrl`) +
  `uploadKpi5sEvaluationImage(factoryId, zoneId, file)` (bucket `order-files`,
  path `{factory_id}/kpi/5s/{zone_id}/...`, mirror `uploadKpiEvidenceImage`).
- `fetchLatestKpi5sEvaluationsByZoneIds(zoneIds)` — 1 query duy nhất lấy kết quả
  tuần gần nhất của NHIỀU khu vực cùng lúc (order theo `tuan_bat_dau DESC` rồi
  chỉ giữ dòng đầu tiên mỗi `zone_id` ở tầng JS) — tránh N+1 query khi render
  danh sách khu vực.
- `downloadKpi5sZoneBulkQrPdf(zones)` (`kpi-5s-pdf.ts`) — **cố ý KHÔNG refactor
  gộp** với `downloadStorageBulkQrPdf` (`storage-pdf.ts`) dù thuật toán lưới
  giống hệt nhau — tách file riêng để không đụng code Storage đang chạy ổn định
  trên production, đúng nguyên tắc "không sửa code đang chạy tốt chỉ để tái
  dùng, nếu rủi ro vượt lợi ích". Nhãn QR khu vực khác nhãn ngăn lưu: 2 dòng
  (mã khu vực đậm + tên khu vực thường) thay vì 1 dòng mã ngăn.

### UI

- `KpiShell` thêm tab "Đánh giá 5S" (icon `Sparkles`, prefix
  `/dashboard/kpi/5s`).
- `/dashboard/kpi/5s/page.tsx` — grid card khu vực (mã, tên, vị trí, người dọn/
  chấm hiện tại, badge kết quả tuần gần nhất hoặc "Chưa chấm"), badge riêng
  "Cần bạn chấm điểm tuần này" khi `user.id === zone.nguoi_cham_id` và tuần
  hiện tại (`getIsoWeekStart()`) chưa có trong `latestByZone`. Link "Quản lý
  khu vực" (chỉ `kpi.manage_config`/admin) sang `/dashboard/settings?tab=kpi_5s`
  — đã nối vào `deepLinkHandledRef` sẵn có của Settings (mirror deep-link
  `?tab=cau_hinh_nha_may` đã có cho "Tạo Polygon mới").
- `/dashboard/kpi/5s/zone/[id]/page.tsx` — QR thật (`QRCodeSVG`) + nút "Tải QR"
  (gọi lại `downloadKpi5sZoneBulkQrPdf([zone])`, tái dùng hàm bulk cho đúng 1
  khu vực thay vì viết hàm single riêng); nút "Chấm điểm tuần này" chỉ hiện khi
  `zone.is_active && user.id === zone.nguoi_cham_id && !currentWeekEvaluation`;
  form chấm chọn "Người chịu trách nhiệm dọn tuần này" (mặc định
  `zone.nguoi_don_id`, sửa được), Đạt/Không đạt (2 nút lớn), lý do bắt buộc khi
  Không đạt, `Kpi5sImagePicker` (ảnh khuyến khích, tối đa 6); lịch sử chấm điểm
  hiển thị đầy đủ công khai (không gate quyền xem, đúng RLS SELECT rộng trong
  factory).
- `src/app/dashboard/kpi/5s/_components/kpi-5s-image-picker.tsx` — mirror
  `NoteImagePicker`/`KpiEvidencePicker`, ảnh-only, tối đa 6.
- `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx` — CRUD zones
  (card grid + modal `ModalShell`, mirror `TemplateFormModal`/`QualityTargetsTab`)
  + checkbox chọn nhiều khu vực + nút "In QR hàng loạt (N)" gọi
  `downloadKpi5sZoneBulkQrPdf`. Dropdown "Người dọn"/"Người chấm" dùng
  `userOptions` từ `activeProfilesForLink` (state `profiles` sẵn có của trang
  Settings — chỉ trang này mới đọc được toàn bộ `profiles` trong nhà máy, xem
  `.claude/rules/16-iso-vanban-module.md` mục RLS `profiles`), **khác** với
  `loadKpiTaskCandidates()` (nguồn `maintenance_staff`) dùng ở các trang
  `/dashboard/kpi/*` — 2 nguồn khác nhau nhưng cùng trỏ về `auth.users.id` nên
  tương thích lẫn nhau (không có xung đột khi 1 trang ghi bằng nguồn này, trang
  khác đọc bằng nguồn kia).
- Settings: thêm top-level tab mới **"KPI & 5S"** (icon `Target`, gate
  `canManageKpiConfig = isAdmin || hasPermission(user, "kpi.manage_config")`) —
  **đã mở rộng guard tổng ở đầu `bootstrap()`** để thêm điều kiện
  `kpi.manage_config` vào danh sách OR (trước đó tài khoản chỉ có
  `kpi.manage_config`, không có bất kỳ quyền Settings nào khác, sẽ bị guard tổng
  redirect ra `/dashboard` ngay cả khi có quyền quản lý khu vực 5S — bug tiềm ẩn
  đã phát hiện và fix ngay lúc code, chưa từng ship ra production). Sub-tab bar
  hiện chỉ có đúng 1 mục "Khu vực 5S" (mirror cấu trúc sub-tab của tab
  "ISO & Văn bản" — cũng chỉ 1 sub-tab "Chữ ký cá nhân" — để dễ thêm "Khung tiêu
  chí KPI"/"Trọng số công thức" ở Phase 3/4 mà không phải đổi cấu trúc).
- `kpi/page.tsx` — bỏ "Công việc" và "Đánh giá 5S" khỏi danh sách "Sắp có" (đã
  có tab riêng, không còn là roadmap "chưa build" nữa), chỉ còn "Chấm điểm
  chuyên môn" và "Bảng điểm KPI".

`npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa), và `npm run build`
đều sạch — đã đối chiếu `git stash` xác nhận các warning còn lại trong
`settings/page.tsx` (biến `Calendar`/`_fid`/`driverAssignedVehiclesMap` không
dùng, 1 cảnh báo `<img>`) là pre-existing, không liên quan thay đổi lần này.

### Chưa test tay — cần làm ở phiên sau

1. Chạy `supabase/migrations/20260729_kpi_5s_zones.sql` trên Supabase SQL
   Editor.
2. Tài khoản `kpi.manage_config` (không có bất kỳ quyền Settings nào khác) mở
   `/dashboard/settings` → xác nhận vào được (không bị guard tổng chặn), thấy
   đúng 1 tab "KPI & 5S" → thêm 1 khu vực test (mã, tên, người dọn, người chấm
   khác nhau) → lưu → xác nhận card hiện đúng.
3. Từ `/dashboard/kpi/5s` bấm "Quản lý khu vực" → xác nhận điều hướng đúng sang
   Settings, tự mở đúng tab "KPI & 5S" (deep-link `?tab=kpi_5s`).
4. Đăng nhập đúng tài khoản là `nguoi_cham_id` của khu vực vừa tạo → vào
   `/dashboard/kpi/5s` → xác nhận card hiện badge "Cần bạn chấm điểm tuần này"
   → mở chi tiết → thấy nút "Chấm điểm tuần này" → chấm "Đạt" (không cần lý do)
   → lưu → xác nhận chuyển vào lịch sử đúng, nút biến mất, banner "Tuần này đã
   được chấm" hiện đúng.
5. Đăng nhập tài khoản KHÁC (không phải `nguoi_cham_id`) → mở cùng khu vực →
   xác nhận KHÔNG thấy nút "Chấm điểm tuần này", thấy đúng banner "chỉ {tên}
   mới được chấm".
6. Thử chấm "Không đạt" mà không nhập lý do → xác nhận bị chặn ở cả UI (validate
   JS) lẫn nếu cố tình bỏ qua UI gọi thẳng API (CHECK constraint DB) → nhập lý
   do → lưu thành công, xác nhận lý do hiển thị đúng trong lịch sử.
7. Test đổi "Người chịu trách nhiệm dọn tuần này" khác với `zone.nguoi_don_id`
   mặc định (mô phỏng "có người dọn thay") → lưu → xác nhận lịch sử ghi đúng
   người đã chọn (snapshot), không đổi `zone.nguoi_don_id` gốc.
8. Test tải ảnh khi chấm điểm (tối đa 6) → xác nhận ảnh hiện đúng trong lịch sử,
   click mở lightbox phóng to hoạt động.
9. Test "In QR hàng loạt" ở Settings: chọn 2-3 khu vực → in → xác nhận PDF có
   đúng số nhãn, QR quét ra đúng URL zone, nhãn 2 dòng (mã đậm + tên) không vỡ
   khi tên khu vực dài. Test nút "Tải QR" đơn lẻ ở trang chi tiết khu vực cũng
   ra đúng file tương tự (chỉ 1 nhãn).
10. Test xóa 1 khu vực ĐÃ có lịch sử chấm điểm → xác nhận bị chặn với thông báo
    rõ ràng hướng dẫn dùng "Tạm ngưng"; test "Tạm ngưng" → xác nhận khu vực biến
    mất khỏi `/dashboard/kpi/5s` (chỉ `fetchKpi5sZones` mặc định `is_active`)
    nhưng vẫn xem được trực tiếp qua URL (`fetchKpi5sZone` không lọc
    `is_active`), và không còn chấm được (banner "Khu vực đang tạm ngưng").
11. Test xóa 1 khu vực CHƯA có lịch sử chấm điểm nào → xác nhận xóa được bình
    thường.

## Cập nhật (2026-07-26, tiếp) — Phân công thông minh 5S + Gia hạn + Khiếu nại +
Thông báo Telegram + Redesign giao diện module KPI, đã code xong

Người dùng nêu vấn đề thực tế: quá nhiều khu vực 5S thì lãnh đạo không thể ngồi
gán tay từng người dọn/người chấm, và đề xuất "vòng quay ngẫu nhiên đầu tuần".
Đã phân tích trực tiếp với người dùng (xem hội thoại) — random thuần túy có 2 lỗ
hổng (không cân tải thực chất, không tránh được người dọn/chấm "cùng phe") — và
đề xuất thay bằng **random có trọng số + ràng buộc, luôn cho xem trước/sửa tay
trước khi ghi thật**, đã được chấp nhận và triển khai đúng như mô tả bên dưới.
Cùng đợt: xây thêm 2 tính năng còn thiếu mà thông báo Telegram cần tới ("gia
hạn", "khiếu nại" — build tối giản đủ dùng, `kpi_appeals` xây SỚM HƠN lịch trong
roadmap Phase 5 vì không phụ thuộc `kpi_monthly_scores`), 1 kênh thông báo
Telegram dùng chung cho toàn bộ vòng đời công việc/5S, và redesign giao diện
**chỉ trong phạm vi `/dashboard/kpi/*`** (không đụng module khác, không đụng
Settings dù `kpi-5s-zones-tab.tsx` nằm trong `/dashboard/settings`).

### A. Phân công thông minh cho khu vực 5S

- `src/lib/kpi-5s-auto-assign.ts` — thuật toán thuần (`buildAutoAssignSuggestions`):
  random **có trọng số nghịch đảo theo tải hiện tại** (ai đang phụ trách ít khu
  vực hơn có xác suất được chọn cao hơn — KHÔNG phải random đều 100%), ràng buộc
  cứng `người dọn ≠ người chấm`, ràng buộc mềm "tránh người chấm cùng nhóm chính
  với người dọn" (tự động nới lỏng nếu hết ứng viên khác, đánh dấu
  `groupConstraintRelaxed` để UI cảnh báo — không được để trống khu vực chỉ vì
  ràng buộc mềm). Cố ý KHÔNG dùng thuật toán tối ưu ghép cặp (Hungarian...) — đây
  chỉ là công cụ ĐỀ XUẤT, người dùng luôn xem lại/sửa tay trước khi xác nhận.
- `loadKpiTaskCandidates()` (`kpi-tasks.ts`) mở rộng thêm field `primaryGroupId`
  per candidate (trước đó chỉ có `groupIds` — tất cả nhóm, không phân biệt
  nhóm chính) — cần cho ràng buộc "tránh cùng nhóm chính".
- `src/app/dashboard/settings/_components/kpi-5s-auto-assign-modal.tsx` — modal
  2 bước: (1) chọn phạm vi (chỉ khu vực chưa gán đủ / toàn bộ) + tùy chọn tránh
  cùng nhóm → "Tạo đề xuất"; (2) bảng preview mỗi khu vực có 2 dropdown (người
  dọn/người chấm) đã điền sẵn theo thuật toán nhưng **sửa tay được**, nút
  "Random lại" (tạo lại đề xuất mới), "Xác nhận & Giao (N thay đổi)" chỉ ghi
  đúng những dòng thực sự thay đổi so với hiện trạng (không ghi đè toàn bộ vô
  ích). Nút mở modal đặt trong `kpi-5s-zones-tab.tsx` (Cài đặt → KPI & 5S → Khu
  vực 5S), cạnh nút "Thêm khu vực".
- Nguồn ứng viên của công cụ này là `loadKpiTaskCandidates()`
  (`maintenance_staff`-based, có `primaryGroupId`) — **khác** `userOptions`
  dùng cho modal Thêm/Sửa khu vực thủ công (`activeProfilesForLink`,
  `profiles`-based, không lọc theo nhóm) — tập ứng viên của công cụ tự động có
  thể hẹp hơn (chỉ người đã liên kết `maintenance_staff` + có nhóm), chấp nhận
  được vì mục đích chính là công bằng theo nhóm.

### B. "Gia hạn" (đổi hạn hoàn thành) — tính năng mới, chưa có trong roadmap gốc

- Migration `supabase/migrations/20260730_kpi_task_extend_deadline.sql` (**cần
  chạy thủ công, CHƯA CHẠY**): thêm `'gia_han'` vào CHECK constraint
  `kpi_task_logs.hanh_dong`; RPC `SECURITY DEFINER`
  `kpi_task_extend_deadline(p_task_id, p_new_han_hoan_thanh, p_ly_do)` — chỉ
  `nguoi_giao_id`/admin, chặn khi task đã `hoan_thanh`/`huy`, bắt buộc lý do.
  Ghi **1 dòng log cho MỖI thành viên active** (không phải 1 dòng chung) — vì
  đổi hạn ảnh hưởng trực tiếp tất cả người đang làm, mỗi người cần thấy sự kiện
  này trong dòng thời gian của chính họ (khác `chuyen_giao`/`gan_ban_ghi` vốn
  gắn với đúng 1 người).
- `extendKpiTaskDeadline()` (`kpi-tasks.ts`) + nút "Gia hạn" (icon
  `CalendarClock`) ngay dưới field "Hạn hoàn thành" ở trang chi tiết công việc
  (chỉ `isOwner && open`) → `ExtendDeadlineModal` (input `datetime-local` mặc
  định = hạn hiện tại qua `toDatetimeLocalValue()`, lý do bắt buộc).

### C. "Khiếu nại" (kpi_appeals) — xây SỚM HƠN lịch Phase 5, tối giản đủ dùng

- Migration `supabase/migrations/20260731_kpi_appeals.sql` (**cần chạy thủ
  công, CHƯA CHẠY**): bảng `kpi_appeals` — gắn với `task_id` HOẶC
  `zone_evaluation_id` (cột `monthly_score_id` giữ chỗ cho Phase 5, KHÔNG dùng
  ở bản này). RLS: SELECT (chủ khiếu nại thấy của mình; admin/kpi.manage_config
  thấy tất cả); INSERT chỉ người THỰC SỰ liên quan (thành viên/người giao của
  task, hoặc người dọn/người chấm của ĐÚNG lần chấm 5S đó — chặn spam khiếu nại
  không liên quan); UPDATE (xử lý — đổi `trang_thai`/`phan_hoi`) chỉ
  admin/kpi.manage_config, **không có** policy cho phép người khiếu nại tự sửa
  lại nội dung sau khi gửi (giữ đúng bản chất "log", tránh sửa đổi sau tranh
  chấp).
- `src/lib/kpi-appeals.ts` — CRUD tối giản (`fetchKpiAppeals`,
  `createKpiAppealForTask`, `createKpiAppealForZoneEvaluation`,
  `resolveKpiAppeal`).
- Nút "Khiếu nại" (icon `Flag`) ở header trang chi tiết công việc (chỉ
  `isOwner || myMember`) → `AppealModal`. Nút "Khiếu nại" ở mỗi dòng lịch sử
  chấm điểm 5S (chỉ hiện khi `user.id === nguoi_don_id || nguoi_cham_id` của
  ĐÚNG lần chấm đó) → modal inline trong chính trang chi tiết khu vực.
- Trang mới `/dashboard/kpi/appeals` + tab "Khiếu nại" trong `KpiShell` — danh
  sách (RLS tự lọc phạm vi xem), nút "Đã giải quyết"/"Từ chối" (chỉ
  admin/kpi.manage_config, chỉ khi `cho_xu_ly`) mở modal nhập phản hồi. Cố gắng
  resolve tiêu đề công việc/tên khu vực để hiển thị link — **best-effort**
  (`taskRefs`/`zoneRefs`, query riêng sau khi có danh sách khiếu nại) vì người
  xử lý có thể không có quyền SELECT trực tiếp bản ghi `kpi_tasks` gốc nếu
  không phải owner/member/admin/kpi.view_all — chấp nhận được, phần THỰC SỰ
  hành động (nội dung khiếu nại + xử lý) không phụ thuộc việc resolve này.

### D. Thông báo Telegram — CHỈ Telegram, dùng bot riêng `QL_CONG_VIEC_CHAT_TOKEN`/`QL_CONG_VIEC_CHAT_ID`

- `src/app/api/kpi/notify/route.ts` — **cố ý đơn giản hơn nhiều** so với
  `/api/iso/forms/notify`/`/api/documents/notify` (những route đó fan-out 3
  kênh: in-app + Telegram + Email, cần resolve danh sách `recipientUserIds` cụ
  thể). Ở đây:
  - **Chỉ Telegram** (đúng yêu cầu người dùng) — không insert vào bảng
    `notifications` dùng chung. Lý do: Bell badge của module KPI đã là
    "live-computed" (`module-tasks.ts`, xem
    `.claude/rules/24-notification-bell-module-tasks.md`), không persist; ghi
    thêm vào `notifications` sẽ tạo 1 luồng song song không đồng bộ với chuông,
    dễ trùng lặp/khó hiểu.
  - **Không cần resolve người nhận** — vì đích đến là 1 NHÓM CHAT CHUNG (không
    phải tin nhắn riêng từng người), mọi thành viên trong nhóm Telegram đó tự
    thấy tin nhắn broadcast. Route chỉ nhận `{factoryId?, title, lines[],
    link?}` từ phía gọi (đã có sẵn đầy đủ ngữ cảnh) rồi ghép khung tin nhắn cố
    định (`🔔 <b>title — tên nhà máy</b>` + các dòng + link) — tránh 1 map
    tiêu đề/nội dung khổng lồ ở server như ISO Forms từng làm cho 4 loại sự
    kiện (module KPI có >10 loại sự kiện, map kiểu đó sẽ rất cồng kềnh).
  - Chưa cấu hình bot (thiếu env) → trả `{ok:true, skipped:...}` êm, không chặn
    hành động nghiệp vụ. Lỗi Telegram → HTTP 207, cũng không chặn (route được
    gọi fire-and-forget từ client qua `sendKpiNotify()`,
    `src/lib/kpi-notify.ts`).
- Đã nối `sendKpiNotify()` vào **tất cả** action đã liệt kê + 2 action bổ sung
  hợp lý (chấm điểm 5S, xử lý khiếu nại — không có trong yêu cầu gốc nhưng là
  phần tự nhiên của "khiếu nại"/"5S" đã yêu cầu):
  - Giao việc mới (`kpi-task-form-modal.tsx`, sau `createKpiTask()`).
  - Cập nhật tiến độ + Nộp (`ProgressForm`, task detail).
  - Nghiệm thu/Điều chỉnh/Trả về/Yêu cầu bổ sung (`EvaluateModal`, task detail
    — không có trong yêu cầu gốc theo tên gọi, nhưng là phần lõi của "cập nhật
    tiến độ" từ phía người giao).
  - Chuyển giao: gửi yêu cầu (`TransferModal`) + chấp nhận/từ chối
    (`handleRespondTransfer`).
  - Đăng ký người thay thế tạm thời (`SubstitutionFormModal`, kpi/templates).
  - Gia hạn (`ExtendDeadlineModal`).
  - Khiếu nại: gửi mới (task lẫn 5S) + xử lý (`kpi/appeals/page.tsx`).
  - Phân công thông minh 5S (`kpi-5s-auto-assign-modal.tsx`, sau khi ghi xong).
  - Chấm điểm 5S hàng tuần (`kpi/5s/zone/[id]/page.tsx`).
- **Không** wire "sinh việc định kỳ tự động" (`kpi_ensure_today_task_instances`)
  — hàm đó chạy ngầm mỗi khi có ai mở app, bắn Telegram mỗi lần sẽ rất ồn ào
  (nhiều lần/ngày, nhiều người); nằm ngoài phạm vi yêu cầu gốc.

### E. Redesign giao diện — CHỈ `/dashboard/kpi/*`, không đụng module khác

- **Không tạo hệ thống animation mới** — tái dùng nguyên vẹn các utility class
  đã có sẵn toàn app (`src/app/globals.css` + hook `useScrollReveal` dùng
  chung ở Dashboard/Inventory/Storage): `.hover-lift` (thẻ nổi lên khi hover),
  `.row-hover` (dòng bảng), `.scroll-reveal` + `revealRef` (animation khi cuộn
  tới) — đúng nguyên tắc "không dùng animation framework rời rạc ngoài
  scroll-reveal đã có sẵn" (`.claude/rules/05-ui-components.md`).
- **Quy tắc an toàn đã tuân thủ nghiêm ngặt** (xem cảnh báo có sẵn trong
  05-ui-components.md: "React re-render dễ làm mất class `revealed`, gây ẩn dữ
  liệu"): `.scroll-reveal` **CHỈ** áp cho các khối có className TĨNH (không nội
  suy biến state ngay trong CHÍNH class string đó) như header trang, card banner
  tĩnh — **tuyệt đối không** áp cho grid danh sách task/khu vực 5S/khiếu nại
  (những khối này phụ thuộc dữ liệu tải async + filter, đúng loại bị cấm theo
  rule). Danh sách card đó chỉ dùng `.hover-lift`/`.row-hover` (an toàn tuyệt
  đối, thuần CSS, không phụ thuộc class JS thêm vào).
- `src/app/dashboard/kpi/_components/kpi-progress-bar.tsx` (component MỚI,
  `KpiProgressBar`) — thanh tiến độ "nổi khối": track có `shadow-inner` (rãnh
  lõm), phần fill có `boxShadow` + lớp phủ gradient trắng bán trong suốt phía
  trên (`bg-gradient-to-b from-white/45 to-transparent`) tạo cảm giác nổi/bóng.
  Màu **tính bằng nội suy HSL thật** (không phải vài mốc màu rời rạc): hue chạy
  0%→50% từ tím thương hiệu KPI (262°) sang hổ phách (38°), 50%→100% từ hổ
  phách sang xanh lá (152°), giữ `s=68% l=50%` để ra tông "pastel đậm đà" (bão
  hòa cao hơn pastel-100 mặc định nhưng vẫn không chói). Áp dụng ở: card danh
  sách công việc (`kpi/tasks/page.tsx`, size `sm`) và thanh tiến độ tổng của
  việc mục tiêu số lượng (`kpi/tasks/[id]/page.tsx`, size `md`, thay thanh
  phẳng 1 màu tím cố định trước đó).
- `kpi-shell.tsx` — mỗi tab có tông pastel đậm RIÊNG (trước đó mọi tab active
  đều cùng 1 màu tím): Tổng quan=tím, Công việc=xanh dương, Việc định kỳ=xanh
  ngọc, Đánh giá 5S=hổ phách, Khiếu nại=hồng — kèm `.hover-lift` trên mọi tab.
- Mỗi trang trong `/dashboard/kpi/*` (Tổng quan, Công việc, chi tiết công việc,
  Việc định kỳ, Đánh giá 5S danh sách + chi tiết, Khiếu nại): header đổi từ chữ
  trơn sang icon trong khung tròn gradient pastel đậm (màu riêng theo trang,
  khớp màu tab tương ứng) + `scroll-reveal`; toàn bộ thẻ card (task/khu vực/
  khiếu nại/template/substitution/member row) thêm `.hover-lift` hoặc
  `.row-hover`.
- **KHÔNG đụng** `kpi-5s-zones-tab.tsx`/`kpi-5s-auto-assign-modal.tsx`
  (`/dashboard/settings/_components/`) — dù thuộc module KPI về nghiệp vụ,
  nằm vật lý trong route `/dashboard/settings/*` nên NGOÀI phạm vi
  `/dashboard/kpi/*` đã chốt với người dùng; giữ nguyên style Settings hiện có
  để nhất quán với các tab Cài đặt khác.

`npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa của cả A+B+C+D+E), và
`npm run build` đều sạch qua từng phần (chạy riêng sau mỗi phần A, B, C để dễ
khoanh vùng nếu lỗi — đều pass ngay từ lần đầu, không phải sửa lại).

### Chưa test tay — cần làm ở phiên sau (theo đúng thứ tự, một số bước phụ thuộc bước trước)

1. Chạy đủ 3 migration theo thứ tự: `20260730_kpi_task_extend_deadline.sql` →
   `20260731_kpi_appeals.sql` (không phụ thuộc nhau nhưng nên chạy cả 2 trước
   khi test) — cộng migration Phase 2 `20260729_kpi_5s_zones.sql` nếu chưa chạy
   từ phiên trước.
2. Cấu hình `QL_CONG_VIEC_CHAT_TOKEN`/`QL_CONG_VIEC_CHAT_ID` trong môi trường
   Vercel production nếu chưa có (đã xác nhận có sẵn trong `.env.local` local,
   cần kiểm tra đã đồng bộ lên production hay chưa).
3. **Phân công thông minh**: tạo ≥4 khu vực 5S test, để trống người dọn/chấm →
   Cài đặt → KPI & 5S → "Phân công thông minh" → chọn "Toàn bộ" → "Tạo đề xuất"
   → xác nhận preview hiện đủ, sửa tay 1-2 dòng → "Xác nhận & Giao" → xác nhận
   chỉ đúng số dòng đã thay đổi được ghi, banner tóm tắt đúng, Telegram nhận
   được tin nhắn liệt kê đúng người/khu vực. Test lại lần 2 với 1 người đã có
   tải cao — xác nhận thuật toán có xu hướng né người đó (không tuyệt đối, vì
   vẫn là random có trọng số).
4. **Gia hạn**: mở 1 công việc đang mở, bấm "Gia hạn" → đổi hạn + lý do → xác
   nhận hạn cập nhật đúng, mỗi thành viên active có 1 dòng log riêng trong dòng
   thời gian của họ, Telegram nhận tin đúng nội dung hạn cũ/mới.
5. **Khiếu nại**: từ 1 công việc (thành viên hoặc người giao) → "Khiếu nại" →
   gửi → xác nhận xuất hiện ở `/dashboard/kpi/appeals` (chủ khiếu nại thấy của
   mình, tài khoản khác không phải admin/kpi.manage_config KHÔNG thấy), Telegram
   nhận tin. Tài khoản admin/kpi.manage_config xử lý (Đã giải quyết/Từ chối +
   phản hồi) → xác nhận trạng thái cập nhật đúng, Telegram nhận tin phản hồi.
   Lặp lại tương tự cho khiếu nại từ 1 lần chấm điểm 5S (chỉ nguoi_don/
   nguoi_cham của đúng lần chấm đó mới thấy nút Khiếu nại).
6. **Redesign UI**: xem trên trình duyệt thật từng trang `/dashboard/kpi/*` —
   xác nhận thanh tiến độ đổi màu đúng theo % (thấp=tím, giữa=hổ phách,
   cao=xanh lá), hover vào card thấy nổi lên rõ ràng, cuộn trang thấy header
   fade-in đúng 1 lần (không lặp lại khi cuộn qua lại), tab bar mỗi tab đúng
   màu riêng. Xác nhận KHÔNG có card/danh sách nào bị "biến mất" do lỗi
   scroll-reveal (test bằng cách filter/tải lại dữ liệu nhiều lần liên tiếp).
7. Test tổng hợp: 1 kịch bản đầy đủ từ đầu đến cuối — Phân công thông minh 2
   khu vực → 1 người chấm điểm "Không đạt" kèm lý do → người dọn khiếu nại →
   admin xử lý → suốt quá trình xác nhận Telegram luôn nhận đủ, đúng thứ tự,
   không tin nào bị thiếu do lỗi mạng/env.

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

## Cập nhật 2026-07-26 (tiếp) — 2 bug thật + mức "Tương đối" + Nhóm khu vực cho Phân công thông minh

Người dùng test Phase 2 (Đánh giá 5S) trên dữ liệu thật (RyTa/Nho, factory
`phuochoa_kt`) và báo 2 bug thật + 2 yêu cầu tính năng. Đã fix/triển khai đầy đủ,
`npx tsc --noEmit`/`npx eslint`/`npm run build` đều sạch. **Chưa test tay** — xem
checklist cuối mục.

### Bug 1 — Nút "Khiếu nại" hiện cho cả người CHẤM lẫn người BỊ chấm

Trước đó điều kiện hiện nút là `user.id === e.nguoi_don_id || user.id ===
e.nguoi_cham_id` (OR) — dữ liệu thật xác nhận cả người dọn (RyTa) lẫn người chấm
(Nho) đều tự khiếu nại được về cùng 1 lần chấm, dù người chấm khiếu nại về chính
lần chấm do họ tạo ra là vô lý.

- `src/app/dashboard/kpi/5s/zone/[id]/page.tsx`: nút "Khiếu nại" giờ chỉ hiện khi
  `user.id === e.nguoi_don_id`.
- Migration `supabase/migrations/20260801_kpi_appeals_fix_insert_policy.sql`
  (**cần chạy thủ công**) — thắt lại RLS `kpi_appeals_insert`: bỏ nhánh
  `e.nguoi_cham_id = auth.uid()` khỏi điều kiện cho `zone_evaluation_id`, chỉ giữ
  `e.nguoi_don_id = auth.uid()`. Bắt buộc sửa cả RLS (không chỉ ẩn nút UI) — nếu
  không, gọi thẳng `createKpiAppealForZoneEvaluation` qua devtools vẫn insert
  được cho người chấm. Nhánh `task_id` (khiếu nại công việc) giữ nguyên.
- Case "người chấm tự phát hiện chấm sai" (không còn nút Khiếu nại cho họ) được
  giải quyết bằng nút **"Sửa kết quả"** mới — xem Bug 2.

### Bug 2 — "Đã giải quyết" khiếu nại không sửa lại kết quả 5S gốc

Trước đó `resolveKpiAppeal()` chỉ UPDATE bảng `kpi_appeals`
(`trang_thai`/`phan_hoi`/`nguoi_xu_ly_id`) — không có cơ chế nào sửa lại
`kpi_5s_evaluations.ket_qua` gây tranh chấp (bảng cố ý thiết kế bất biến, không
RLS UPDATE cho client). Dữ liệu thật xác nhận: khiếu nại của RyTa đã
`trang_thai='da_giai_quyet'` nhưng `ket_qua` vẫn `'khong_dat'`.

- Migration `supabase/migrations/20260802_kpi_5s_evaluation_correct.sql` (**cần
  chạy thủ công, SAU** `20260803_kpi_5s_result_tuong_doi.sql`) — RPC
  `SECURITY DEFINER` mới `kpi_5s_evaluation_correct(p_zone_evaluation_id,
  p_new_ket_qua, p_new_ly_do, p_ghi_chu, p_appeal_id DEFAULT NULL)`, chỉ
  admin/`kpi.manage_config`. Đây là **ngoại lệ DUY NHẤT** được phép sửa
  `kpi_5s_evaluations` — chỉ đi qua đúng 1 cửa RPC, không mở lại RLS UPDATE.
  - `p_appeal_id` có giá trị: đang xử lý 1 khiếu nại `cho_xu_ly` có sẵn → sửa
    `ket_qua`/`ly_do` VÀ đóng khiếu nại đó thành `da_giai_quyet` trong cùng
    transaction (`FOR UPDATE` khóa cả 2 bảng, chặn xử lý 2 lần).
  - `p_appeal_id` là NULL: admin tự sửa trực tiếp (case Bug 1 nêu trên) → tự
    `INSERT` 1 dòng `kpi_appeals` mới đã `da_giai_quyet` ngay, nội dung "Admin
    tự sửa kết quả (không qua khiếu nại)" — dùng lại `kpi_appeals` làm audit
    trail duy nhất, không thêm cột mới vào `kpi_5s_evaluations`.
- `src/lib/kpi-appeals.ts` thêm 2 wrapper: `resolveKpiZoneEvaluationAppeal()`
  (truyền `p_appeal_id`) và `correctKpi5sEvaluationDirect()` (không truyền).
  `resolveKpiAppeal()` cũ giữ nguyên, vẫn dùng cho khiếu nại `task_id` và cho
  nhánh "Từ chối" của khiếu nại 5S (không sửa kết quả khi từ chối).
- `src/app/dashboard/kpi/appeals/page.tsx`: modal "Đánh dấu đã giải quyết" —
  khi appeal gắn `zone_evaluation_id` VÀ đang chọn "Đã giải quyết", hiện thêm
  `Kpi5sResultPicker` (mặc định = kết quả hiện tại, câu SELECT `zoneRefs` đã mở
  rộng lấy thêm `ket_qua, ly_do`), gọi `resolveKpiZoneEvaluationAppeal` thay vì
  `resolveKpiAppeal`.
- `src/app/dashboard/kpi/5s/zone/[id]/page.tsx`: thêm nút nhỏ **"Sửa kết quả"**
  (icon `Pencil`) trên mỗi dòng lịch sử, chỉ hiện khi
  `isAdmin || hasPermission(user, "kpi.manage_config")`, mở modal riêng gọi
  `correctKpi5sEvaluationDirect`. Tách biệt hoàn toàn với nút "Khiếu nại".

### Mức trung gian "Tương đối" (Đạt/Tương đối/Không đạt)

- Migration `supabase/migrations/20260803_kpi_5s_result_tuong_doi.sql` (**cần
  chạy thủ công, TRƯỚC** migration Bug 2 ở trên) — dùng `DO` block dò và drop
  toàn bộ CHECK constraint tham chiếu cột `ket_qua` (thay vì đoán tên constraint
  mặc định Postgres tự sinh, an toàn hơn hard-code), tạo lại 2 constraint có tên
  tường minh: `ket_qua IN ('dat','tuong_doi','khong_dat')` và **bắt buộc lý do
  cho cả `tuong_doi` lẫn `khong_dat`** (đã chốt với người dùng — giữ lịch sử
  minh bạch, dễ tra cứu vì sao không đạt tuyệt đối).
- `src/lib/kpi-5s.ts`: `Kpi5sResult` thêm `"tuong_doi"`, `KPI_5S_RESULT_LABEL`
  thêm `"Tương đối"`. Thêm hằng số dùng chung mới `KPI_5S_RESULT_BADGE_CLASS`
  (dat=emerald, tuong_doi=amber, khong_dat=rose) — mọi nơi hiển thị badge kết
  quả đều dùng chung, không hard-code lại màu.
- Component dùng chung mới `src/app/dashboard/kpi/_components/kpi-5s-result-picker.tsx`
  (`Kpi5sResultPicker`) — 3 nút Đạt/Tương đối/Không đạt + ô lý do (bắt buộc khi
  khác "Đạt"). Dùng ở **3 nơi**: form "Chấm điểm tuần này" (zone detail), modal
  "Sửa kết quả" (Bug 2, zone detail), modal resolve-appeal (trang Khiếu nại) —
  tránh viết lại 3 lần cùng 1 logic.
- `src/app/dashboard/kpi/5s/zone/[id]/page.tsx` và `src/app/dashboard/kpi/5s/page.tsx`:
  badge màu kết quả trong lịch sử/card danh sách đổi từ hard-code 2 màu
  (`ket_qua === "dat" ? emerald : rose`) sang lookup `KPI_5S_RESULT_BADGE_CLASS`.
- **Công thức "C — Điểm 5S" cập nhật** (thuần tài liệu — Phase 4 chấm điểm tháng
  chưa build, không có engine code để đụng): `Đạt=100, Tương đối=50, Không
  đạt=0` — khớp đúng quy ước 1.0/0.5/0 đã dùng sẵn cho công thức "D — Điểm
  chuyên môn" (`kpi_daily_evaluation_items`, cũng chưa build).

### Nhóm khu vực 5S theo khu vực vật lý — random chỉ trong nội bộ nhóm

Trước đó "Phân công thông minh" coi TOÀN BỘ khu vực + TOÀN BỘ nhân sự là 1 pool
duy nhất khi random — không có cách nào giới hạn random chỉ trong 1 khu vực vật
lý (vd "Kho 1" chỉ đổi với "Kho 1", không lẫn "Văn phòng").

**Kiến trúc đã chốt**: tái dùng nguyên `personnel_groups`/`personnel_group_members`
đã có sẵn (đúng quyết định gốc Phase 0 — không tạo bảng nhóm mới). Admin tự tạo
các nhóm MỚI thuần túy cho mục đích 5S (vd "Văn phòng", "Kho 1", "Kho 2", "Ca SX
mủ tạp", "Ca SX mủ nước"...) qua UI Cài đặt → Hệ thống → Nhân sự đã có sẵn —
không cần migration seed, không cần code CRUD mới cho bước tạo nhóm.

- Migration `supabase/migrations/20260804_kpi_5s_zones_eligible_group.sql`
  (**cần chạy thủ công**) — thêm cột `kpi_5s_zones.eligible_group_id UUID
  REFERENCES personnel_groups(id) ON DELETE SET NULL`. `NULL` = hành vi cũ
  (pool toàn nhà máy) — backward-compatible với khu vực đã tạo trước đó.
- `src/lib/kpi-5s.ts`: `Kpi5sZone`/`ZONE_COLS`/`Kpi5sZoneInput` thêm
  `eligible_group_id: string | null`.
- `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx`: tự load
  `loadAllPersonnelGroups(factoryId)` (đã có sẵn trong `src/lib/kpi-templates.ts`,
  dùng cho `/dashboard/kpi/templates`) song song với zones trong `loadData` —
  **không cần sửa `settings/page.tsx`** (component tự fetch, không cần prop mới
  từ cha). Thêm dropdown "Nhóm khu vực (random nội bộ)" trong form Thêm/Sửa (kèm
  text hướng dẫn ngắn), hiển thị tên nhóm trên card khu vực nếu đã gán.
- **Đã chốt với người dùng**: form Thêm/Sửa khu vực (chọn tay Người dọn/Người
  chấm) **KHÔNG** bị giới hạn theo `eligible_group_id` — chỉ thuật toán random
  tôn trọng ràng buộc này.
- `src/lib/kpi-5s-auto-assign.ts`: `AutoAssignCandidate` thêm `groupIds: string[]`
  (đã có sẵn từ `loadKpiTaskCandidates`, chỉ truyền qua); `AutoAssignZoneInput`
  thêm `eligible_group_id`; `AutoAssignSuggestion` thêm cờ mới `areaPoolRelaxed`
  (song song `groupConstraintRelaxed` đã có, ý nghĩa khác — relax vì pool khu
  vực <2 người, không phải vì trùng nhóm chính). Mỗi zone tự tính `areaPool =
  people.filter(p => p.groupIds.includes(zone.eligible_group_id))`; nếu
  `areaPool.length < 2` → dùng lại toàn bộ `people` + đánh dấu
  `areaPoolRelaxed`. Ràng buộc "tránh cùng nhóm chính" (`avoidSameGroup`) áp
  dụng SAU, độc lập, BÊN TRONG `areaPool` đã lọc — 2 tầng ràng buộc lồng nhau,
  mỗi tầng có cờ relax riêng. Trọng số random (`loadByUser`, ai đang tải ít hơn
  có xác suất cao hơn) vẫn tính trên tải TOÀN NHÀ MÁY như cũ — chỉ phạm vi ứng
  viên hợp lệ bị thu hẹp theo nhóm.
- `src/app/dashboard/settings/_components/kpi-5s-auto-assign-modal.tsx`: truyền
  thêm `eligible_group_id`/`groupIds` khi gọi `buildAutoAssignSuggestions`; hiện
  cảnh báo `areaPoolRelaxed` (icon `AlertTriangle` hổ phách) cho CẢ 2 dropdown
  Người dọn/Người chấm — khác `groupConstraintRelaxed` chỉ ảnh hưởng Người chấm.

### Chưa test tay — cần làm ở phiên sau

1. Chạy đủ 4 migration mới theo đúng thứ tự: `20260801_...` (bug 1, độc lập) →
   `20260803_...` (mức Tương đối) → `20260802_...` (bug 2, phụ thuộc 20260803)
   → `20260804_...` (nhóm khu vực, độc lập) trên Supabase SQL Editor.
2. Đăng nhập Nho (người chấm) mở lại khu vực có lịch sử chấm điểm của chính họ
   — xác nhận KHÔNG còn thấy nút "Khiếu nại"; đăng nhập RyTa (người dọn) — vẫn
   thấy nút bình thường. Thử insert thẳng qua devtools với tư cách Nho — phải
   bị RLS chặn.
3. Admin mở lại khiếu nại cũ của RyTa (hoặc tạo appeal mới), chọn "Đã giải
   quyết" kèm đổi kết quả sang "Đạt" — xác nhận `kpi_5s_evaluations.ket_qua`
   đổi đúng ngay lập tức, badge lịch sử cập nhật đúng màu ở cả trang chi tiết
   khu vực lẫn card `/dashboard/kpi/5s`. Test nút "Sửa kết quả" độc lập (không
   qua khiếu nại có sẵn) trên trang chi tiết khu vực — xác nhận tạo đúng 1
   khiếu nại tự động "Đã giải quyết" với nội dung "Admin tự sửa...".
4. Chấm 1 tuần mới chọn "Tương đối" mà không nhập lý do — phải bị chặn (bắt
   buộc như "Không đạt"); nhập lý do xong lưu được, badge màu amber đúng.
5. ~~Tạo 2 nhóm mới ở Cài đặt → Nhân sự (vd "Kho 1", "Kho 2")...~~ — **ĐÃ HỦY,
   xem mục "Kế hoạch phiên sau (viết 2026-07-26) — Tách 'Nhóm khu vực 5S' khỏi
   personnel_groups" ngay bên dưới.** Người dùng phát hiện đúng lúc test tay:
   kiến trúc "tái dùng `personnel_groups`" cho `eligible_group_id` là **bug
   thiết kế thật**, không chỉ là chi tiết UX — phải làm lại theo hướng tách
   riêng hoàn toàn trước khi test lại mục 5 này.

## Kế hoạch phiên sau (viết 2026-07-26) — Tách "Nhóm khu vực 5S" khỏi personnel_groups

### Bug đã xác nhận (không chỉ là UX rối mắt — có rủi ro sai điểm KPI thật)

Người dùng phát hiện ngay khi mở form "Thêm khu vực 5S" (chưa kịp tạo dữ liệu
thật — đã verify qua DB: cả 2 khu vực `PH01`/`PGĐ` hiện có vẫn `eligible_group_id
= NULL`, không có dữ liệu test nào cần dọn): dropdown "Nhóm khu vực (random nội
bộ)" trong `kpi-5s-zones-tab.tsx` tái dùng thẳng `personnel_groups` — đúng bảng
đang được dùng cho **hệ số điểm KPI chuyên môn** (nhóm chính ×10, nhóm choàng ×5,
xem mục "D — Điểm chuyên môn"). Đã xác nhận qua đọc code (`settings/page.tsx`
dòng 4560-4596, form Thêm/Sửa "Nhóm"): đây là **1 danh sách phẳng dùng chung**,
không có cột nào phân biệt "loại nhóm" — `personnel_groups` chỉ có
`id, factory_id, code, name, description, is_system, is_active, sort_order`
(`supabase/migrations/20260607_create_personnel_groups.sql`).

Hệ quả 2 tầng:

1. **UX**: tạo 1 nhóm "Kho 1" cho mục đích 5S sẽ hiện lẫn trong Cài đặt → Hệ
   thống → Nhân sự cùng các nhóm chuyên môn thật (Cơ điện, Bảo trì, Trực ca...)
   — đúng phản ánh của người dùng: "Nhóm" (bao quát toàn nhà máy, chỉ 1 nhóm
   người làm được việc đó) và "Khu vực" (5S, phân công dọn dẹp/đánh giá theo
   khu vực vật lý) là **2 trục khái niệm hoàn toàn khác nhau**, không nên dùng
   chung 1 danh mục.
2. **Đúng đắn dữ liệu (nghiêm trọng hơn)**: vì cùng 1 bảng, nhóm "Kho 1" sẽ
   XUẤT HIỆN trong chính dropdown "Nhóm chính"/tick-chọn-nhóm ở form Nhân sự
   (dùng để tính hệ số KPI chuyên môn) — admin có thể lỡ tay tick "Kho 1" làm
   nhóm chuyên môn của 1 nhân viên, khiến công thức D (`%đạt×10` cho nhóm
   chính) tính sai hoàn toàn dựa trên 1 nhóm chưa từng có ý nghĩa "chuyên môn"
   nào — sai điểm KPI thật, không chỉ rối giao diện.

**Quyết định đã chốt với người dùng**: tách hoàn toàn — tạo danh mục "Nhóm khu
vực 5S" MỚI, độc lập 100% với `personnel_groups`, không hiện trong Cài đặt →
Nhân sự, không thể bị chọn nhầm cho KPI chuyên môn.

### Thiết kế kỹ thuật

**Migration mới** (vd `20260805_kpi_5s_zone_groups.sql`, cần chạy thủ công):

- Bảng `kpi_5s_zone_groups` — `id, factory_id, ten TEXT NOT NULL, is_active
  BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at, updated_at`,
  `UNIQUE(factory_id, lower(ten))`. RLS mirror `kpi_5s_zones`: SELECT rộng trong
  factory, INSERT/UPDATE/DELETE chỉ admin/`kpi.manage_config`.
- Bảng `kpi_5s_zone_group_members` — `id, factory_id, zone_group_id →
  kpi_5s_zone_groups(id) ON DELETE CASCADE, user_id UUID REFERENCES
  auth.users(id), created_at`, `UNIQUE(zone_group_id, user_id)`. **Dùng
  `user_id` (auth.users) trực tiếp, KHÔNG dùng `staff_id` (maintenance_staff)
  như `personnel_group_members`** — để nhất quán với toàn bộ model candidate
  của module KPI (`kpi_5s_zones.nguoi_don_id`, `kpi_task_members.user_id`...
  đều dùng thẳng `auth.users.id`, resolve tên qua `loadKpiTaskCandidates`). RLS
  mirror bảng trên.
- `kpi_5s_zones`: đổi cột `eligible_group_id` (hiện `NULL` ở mọi khu vực, xác
  nhận không có dữ liệu cần backfill) — `DROP COLUMN eligible_group_id` (bỏ FK
  cũ trỏ `personnel_groups`) rồi `ADD COLUMN zone_group_id UUID REFERENCES
  kpi_5s_zone_groups(id) ON DELETE SET NULL`. **Đổi tên cột** (không giữ
  `eligible_group_id`) để không còn gợi nhớ tới `personnel_groups` — tên mới
  phản ánh đúng bảng đích.

**File cần sửa (rename `eligible_group_id` → `zone_group_id` xuyên suốt +
đổi nguồn dữ liệu):**

- `src/lib/kpi-5s.ts` — `Kpi5sZone`/`ZONE_COLS`/`Kpi5sZoneInput`: đổi tên field.
- **File mới** `src/lib/kpi-5s-zone-groups.ts` — CRUD `kpi_5s_zone_groups`
  (`fetchKpi5sZoneGroups`, `createKpi5sZoneGroup`, `updateKpi5sZoneGroup`,
  `deleteKpi5sZoneGroup`) + membership (`fetchKpi5sZoneGroupMembers(zoneGroupId)`
  hoặc `fetchAllZoneGroupMemberships(factoryId): Map<zoneGroupId, userId[]>`,
  `addKpi5sZoneGroupMember`, `removeKpi5sZoneGroupMember`) — KHÔNG thêm vào
  `kpi-5s.ts` (giữ tách file để rõ ràng đây là khái niệm độc lập, đúng tinh
  thần "tách hoàn toàn").
- `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx` — dropdown đổi
  nguồn từ `loadAllPersonnelGroups` sang `fetchKpi5sZoneGroups`; đổi nhãn field
  form thành `zone_group_id`; text hướng dẫn đổi lại trỏ đúng
  "Cài đặt → KPI & 5S → Nhóm khu vực 5S" (KHÔNG còn nhắc "Cài đặt → Hệ thống →
  Nhân sự").
- **Component mới** `src/app/dashboard/settings/_components/kpi-5s-zone-groups-tab.tsx`
  — CRUD danh sách nhóm khu vực (card + modal Thêm/Sửa, mirror
  `kpi-5s-zones-tab.tsx`) + nút "Quản lý thành viên" mỗi card mở modal checklist
  (dùng `loadKpiTaskCandidates` lấy danh sách người, tick/bỏ tick gọi
  `addKpi5sZoneGroupMember`/`removeKpi5sZoneGroupMember`).
- `src/app/dashboard/settings/page.tsx` — thêm sub-tab thứ 2 "Nhóm khu vực 5S"
  vào mảng sub-tab của `tab === "kpi-5s"` (dòng ~5864, hiện chỉ có 1 phần tử
  `"khu-vuc"`), mở rộng type `kpi5sTab` (dòng 847) từ `"khu-vuc"` thành
  `"khu-vuc" | "nhom-khu-vuc"`, thêm block render mirror khối `khu-vuc` hiện có
  (dòng 5881-5892).
- `src/lib/kpi-5s-auto-assign.ts`:
  - `AutoAssignZoneInput.eligible_group_id` → `zone_group_id`.
  - `AutoAssignCandidate` thêm field mới `zoneGroupIds: string[]` (membership
    trong `kpi_5s_zone_groups`) — **KHÔNG đụng `primaryGroupId`/`groupIds`
    hiện có** (vẫn giữ nguyên trỏ `personnel_groups`, dùng cho ràng buộc mềm
    "tránh người chấm cùng nhóm CHUYÊN MÔN chính với người dọn" — đây là 1 mục
    đích hợp lệ khác, không liên quan gì tới nhóm khu vực, không được gộp lại
    lần nữa).
  - Lọc pool đổi từ `p.groupIds.includes(zone.eligible_group_id)` sang
    `p.zoneGroupIds.includes(zone.zone_group_id)`.
- `src/app/dashboard/settings/_components/kpi-5s-auto-assign-modal.tsx` — thêm
  bước tải `fetchAllZoneGroupMemberships(factoryId)` (song song
  `loadKpiTaskCandidates`), merge `zoneGroupIds` vào từng candidate trước khi
  gọi `buildAutoAssignSuggestions`; đổi `eligible_group_id` → `zone_group_id`
  khi map `zones`.

### Việc cần làm ở phiên sau (theo đúng thứ tự)

1. Viết + chạy migration `20260805_kpi_5s_zone_groups.sql` trên Supabase SQL
   Editor (không cần backfill — xác nhận 0 khu vực nào đang dùng
   `eligible_group_id`).
2. Code đủ các file liệt kê ở trên, ưu tiên: lib mới → rename field `kpi-5s.ts`
   → `kpi-5s-auto-assign.ts` → 2 file UI khu vực đã có → component mới "Nhóm
   khu vực 5S" → `settings/page.tsx` (thêm sub-tab, mechanical).
3. `npx tsc --noEmit`, `npx eslint`, `npm run build` — đều phải sạch.
4. Test tay: tạo 2 "Nhóm khu vực 5S" (vd "Kho 1", "Kho 2") tại đúng sub-tab
   mới — xác nhận **KHÔNG** xuất hiện ở Cài đặt → Hệ thống → Nhân sự, và
   **KHÔNG** xuất hiện trong dropdown "Nhóm chính"/tick-nhóm của form Nhân sự.
   Gán vài người vào mỗi nhóm qua "Quản lý thành viên". Gán "Nhóm khu vực" cho
   2-3 khu vực 5S theo đúng 2 nhóm trên → mở "Phân công thông minh" → xác nhận
   random chỉ chọn đúng người trong nhóm khu vực tương ứng, không lẫn người
   ngoài; thử 1 nhóm chỉ có 1 thành viên → xác nhận `areaPoolRelaxed` vẫn hoạt
   động đúng (nới lỏng, không treo). Xác nhận form Thêm/Sửa khu vực (chọn tay
   Người dọn/Người chấm) vẫn tự do, không bị giới hạn theo nhóm khu vực.

## Cập nhật 2026-08-05 — Sửa nhầm lẫn tầng khái niệm: "Vị trí" vs "Khu vực" +
triển khai xong "tách khỏi personnel_groups" (thay thế kế hoạch phía trên)

Mục kế hoạch ngay phía trên ("Tách 'Nhóm khu vực 5S' khỏi personnel_groups",
viết 2026-07-26) đã được triển khai, nhưng **trong lúc code lại phát hiện thêm
1 nhầm lẫn nghiêm trọng hơn** ở chính tầng đặt tên gốc — không chỉ là vấn đề
"nhóm khu vực nên tách khỏi personnel_groups" như kế hoạch cũ mô tả.

### Nhầm lẫn được phát hiện

Người dùng chỉ ra trực tiếp: **"Đúng là khu vực văn phòng có phòng PGĐ, phòng
PH01 chứ không phải PGĐ, PH01 là khu vực"**. Tức là bảng `kpi_5s_zones` gốc
(mỗi dòng như "PGĐ"/"PH01", có 1 QR riêng để chấm điểm hàng tuần) đã bị gọi
**sai tầng** — đây là tầng NHỎ (1 vị trí/phòng cụ thể cần dọn dẹp), không phải
"khu vực". "Khu vực" đúng nghĩa là tầng LỚN (Văn phòng, Kho 1, Kho 2, Ca SX mủ
tạp, Ca SX mủ nước — đúng như yêu cầu gốc của người dùng khi lần đầu đề xuất
tính năng "Phân công thông minh"), CHỨA nhiều vị trí nhỏ bên trong.

Đã hỏi lại và chốt 2 quyết định trước khi code:

- Tầng nhỏ (PGĐ, PH01...) đổi tên thành **"Vị trí"** ("Vị trí 5S") — thuật ngữ
  trung tính, dùng được cho cả phòng (Văn phòng) lẫn các điểm cụ thể trong
  Kho 1/Kho 2/trạm sản xuất (không phải lúc nào cũng là "phòng").
- Đổi **TOÀN BỘ nhất quán** — cả nhãn UI lẫn route/tên bảng/tên hàm kỹ thuật —
  vì xác nhận **chưa in/phát QR nào ra hiện trường thật** (chỉ 2 vị trí test
  PGĐ/PH01), đổi ngay lúc này ít tốn kém nhất.

### Kỹ thuật "tái dùng tên đã giải phóng"

Sau `ALTER TABLE kpi_5s_zones RENAME TO kpi_5s_locations`, tên `kpi_5s_zones`
được giải phóng — dùng lại đúng tên đó cho bảng MỚI của tầng lớn "Khu vực"
(khớp tự nhiên tiếng Anh zone=khu vực lớn, location=vị trí cụ thể). Áp dụng
tương tự cho file UI (`kpi-5s-zones-tab.tsx` cũ đổi tên thành
`kpi-5s-locations-tab.tsx`, tên file `kpi-5s-zones-tab.tsx` được tái dùng cho
UI MỚI của tầng lớn) và tên hàm lib (`fetchKpi5sZones`/`createKpi5sZone`/...
tái dùng cho tầng lớn). Vì vậy **kết quả cuối cùng khác tên so với kế hoạch
"Nhóm khu vực 5S" (`kpi_5s_zone_groups`) mô tả ở mục ngay phía trên** — bảng
tầng lớn thật sự tên là `kpi_5s_zones`/`kpi_5s_zone_members`, không phải
`kpi_5s_zone_groups`/`kpi_5s_zone_group_members`. Nội dung/logic bên trong kế
hoạch cũ (tách khỏi `personnel_groups`, dùng `auth.users.id` trực tiếp, RLS
mirror, thuật toán không đổi) được giữ nguyên và áp dụng đúng.

### Migration `supabase/migrations/20260805_kpi_5s_rename_locations_and_zones.sql`
(**cần chạy thủ công, CHƯA CHẠY — phải chạy SAU 4 migration `20260801-04`**)

Gồm 2 phần trong cùng 1 file:

**Phần 1 — rename tầng nhỏ**: `ALTER TABLE kpi_5s_zones RENAME TO
kpi_5s_locations`; đổi tên cột `ma_khu_vuc→ma_vi_tri`, `ten_khu_vuc→ten_vi_tri`,
`vi_tri_mo_ta→mo_ta`; `DROP COLUMN eligible_group_id` (cột thêm ở migration
`20260804`, thiết kế tái dùng `personnel_groups` đã huỷ — xác nhận cả 2 dòng
PGĐ/PH01 hiện `NULL`, xoá an toàn không mất dữ liệu); `ALTER TABLE
kpi_5s_evaluations RENAME COLUMN zone_id TO location_id`; `ALTER TABLE
kpi_appeals RENAME COLUMN zone_evaluation_id TO location_evaluation_id`; DROP +
CREATE lại tường minh mọi RLS policy liên quan (đổi tên bảng/cột lẫn tên
policy). **Quan trọng nhất**: `CREATE OR REPLACE FUNCTION
kpi_5s_evaluation_correct(...)` phải viết lại với tham số
`p_location_evaluation_id` (đổi từ `p_zone_evaluation_id`) — vì PL/pgSQL
function body là **raw SQL text**, KHÔNG tự động cascade theo tên cột như RLS
policy/VIEW/CHECK/FK (những thứ đó là parsed expression tree gắn theo OID) —
bỏ qua bước này hàm sẽ lỗi "column does not exist" ngay khi user bấm "Sửa kết
quả"/"Đánh dấu đã giải quyết" sau migration.

**Phần 2 — tạo tầng lớn (nối tiếp trong cùng file, sau khi rename xong)**:
`CREATE TABLE kpi_5s_zones (id, factory_id, ten TEXT NOT NULL, is_active,
sort_order, created_at, updated_at)`, `UNIQUE(factory_id, lower(ten))`, RLS
SELECT rộng trong factory + INSERT/UPDATE/DELETE chỉ admin/`kpi.manage_config`;
`CREATE TABLE kpi_5s_zone_members (id, factory_id, zone_id → kpi_5s_zones ON
DELETE CASCADE, user_id UUID → auth.users, created_at)`,
`UNIQUE(zone_id, user_id)`, RLS mirror; `ALTER TABLE kpi_5s_locations ADD
COLUMN zone_id UUID REFERENCES kpi_5s_zones(id) ON DELETE SET NULL`.

### File đã đổi (đầy đủ, đã build sạch)

- Route đổi tên: `src/app/dashboard/kpi/5s/zone/[id]/` →
  `src/app/dashboard/kpi/5s/location/[id]/page.tsx` (viết lại toàn bộ theo tên
  mới, dùng `buildKpi5sLocationUrl`/`fetchKpi5sLocation`/
  `Kpi5sLocation`/`downloadKpi5sLocationBulkQrPdf`/
  `createKpiAppealForLocationEvaluation`).
- `src/lib/kpi-5s.ts` — viết lại theo tầng nhỏ: `Kpi5sLocation`, `LOCATION_COLS`,
  `fetchKpi5sLocations/fetchKpi5sLocation/createKpi5sLocation/
  updateKpi5sLocation/deleteKpi5sLocation`, `Kpi5sEvaluation.location_id`,
  `fetchKpi5sEvaluations(locationId)`, `fetchLatestKpi5sEvaluationsByLocationIds`,
  `buildKpi5sLocationUrl` (path `/dashboard/kpi/5s/location/${id}`),
  `uploadKpi5sEvaluationImage(factoryId, locationId, file)`. `Kpi5sResult`/
  `KPI_5S_RESULT_LABEL`/`KPI_5S_RESULT_BADGE_CLASS` (3 mức, từ 2026-07-25)
  không đổi.
- `src/lib/kpi-5s-pdf.ts` — `downloadKpi5sZoneBulkQrPdf` →
  `downloadKpi5sLocationBulkQrPdf`, tham số `zones`→`locations`.
- **File mới** `src/lib/kpi-5s-zones.ts` (tái dùng tên file giải phóng) — CRUD
  tầng lớn `kpi_5s_zones` (`fetchKpi5sZones/createKpi5sZone/updateKpi5sZone/
  deleteKpi5sZone`) + `fetchAllZoneMemberships(factoryId): Map<zoneId,
  userId[]>`, `addKpi5sZoneMember`, `removeKpi5sZoneMember`. Header comment ghi
  rõ tách biệt hoàn toàn khỏi `personnel_groups`.
- `src/app/dashboard/kpi/5s/page.tsx` — danh sách vị trí, link
  `/dashboard/kpi/5s/location/${id}`.
- `src/lib/kpi-appeals.ts` — `KpiAppeal.location_evaluation_id`,
  `createKpiAppealForLocationEvaluation`, `resolveKpiLocationEvaluationAppeal`
  (RPC key `p_location_evaluation_id`), `correctKpi5sEvaluationDirect` (RPC key
  `p_location_evaluation_id`).
- `src/app/dashboard/kpi/appeals/page.tsx` — `LocationEvalRef`/`LocationRef`,
  query `.from("kpi_5s_locations").select("id, ma_vi_tri, ten_vi_tri")`.
- `src/app/dashboard/kpi/5s/_components/kpi-5s-image-picker.tsx` — prop
  `zoneId`→`locationId`.
- `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx` (file cũ) đổi
  tên thành `kpi-5s-locations-tab.tsx` — `Kpi5sLocationsTab`, dropdown "Khu
  vực" mới trong form Thêm/Sửa vị trí lấy nguồn từ `fetchKpi5sZones` (KHÔNG
  phải `personnel_groups`), gọi `Kpi5sAutoAssignModal` với prop `locations`.
- **File UI mới** `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx`
  (tái dùng tên file giải phóng) — `Kpi5sZonesTab({factoryId, canManage})`:
  CRUD khu vực (`ten`/`is_active`/`sort_order`) + nút "Quản lý thành viên" mỗi
  card mở modal checklist (dùng `loadKpiTaskCandidates`, tick/bỏ tick gọi
  `addKpi5sZoneMember`/`removeKpi5sZoneMember`).
- `src/lib/kpi-5s-auto-assign.ts` — `AutoAssignCandidate.zoneIds: string[]`
  (thay `groupIds` cũ trong ngữ cảnh này — **`primaryGroupId` giữ nguyên
  không đổi**, vẫn trỏ `personnel_groups`, dùng riêng cho ràng buộc mềm "tránh
  cùng nhóm CHUYÊN MÔN", không được gộp lại với "khu vực" lần nữa — ghi rõ
  trong comment đầu file); `AutoAssignLocationInput.zone_id` (thay
  `eligible_group_id`); `AutoAssignSuggestion.locationId`/`zonePoolRelaxed`
  (thay `zoneId`/`areaPoolRelaxed`); lọc pool `p.zoneIds.includes(loc.zone_id)`.
- `src/app/dashboard/settings/_components/kpi-5s-auto-assign-modal.tsx` —
  tải song song `fetchAllZoneMemberships(factoryId)` + `loadKpiTaskCandidates`,
  merge thành `AutoAssignCandidate[]` (gộp `zoneIds` từ membership +
  `primaryGroupId` từ candidate gốc) trước khi gọi thuật toán; prop
  `zones`→`locations`.
- `src/app/dashboard/settings/page.tsx` — `kpi5sTab` đổi type từ `"khu-vuc"`
  thành `"vi-tri" | "khu-vuc"` (mặc định `"vi-tri"`); sub-tab bar 2 phần tử
  ("Vị trí 5S" icon `SlidersHorizontal`, "Khu vực" icon `Target`); 2 block
  render — `Kpi5sLocationsTab` (props như cũ, đổi tên import) và `Kpi5sZonesTab`
  MỚI (chỉ `{factoryId, canManage}`, không cần `userOptions`).

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file đã đổi), và `npm run build` đều
sạch (build liệt kê đúng route `ƒ /dashboard/kpi/5s/location/[id]`, không còn
`/zone/[id]` cũ). Trước khi chạy `tsc`, phải xoá `.next/types` (cache route cũ
từ lần build trước khi rename route folder) — nếu gặp lỗi
`Cannot find module '.../kpi/5s/zone/[id]/page.js'` khi chạy `tsc --noEmit` mà
route đã đổi tên đúng trong code, đây chỉ là cache stale, không phải lỗi thật.

### 2 lỗi cú pháp SQL đã phát hiện + fix khi user chạy thật trên Supabase SQL Editor

Cả 2 lỗi này KHÔNG bị `tsc`/`eslint`/`npm run build` bắt được (đúng bản chất —
những lệnh đó chỉ kiểm tra code TypeScript, không parse file `.sql`). Cả 2 lần
chạy đều lỗi giữa transaction nên **không để lại thay đổi nào trên DB** (Supabase
SQL Editor chạy cả file dán vào như 1 transaction duy nhất — 1 câu lỗi cuối cùng
rollback toàn bộ, kể cả các `ALTER TABLE`/`CREATE TABLE` đã "chạy qua" trước đó
trong cùng lượt — đúng cơ chế đã ghi ở `.claude/rules/22-documents-module.md`
mục "Fix 2026-07-24"). Vì vậy KHÔNG cần dọn dẹp gì giữa các lần chạy lại, chỉ
cần sửa file rồi dán lại chạy lại từ đầu.

1. **`UNIQUE(factory_id, lower(ten))` trong `CREATE TABLE kpi_5s_zones`** —
   Postgres KHÔNG cho phép biểu thức (`lower(ten)`) trong constraint
   `UNIQUE(...)` khai báo inline ở `CREATE TABLE`, chỉ nhận tên cột thô →
   `ERROR 42601: syntax error at or near "("`. Đã sửa: bỏ khỏi
   `CREATE TABLE`, thay bằng
   `CREATE UNIQUE INDEX uniq_kpi_5s_zones_factory_ten_lower ON
   public.kpi_5s_zones(factory_id, lower(ten));` riêng — đúng cách mọi nơi
   khác trong repo đã làm (`required_notes`, `personnel_groups`, `lots`).
2. **`CREATE OR REPLACE FUNCTION kpi_5s_evaluation_correct(...)` đổi tên tham
   số `p_zone_evaluation_id`→`p_location_evaluation_id`** — dù cùng danh sách
   KIỂU tham số (đủ để không tạo overload mới), Postgres vẫn từ chối
   `CREATE OR REPLACE` khi tên tham số khác bản cũ:
   `ERROR 42P13: cannot change name of input parameter
   "p_zone_evaluation_id", HINT: Use DROP FUNCTION ... first`. Đây là giới
   hạn RIÊNG của `CREATE OR REPLACE FUNCTION` (khác với đổi return
   type/body, vốn được phép) — không tự cascade/suy luận được như rename
   table/column. Đã sửa: thêm
   `DROP FUNCTION IF EXISTS public.kpi_5s_evaluation_correct(UUID, TEXT,
   TEXT, TEXT, UUID);` ngay trước, đổi `CREATE OR REPLACE FUNCTION` thành
   `CREATE FUNCTION` thường (không cần `OR REPLACE` nữa vì đã DROP).
   **Bài học chung cho migration sau này**: bất cứ khi nào đổi tên tham số
   của 1 hàm đã tồn tại (không chỉ đổi logic/kiểu trả về), phải luôn
   `DROP FUNCTION IF EXISTS <đúng chữ ký cũ>` trước, không tin `CREATE OR
   REPLACE` tự xử lý được.

Sau 2 fix trên, `npx tsc --noEmit`/`npx eslint`/`npm run build` (không liên
quan tới 2 lỗi SQL này, đã pass từ trước) vẫn giữ nguyên sạch. **File migration
đã sửa xong, nhưng TÍNH ĐẾN THỜI ĐIỂM GHI CHÚ NÀY VẪN CHƯA CÓ XÁC NHẬN CHẠY
THÀNH CÔNG TRỌN VẸN TRÊN SUPABASE** — 2 lần chạy trước đó đều lỗi và rollback,
lần chạy tiếp theo (sau 2 fix) chưa được xác nhận kết quả.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự

1. Chạy `supabase/migrations/20260805_kpi_5s_rename_locations_and_zones.sql`
   trên Supabase SQL Editor (SAU 4 migration `20260801-04` đã chạy từ trước).
   **Xác nhận chạy THÀNH CÔNG hoàn toàn** (không còn lỗi nào) trước khi làm
   các bước sau — nếu vẫn lỗi, đọc kỹ thông báo lỗi, đối chiếu với 2 lỗi đã
   biết ở trên xem có phải dạng tương tự (biểu thức trong constraint inline,
   đổi tên tham số qua `OR REPLACE`...) hay là lỗi mới hoàn toàn.
2. **Test riêng RPC `kpi_5s_evaluation_correct` NGAY sau migration** (rủi ro
   cao nhất, dễ vỡ nhất vì không lỗi lúc migration chạy, chỉ lỗi lúc gọi) — mở
   1 vị trí có lịch sử chấm điểm, bấm "Sửa kết quả" (hoặc qua trang Khiếu nại
   "Đánh dấu đã giải quyết") — xác nhận không lỗi "column does not exist".
3. Mở `/dashboard/kpi/5s` → xác nhận nhãn "Vị trí 5S", card PGĐ/PH01 vẫn còn
   nguyên dữ liệu (nguoi_don_id/nguoi_cham_id/lịch sử chấm điểm), link vào đúng
   `/dashboard/kpi/5s/location/{id}` (route cũ `/zone/{id}` không còn tồn tại —
   chấp nhận được, chưa in QR thật).
4. Cài đặt → KPI & 5S → xác nhận 2 sub-tab: "Vị trí 5S" (PGĐ, PH01, nhãn đổi
   "Mã vị trí"/"Tên vị trí") và "Khu vực" (trống, tạo mới được).
5. Tạo 2 "Khu vực" (vd "Văn phòng", "Kho 1") ở sub-tab "Khu vực", gán vài
   người vào mỗi khu vực qua "Quản lý thành viên". Vào sub-tab "Vị trí 5S",
   sửa PGĐ/PH01 gán vào khu vực "Văn phòng" qua dropdown mới trong form.
6. Mở "Phân công thông minh" ở sub-tab "Vị trí 5S" — chọn PGĐ/PH01 (đã gán
   khu vực Văn phòng) — xác nhận random CHỈ chọn trong số thành viên khu vực
   Văn phòng, không lẫn người khác nhà máy; thử 1 khu vực chỉ có 1 thành viên
   → xác nhận `zonePoolRelaxed` hoạt động đúng (nới lỏng, không treo).
7. Xác nhận ràng buộc mềm "tránh cùng nhóm chuyên môn chính" (`personnel_groups`,
   KHÔNG đụng gì tới Khu vực mới) vẫn hoạt động độc lập, không bị ảnh hưởng
   bởi thay đổi này (regression check).
8. Kiểm tra QR trên trang chi tiết vị trí (`buildKpi5sLocationUrl`) trỏ đúng
   route mới, quét thử ra đúng trang.

## Cập nhật 2026-08-06 — 7 fix sau test tay đầu tiên (đã code xong, chưa test tay)

Người dùng test bản đổi tên "Vị trí"/"Khu vực" (mục "Cập nhật 2026-08-05") và báo lại 7 vấn đề.
Đã code đầy đủ cả 7, `npx tsc --noEmit` + `npx eslint` (chỉ còn warning pre-existing không liên
quan) + `npm run build` đều sạch. **Chưa test tay bất kỳ mục nào** — xem checklist cuối mục.

### Migration mới `supabase/migrations/20260806_kpi_management_upgrades.sql` (CẦN CHẠY THỦ CÔNG,
CHƯA CHẠY — phải chạy SAU `20260805_kpi_5s_rename_locations_and_zones.sql`)

- `kpi_5s_location_cleaners` (id, factory_id, location_id, user_id) — đội ngũ dọn dẹp NHIỀU
  người/1 vị trí (Fix 5a). Backfill 1 lần từ `nguoi_don_id` cũ (`ON CONFLICT DO NOTHING`). RLS:
  SELECT rộng trong factory; ghi (INSERT/UPDATE/DELETE, `FOR ALL`) chỉ admin/`kpi.manage_config`.
  Cột `kpi_5s_locations.nguoi_don_id` GIỮ NGUYÊN (không xóa) — vẫn dùng cho "Phân công thông
  minh" (chưa cập nhật để ghi vào bảng multi mới, xem mục "Chưa làm" cuối phần này) và làm
  fallback hiển thị cho vị trí chưa từng gán qua bảng mới.
- `kpi_5s_self_reports` (id, factory_id, location_id, user_id, noi_dung, image_urls, vi_do,
  kinh_do, dia_diem_text, created_at) — tự báo cáo (Fix 5b), CHECK bắt buộc có ít nhất 1 trong
  {nội dung, ảnh}. RLS: SELECT rộng trong factory (mirror lịch sử chấm điểm 5S — minh bạch);
  INSERT chỉ chính `user_id = auth.uid()` VÀ (có mặt trong `kpi_5s_location_cleaners` của đúng
  vị trí đó HOẶC là `nguoi_don_id` cũ của vị trí đó — hỗ trợ vị trí chưa được gán multi). Không
  UPDATE/DELETE — log bất biến như `kpi_task_logs`.
- `kpi_department_managers` (id, factory_id, department_id → `departments`, user_id, created_at,
  UNIQUE(factory_id, department_id, user_id)) — cấu hình "Quản lý theo phòng ban" (Fix 7). RLS:
  SELECT rộng trong factory; ghi chỉ admin/`kpi.manage_config`.
- **Thắt chặt có điều kiện** 3 policy hiện có (Fix 7, xem chi tiết thiết kế ở mục "D" dưới):
  `kpi_tasks_insert` (DROP+CREATE lại — thêm điều kiện AND thứ 3), `kpi_appeals_update`
  (DROP+CREATE lại), `kpi_user_substitutions_insert` (DROP+CREATE lại, chỉ nhánh "đăng ký hộ
  người khác qua `kpi.assign`", nhánh tự đăng ký `original_user_id = auth.uid()` không đổi).
- CHECK ảnh bắt buộc trên `kpi_5s_evaluations` (Fix 2): `DROP CONSTRAINT IF EXISTS` rồi
  `ADD CONSTRAINT ... CHECK (coalesce(array_length(image_urls,1),0) > 0) NOT VALID` — `NOT VALID`
  để không phá dữ liệu chấm điểm cũ (một số lần chấm test trước đây chưa có ảnh).

### A. Bảng minh bạch — "Được giao"/"Cần làm"/"Liên quan" + hiện người giao (Fix 1)

- **Danh sách công việc** (`kpi/tasks/page.tsx`): mỗi card giờ hiện dòng "Người giao: {tên}" +
  badge màu phân biệt vai trò — `Việc được giao cho bạn` (sky, khi bạn là active member) và
  `Bạn là người giao` (violet, khi `nguoi_giao_id === user.id`). Card task cũng hiện preview
  `mo_ta` (nếu có) trong khung amber nhỏ `📝 {nội dung}` (line-clamp 2 dòng) — trả lời trực tiếp
  Fix 3 (xem mục C) ngay tại danh sách, không cần mở chi tiết mới thấy ghi chú.
- **Chi tiết công việc** (`kpi/tasks/[id]/page.tsx`): thêm 2 badge tương tự ngay cạnh badge trạng
  thái ở header (`Việc được giao cho bạn`/`Bạn là người giao`).
- **Danh sách vị trí 5S** (`kpi/5s/page.tsx`): banner "Cần bạn chấm điểm tuần này" đổi từ dòng chữ
  nhạt `bg-amber-50 text-amber-700` ở cuối card sang khối nổi bật `bg-amber-500 text-white` ở ĐẦU
  card + icon `animate-pulse`, đồng thời card đó đổi viền `border-2 border-amber-400` (khác hẳn
  card thường). Thêm badge vai trò `Bạn thuộc đội dọn dẹp` (sky)/`Bạn là người chấm` (emerald)
  cho MỌI card liên quan tới người xem (không chỉ khi cần hành động) — đây chính là phần "phân
  biệt việc được giao vs liên quan tới tôi" cho tầng 5S.
- **Chi tiết vị trí 5S** (`kpi/5s/location/[id]/page.tsx`): cùng 2 badge vai trò ở header; khối
  "Đến lượt bạn chấm điểm..." đổi thành banner viền `border-2 border-amber-400` + icon pulse +
  nút "Chấm điểm ngay" nằm bên trong banner (thay vì 1 nút rời rạc mờ nhạt như trước).
- **Giới hạn xem "tất cả"**: xem mục D — `canViewAll`/tab "Tất cả công việc" giờ phụ thuộc thêm
  điều kiện quản lý KPI theo phòng ban (không chỉ permission `kpi.view_all` phẳng). **Lưu ý**:
  quyết định KHÔNG áp dụng giới hạn tương tự cho danh sách "Vị trí 5S" — trang đó cố ý giữ
  nguyên thiết kế "công khai trong factory" đã có từ Phase 2 (lịch sử chấm điểm minh bạch cho
  mọi người xem). Nếu người dùng thực sự muốn ẩn danh sách 5S theo cùng logách department-manager,
  đây là việc CHƯA làm — cần xác nhận lại trước khi đổi (xem mục "Chưa làm" cuối phần này).

### B. Ảnh bắt buộc khi chấm điểm + chụp ảnh trực tiếp/thư viện (Fix 2)

- `Kpi5sImagePicker` (`kpi/5s/_components/kpi-5s-image-picker.tsx`): tách 1 nút "Thêm ảnh" cũ
  thành 2 nút riêng — "Chụp ảnh" (`<input type="file" capture="environment">`, chỉ mở camera
  trên thiết bị di động) và "Thư viện" (`<input type="file" multiple>` không có `capture`, mở
  trình chọn ảnh/camera tùy trình duyệt). Thêm prop `folder?: "evaluations" | "self-reports"`
  (mặc định `"evaluations"`) truyền xuống `uploadKpi5sEvaluationImage()` để tách đường dẫn lưu
  trữ giữa ảnh chấm điểm chính thức và ảnh tự báo cáo, cùng bucket `order-files`.
- `KpiEvidencePicker` (`kpi/tasks/_components/kpi-evidence-picker.tsx`, dùng cho tiến độ công
  việc): áp dụng cùng pattern tách "Chụp"/"Thư viện" cho phần ảnh (phần "File đính kèm" giữ
  nguyên 1 nút, vì file bất kỳ không có khái niệm camera). **Không đổi thành bắt buộc** ở đây —
  yêu cầu ảnh của công việc vẫn là tùy theo `yeu_cau_bao_cao` đã chọn lúc giao việc (soft-warn
  như cũ, xem `missingReq` trong `ProgressForm`) — quyết định phạm vi "ảnh bắt buộc" của Fix 2
  CHỈ áp dụng cho chấm điểm 5S hàng tuần (theo đúng ngữ cảnh câu hỏi gốc "khi chấm"), không mở
  rộng sang tiến độ công việc.
- `location/[id]/page.tsx`, `handleSubmit()`: thêm chặn cứng `images.length === 0 →
  "Vui lòng chụp/tải lên ít nhất 1 ảnh minh chứng."` — TRƯỚC bước validate lý do (để hiện đúng
  thông báo ưu tiên). Label đổi "Ảnh (khuyến khích)" → "Ảnh minh chứng *" kèm ghi chú bắt buộc.
  Form "Tự báo cáo" (mục D) KHÔNG bắt buộc ảnh — chỉ cần 1 trong {nội dung, ảnh} (khớp CHECK
  constraint DB), vì tự báo cáo có thể chỉ là 1 dòng ghi chú nhanh.

### C. Ghi chú/hướng dẫn khi giao việc (Fix 3)

- **Quyết định thiết kế quan trọng**: KHÔNG thêm cột DB mới — cột `kpi_tasks.mo_ta` đã tồn tại
  sẵn từ Phase 1a đúng cho mục đích này (textarea "Mô tả" khi giao việc, đã hiển thị ở trang chi
  tiết công việc từ trước). Vấn đề thật chỉ là UX: label "Mô tả" mơ hồ, không gợi ý đây là nơi
  ghi hướng dẫn cụ thể, và không hiển thị ở đâu khác ngoài trang chi tiết (dễ bị bỏ qua).
- `kpi-task-form-modal.tsx`: label đổi thành "Ghi chú / Hướng dẫn thực hiện", thêm placeholder
  đúng ví dụ người dùng đưa ra ("Không để chai lọ trên bờ tường; kiểm tra pallet trước khi cho
  mủ vào kiện..."), thêm dòng giải thích nhỏ bên dưới.
- `kpi/tasks/page.tsx` (card danh sách): preview `mo_ta` (xem mục A).
- `kpi/tasks/[id]/page.tsx`: đổi từ `<p>` thường sang khối callout viền `border-amber-200
  bg-amber-50` có tiêu đề nhỏ "GHI CHÚ / HƯỚNG DẪN THỰC HIỆN" — nổi bật rõ ràng hơn hẳn text
  thường trước đó.

### D. Khóa logic "người chịu trách nhiệm dọn tuần này" + multi-cleaner (Fix 4 + 5a)

**Fix 4 (khóa dropdown)**: trước đây form chấm điểm 5S cho chọn TỰ DO trong số TẤT CẢ
`candidates` (mọi nhân sự đã liên kết tài khoản trong nhà máy) — sai logic vì người chấm có thể
lỡ tay chọn nhầm bất kỳ ai, không liên quan gì tới vị trí đang chấm. Đã sửa:
- `getEffectiveCleanerIds(location, cleanerMap)` (`src/lib/kpi-5s.ts`) — ưu tiên đọc
  `kpi_5s_location_cleaners` (bảng mới, multi), fallback về `[nguoi_don_id]` (cột cũ, đơn) nếu
  vị trí chưa từng được gán qua bảng mới — không bao giờ trả rỗng nếu vị trí có gán bằng cách
  nào đó (cũ hoặc mới).
- `location/[id]/page.tsx`: dropdown giờ chỉ hiển thị các lựa chọn trong
  `effectiveCleanerIds` — đúng 1 người → khóa cứng (hiển thị tĩnh, không phải `<select>`); nhiều
  người → `<select>` chỉ trong số đó; 0 người (chưa gán) → non-admin bị chặn hẳn với thông báo đỏ
  "liên hệ Admin để gán trước khi chấm điểm"; **admin có lối thoát dự phòng** (dropdown mở toàn
  bộ `candidates`, viền amber, kèm cảnh báo "chỉ admin thấy được lựa chọn dự phòng này").
- **Chưa làm** (ghi rõ, không tự ý mở rộng): KHÔNG xây dựng cơ chế "người thay thế tạm thời"
  riêng cho 5S song song với `kpi_user_substitutions` (cơ chế đó hiện chỉ áp dụng cho việc định
  kỳ `kpi_task_templates`, xem Phase "Việc định kỳ"). Nếu về tua/nghỉ, admin phải tự vào Cài đặt
  sửa lại đội ngũ dọn dẹp — chưa có tự động hoá theo ngày như task templates. Đây là điểm rõ
  ràng nhất cần làm tiếp ở phase sau nếu người dùng muốn đồng bộ 2 cơ chế.

**Fix 5a (multi-select)**: `kpi_5s_location_cleaners` + các hàm CRUD trong `kpi-5s.ts`
(`fetchAllLocationCleanerMemberships`, `fetchLocationCleaners`, `addKpi5sLocationCleaner`,
`removeKpi5sLocationCleaner`). Settings (`kpi-5s-locations-tab.tsx`): thêm nút "Quản lý đội ngũ
dọn dẹp" trên mỗi card vị trí (LUÔN hiện, không gate `canManage` — xem/tick giống hệt pattern
"Quản lý thành viên" của `kpi-5s-zones-tab.tsx`), mở modal checklist multi-select từ
`userOptions` (profiles-based, đã có sẵn ở Settings). Card hiển thị "Đội ngũ dọn dẹp (N): ...".
**Trường "Người dọn hiện tại" (single-select) trong form Thêm/Sửa vị trí VẪN GIỮ NGUYÊN không
đổi** — cố ý giữ song song 2 cơ chế (đơn cho form nhanh + "Phân công thông minh"; multi cho quản
lý team thực tế) thay vì gộp làm một, để không phải viết lại toàn bộ luồng auto-assign trong
phiên này.

**Chưa làm (quan trọng, cần quyết định ở phiên sau)**: "Phân công thông minh"
(`kpi-5s-auto-assign.ts`/`kpi-5s-auto-assign-modal.tsx`) HOÀN TOÀN CHƯA ĐƯỢC CẬP NHẬT để nhận
biết bảng multi mới — nó vẫn chỉ ghi vào cột đơn `nguoi_don_id`/`nguoi_cham_id`. Nếu admin dùng
"Phân công thông minh" sau khi đã có nhân sự multi-select riêng ở 1 vị trí, kết quả auto-assign
sẽ GHI ĐÈ cột `nguoi_don_id` đơn (không xóa/đổi bảng multi) — 2 nguồn dữ liệu (`nguoi_don_id` và
`kpi_5s_location_cleaners`) có thể lệch nhau tạm thời cho tới khi admin đồng bộ lại tay. Không
nguy hiểm (dropdown ưu tiên bảng multi nếu có), nhưng gây khó hiểu — cần làm rõ ở phase sau: có
nên để "Phân công thông minh" tự thêm người được chọn vào bảng multi luôn hay không.

### E. Tự báo cáo — ảnh/văn bản/vị trí (Fix 5b, tính năng mới)

- `kpi_5s_self_reports` + `fetchKpi5sSelfReports`/`submitKpi5sSelfReport` (`kpi-5s.ts`).
- `location/[id]/page.tsx`: nút "Tự báo cáo (ảnh/ghi chú/vị trí)" (sky, chỉ hiện cho
  `iAmCleaner` — tức có mặt trong `effectiveCleanerIds`) mở form riêng (textarea nội dung +
  `Kpi5sImagePicker` folder `self-reports` + nút "Lấy vị trí hiện tại" dùng
  `navigator.geolocation`, mirror `ProgressForm` của module Công việc). Gửi xong hiện trong card
  "Tự báo cáo của đội ngũ dọn dẹp" (danh sách công khai, mới nhất trước) — độc lập hoàn toàn với
  "Lịch sử chấm điểm" chính thức, KHÔNG ảnh hưởng `ket_qua`/điểm số nào — thuần túy là kênh
  thông tin thêm giữa các tuần.

### F. Tab mặc định "Việc của tôi" (Fix 6)

- `kpi/page.tsx` (route `/dashboard/kpi`, trước là "Tổng quan") viết lại thành **redirect stub**
  — `router.replace("/dashboard/kpi/tasks?tab=mine")` ngay khi mount. Không xóa hẳn route (để
  link/sidebar cũ trỏ `/dashboard/kpi` không bị 404) — không đổi `dashboard/layout.tsx`'s NAV
  (`key: "/dashboard/kpi"`) để tránh rủi ro đụng logic highlight/permission-check khác đang dựa
  vào key này.
  chú ý: quyết định KHÔNG đổi `key` trong NAV — chỉ đổi hành vi trang đích.
- `kpi-shell.tsx`: xóa hẳn tab "Tổng quan" khỏi thanh điều hướng (`tabs` array) — vì giờ nó chỉ
  bounce sang "Công việc", giữ lại sẽ gây UX kỳ lạ (bấm tab lại nhảy sang tab khác).
  Import `LayoutDashboard` không còn dùng đã bị xóa khỏi import list.
- Banner "Nhóm chính" (trước đây ở trang Tổng quan) **chuyển nguyên vẹn logic** sang đầu
  `kpi/tasks/page.tsx` (dưới header, trên thanh tab "Việc của tôi"/"Tất cả công việc") — không
  mất thông tin, chỉ đổi vị trí hiển thị.

### G. Phân quyền theo phòng ban — "Quản lý KPI theo phòng ban" (Fix 7)

**Quyết định kiến trúc quan trọng — thắt chặt CÓ ĐIỀU KIỆN, không phá vỡ tương thích ngược**:
mặc định `role="manager"` được cấp sẵn `kpi.assign`/`kpi.view_all` rất rộng (xem `ROLE_DEFAULTS`,
`src/lib/auth.ts`) — không khớp yêu cầu "chỉ Admin + Giám đốc/Phó giám đốc đơn vị". Thay vì xóa
thẳng quyền mặc định đó (sẽ phá vỡ mọi factory đang chạy ngay khi migration chạy, rất rủi ro),
đã thiết kế **feature flag tự nhiên qua dữ liệu**: bảng `kpi_department_managers` CÒN RỖNG →
hành vi y hệt trước đây (chỉ cần permission cũ); ngay khi admin thêm dòng ĐẦU TIÊN qua Cài đặt
→ KPI & 5S → "Quản lý theo phòng ban", cả DB (RLS) lẫn UI đồng loạt thắt chặt: chỉ admin hoặc
đúng những `user_id` được liệt kê trong bảng đó (bất kể phòng ban nào, xem hạn chế bên dưới) mới
còn:
- Tạo công việc mới (`kpi_tasks_insert` RLS + `canAssign` trong `kpi/tasks/page.tsx`).
- Xem tab "Tất cả công việc" (`kpi.view_all` + `canViewAll`, cùng file).
- Giải quyết khiếu nại (`kpi_appeals_update` RLS + `canResolve` trong `kpi/appeals/page.tsx`).
- Đăng ký "Người thay thế tạm thời" HỘ người khác (`kpi_user_substitutions_insert` RLS) — tự
  đăng ký cho chính mình (`original_user_id = auth.uid()`) KHÔNG bị ảnh hưởng, vẫn luôn được
  phép với bất kỳ ai.
- **`src/lib/kpi-department-managers.ts`** (file mới): `fetchDepartmentOptions()` (đọc bảng
  `departments` dùng chung toàn hệ thống, không có `factory_id`, đọc được bởi mọi authenticated
  user), `fetchKpiDepartmentManagers`, `addKpiDepartmentManager`, `removeKpiDepartmentManager`,
  `kpiManagersConfigured(managers)` (bảng rỗng hay không), `isFactoryKpiManager(managers,
  userId)`.
- **UI mới** `src/app/dashboard/settings/_components/kpi-5s-department-managers-tab.tsx` — sub-
  tab thứ 3 "Quản lý theo phòng ban" trong Cài đặt → KPI & 5S (cạnh "Vị trí 5S"/"Khu vực"), chọn
  Phòng ban (từ `departments`) + Người dùng (từ `activeProfilesForLink` có sẵn ở Settings) → nút
  "Thêm". Banner đầu trang hiện rõ trạng thái hiện tại (chưa cấu hình = amber "chưa thắt chặt gì"
  / đã cấu hình = emerald "đang áp dụng thắt chặt").

**Hạn chế đã biết, cần xác nhận lại nếu chưa đúng ý người dùng**:
1. **Không có khái niệm "đúng phòng ban của việc/khiếu nại đó"** — `kpi_department_managers` chỉ
   trả lời "user X có được coi là 1 người quản lý KPI (ở BẤT KỲ phòng ban nào đã cấu hình) hay
   không", KHÔNG kiểm tra "việc/khiếu nại này có thuộc đúng phòng ban mà X quản lý hay không" —
   vì `kpi_tasks`/`kpi_appeals` không có cột `department_id` nào để đối chiếu. Nếu nhà máy có
   nhiều phòng ban và muốn tách biệt hoàn toàn (GĐ phòng A không quản được việc của phòng B),
   đây là việc CHƯA làm — cần thêm cột `phong_ban`/`department_id` vào `kpi_tasks` và logic gán
   phòng ban cho từng task, RỘNG hơn nhiều so với phạm vi phiên này.
2. **"Chuyển việc" (task transfer, `kpi_task_transfers`) KHÔNG bị đụng tới** — đã cân nhắc và
   quyết định đây là hành động NGANG HÀNG (nhân viên A tự xin chuyển việc cho nhân viên B, B tự
   nguyện chấp nhận), không phải hành động "quản lý/phê duyệt" cần giới hạn GĐ/PGĐ — khác với
   "phê duyệt người thay thế" (`kpi_user_substitutions`, vốn thường do CẤP TRÊN đăng ký hộ nhân
   viên đi vắng). Nếu ý người dùng thực chất là muốn CẤP TRÊN có quyền ÉP buộc chuyển việc mà
   không cần người nhận đồng ý, đây là 1 tính năng hoàn toàn mới, chưa tồn tại — cần hỏi lại rõ.
3. **Danh sách "Vị trí 5S" và "Tự báo cáo" KHÔNG bị giới hạn theo department-manager** — cố ý
   giữ nguyên "công khai trong factory" như thiết kế Phase 2 ban đầu (xem mục A).

### Việc CHƯA làm — cần quyết định/triển khai ở phiên sau

1. Đồng bộ "Phân công thông minh" 5S với bảng `kpi_5s_location_cleaners` mới (mục D).
2. Cân nhắc xây "Người thay thế tạm thời" riêng cho 5S (song song `kpi_user_substitutions` cho
   task templates) — hiện Fix 4 chỉ khóa dropdown vào đúng đội ngũ đã gán, chưa có cơ chế tạm
   thời đổi người khi đi tua/nghỉ mà không cần admin sửa tay Cài đặt.
3. Xác nhận lại phạm vi chính xác của "chuyển việc" trong yêu cầu Fix 7 (mục G, hạn chế #2).
4. Cân nhắc thêm `department_id` thật vào `kpi_tasks` nếu người dùng muốn tách biệt quản lý
   theo ĐÚNG phòng ban (mục G, hạn chế #1) thay vì "quản lý KPI nói chung".
5. Cân nhắc có nên giới hạn "Vị trí 5S"/"Tự báo cáo" theo department-manager tương tự Công
   việc/Khiếu nại hay không (mục G, hạn chế #3) — hiện đang cố ý giữ công khai.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự

1. Chạy `supabase/migrations/20260806_kpi_management_upgrades.sql` trên Supabase SQL Editor
   (SAU `20260805_kpi_5s_rename_locations_and_zones.sql` đã chạy từ trước).
2. Chấm điểm 1 vị trí KHÔNG đính kèm ảnh → xác nhận bị chặn đúng thông báo; đính kèm ảnh qua cả
   2 nút "Chụp ảnh" (trên điện thoại thật, xác nhận mở đúng camera) và "Thư viện" (chọn từ ảnh
   có sẵn) → xác nhận cả 2 đều upload đúng, lưu thành công.
3. Vị trí có ĐÚNG 1 người dọn (`nguoi_don_id` cũ, chưa gán multi) → mở form chấm điểm, xác nhận
   trường "Người chịu trách nhiệm" hiển thị TĨNH (không phải dropdown) đúng tên người đó.
4. Vào Cài đặt → KPI & 5S → Vị trí 5S → "Quản lý đội ngũ dọn dẹp" cho 1 vị trí, tick 2-3 người →
   quay lại chấm điểm vị trí đó → xác nhận dropdown giờ CHỈ liệt kê đúng 2-3 người đã tick, không
   còn thấy toàn bộ nhân sự nhà máy như trước.
5. Test vị trí CHƯA gán ai (cả cũ lẫn mới) — tài khoản thường bị chặn với thông báo đỏ; tài
   khoản admin thấy dropdown dự phòng viền amber vẫn chọn được.
6. Test "Tự báo cáo": đăng nhập 1 người có trong đội ngũ dọn dẹp của 1 vị trí → gửi 1 báo cáo chỉ
   có ảnh, 1 báo cáo chỉ có nội dung, 1 báo cáo có cả vị trí GPS → xác nhận cả 3 lưu đúng, hiện
   trong danh sách "Tự báo cáo của đội ngũ dọn dẹp"; đăng nhập người KHÔNG thuộc đội ngũ đó → xác
   nhận không thấy nút "Tự báo cáo".
7. Test hiển thị: card công việc/vị trí 5S hiện đúng badge vai trò + tên người giao/đội ngũ;
   banner "Cần bạn chấm điểm" đủ nổi bật (không còn "mờ nhạt" như phản ánh ban đầu).
8. Test Fix 6: bấm vào mục "Công việc & KPI" ở sidebar → xác nhận vào thẳng
   `/dashboard/kpi/tasks` với tab "Việc của tôi" đang active, KHÔNG còn dừng ở trang Tổng quan
   trung gian; xác nhận banner "Nhóm chính" vẫn hiện đúng ở đây.
9. Test Fix 7 (theo đúng thứ tự, vì bước 2 làm thay đổi hành vi ngay lập tức cho TOÀN NHÀ MÁY):
   - Trước khi cấu hình: xác nhận 1 tài khoản `role=manager` bình thường (không phải GĐ/PGĐ) vẫn
     thấy nút "Giao việc mới"/tab "Tất cả công việc" như cũ (chưa breaking).
   - Vào Cài đặt → KPI & 5S → "Quản lý theo phòng ban" → thêm ĐÚNG 1 người (vd tài khoản admin
     test hoặc 1 tài khoản GĐ) cho 1 phòng ban bất kỳ.
   - Đăng nhập lại tài khoản `manager` bình thường ở bước đầu → xác nhận nút "Giao việc mới"/tab
     "Tất cả công việc" đã BIẾN MẤT; thử gọi thẳng `createKpiTask` qua devtools (nếu tiện) → xác
     nhận bị RLS chặn.
   - Đăng nhập đúng người vừa được cấu hình → xác nhận vẫn thấy đầy đủ các nút/tab như cũ.
   - Test tương tự cho "Giải quyết khiếu nại" (`/dashboard/kpi/appeals`) và đăng ký "Người thay
     thế tạm thời" hộ người khác (`/dashboard/kpi/templates`).
   - Gỡ hết cấu hình (xóa dòng vừa thêm) → xác nhận mọi thứ QUAY LẠI đúng hành vi cũ (không kẹt
     ở trạng thái thắt chặt vĩnh viễn).

## Cập nhật 2026-07-28 — Phòng ban thay "Quản lý theo phòng ban", duyệt Người thay thế, Việc
hôm nay, bỏ hẳn Tự báo cáo, multi-select Người dọn ngay trong form — đã code xong cả 6 phase

Người dùng test bản "2026-08-06" (7 fix ở mục ngay trên) và phát hiện thêm 1 loạt vấn đề/nhầm
lẫn thiết kế mới, tổng hợp thành 1 kế hoạch 6 phase (A→F), viết ở
`C:\Users\Software\.claude\plans\shimmering-wiggling-hummingbird.md`, đã hỏi 2 vòng
`AskUserQuestion` để chốt hướng trước khi code (xem "Context" trong file plan để biết đầy đủ
lịch sử quyết định). Tóm tắt các thay đổi lớn nhất:

1. **"Quản lý theo phòng ban" (`kpi_department_managers`, cấu hình tay GĐ/PGĐ) đã bị loại bỏ
   hoàn toàn khỏi RLS/UI** — thay bằng cơ chế **tự phát hiện "lãnh đạo"** qua đúng
   `chuc_vu`/`chuc_vu_chinh_quyen` trong `maintenance_staff` (EXACT MATCH, không phải substring
   như `dept-leader` của module Văn bản — tách đúng "Giám đốc/Phó giám đốc" nhà máy khỏi "Tổng
   giám đốc/Phó tổng giám đốc" công ty). Bảng `kpi_department_managers` **KHÔNG bị DROP** (còn
   dữ liệu cấu hình cũ, không tự ý xoá) — chỉ ngừng được tham chiếu trong RLS/UI mới.
2. Mọi đối tượng lớn của module giờ **bắt buộc mang theo "Phòng ban"**: `kpi_5s_locations`,
   `kpi_5s_zones`, `kpi_task_templates`, `kpi_tasks` đều có cột `phong_ban_id` mới — quyết định
   ai (lãnh đạo đúng phòng ban đó, ngoài admin/`kpi.manage_config`) được quản lý/thu hẹp danh
   sách ứng viên người nhận/người dọn/người chấm.
3. **"Người thay thế tạm thời" giờ cần duyệt** — `kpi_user_substitutions` thêm
   `trang_thai` (`cho_duyet`/`da_duyet`/`tu_choi`), chỉ `da_duyet` mới có hiệu lực sinh việc định
   kỳ. Ai đăng ký thì phía CÒN LẠI duyệt (tự đăng ký → lãnh đạo phòng ban của người đi vắng
   duyệt; lãnh đạo/`kpi.assign` đăng ký hộ → chính người đi vắng tự xác nhận).
4. **"Việc hôm nay"** — sub-tab mới, mặc định khi vào trang, ở cả `/dashboard/kpi/tasks`
   (việc "của tôi" quá hạn/sắp đến hạn (24h)/giao đúng hôm nay) và `/dashboard/kpi/5s` (vị trí
   đến lượt tôi chấm điểm tuần này).
5. **"Tự báo cáo" (Fix 5b ở mục "2026-08-06") đã bị bỏ hẳn, không thay thế bằng gì khác** —
   quyết định đã chốt lại qua trao đổi thêm với người dùng ("logic tự chấm không khác gì chọn
   người chấm... bỏ hẵn"). Bảng `kpi_5s_self_reports` **giữ nguyên trong DB** (không xoá dữ
   liệu), chỉ ngừng đọc/ghi từ app.
6. **"Người dọn hiện tại" ở form Thêm/Sửa Vị trí 5S đổi thành multi-select TRỰC TIẾP trong
   CHÍNH form đó** (không còn nút "Quản lý đội ngũ dọn dẹp" tách riêng như "2026-08-06") — ghi
   thẳng vào `kpi_5s_location_cleaners` cùng lúc lưu vị trí. "Người chấm hiện tại" **giữ nguyên
   logic cũ** (dropdown đơn) — chỉ đổi phép so sánh từ "khác 1 `nguoi_don_id`" sang "không nằm
   trong tập nhiều người dọn vừa chọn".

### 3 migration mới (**CẦN CHẠY THỦ CÔNG, THEO ĐÚNG THỨ TỰ NÀY**, sau
`20260806_kpi_management_upgrades.sql` đã liệt kê ở mục "2026-08-06" phía trên)

1. `supabase/migrations/20260807_kpi_department_scoping.sql` — thêm `phong_ban_id` cho 4 bảng
   (`kpi_5s_locations`, `kpi_5s_zones`, `kpi_task_templates`, `kpi_tasks`); thêm
   `assigned_by`/`assigned_at` cho `kpi_5s_locations`; gỡ CHECK cũ
   `nguoi_don_id <> nguoi_cham_id` (dò tên constraint qua `pg_constraint`, không đoán cứng tên)
   thay bằng 2 trigger `trg_kpi_5s_location_cleaners_not_scorer`/
   `trg_kpi_5s_locations_scorer_not_cleaner` thực thi đúng ràng buộc "người chấm khác MỌI người
   dọn" so với tập nhiều người (Postgres không viết được CHECK constraint tham chiếu bảng
   khác); hàm `kpi_is_department_leader(user, department)` (EXACT MATCH 6 chức danh); viết lại
   RLS `kpi_tasks_insert`/`kpi_appeals_update`/`kpi_user_substitutions_insert` (bỏ phụ thuộc
   `kpi_department_managers`) + mở rộng CRUD `kpi_task_templates`/`kpi_5s_locations`/
   `kpi_5s_zones` cho lãnh đạo phòng ban tự quản lý đúng phạm vi của mình.
2. `supabase/migrations/20260807_kpi_substitution_approval.sql` — thêm
   `trang_thai`/`nguoi_duyet_id`/`duyet_luc`/`ly_do_tu_choi` vào `kpi_user_substitutions`
   (mặc định `cho_duyet`, **KHÔNG backfill** dữ liệu cũ về `da_duyet` — mọi đăng ký cũ trước
   migration này sẽ hiện là "Chờ duyệt" cho tới khi có ai duyệt lại); mở rộng RLS SELECT cho
   lãnh đạo phòng ban thấy được đăng ký cần họ xử lý; RPC `kpi_substitution_approve(p_id)`/
   `kpi_substitution_reject(p_id, p_ly_do)`; viết lại `kpi_ensure_today_task_instances` chỉ
   tôn trọng substitution `trang_thai = 'da_duyet'`.

### File chính đã sửa/thêm

- **Lib mới** `src/lib/kpi-department-leaders.ts` (thay thế hoàn toàn
  `src/lib/kpi-department-managers.ts` đã xoá, cùng
  `src/app/dashboard/settings/_components/kpi-5s-department-managers-tab.tsx` đã xoá) —
  `fetchDepartmentOptions()`, `resolveMyLeaderDepartmentId(userId, factoryId)`,
  `canSeeKpiTemplatesTab(user, factoryId)`.
- `src/app/api/kpi/dept-users/route.ts` (mới) — service-role, mirror
  `/api/documents/dept-users`, nhận thẳng `departmentId` (UUID) thay vì tên phòng ban.
- `src/lib/kpi-tasks.ts` — `loadKpiTaskCandidates(factoryId, opts?: {departmentId})` mở rộng
  lọc theo phòng ban qua route trên; `KpiTask`/`createKpiTask()` thêm `phong_ban_id`/
  `phongBanId` (bắt buộc).
- `src/lib/kpi-templates.ts` — `KpiTaskTemplate`/`KpiTaskTemplateInput` thêm `phong_ban_id`/
  `phongBanId`; `KpiUserSubstitution` thêm `trang_thai`/`nguoi_duyet_id`/`duyet_luc`/
  `ly_do_tu_choi`; `approveKpiUserSubstitution()`/`rejectKpiUserSubstitution()`/
  `fetchPendingSubstitutionsForApprover()` (wrapper RPC).
- `src/app/dashboard/kpi/_components/pending-substitutions-banner.tsx` (mới) — banner dùng
  chung "Đăng ký người thay thế đang chờ bạn duyệt", đặt ở cả `/dashboard/kpi/tasks` (banner
  "Nhóm chính" ngay trên) lẫn `/dashboard/kpi/templates`.
- `src/app/dashboard/kpi/_components/kpi-shell.tsx` — nhận thêm prop optional
  `user`/`factoryId`, tự gọi `canSeeKpiTemplatesTab` để ẩn hẳn tab "Việc định kỳ" với người
  không đủ quyền (mặc định ẩn cho tới khi xác nhận được — tránh hiện nhầm dù chỉ vài ms); tab
  "Công việc" đổi nhãn thành **"Công việc chuyên môn"**. Toàn bộ 7 nơi render `<KpiShell>` đã
  cập nhật truyền `user={user} factoryId={factoryId}`.
- `src/app/dashboard/kpi/templates/page.tsx` — thêm guard bootstrap thật (redirect
  `/dashboard/kpi/tasks` nếu `!canSeeKpiTemplatesTab`, không chỉ ẩn tab); load thêm
  `departments`/`pendingSubs`; render `<PendingSubstitutionsBanner>`; badge trạng thái
  Chờ duyệt/Đã duyệt/Từ chối trên danh sách "Người thay thế tạm thời".
- `src/app/dashboard/kpi/templates/_components/template-form-modal.tsx` — thêm "Phòng ban *",
  thu hẹp "Người nhận cố định" theo phòng ban đã chọn (gọi lại `loadKpiTaskCandidates` khi đổi
  phòng ban, tự gỡ lựa chọn không còn hợp lệ).
- `src/app/dashboard/kpi/tasks/page.tsx` — thêm sub-tab **"Việc hôm nay"** (mặc định); load
  `departments`, truyền vào `<KpiTaskFormModal>`.
- `src/app/dashboard/kpi/tasks/_components/kpi-task-form-modal.tsx` — thêm "Phòng ban chịu
  trách nhiệm *" (bắt buộc), thu hẹp "Người thực hiện" theo phòng ban đã chọn.
- `src/app/dashboard/kpi/5s/page.tsx` — thêm sub-tab **"Việc hôm nay"**; **thu hẹp phạm vi hiển
  thị danh sách** (khác thiết kế "công khai toàn nhà máy" của Phase 2 gốc): admin/
  `kpi.manage_config` thấy tất cả, lãnh đạo phòng ban thấy đúng vị trí thuộc phòng ban của họ,
  người dùng thường chỉ thấy vị trí họ thực sự liên quan (thuộc đội ngũ dọn dẹp hoặc là người
  chấm).
- `src/app/dashboard/kpi/5s/location/[id]/page.tsx` — **xoá toàn bộ phần "Tự báo cáo"** (state,
  form, nút, danh sách, `handleSrLocate`/`handleSubmitSelfReport`); thêm hiển thị "Người giao:
  {tên}" ở header.
- `src/app/dashboard/kpi/5s/_components/kpi-5s-image-picker.tsx` — bỏ tham số `folder` (chỉ
  còn duy nhất mục đích "evaluations", không còn "self-reports").
- `src/lib/kpi-5s.ts` — `Kpi5sLocation`/`Kpi5sLocationInput` thêm `phong_ban_id`/`assigned_by`/
  `assigned_at`; **xoá hẳn** `fetchKpi5sSelfReports`/`submitKpi5sSelfReport`/`Kpi5sSelfReport`;
  `createKpi5sLocation(input, cleanerUserIds, assignedBy)`/
  `updateKpi5sLocation(id, input, cleanerUserIds, assignedBy)` đổi chữ ký — đồng bộ
  `kpi_5s_location_cleaners` trong CÙNG 1 lượt lưu (thứ tự bắt buộc: xoá cleaner cũ → update
  location → insert cleaner mới, để không bị 2 trigger DB chặn nhầm khi người sắp thành "chấm"
  từng là "dọn"). Hàm mới `patchKpi5sLocation(id, patch)` — sửa nhanh 1 vài cột đơn giản
  (`is_active`, hoặc `nguoi_don_id`/`nguoi_cham_id` LEGACY do "Phân công thông minh" ghi) mà
  KHÔNG động tới cleaner set/`assigned_by` — tách riêng để 1 lượt bấm "Tạm ngưng" không vô tình
  ghi đè "Người giao".
- `src/app/dashboard/settings/_components/kpi-5s-locations-tab.tsx` — viết lại đáng kể: bỏ hẳn
  nút + modal "Quản lý đội ngũ dọn dẹp" riêng, gộp thẳng thành multi-select checklist trong
  CHÍNH form Thêm/Sửa; thêm "Phòng ban *"; thêm prop `currentUserId` (để ghi `assigned_by`);
  card hiện thêm "Người giao".
- `src/lib/kpi-5s-zones.ts` + `src/app/dashboard/settings/_components/kpi-5s-zones-tab.tsx` —
  thêm `phong_ban_id`/field "Phòng ban" (giữ nguyên nút "Quản lý thành viên" riêng — plan không
  yêu cầu gộp cho tầng Khu vực, chỉ tầng Vị trí).
- `src/app/dashboard/settings/_components/kpi-5s-auto-assign-modal.tsx` — đổi
  `updateKpi5sLocation(...)` → `patchKpi5sLocation(...)` (chữ ký cũ 2 tham số) — "Phân công
  thông minh" **vẫn CHƯA đồng bộ với `kpi_5s_location_cleaners`** (xem mục "Chưa làm" ở
  "2026-08-06"), chỉ ghi cột đơn `nguoi_don_id`/`nguoi_cham_id` LEGACY như trước.
- `src/app/dashboard/settings/page.tsx` — bỏ import + render block tab "Quản lý theo phòng
  ban"; bỏ giá trị `"phong-ban"` khỏi `kpi5sTab`; truyền `currentUserId={user?.id || ""}` vào
  `<Kpi5sLocationsTab>`.

### Quyết định/đơn giản hoá có chủ đích (đọc trước khi mở rộng thêm)

- **Không dựng `department_id` scoping cho "Người thay thế" (candidate list "Người thay thế"
  trong `substitution-form-modal.tsx`)** — chỉ RPC duyệt (`kpi_substitution_approve/reject`)
  mới enforce đúng thẩm quyền theo phòng ban; dropdown chọn người vẫn hiện toàn bộ
  `candidates` truyền vào (không lọc theo phòng ban của "người đi vắng"). Lý do: cần 1 API
  reverse-lookup "phòng ban của 1 user cụ thể" mới làm được (route hiện có chỉ đi 1 chiều:
  phòng ban → danh sách user), không tương xứng công sức so với lợi ích UX nhỏ này — an toàn
  vẫn được đảm bảo đầy đủ ở tầng RLS/RPC, chỉ UI chưa lọc trước.
- **`handleToggleActive` (Tạm ngưng/Kích hoạt lại vị trí 5S) dùng `patchKpi5sLocation`, KHÔNG
  dùng `updateKpi5sLocation`** — tránh mỗi lần bấm toggle vô tình ghi đè `assigned_by`/
  `assigned_at` (đáng lẽ chỉ nên đổi khi thực sự sửa nội dung phân công qua form đầy đủ).
- **"Phân công thông minh" (5S) vẫn dùng cột `nguoi_don_id`/`nguoi_cham_id` LEGACY, chưa đồng
  bộ với `kpi_5s_location_cleaners`** — kế thừa nguyên trạng "Chưa làm" đã ghi ở mục
  "2026-08-06"; sau khi random-gán qua công cụ này, admin cần tự vào form Sửa vị trí để đồng
  bộ lại multi-select "Người dọn hiện tại" nếu muốn 2 nguồn khớp nhau.
- **`kpi_department_managers` không bị xoá khỏi DB** — chỉ ngừng dùng ở RLS/UI mới. Nếu về sau
  người dùng xác nhận muốn dọn hẳn, cần 1 migration `DROP TABLE` riêng (chưa làm trong đợt
  này).

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa liệt kê ở trên), và `npm run build`
đều sạch (build liệt kê đủ `/dashboard/kpi/tasks`, `/dashboard/kpi/tasks/[id]`,
`/dashboard/kpi/templates`, `/dashboard/kpi/5s`, `/dashboard/kpi/5s/location/[id]`,
`/dashboard/kpi/appeals`, không có route KPI nào lỗi build).

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự

1. Chạy 2 migration mới theo đúng thứ tự: `20260807_kpi_department_scoping.sql` →
   `20260807_kpi_substitution_approval.sql` (sau khi đã chắc chắn `20260806_...` từ mục
   "2026-08-06" đã chạy xong).
2. **Test lãnh đạo phòng ban tự phát hiện**: sửa Chức vụ/Chức vụ chính quyền của 1 nhân sự
   trong `maintenance_staff` thành đúng `"Trưởng phòng"` (hoặc 1 trong 6 chức danh), gán đúng
   phòng ban của họ → đăng nhập tài khoản đó → xác nhận thấy tab "Việc định kỳ" dù KHÔNG có
   `kpi.manage_config`; xác nhận `/dashboard/settings?tab=kpi_5s` (Vị trí/Khu vực có
   `phong_ban_id` khớp) cho phép họ Sửa dù không phải admin.
3. **Test duyệt Người thay thế**: user A tự đăng ký thay thế cho chính mình → xác nhận lãnh
   đạo ĐÚNG phòng ban của A thấy banner "Chờ bạn duyệt" (ở cả `/tasks` lẫn `/templates`), người
   khác (phòng ban khác) KHÔNG thấy → duyệt/từ chối → xác nhận `trang_thai` đổi đúng, chỉ
   `da_duyet` mới được `kpi_ensure_today_task_instances` tôn trọng khi sinh việc hôm nay. Lặp
   lại nhánh ngược: lãnh đạo/`kpi.assign` đăng ký hộ người khác → xác nhận CHÍNH người đi vắng
   (không phải lãnh đạo) mới thấy banner cần duyệt.
4. **Test "Việc hôm nay"**: tạo 1 việc hạn hôm nay/quá hạn/sắp đến hạn (24h) cho chính mình →
   vào `/dashboard/kpi/tasks` → xác nhận sub-tab "Việc hôm nay" là mặc định và liệt kê đúng;
   tương tự cho `/dashboard/kpi/5s` với 1 vị trí mình là người chấm chưa chấm tuần này.
5. **Test bỏ Tự báo cáo**: xác nhận trang chi tiết vị trí 5S không còn nút/khối "Tự báo cáo"
   nào; dữ liệu `kpi_5s_self_reports` cũ (nếu có từ lúc test "2026-08-06") vẫn còn nguyên trong
   DB, chỉ không hiển thị trên UI nữa.
6. **Test multi-select "Người dọn" trong form**: mở Cài đặt → KPI & 5S → Vị trí 5S → Sửa 1 vị
   trí đã có sẵn `nguoi_don_id` cũ (dữ liệu trước "2026-08-06") → xác nhận form tự tick đúng
   người đó (fallback từ cột legacy); tick thêm 2-3 người, đổi "Người chấm hiện tại" trùng 1
   người vừa tick → xác nhận bị chặn lưu với thông báo rõ; bỏ trùng → lưu thành công → xác nhận
   card hiện đúng "Đội ngũ dọn dẹp (N)" và "Người giao" đúng tài khoản admin vừa lưu.
7. **Test "Phòng ban chịu trách nhiệm" bắt buộc** ở cả 3 form (giao việc tay, việc định kỳ, vị
   trí 5S) — thử lưu khi chưa chọn phòng ban → bị chặn đúng thông báo; chọn xong → danh sách
   người nhận/thực hiện tự thu hẹp đúng theo phòng ban.
8. **Test phạm vi hiển thị 5S mới**: đăng nhập 1 tài khoản KHÔNG phải admin/lãnh đạo/không
   thuộc đội dọn dẹp hay người chấm của bất kỳ vị trí nào → vào `/dashboard/kpi/5s` → xác nhận
   danh sách trống hoặc chỉ hiện đúng vị trí họ liên quan (không còn thấy "công khai toàn nhà
   máy" như trước).
9. Test regression: tài khoản admin vẫn thấy/làm được mọi thứ như trước (tab Việc định kỳ,
   toàn bộ vị trí 5S, duyệt bất kỳ đăng ký thay thế nào) — không bị ảnh hưởng bởi các giới hạn
   phòng ban mới.

## Cập nhật 2026-07-29 — 3 bug thật đã fix sau khi người dùng test tay bản "2026-07-28" (đã code
xong, `tsc`/`eslint`/`npm run build` sạch, CHƯA test tay)

Người dùng test bản "Cập nhật 2026-07-28" (phòng ban thay "Quản lý theo phòng ban", duyệt Người
thay thế, Việc hôm nay...) và báo lại đúng 3 vấn đề — cả 3 đã xác nhận nguyên nhân bằng cách đọc
code thật (không đoán) trước khi sửa:

### Bug 1 — Tab "Việc định kỳ" bị ẩn hoàn toàn với nhân viên thường, chặn cả việc tự đăng ký
"Người thay thế"

**Nguyên nhân xác nhận qua code**: `kpi-shell.tsx` ẩn hẳn tab "Việc định kỳ" khỏi thanh điều
hướng (`requiresTemplatesAccess: true` + gọi `canSeeKpiTemplatesTab`) với bất kỳ ai không phải
admin/`kpi.manage_config`/lãnh đạo phòng ban. Đồng thời `templates/page.tsx` có thêm 1 `useEffect`
**redirect thẳng** `window.location.replace("/dashboard/kpi/tasks")` nếu `!canSeeKpiTemplatesTab`.
Vì sub-tab **"Người thay thế tạm thời"** bên trong chính trang đó dành cho **MỌI** nhân viên tự
đăng ký cho chính mình (RLS `kpi_user_substitutions_insert` từ trước đã cho phép
`original_user_id = auth.uid()` không cần bất kỳ quyền đặc biệt nào), việc ẩn+redirect cả trang
khiến nhân viên thường **không có cách nào vào trang để đăng ký** — đúng bug người dùng báo.

**Fix**:
- `kpi-shell.tsx`: bỏ hẳn cơ chế ẩn tab theo quyền (`requiresTemplatesAccess`, state
  `showTemplatesTab`, effect gọi `canSeeKpiTemplatesTab`) — "Việc định kỳ" giờ hiện cho mọi người
  như 3 tab còn lại (Công việc/Đánh giá 5S/Khiếu nại). Đã bỏ luôn prop `user`/`factoryId` của
  `KpiShellProps` (không còn cần thiết) — dọn theo ở cả 7 nơi gọi `<KpiShell>`.
- `templates/page.tsx`: bỏ hẳn `useEffect` redirect. Thêm `myLeaderDepartmentId` (qua
  `resolveMyLeaderDepartmentId`, cùng pattern `tasks/page.tsx`/`5s/page.tsx`) — `canManageTemplates
  = isAdmin || kpi.manage_config || isDeptLeader` (khớp đúng RLS
  `kpi_task_templates_insert/update/delete` sau migration `20260807_kpi_department_scoping.sql`).
  Sub-tab "Việc định kỳ" giờ hiển thị ĐỌC ĐƯỢC (read-only) cho người không quản lý — chỉ ẩn nút
  Thêm/Sửa/Tạm ngưng/Xóa, không ẩn cả danh sách (RLS SELECT vốn đã rộng trong factory từ trước).
  Thêm 1 effect chạy đúng 1 lần: người KHÔNG quản lý được mặc định vào thẳng sub-tab "Người thay
  thế tạm thời" (không cần tự bấm chuyển tab).
- Đã xóa hẳn hàm `canSeeKpiTemplatesTab` (dead code sau khi cả 2 nơi gọi nó bị gỡ) khỏi
  `src/lib/kpi-department-leaders.ts` — giữ nguyên `resolveMyLeaderDepartmentId`/
  `fetchDepartmentOptions`.

### Bug 2 — "Phân công thông minh" 5S chọn rất nhiều nhân sự không liên quan (form + thuật toán
không lọc theo Phòng ban)

**Nguyên nhân xác nhận qua code**: `kpi-5s-locations-tab.tsx` (form Thêm/Sửa Vị trí 5S) và
`kpi-5s-auto-assign-modal.tsx`/`kpi-5s-auto-assign.ts` (thuật toán) đều lấy **`userOptions`**
(toàn bộ profile active trong nhà máy, không lọc gì) hoặc **`loadKpiTaskCandidates(factoryId)`**
(toàn bộ `maintenance_staff` liên kết tài khoản trong nhà máy) làm nguồn ứng viên — dù
`kpi_5s_locations.phong_ban_id` đã tồn tại từ migration `20260807_kpi_department_scoping.sql`,
KHÔNG nơi nào dùng nó để thu hẹp danh sách. Đây là nguyên nhân thật của "chọn rất nhiều nhân sự
không liên quan".

**Quyết định thiết kế đã hỏi và được xác nhận qua `AskUserQuestion`**: ngoài lọc theo Phòng ban,
"Phân công thông minh" CHỈ random trong số người **ĐANG** là người dọn/chấm ở **bất kỳ vị trí
nào khác** (loại hẳn người chưa từng giữ vai trò 5S nào) — tự động nới lỏng về "chỉ theo phòng
ban" nếu phòng ban đó chưa từng gán ai (tránh pool rỗng vĩnh viễn lúc mới thiết lập).

**Fix**:
- `kpi-tasks.ts`: export `fetchDepartmentUserIds(factoryId, departmentId)` (trước đó private,
  chỉ dùng nội bộ cho `loadKpiTaskCandidates`) — dùng chung cho cả candidate list kiểu
  `maintenance_staff` lẫn danh sách profile thô.
- `kpi-5s-locations-tab.tsx` (form Thêm/Sửa Vị trí): thêm state `deptUserIds` (tra qua
  `fetchDepartmentUserIds` mỗi khi `form.phong_ban_id` đổi, chỉ khi modal mở);
  `filteredUserOptions` = `userOptions` đã lọc theo `deptUserIds`, **luôn giữ hiển thị người ĐÃ
  chọn** (cleaner/scorer) dù họ rơi ra ngoài phòng ban vừa lọc (tránh bug "select hiển thị sai
  giá trị"). Cả 2 picker "Người dọn hiện tại"/"Người chấm hiện tại" đổi sang dùng
  `filteredUserOptions` thay `userOptions`.
- `kpi-5s-auto-assign.ts`: `AutoAssignLocationInput` thêm `phong_ban_id`; `AutoAssignSuggestion`
  thêm `deptPoolRelaxed`/`establishedRelaxed`/`eligibleUserIds`. Hàm mới
  `computeEstablished5sUserIds(locations, cleanerMembership)` — union userId đang là người dọn
  (kể cả fallback `nguoi_don_id` legacy) hoặc người chấm của BẤT KỲ vị trí nào. Thuật toán
  `buildAutoAssignSuggestions` giờ có 3 tầng lọc lồng nhau theo đúng thứ tự: (1) Phòng ban — bắt
  buộc, không nới lỏng; (2) "đã từng dọn/chấm" — mềm, tự nới lỏng về pool phòng ban nếu rỗng; (3)
  Khu vực (`zone_id`, đã có từ trước) — mềm, tự nới lỏng như cũ. Tầng "tránh cùng nhóm chính"
  (existing) áp dụng sau cùng, không đổi.
- `kpi-5s-auto-assign-modal.tsx` (đã MOVE, xem mục dưới): tải thêm
  `fetchAllLocationCleanerMemberships` + tra `fetchDepartmentUserIds` cho từng `phong_ban_id`
  distinct trong `locations` được truyền vào, build `deptUserIdsByDept`/`establishedUserIds`
  truyền vào thuật toán. Dropdown sửa tay trong preview (`<select>` Người dọn/Người chấm) giờ
  CHỈ hiện đúng `eligibleUserIds` (pool cuối cùng sau mọi tầng lọc/nới lỏng) thay vì toàn bộ
  `candidates` — fallback về danh sách đầy đủ nếu pool đó rỗng (tránh dropdown trống hoàn toàn).
  Thêm 2 cảnh báo mới (icon `AlertTriangle`, mirror `zonePoolRelaxed`/`groupConstraintRelaxed` đã
  có): "Chưa tra được phòng ban — không lọc được" (`deptPoolRelaxed`) và "Phòng ban chưa từng gán
  ai — đã nới lỏng" (`establishedRelaxed`).

### Bug 3 (yêu cầu, không phải bug) — "Người chấm hiện tại" chưa bắt buộc khi thêm Vị trí 5S

`kpi-5s-locations-tab.tsx`'s `handleSave()` thêm chặn cứng
`if (!form.nguoi_cham_id) { setSaveError("Vui lòng chọn Người chấm hiện tại."); return }` — đặt
TRƯỚC check "chấm không được nằm trong người dọn" (để hiện đúng thông báo ưu tiên). Label đổi
"Người chấm hiện tại" → "Người chấm hiện tại \*", option placeholder đổi "— Chưa gán —" → "--
Chọn người chấm --" (nhất quán với "-- Chọn phòng ban --" đã có).

### Việc phụ phát sinh giữa phiên (theo yêu cầu mid-turn của người dùng) — nút "Phân công thông
minh" chuyển ra `/dashboard/kpi/5s`

Người dùng nhận xét nút "Sinh việc hôm nay" ở tab "Việc định kỳ" (đặt ngay ở trang chính, không
phải chôn trong Cài đặt) rất tiện — yêu cầu áp dụng tương tự cho "Phân công thông minh" (trước
đó chỉ có trong Cài đặt → KPI & 5S → Vị trí 5S).

- **Di chuyển file**: `kpi-5s-auto-assign-modal.tsx` chuyển từ
  `src/app/dashboard/settings/_components/` sang `src/app/dashboard/kpi/_components/` (component
  thuần túy, không phụ thuộc layout Settings) — cập nhật import tại
  `kpi-5s-locations-tab.tsx` sang đường dẫn mới.
- `/dashboard/kpi/5s/page.tsx`: thêm nút **"Phân công thông minh"** (tím, icon `Shuffle`) đặt
  cùng hàng với "Quản lý vị trí" — gọi thẳng `Kpi5sAutoAssignModal` với `locations=visibleLocations`
  (đã scope đúng theo người xem — admin/kpi.manage_config thấy tất cả, lãnh đạo phòng ban chỉ
  thấy đúng phòng ban mình). Sau khi giao xong: hiện banner tóm tắt (mirror Settings tab), gọi
  `sendKpiNotify` (Telegram), rồi `loadData()` lại.
- **Fix đi kèm phát hiện trong lúc làm việc này** (không phải yêu cầu gốc nhưng là hệ quả tất
  yếu): biến `canManageLocations` trong `5s/page.tsx` (dùng để quyết định `visibleLocations` có
  bypass scoping theo phòng ban hay không) **KHÔNG được đổi** — vẫn giữ nguyên
  `isAdmin || kpi.manage_config` (đổi biến này sẽ vô tình cho lãnh đạo phòng ban thấy TẤT CẢ vị
  trí thay vì chỉ đúng phòng ban mình, phá vỡ toàn bộ logic scoping "Phase E" đã có). Thay vào đó
  thêm biến RIÊNG `canManageAnyLocation = canManageLocations || isDeptLeader` — chỉ dùng để hiện/
  ẩn 2 nút "Quản lý vị trí"/"Phân công thông minh", không ảnh hưởng `visibleLocations`.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file mới/đã sửa: `kpi-tasks.ts`,
`kpi-department-leaders.ts`, `kpi-5s-auto-assign.ts`, `kpi-shell.tsx`,
`kpi-5s-auto-assign-modal.tsx` (mới), `templates/page.tsx`, `5s/page.tsx`, `tasks/page.tsx`,
`tasks/[id]/page.tsx`, `appeals/page.tsx`, `5s/location/[id]/page.tsx`,
`kpi-5s-locations-tab.tsx`, `settings/page.tsx`), và `npm run build` đều sạch (4 warning còn lại
trong `settings/page.tsx` là pre-existing, không liên quan thay đổi này — đã đối chiếu).

### Mở Cài đặt → KPI & 5S cho lãnh đạo phòng ban (quyết định đã hỏi và được xác nhận)

Vì migration `20260807_kpi_department_scoping.sql` đã cấp RLS cho lãnh đạo phòng ban tự quản lý
`kpi_5s_locations`/`kpi_5s_zones`/`kpi_task_templates` đúng phòng ban mình mà KHÔNG cần
`kpi.manage_config`, nhưng tab "Cài đặt → KPI & 5S" trước đó ẩn hoàn toàn với họ (kể cả bootstrap
guard tổng của trang Cài đặt cũng chặn thẳng), đã mở thêm lối vào:

- `settings/page.tsx`: thêm state `kpiLeaderDepartmentId` (tính trong `bootstrap()` qua
  `resolveMyLeaderDepartmentId(sessionUser.id, fid)`, **TRƯỚC** guard tổng) — guard tổng
  (`if (!hasPermission(...) && ... && !hasPermission(sessionUser, "kpi.manage_config"))`) thêm
  điều kiện `&& leaderDeptId == null` vào cuối chuỗi AND, để lãnh đạo phòng ban không bị đá về
  `/dashboard` chỉ vì thiếu MỌI quyền Cài đặt khác.
- Thêm biến `isKpiDeptLeader`/`canManageKpi5s = canManageKpiConfig || isKpiDeptLeader` — dùng
  riêng cho sidebar (`show: canManageKpi5s` thay `canManageKpiConfig`) và 2 nơi truyền
  `canManage` prop xuống `Kpi5sLocationsTab`/`Kpi5sZonesTab`. **`canManageKpiConfig` gốc giữ
  nguyên không đổi** (không dùng cho tab "KPI & 5S" nữa, nhưng không có nơi nào khác tham chiếu
  nên an toàn).
- **Giới hạn đã biết, chưa xử lý**: dropdown "Phòng ban" trong form Thêm/Sửa Vị trí 5S (và
  tương tự ở form Việc định kỳ/Giao việc tay) liệt kê TẤT CẢ phòng ban trong hệ thống, không tự
  giới hạn lãnh đạo chỉ chọn được đúng phòng ban của họ ở tầng UI — nếu họ cố tình chọn phòng ban
  khác, RLS sẽ chặn ở bước lưu với lỗi Supabase chung chung (không thân thiện, nhưng không sai
  logic). Chưa xử lý vì không nằm trong yêu cầu gốc của phiên này — cần cân nhắc thêm UX rõ ràng
  hơn nếu người dùng phản ánh nhầm lẫn.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự (không cần migration mới, đã
dùng lại đúng 2 migration `20260807_...` đã liệt kê ở mục "2026-07-28" phía trên)

1. Đăng nhập 1 tài khoản THƯỜNG (không phải admin/kpi.manage_config/lãnh đạo phòng ban nào) →
   xác nhận thấy tab "Việc định kỳ" trong thanh điều hướng module KPI → bấm vào → tự động vào
   thẳng sub-tab "Người thay thế tạm thời" (không phải "Việc định kỳ") → bấm "Đăng ký người thay
   thế" → tự đăng ký cho chính mình → xác nhận lưu thành công (trước đây không thể vào trang).
2. Cùng tài khoản đó, thử bấm sub-tab "Việc định kỳ" → xác nhận vẫn XEM được danh sách (đọc),
   nhưng KHÔNG thấy nút "Thêm việc định kỳ"/"Sửa"/"Tạm ngưng"/"Xóa"/"Sinh việc hôm nay ngay".
3. Tạo 2 Vị trí 5S ở 2 phòng ban khác nhau (vd "Phòng Kế toán" và "Đội xe"), mỗi phòng ban có
   ít nhất 2-3 nhân sự liên kết tài khoản khác nhau → mở form Sửa 1 trong 2 vị trí đó → xác nhận
   "Người dọn hiện tại"/"Người chấm hiện tại" CHỈ liệt kê đúng nhân sự thuộc phòng ban đã chọn,
   không còn thấy toàn bộ nhân sự nhà máy.
4. Thử lưu vị trí 5S KHÔNG chọn "Người chấm hiện tại" → xác nhận bị chặn đúng thông báo; chọn
   xong lưu thành công.
5. Test "Phân công thông minh" (cả từ Cài đặt lẫn nút mới ở `/dashboard/kpi/5s`): với 2 phòng
   ban ở bước 3, bấm "Tạo đề xuất" → xác nhận đề xuất người dọn/chấm CHỈ đến từ đúng phòng ban
   của từng vị trí, không lẫn người phòng ban khác. Nếu phòng ban đó CHƯA từng gán ai làm 5S
   trước đây → xác nhận cảnh báo "Phòng ban chưa từng gán ai — đã nới lỏng" hiện đúng, và đề
   xuất khi đó mở rộng ra toàn bộ phòng ban (không còn giới hạn "đã từng dọn/chấm"). Nếu phòng
   ban ĐÃ có người từng làm 5S ở vị trí khác → xác nhận đề xuất ưu tiên đúng những người đó.
6. Đăng nhập 1 tài khoản là lãnh đạo phòng ban (Chức vụ đúng 1 trong 6 chức danh, xem mục "Phase
   B") → xác nhận vào được `Cài đặt → KPI & 5S` (trước đây bị ẩn/chặn hoàn toàn) → tạo/sửa được
   Vị trí 5S có `phong_ban_id` = đúng phòng ban của họ; thử chọn phòng ban KHÁC phòng ban mình →
   xác nhận bị chặn lưu (lỗi RLS) — ghi nhận đây là hành vi chấp nhận được (chưa có UX thân
   thiện hơn), không phải bug.
7. Test nút "Phân công thông minh" mới ở `/dashboard/kpi/5s` cho tài khoản lãnh đạo phòng ban →
   xác nhận CHỈ thấy/random được vị trí thuộc đúng phòng ban mình (không phải toàn bộ nhà máy
   như admin).
8. Test regression: tài khoản admin vẫn thấy/thao tác được mọi thứ như trước ở cả 2 nơi (Cài đặt
   và `/dashboard/kpi/5s`), không bị thu hẹp bởi các thay đổi trên.

## Cập nhật Phase 3 (2026-07-29, tiếp) — Khung tiêu chí KPI + Chấm điểm chuyên môn theo ngày, ĐÃ
CODE XONG, CHƯA CHẠY MIGRATION, CHƯA TEST TAY

Đã hỏi và được xác nhận qua `AskUserQuestion` trước khi code (đi tiếp Phase 3 thay vì ưu tiên
việc khác). Xây đúng theo schema đã phác thảo sẵn ở mục "Database Schema" → "Nhóm & Chuyên môn
(D)" đầu file, không lệch thiết kế nào đáng kể.

### Migration `supabase/migrations/20260811_kpi_criteria_daily_evaluations.sql` (**CẦN CHẠY THỦ
CÔNG, CHƯA CHẠY**)

- `kpi_criteria_templates` (`factory_id, group_id → personnel_groups, ten_tieu_chi, mo_ta,
  sort_order, is_active`) — mỗi tiêu chí thuộc đúng 1 nhóm chuyên môn. RLS: SELECT rộng trong
  factory; INSERT/UPDATE/DELETE chỉ `kpi.manage_config`/admin — **KHÔNG mở rộng cho lãnh đạo
  phòng ban** như `kpi_5s_locations`/`kpi_task_templates`, vì `personnel_groups` không mang khái
  niệm phòng ban (`phong_ban_id`), không có ranh giới rõ ràng để gán quyền tương tự.
- `kpi_daily_evaluations` (`factory_id, user_id, ngay, group_id, loai ('chinh'|'choang'),
  nguoi_cham_id, ghi_chu`), `UNIQUE(factory_id,user_id,ngay,group_id)` — RLS chỉ có SELECT rộng
  trong factory; **không cấp INSERT/UPDATE/DELETE trực tiếp cho client** — mọi ghi bắt buộc qua 2
  RPC bên dưới.
- `kpi_daily_evaluation_items` (`factory_id, evaluation_id → kpi_daily_evaluations ON DELETE
  CASCADE, criteria_id, ket_qua ('dat'|'tuong_doi'|'chua_dat')`), `UNIQUE(evaluation_id,
  criteria_id)` — có `factory_id` riêng (mirror `kpi_task_logs`, tránh JOIN qua bảng cha mỗi lần
  lọc, đúng invariant "mọi bảng đều có factory_id"). Cũng không cấp ghi trực tiếp.
- **Quyết định thiết kế quan trọng**: `kpi.evaluate` (đã seed sẵn từ Phase 0, cấp mặc định cho
  `admin`+`manager`) trước đây **chưa từng được dùng để gate bất kỳ đâu** (đã ghi rõ ở mục "Fix
  nhỏ 2026-07-25" — Nghiệm thu/Điều chỉnh/Trả về của công việc chỉ dùng `nguoi_giao_id`/admin,
  cố ý không dùng permission này). Đây là nơi ĐẦU TIÊN `kpi.evaluate` thực sự có tác dụng: gate
  ai được gọi RPC `kpi_submit_daily_evaluation`/`kpi_delete_daily_evaluation`.
- **RPC atomic `kpi_submit_daily_evaluation(p_user_id, p_ngay, p_group_id, p_ghi_chu, p_items
  JSONB)`** — validate quyền (`current_profile_has_permission('kpi.evaluate')`) + cùng nhà máy
  (cả người chấm, người được chấm, nhóm) → tự tính `loai` server-side (snapshot
  `personnel_group_members.is_primary` của đúng `group_id` cho đúng `user_id`, KHÔNG tin client
  tự khai) → `INSERT ... ON CONFLICT (factory_id,user_id,ngay,group_id) DO UPDATE` (upsert, cho
  phép "gộp nhiều lần chấm/lần" đúng theo roadmap — khác hẳn `kpi_5s_evaluations`, vốn là log bất
  biến không cho sửa) → xóa hết items cũ → insert items mới (validate từng `criteria_id` đúng
  thuộc `group_id`+`factory_id` đang chấm). Toàn bộ trong 1 transaction, đúng convention "RPC
  atomic cho multi-step write" xuyên suốt cả module.
- **RPC `kpi_delete_daily_evaluation(p_evaluation_id)`** — xóa hẳn 1 lượt chấm (dùng khi chọn
  nhầm người/nhóm hoàn toàn, không phải sửa kết quả).
- Không có ràng buộc "chỉ người chấm gốc mới sửa lại được" — bất kỳ ai có `kpi.evaluate`/admin
  đều re-score được (ghi đè `nguoi_cham_id` thành người vừa sửa) — quyết định có chủ đích vì
  roadmap ưu tiên "gộp/merge" hơn tính bất biến kiểu 5S; nếu sau này phát sinh lo ngại thao túng
  điểm số, có thể bổ sung theo hướng audit log riêng (chưa làm ở đợt này).

### `src/lib/kpi-criteria.ts` (mới) — CRUD khung tiêu chí

`fetchKpiCriteriaTemplates(factoryId, opts?)`, `fetchKpiCriteriaTemplatesByGroup(factoryId,
groupId)` (chỉ tiêu chí `is_active`, dùng cho form chấm điểm), `createKpiCriteriaTemplate`,
`updateKpiCriteriaTemplate`, `setKpiCriteriaTemplateActive`, `deleteKpiCriteriaTemplate`. Theo
đúng convention `kpi-templates.ts` (throw raw Supabase error, không tự bọc message — trang gọi
dùng `getKpiErrorMessage` từ `kpi-tasks.ts` để format), KHÔNG duplicate helper error như
`kpi-5s.ts` từng làm.

### `src/lib/kpi-daily-evaluations.ts` (mới) — nộp/xem chấm điểm

- `computeDailyPercent(items)` — đúng công thức `%đạt = Σ(Đạt×1.0+Tương_đối×0.5+Chưa_đạt×0) ÷ số
  tiêu chí đã chấm`, làm tròn 1 chữ số thập phân.
- `fetchKpiDailyEvaluationOne(factoryId, userId, ngay, groupId)` — 1 lượt chấm cụ thể kèm items
  (nested select `kpi_daily_evaluation_items(...)`), dùng pre-fill form khi mở lại/sửa.
- `fetchKpiDailyEvaluationsForDay(factoryId, ngay)` — toàn bộ lượt chấm trong 1 ngày (mọi
  người/nhóm), dùng cho bảng lịch sử.
- `submitKpiDailyEvaluation`/`deleteKpiDailyEvaluation` — wrapper gọi 2 RPC trên.

### Settings — sub-tab "Khung tiêu chí KPI" (`kpi-criteria-tab.tsx`, mới)

Thêm sub-tab thứ 3 trong Cài đặt → KPI & 5S (cạnh "Vị trí 5S"/"Khu vực"). Danh sách nhóm chuyên
môn (`loadAllPersonnelGroups`) mỗi nhóm 1 card, liệt kê tiêu chí bên trong (Sửa/Tạm ngưng/Xóa),
nút "Thêm tiêu chí" chung + "Thêm vào nhóm này" per-card. **`canManage` truyền vào là
`canManageKpiConfig` THUẦN** (admin/kpi.manage_config) — KHÔNG dùng `canManageKpi5s` (đã mở rộng
cho lãnh đạo phòng ban ở 2 tab kia) — đúng quyết định thiết kế ở trên.

### Tab "Chấm điểm chuyên môn" (`/dashboard/kpi/evaluate/page.tsx`, mới)

- Thêm vào `KpiShell` (tông màu indigo, icon `ClipboardCheck`) — hiện cho mọi `kpi.view` user
  như 4 tab còn lại; phần "Lưu"/"Sửa"/"Xóa" tự ẩn nếu `!canEvaluate` (chỉ còn xem lịch sử).
- Form: Ngày (mặc định hôm nay) → Người được chấm (`loadKpiTaskCandidates`) → Nhóm chuyên môn
  (chỉ hiện các nhóm mà NGƯỜI ĐÓ thực sự thuộc, qua `candidate.groupIds`) → tự tải tiêu chí
  (`fetchKpiCriteriaTemplatesByGroup`) + lượt chấm đã có (nếu có, để sửa/gộp) → mỗi tiêu chí 3 nút
  Đạt/Tương đối/Chưa đạt (không ép chọn hết — khớp đúng "số tiêu chí ĐÃ CHẤM" trong công thức, cho
  phép chấm một phần) → ghi chú → Lưu (gọi RPC, upsert).
- Hiển thị preview `%đạt hiện tại` + nhãn "Chính (×10)"/"Choàng (×5)" tính client-side (chỉ để
  tham khảo trước khi lưu — giá trị `loai` CHÍNH THỨC luôn do RPC tự tính lại server-side, không
  tin giá trị preview này).
- Bảng "Lịch sử chấm điểm ngày {ngày}" — liệt kê mọi lượt chấm trong ngày đã chọn (mọi người/mọi
  nhóm), hiện %đạt/loại/người chấm/ghi chú, nút Sửa (nạp lại vào form phía trên) + Xóa (RPC
  `kpi_delete_daily_evaluation`, có xác nhận qua `ModalShell`).

### Ngoài phạm vi (chưa làm ở Phase 3 này, để Phase 4)

- **KHÔNG tính điểm tháng** (D — Điểm chuyên môn tổng hợp theo công thức "Điểm ngày =
  %chính×10 + Σ(%choàng_i×5), Max ngày = 10 + 5×số nhóm choàng có chấm ngày đó") — Phase 3 chỉ
  xây hạ tầng lưu trữ + form chấm điểm hàng ngày, việc tổng hợp thành điểm KPI tháng
  (`kpi_monthly_scores`) thuộc Phase 4, cần dữ liệu Phase 3 này làm input.
- Không có cơ chế nhắc nhở/báo thiếu nếu 1 người bị bỏ sót chấm điểm ngày nào đó — thuần túy nộp
  chủ động, không có "Việc hôm nay" kiểu Công việc/5S cho việc chấm điểm.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự

1. Chạy `supabase/migrations/20260811_kpi_criteria_daily_evaluations.sql` trên Supabase SQL
   Editor.
2. Vào Cài đặt → KPI & 5S → "Khung tiêu chí KPI" — thêm 2-3 tiêu chí cho 1 nhóm chuyên môn có
   sẵn (vd "Bảo trì") — xác nhận lưu đúng, Sửa/Tạm ngưng/Xóa hoạt động; test tài khoản KHÔNG có
   `kpi.manage_config` (kể cả lãnh đạo phòng ban) → xác nhận vẫn xem được danh sách nhưng không
   thấy nút Thêm/Sửa/Xóa.
3. Vào `/dashboard/kpi/evaluate` với tài khoản có `kpi.evaluate` (mặc định admin/manager) — chọn
   Ngày (hôm nay) + 1 Người thuộc nhóm vừa thêm tiêu chí + đúng Nhóm đó → xác nhận tiêu chí hiện
   ra đúng, chấm 1 vài tiêu chí (không cần hết) → Lưu → xác nhận thành công, %đạt hiển thị đúng
   theo công thức, xuất hiện trong "Lịch sử chấm điểm ngày" bên dưới với đúng nhãn Chính/Choàng
   (test cả 2 trường hợp: nhóm đó LÀ nhóm chính của người này, và KHÔNG PHẢI nhóm chính).
4. Mở lại đúng (Ngày, Người, Nhóm) đã chấm ở bước 3 → xác nhận form tự nạp lại đúng kết quả cũ
   (pre-fill) → đổi 1-2 tiêu chí, thêm tiêu chí mới chưa chấm trước đó → Lưu lại → xác nhận
   UPSERT đúng (không tạo dòng trùng trong lịch sử, chỉ 1 dòng duy nhất cho đúng tổ hợp
   Ngày+Người+Nhóm, %đạt cập nhật đúng theo bộ items mới).
5. Bấm "Sửa" trực tiếp từ bảng "Lịch sử chấm điểm" → xác nhận nạp đúng vào form phía trên; bấm
   "Xóa" 1 lượt chấm → xác nhận biến mất khỏi lịch sử, gọi lại đúng RPC xóa.
6. Test tài khoản KHÔNG có `kpi.evaluate` (role `user` mặc định) → vào `/dashboard/kpi/evaluate`
   → xác nhận chỉ thấy bảng lịch sử (đọc), không thấy form chấm điểm/nút Lưu/Sửa/Xóa.
7. Test 1 người CHƯA thuộc nhóm chuyên môn nào (`personnel_group_members` rỗng cho họ) → chọn
   người đó trong form → xác nhận dropdown "Nhóm chuyên môn" hiện đúng cảnh báo "chưa thuộc nhóm
   chuyên môn nào" và bị khóa (không chọn được nhóm nào), không crash.
8. Test 1 nhóm CHƯA có tiêu chí nào (`is_active`) → chọn nhóm đó → xác nhận hiện đúng thông báo
   hướng dẫn vào Cài đặt thêm tiêu chí, không hiện nút Lưu.
9. Thử gọi thẳng RPC `kpi_submit_daily_evaluation` (qua devtools) với `p_user_id` thuộc nhà máy
   KHÁC, hoặc `p_group_id` không tồn tại — xác nhận bị chặn đúng với thông báo lỗi rõ ràng, không
   ghi được dữ liệu sai nhà máy.

## Cập nhật (kế hoạch phiên sau) — Fix bug "việc định kỳ mắc kẹt" + tài liệu Q1/Q4, ĐÃ CODE XONG,
CHƯA CHẠY MIGRATION, CHƯA TEST TAY

Người dùng đặt 3 câu hỏi thiết kế trước khi đi tiếp Phase 4, xác nhận qua `AskUserQuestion` — câu
hỏi 2 chỉ ra 1 bug thật, đã fix. Câu hỏi 1/4 chỉ cần tài liệu hóa (không code logic). Câu hỏi 3
(validate ngày dữ liệu nghiệp vụ khi "Gắn bản ghi tại chỗ") **cố ý hoãn**, chưa làm.

### Bug đã fix — RPC `kpi_ensure_today_task_instances` sinh task trùng mỗi ngày khi task cũ chưa xong

**Nguyên nhân xác nhận qua đọc code** (không đoán): hàm chỉ kiểm tra `EXISTS (... AND ngay_giao =
v_today)` — "đã có task cho ĐÚNG HÔM NAY chưa" — không hề kiểm tra instance của NGÀY TRƯỚC (cùng
`template_id`) đã đóng (`hoan_thanh`/`huy`) hay chưa. Ví dụ thật: 1 việc định kỳ "up sản lượng
trước 22h" giao ngày 27/7, chưa hoàn thành; sang ngày 28/7 mở app, hệ thống vẫn sinh thêm 1 task
MỚI cho ngày 28/7 — task ngày 27/7 vẫn còn mở, chồng chất dần mỗi ngày không xong.

**Fix** — migration `supabase/migrations/20260812_kpi_task_templates_skip_stuck.sql` (**CẦN CHẠY
THỦ CÔNG, CHƯA CHẠY** — phải chạy SAU `20260807_kpi_substitution_approval.sql`): `CREATE OR
REPLACE FUNCTION kpi_ensure_today_task_instances` (giữ nguyên chữ ký, không cần `DROP FUNCTION`)
— thêm 1 khối `IF EXISTS (SELECT 1 FROM kpi_tasks WHERE template_id = v_tpl.id AND trang_thai NOT
IN ('hoan_thanh','huy')) THEN CONTINUE; END IF;` ngay sau khối kiểm tra "đã có task hôm nay chưa".
Nếu template đang có BẤT KỲ task nào còn mở (bất kể ngày sinh, bất kể ai đang giữ), không sinh
thêm — task cũ giữ nguyên `han_hoan_thanh` gốc, độ trễ hiển thị rõ qua badge "Quá hạn N ngày" mới
thêm (xem dưới) thay vì bị nhân bản.

**Known limitation đã ghi nhận, cố ý chưa xử lý ở đợt này**: nếu "Người thay thế tạm thời" bắt
đầu hiệu lực trong lúc task cũ (của người gốc) còn mắc kẹt, người thay thế sẽ KHÔNG có task mới
cho tới khi task cũ đóng (không tự động reassign task cũ sang người thay thế). Cần quyết định
thêm nếu người dùng phản ánh case này trong thực tế.

**UX đi kèm** — hàm mới `daysOverdue(task, nowMs?)` trong `src/lib/kpi-tasks.ts` (bên cạnh
`isTaskOverdue`/`isTaskDueSoon` đã có), trả về số ngày quá hạn (làm tròn xuống) hoặc `null` nếu
task không quá hạn. Hiển thị badge đỏ nhỏ "Quá hạn N ngày" ở: card danh sách công việc
(`kpi/tasks/page.tsx`, cạnh dòng "Hạn: ...") và header trang chi tiết công việc
(`kpi/tasks/[id]/page.tsx`, cạnh "Hạn hoàn thành"). Cần thiết vì sau fix, 1 task có thể tồn tại
quá hạn NHIỀU ngày liên tục thay vì bị "che" bởi các bản sao mới mỗi ngày như trước — nếu không
hiển thị rõ mức độ trễ, module sẽ mất đi tính minh bạch.

### Tài liệu hóa câu hỏi 1 — "Vì sao cần Khung tiêu chí (D) khi đã giao task (A/B) rồi?"

Đã xác nhận với người dùng: D và A/B đo hai thứ khác nhau, không trùng lặp nếu tiêu chí được cấu
hình đúng tinh thần — **không cần sửa code**, chỉ ghi lại hướng dẫn cho admin khi cấu hình
`kpi_criteria_templates` (Cài đặt → KPI & 5S → Khung tiêu chí KPI):

- **A (Hoàn thành) + B (Đúng hạn)** — đo việc GIAO CỤ THỂ (`kpi_tasks`): đã làm task này chưa,
  đúng hạn không. Ví dụ: task "Đo mẫu hàng ngày" (nhóm Kỹ thuật - Chất lượng, giao Nguyễn Hữu Thọ
  chính/Chau Nho choàng) → A = đã nộp/nghiệm thu chưa; B = có đúng hạn không.
- **D (Chuyên môn)** — đo CHẤT LƯỢNG/KỸ NĂNG HÀNH NGHỀ CHUNG của nhóm, độc lập với có task cụ thể
  nào hôm đó hay không. Tiêu chí ĐÚNG tinh thần cho nhóm "Kỹ thuật - Chất lượng": *"Tuân thủ đúng
  quy trình lấy mẫu"*, *"Ghi chép đầy đủ vào biểu mẫu"*, *"Vệ sinh/bảo quản dụng cụ đo đúng
  cách"*, *"An toàn lao động khi thao tác mẫu"*. Tiêu chí SAI tinh thần (tránh khi cấu hình) —
  *"Đã đo mẫu đúng hạn hôm nay"* (trùng lặp trực tiếp với B, không nên đưa vào Khung tiêu chí).

### Tài liệu hóa câu hỏi 4 — "Việc định kỳ nhịp độ khác ngày (vd chấm điểm hàng tuần)"

Đã xác nhận: dùng cơ chế có sẵn, **không cần code**. `kpi_task_templates.apply_weekdays` đã hỗ
trợ chọn ĐÚNG 1 thứ (vd chỉ Chủ nhật) — kết hợp `gio_han` (vd 17:00) → `kpi_ensure_today_task_instances`
tự sinh đúng 1 task/tuần vào đúng thứ đó, không cần thay đổi schema. Đã thêm 1 dòng hint trong
`template-form-modal.tsx` ngay dưới phần chọn "Thứ áp dụng": *"Chọn nhiều thứ = việc lặp lại hàng
ngày... Chỉ chọn 1 thứ (vd chỉ Chủ nhật) = việc lặp lại theo tuần vào đúng thứ đó."*

### Câu hỏi 3 — cố ý CHƯA làm (known limitation)

"Validate đúng ngày dữ liệu nghiệp vụ khi đóng task qua Gắn bản ghi tại chỗ" (vd bắt buộc bản ghi
sản lượng gắn vào đúng phải là của ngày mục tiêu, không được là ngày cũ hơn) — **chưa cần**, theo
xác nhận của người dùng. Cơ chế "Gắn bản ghi tại chỗ" (`kpi_task_link_and_complete`,
`KpiLinkPrompt`) tiếp tục tin tưởng người dùng tự chọn đúng bản ghi, domain-agnostic, không kiểm
tra ngày. Ghi lại làm known limitation, không phải việc quên làm.

### Chưa test tay — cần làm ở phiên sau

1. Chạy migration `20260812_kpi_task_templates_skip_stuck.sql` trên Supabase SQL Editor (SAU
   `20260807_kpi_substitution_approval.sql`).
2. Test đúng kịch bản gốc: 1 template giao cho 1 người, để task ngày N không hoàn thành → mở app
   ở ngày N+1, N+2 → xác nhận CHỈ có 1 task tồn tại (không nhân bản), `han_hoan_thanh` giữ nguyên
   mốc gốc (ngày N), badge "Quá hạn N ngày" tăng đúng theo số ngày trôi qua ở cả card danh sách
   lẫn trang chi tiết.
3. Hoàn thành task đó (nghiệm thu hoặc Gắn bản ghi tại chỗ) → mở app ngày kế tiếp → xác nhận sinh
   đúng 1 task MỚI cho ngày đó (không còn bị chặn nữa vì task cũ đã đóng).
4. Tạo 1 template chỉ chọn Chủ nhật, giờ hạn 17:00 → xác nhận chỉ sinh đúng 1 task/tuần vào đúng
   Chủ nhật (không sinh vào các ngày khác trong tuần) — xác nhận hành vi có sẵn hoạt động đúng như
   kỳ vọng, không cần sửa gì thêm.
5. Xác nhận dòng hint mới trong form Thêm/Sửa "Việc định kỳ" hiển thị đúng, không vỡ layout.

## Cập nhật Phase 4 (kế hoạch phiên sau, tiếp) — Trọng số công thức + Hệ số chuyên cần + Engine
tính điểm tháng, ĐÃ CODE XONG, CHƯA CHẠY MIGRATION, CHƯA TEST TAY

Implement đúng theo công thức đã chốt sẵn ở đầu file ("Công thức tính điểm") — không đổi công
thức, chỉ hiện thực hóa thành schema + RPC + UI.

### Migration `supabase/migrations/20260813_kpi_score_weights_monthly_scores.sql` (**CẦN CHẠY THỦ
CÔNG, CHƯA CHẠY** — chạy sau mọi migration KPI trước đó, không phụ thuộc thứ tự đặc biệt nào khác)

- `kpi_score_weights` (`factory_id, group_id NULL`, `trong_so_hoan_thanh/dung_han/5s/chuyen_mon`
  mặc định 30/25/20/25, `ngay_chuan_chuyen_can` mặc định 24, `he_so_chuyen_can_min/max` mặc định
  0.75/1.10) — `UNIQUE(factory_id, group_id)` (đúng cho các dòng theo nhóm cụ thể) + 1 partial
  unique index riêng `WHERE group_id IS NULL` (Postgres không tự chặn nhiều dòng NULL trong
  UNIQUE thường — bắt buộc phải có index riêng cho dòng "mặc định toàn nhà máy"). RLS: SELECT
  rộng trong factory; INSERT/UPDATE/DELETE chỉ `current_profile_has_permission('kpi.manage_config')`
  (hàm này tự trả `true` cho admin, không cần OR thêm điều kiện role) — **KHÔNG mở rộng cho lãnh
  đạo phòng ban**, cùng lý do với `kpi_criteria_templates`: không có ranh giới phòng ban rõ ràng
  cho cấu hình công thức toàn nhà máy/theo nhóm.
- `kpi_monthly_scores` (`factory_id, user_id, nam, thang`, `diem_hoan_thanh/dung_han/5s/chuyen_mon`,
  `he_so_chuyen_can`, `so_ngay_co_cham`, `diem_tong`, `chi_tiet JSONB`, `trang_thai
  ('nhap'|'da_khoa')` mặc định `nhap`, `khoa_boi`/`khoa_luc` — dự phòng sẵn cho Phase 5, Phase 4
  chưa dùng tới) — `UNIQUE(factory_id, user_id, nam, thang)`. RLS chỉ có SELECT (`user_id =
  auth.uid() OR admin OR kpi.view_all`) — **không có INSERT/UPDATE/DELETE cho client**, mọi ghi
  đều qua RPC `SECURITY DEFINER` bên dưới.
- **RPC atomic `kpi_compute_monthly_scores(p_factory_id, p_nam, p_thang) RETURNS INTEGER`** — 1
  transaction duy nhất, dùng chuỗi CTE + `GROUP BY` cho TOÀN BỘ user active của nhà máy (không
  loop-per-user, đúng ràng buộc bắt buộc ở "Rủi ro/quy tắc bắt buộc" đầu file):
  - `a_data`: A = `AVG(COALESCE(tien_do_nghiem_thu, tien_do))` theo `kpi_task_members.is_active=
    true` join `kpi_tasks.ngay_giao` rơi trong tháng.
  - `b_data`: B = tỷ lệ `da_nop_luc <= han_hoan_thanh` trong số task ĐÃ ĐẾN HẠN
    (`han_hoan_thanh <= cutoff`, `cutoff = LEAST(now(), ngày cuối tháng + 1)` — nếu đang tính
    tháng hiện tại thì chỉ tính task đã thực sự đến hạn tính tới thời điểm gọi RPC, tránh tính
    nhầm các task cuối tháng chưa tới hạn thành "trễ").
  - `c_data`: C = `AVG(dat=100/tuong_doi=50/khong_dat=0)` theo `kpi_5s_evaluations.nguoi_don_id`
    (snapshot đúng tuần đó), `tuan_bat_dau` rơi trong tháng — tự nhiên "chia cho số lần thực sự
    có snapshot" vì `AVG` chỉ tính trên các dòng tồn tại, không phải tổng số tuần trong tháng.
  - `d_data`: dùng `eval_pct` (tính %đạt mỗi `kpi_daily_evaluations`, đúng công thức
    `computeDailyPercent` viết lại bằng SQL) → tách `chinh_days`/`choang_days` → `day_scores`
    (chỉ tính NGÀY có `loai='chinh'` — đúng "ngày có mặt/có chấm" theo rules file; nếu ngày đó
    chỉ có choàng mà không có chính thì KHÔNG được tính vào D tháng) → `d_data` = trung bình
    `(diem_ngay/max_ngay)*100` qua các ngày đó, `so_ngay_co_cham` = đếm số ngày đó.
  - `weight_row`: resolve trọng số ưu tiên theo `personnel_group_members.is_primary` của user →
    `kpi_score_weights` theo đúng `group_id` đó, fallback dòng `group_id IS NULL`, fallback cuối
    cùng hằng số hard-code (khớp `defaultKpiScoreWeights()` phía TS).
  - **Quyết định thiết kế quan trọng (bản nháp)**: thiếu dữ liệu 1 thành phần (không có task nào/
    không có task đã đến hạn/không có lần chấm 5S nào/không có ngày chấm D nào) → thành phần đó
    mặc định **100**, KHÔNG renormalize lại trọng số 3 thành phần còn lại. Đơn giản hóa có chủ
    đích cho giai đoạn nháp — nếu sau vài tháng quan sát thấy bất hợp lý (vd 1 người mới vào chưa
    có task nào nhưng vẫn được A=100), cần quay lại thiết kế ở Phase 5.
  - `UPSERT ... ON CONFLICT (factory_id,user_id,nam,thang) DO UPDATE ... WHERE
    kpi_monthly_scores.trang_thai <> 'da_khoa'` — không ghi đè điểm đã khóa (dù chưa có UI khóa ở
    Phase 4, chuẩn bị sẵn cho Phase 5 cắm vào không phải sửa RPC).
  - Chỉ admin/`kpi.manage_config` gọi được (validate qua `current_profile_has_permission`, không
    tin phía client).

### `src/lib/kpi-scores.ts` (mới)

- `KpiScoreWeights`/`defaultKpiScoreWeights()` (hằng số 30/25/20/25/24/0.75/1.10, dùng làm giá trị
  mặc định form Thêm mới VÀ làm fallback hiển thị khi 1 nhóm/nhà máy chưa cấu hình gì) +
  `fetchKpiScoreWeights`/`createKpiScoreWeights`/`updateKpiScoreWeights`/`deleteKpiScoreWeights`
  (`validateWeightsSum` chặn lưu nếu tổng 4 trọng số ≠ 100 — validate TẦNG APP, không phải DB
  CHECK, vì admin có thể tạm thời lưu dở khi đang chỉnh nhiều dòng).
- `KpiMonthlyScore`/`KpiMonthlyScoreDetail` (khớp `chi_tiet` JSONB) +
  `fetchKpiMonthlyScores(factoryId, nam, thang)` (toàn nhà máy, 1 tháng) +
  `fetchMyKpiMonthlyScores(userId, factoryId)` (lịch sử nhiều tháng của 1 người) +
  `computeKpiMonthlyScores(factoryId, nam, thang)` (wrapper RPC).

### Settings — sub-tab "Trọng số công thức" (`kpi-score-weights-tab.tsx`, mới)

Sub-tab thứ 4 trong Cài đặt → KPI & 5S (cạnh "Vị trí 5S"/"Khu vực"/"Khung tiêu chí KPI"). Hiện 1
card "Mặc định toàn nhà máy" luôn có (dù chưa từng lưu — hiển thị hằng số mặc định + nút "Cấu
hình riêng" để tạo dòng thật) + danh sách card theo từng nhóm đã có cấu hình riêng + hàng nút
nhanh "Thêm cấu hình riêng cho nhóm: ..." cho các nhóm CHƯA cấu hình. Modal Thêm/Sửa hiện live
"Tổng: X%" đổi màu đỏ/xanh theo có = 100 hay không. **`canManage` truyền vào là
`canManageKpiConfig` THUẦN** (admin/kpi.manage_config), giống "Khung tiêu chí KPI" — không mở
rộng cho lãnh đạo phòng ban.

### Tab "Bảng điểm KPI" (`/dashboard/kpi/scores/page.tsx`, mới)

- Thêm vào `KpiShell` (tông màu fuchsia, icon `Award`) — hiện cho mọi `kpi.view` user.
- Bộ chọn Tháng/Năm (mặc định tháng/năm hiện tại). Card "Điểm của bạn — Tháng X/Y" (breakdown
  A/B/C/D bằng `KpiProgressBar` + số, hệ số chuyên cần, số ngày có chấm) luôn hiện cho chính người
  xem. Card "Lịch sử điểm của bạn" liệt kê tất cả tháng đã có điểm (không giới hạn theo tháng đang
  chọn ở trên). Bảng "Toàn nhà máy — Tháng X/Y" (đúng đúng tháng đang chọn, sort theo `diem_tong`
  giảm dần) chỉ hiện khi `canViewAll = hasPermission(user,"kpi.view_all") && (isAdmin ||
  isDeptLeader)` — mirror chính xác pattern đã dùng ở `kpi/tasks/page.tsx`.
- Nút "Tính điểm tháng" chỉ hiện khi `canCompute = isAdmin || hasPermission(user,
  "kpi.manage_config")` — gọi RPC cho đúng (nam, thang) đang chọn, hiện banner tóm tắt số người
  vừa được tính, rồi tự tải lại dữ liệu.
- Tên hiển thị người dùng trong bảng toàn nhà máy dùng lại `loadKpiTaskCandidates(factoryId)`
  (nguồn `maintenance_staff`, đã dùng xuyên suốt module này để resolve tên) — chỉ tải khi
  `canViewAll` để tránh round-trip thừa cho user thường.

### Ngoài phạm vi (chưa làm ở Phase 4 này, để Phase 5)

- Không có khóa sổ thật (`trang_thai` luôn `'nhap'`, không có nút "Khóa" nào trong UI) — Phase 5
  mới thêm.
- Không có `kpi_score_adjustments` (điều chỉnh điểm có audit) hay `kpi_appeals` gắn với
  `monthly_score_id` (khiếu nại điểm tháng — bảng `kpi_appeals` hiện tại chỉ gắn `task_id`/
  `location_evaluation_id`, cột `monthly_score_id` đã có sẵn trong schema từ trước nhưng chưa
  được dùng).
- Không renormalize trọng số khi 1 thành phần thiếu dữ liệu (xem "Quyết định thiết kế quan
  trọng" ở trên) — chấp nhận được cho giai đoạn nháp.
- Không có bảng xếp hạng ẩn danh theo nhóm/phòng ban (roadmap Phase 5).

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC theo đúng thứ tự

1. Chạy `supabase/migrations/20260813_kpi_score_weights_monthly_scores.sql` trên Supabase SQL
   Editor.
2. Vào Cài đặt → KPI & 5S → "Trọng số công thức" — xác nhận card "Mặc định toàn nhà máy" hiện
   đúng hằng số 30/25/20/25/24/0.75-1.10; bấm "Cấu hình riêng" → sửa vài số, thử tổng ≠ 100 → xác
   nhận bị chặn lưu (cả banner đỏ live lẫn khi bấm Lưu thật); sửa lại tổng = 100 → lưu thành công.
3. Tạo 1 cấu hình riêng cho 1 Nhóm chuyên môn cụ thể (khác trọng số mặc định) — xác nhận card
   hiện đúng trong nhóm "Cấu hình riêng theo nhóm", xóa được, sau khi xóa nhóm đó quay lại dùng
   dòng mặc định.
4. Chuẩn bị dữ liệu thật cho 1 tháng: vài task (`kpi_tasks`/`kpi_task_members`, có cả nộp đúng
   hạn/trễ hạn), vài lượt chấm 5S (`kpi_5s_evaluations`), vài lượt chấm chuyên môn theo ngày
   (`kpi_daily_evaluations`, cả ngày có chính+choàng và ngày chỉ có choàng không có chính) cho ít
   nhất 1-2 nhân sự trong tháng đó.
5. Đăng nhập admin/`kpi.manage_config`, vào `/dashboard/kpi/scores`, chọn đúng tháng ở bước 4 →
   bấm "Tính điểm tháng" → xác nhận banner báo đúng số người được tính, bảng "Toàn nhà máy" hiện
   đúng breakdown A/B/C/D + hệ số chuyên cần + tổng.
6. Đối chiếu TAY 1 nhân sự cụ thể theo đúng công thức (dùng ví dụ mẫu ở đầu rules file làm khuôn
   mẫu tính) — đặc biệt xác nhận: (a) ngày chỉ có choàng không có chính KHÔNG được tính vào D
   tháng; (b) B chỉ tính trên task đã đến hạn, không tính task chưa tới hạn; (c) hệ số chuyên cần
   đúng công thức CLAMP.
7. Bấm "Tính điểm tháng" LẦN 2 cho cùng tháng (không đổi dữ liệu nguồn) → xác nhận điểm giữ
   nguyên y hệt (idempotent), không nhân đôi/tạo dòng trùng.
8. Đăng nhập 1 tài khoản THƯỜNG (không `kpi.view_all`, không phải lãnh đạo phòng ban) → vào
   `/dashboard/kpi/scores` → xác nhận CHỈ thấy "Điểm của bạn"/"Lịch sử điểm của bạn" (điểm đúng
   của chính họ nếu đã được tính), KHÔNG thấy bảng "Toàn nhà máy", KHÔNG thấy nút "Tính điểm
   tháng".
9. Đăng nhập 1 lãnh đạo phòng ban (không phải admin, có `kpi.view_all` qua role default) → xác
   nhận thấy bảng "Toàn nhà máy" (đúng `canViewAll` mirror `kpi/tasks/page.tsx`) nhưng KHÔNG thấy
   nút "Tính điểm tháng" nếu họ không có `kpi.manage_config`.
10. Thử gọi thẳng RPC `kpi_compute_monthly_scores` (qua devtools) bằng tài khoản không có
    `kpi.manage_config` — xác nhận bị chặn đúng lỗi "Bạn không có quyền tính điểm KPI tháng."

## Sự cố thật đã xử lý (2026-08-02) — migration 20260812 chưa từng chạy, dọn 27 task trùng

Người dùng báo "chấm 5S + hoàn thành task cho cnho/ryta nhưng Bảng điểm KPI tháng 7/2026 vẫn
'Chưa có điểm cho tháng này'". Điều tra bằng script read-only
(`scripts/investigate-kpi-no-score.mjs`, giữ lại để tái dùng) xác nhận **2 nguyên nhân độc lập**:

1. **Không phải bug** — `kpi_monthly_scores` có 0 dòng cho tháng 7/2026 vì chưa từng có ai bấm
   "Tính điểm tháng" (đúng thiết kế Phase 4: điểm không tự tính khi hoàn thành task/chấm 5S).
   Nút này chỉ hiện cho admin/`kpi.manage_config` — tài khoản người dùng đang xem không có quyền
   đó nên không thấy nút.
2. **Bug thật** — dữ liệu cho thấy migration `20260812_kpi_task_templates_skip_stuck.sql` (fix
   "việc định kỳ mắc kẹt", viết ở mục ngay trên) **chưa từng được chạy** trên Supabase, dù
   `20260811`/`20260813` đã chạy — mỗi ngày mở app vẫn sinh thêm 1 task mới cho template dù task
   ngày trước chưa đóng. Quét toàn bộ `kpi_tasks` (không giới hạn 2 template người dùng nêu) phát
   hiện **6/6 template đang active đều bị ảnh hưởng, tổng 27 task trùng** (28/7 → 1/8): "Upload
   file kiểm nghiệm...", "Đo mẫu tối thiểu...", "Upload file sản lượng...", "Tạo ngăn lưu", "Tạo
   phiếu điều xe...", "Dọn dẹp phòng điều hành xử lý nước thải".

**Đã dọn dữ liệu** bằng `scripts/cleanup-kpi-duplicate-template-tasks.mjs` (dry-run mặc định, cần
`--apply` để ghi thật — giữ lại để tái dùng nếu tái diễn): với mỗi template có >1 task đang mở,
**hủy** (`trang_thai='huy'` — dùng đúng cơ chế "Hủy công việc" có sẵn, KHÔNG xóa cứng, giữ nguyên
`kpi_task_logs`/evidence links) tất cả trừ task có `ngay_giao` mới nhất (1/8/2026). Đã verify lại
bằng dry-run lần 2: 0 template còn trùng.

**Việc bắt buộc phải làm ngay**: chạy `supabase/migrations/20260812_kpi_task_templates_skip_stuck.sql`
trên Supabase SQL Editor — nếu chưa chạy, bug sẽ tái diễn ở lần mở app tiếp theo (mỗi template lại
có nguy cơ sinh thêm task mới dù task 1/8 hiện tại vẫn `moi_giao`).

**Chưa test tay lại việc tính điểm tháng 7** sau khi dọn xong — cần: admin/`kpi.manage_config`
vào `/dashboard/kpi/scores`, chọn Tháng 7/2026, bấm "Tính điểm tháng" → xác nhận cnho/ryta ra
điểm đúng theo dữ liệu 5S + task đã hoàn thành.

## Cập nhật (phiên sau Phase 4, tiếp) — Lọc Phòng ban ở Bảng điểm KPI + Sub-tab "Chi tiết cách
tính điểm", ĐÃ CODE XONG, KHÔNG CẦN MIGRATION, CHƯA TEST TAY

Người dùng yêu cầu 3 việc: (1) liệt kê Phase 5 (xem mục ngay dưới), (2) thêm trường "Phòng ban" để
lọc nhân sự khi xem điểm KPI, (3) thêm 1 sub-tab giải thích minh bạch cách tính điểm của chính
người xem. Cả (2) và (3) đã code xong, **không cần migration nào** — thuần sửa/thêm ở tầng client.

### 1. Lọc Phòng ban ở bảng "Toàn nhà máy" (`src/app/dashboard/kpi/scores/page.tsx`)

**Root cause đã xác nhận (không đoán)**: đây là nơi DUY NHẤT trong module KPI chưa có khái niệm
phòng ban — Công việc/Việc định kỳ/Vị trí 5S/Khu vực 5S đều đã có `phong_ban_id` để lãnh đạo phòng
ban tự động chỉ thấy đúng phạm vi mình, riêng Bảng điểm KPI cho lãnh đạo phòng ban thấy điểm TOÀN
NHÀ MÁY.

- `loadData()` khi `viewAll=true` giờ tải thêm `fetchDepartmentOptions()` (`src/lib/kpi-department-leaders.ts`)
  rồi với MỖI phòng ban gọi song song `fetchDepartmentUserIds(fid, dept.id)` (`src/lib/kpi-tasks.ts`,
  đã export sẵn từ trước) — đảo ngược thành `userDeptMap: Map<userId, DepartmentOption>` (mirror
  đúng pattern `deptUserIdsByDept` đã dùng ở `kpi-5s-auto-assign-modal.tsx`).
- `visibleFactoryScores` (useMemo): lãnh đạo phòng ban (không phải admin) tự động lọc cứng chỉ còn
  dòng có `userDeptMap.get(user_id)?.id === myLeaderDepartmentId` — không có lựa chọn xem thêm
  phòng ban khác (nhất quán các module kia). Admin có dropdown "Phòng ban" (mặc định "Tất cả")
  lọc client-side qua `deptFilter` state.
- Bảng thêm cột "Phòng ban" luôn hiển thị (dùng `userDeptMap.get(s.user_id)?.name || "—"`).
- Cố ý KHÔNG đụng `kpi_score_weights`/"Trọng số công thức" — đã xác nhận với người dùng chỉ áp
  dụng phạm vi lọc ở trang xem điểm, không mở rộng cấu hình trọng số theo phòng ban.

### 2. Sub-tab "Chi tiết cách tính điểm" (cùng file, component `MyScoreExplain`)

Thêm state `scoreView: "tong-quan" | "chi-tiet"` (toggle 2 nút, không route riêng). Chỉ hiện dữ
liệu của **CHÍNH người đang đăng nhập** (không có cách nào chọn xem người khác, kể cả admin/lãnh
đạo phòng ban — đã chốt với người dùng). Tính lại **real-time, client-side** — không đọc
`kpi_monthly_scores.chi_tiet` (chỉ lưu số tổng hợp, không đủ chi tiết từng bản ghi).

**File mới `src/lib/kpi-score-breakdown.ts`** — thuần query READ-ONLY, không RPC, mọi bảng user
luôn tự đọc được cho chính mình qua RLS hiện có (không cần đổi RLS nào):

- `fetchMyPrimaryGroup(factoryId, userId)` — mirror y hệt query `loadPrimaryGroup` trong
  `kpi/tasks/page.tsx` (personnel_group_members + maintenance_staff.profile_id = chính mình).
- `fetchScoreBreakdownTasks`/`fetchScoreBreakdown5s`/`fetchScoreBreakdownDaily` — join tương ứng
  `kpi_task_members`+`kpi_tasks`, `kpi_5s_evaluations`+`kpi_5s_locations(ten_vi_tri)`,
  `kpi_daily_evaluations`+`items`+`personnel_groups(name)`, lọc đúng `(userId, tháng)`.
- `computeCutoffMs(nam, thang)` — mirror đúng cutoff của RPC (`LEAST(now, cuối tháng+1)`), dùng
  `Date.UTC` (không phải local time) vì `han_hoan_thanh` so sánh trong Postgres mặc định UTC —
  chấp nhận sai lệch nhỏ ở biên múi giờ Campuchia, cùng hạn chế đã ghi nhận ở nơi khác trong repo.
- `groupDailyByDay(rows)` — nhóm theo ngày, CHỈ giữ ngày có `loai='chinh'` (đúng "ngày có mặt/có
  chấm"), tính `Điểm ngày = %chính×10 + Σ%choàng×5`, `Max ngày = 10 + 5×số choàng`, `%ngày`.

**UI** (`MyScoreExplain` trong `scores/page.tsx`): card "Trọng số áp dụng cho bạn" (resolve theo
nhóm chính, fallback mặc định — đúng thứ tự RPC) → bảng A (từng task + %) → bảng B (chỉ task đã
đến hạn, Đúng hạn/Trễ hạn) → bảng C (từng lượt chấm 5S + điểm quy đổi) → bảng D (từng ngày có
chính, kèm các lượt choàng cùng ngày, Điểm ngày/Max/%ngày) → khối "Kết quả cuối cùng" ráp công
thức đầy đủ có số thật, kèm ghi chú có thể lệch với điểm đã lưu ở tab Tổng quan nếu dữ liệu thay
đổi sau lần "Tính điểm tháng" gần nhất.

### Chưa test tay — cần làm ở phiên sau

1. Đăng nhập admin → Bảng điểm KPI → xác nhận bảng "Toàn nhà máy" có cột "Phòng ban" + dropdown
   lọc hoạt động đúng (chọn 1 phòng ban → chỉ còn đúng nhân sự phòng ban đó).
2. Đăng nhập 1 lãnh đạo phòng ban (không phải admin) → xác nhận bảng "Toàn nhà máy" CHỈ còn đúng
   nhân sự phòng ban của họ (không còn thấy toàn nhà máy như trước).
3. Đăng nhập 1 user thường → bấm toggle "Chi tiết cách tính điểm của tôi" → xác nhận thấy đầy đủ
   breakdown A/B/C/D + công thức cuối cùng; đối chiếu tay 1-2 dòng để xác nhận đúng công thức
   (đặc biệt: ngày chỉ có choàng không có chính phải KHÔNG xuất hiện trong bảng D; task chưa đến
   hạn phải KHÔNG xuất hiện trong bảng B).
4. Xác nhận không có nơi nào (kể cả admin) chọn xem chi tiết của người khác.
5. Test 1 user chưa thuộc nhóm chuyên môn nào → xác nhận card "Trọng số áp dụng cho bạn" hiện đúng
   thông báo "chưa thuộc nhóm nào — dùng mặc định toàn nhà máy", không crash.
6. Test 1 tháng hoàn toàn chưa có dữ liệu nào (task/5S/daily) → xác nhận cả 4 thành phần hiện đúng
   "mặc định 100%" và công thức cuối cùng vẫn tính ra số hợp lý (không NaN/lỗi chia 0).

## Cập nhật Phase 5 — Khóa sổ, khiếu nại & minh bạch (đã code xong, theo đúng thứ tự đã liệt kê)

Migration `supabase/migrations/20260814_kpi_score_lock_adjust_rank.sql` (**CẦN CHẠY THỦ CÔNG,
CHƯA CHẠY** — chạy sau mọi migration KPI trước đó, đặc biệt sau `20260813_...` vì cần bảng
`kpi_monthly_scores` đã tồn tại). Thực hiện đúng 4 hạng mục còn lại của Phase 5 (hạng mục 5 —
"điểm tạm tính real-time" — đã xong sớm hơn qua sub-tab "Chi tiết cách tính điểm", không có việc
gì thêm):

### 1. Khóa sổ điểm tháng — CHỈ khóa, KHÔNG có "mở khóa"

- RPC `kpi_monthly_score_lock(p_monthly_score_id)` — chỉ admin/`kpi.manage_config`
  (`current_profile_has_permission('kpi.manage_config')`, hàm này đã tự trả `true` cho admin —
  không cần check role riêng, khác `kpi_5s_evaluation_correct` kiểm tra cả 2 kiểu dư thừa).
  Chuyển `trang_thai: 'nhap' → 'da_khoa'`, set `khoa_boi`/`khoa_luc` (2 cột có sẵn từ migration
  `20260813`, chưa từng dùng). Chặn cứng nếu điểm không tồn tại hoặc đã khóa từ trước.
- **Quyết định thiết kế quan trọng — cố ý KHÔNG có RPC "mở khóa"**: nếu cho phép mở khóa tự do
  rồi `kpi_compute_monthly_scores` tính lại (RPC đó chỉ bỏ qua đúng điều kiện
  `WHERE trang_thai <> 'da_khoa'`), admin có thể lách hoàn toàn cơ chế audit của mục 2 — mở khóa,
  tính lại, khóa lại, không để lại dấu vết nào trong `kpi_score_adjustments`. Nếu cần sửa điểm đã
  khóa, bắt buộc đi qua `kpi_monthly_score_adjust` (có audit) — không có đường tắt nào khác.
- UI: cột "Trạng thái" mới trong bảng "Toàn nhà máy" (`/dashboard/kpi/scores`, sub-tab "Tổng
  quan") — badge Nháp/Đã khóa + nút "Khóa" (chỉ `canCompute`, chỉ khi `trang_thai='nhap'`).

### 2. `kpi_score_adjustments` — audit log bất biến + RPC điều chỉnh

- Bảng `kpi_score_adjustments` — **có thêm cột `factory_id`** so với bản phác thảo gốc ở đầu file
  này (CLAUDE.md invariant "mọi bảng đều có factory_id", cùng lý do `kpi_appeals` cũng có cột
  này dù là bảng audit-log-like). Không có RLS INSERT/UPDATE/DELETE cho client — chỉ RPC
  `kpi_monthly_score_adjust` (SECURITY DEFINER) mới ghi được, đảm bảo MỌI thay đổi điểm đã khóa
  đều để lại đúng 1 dòng audit.
- RPC `kpi_monthly_score_adjust(p_monthly_score_id, p_new_diem_tong, p_ly_do, p_ghi_chu DEFAULT
  NULL, p_appeal_id DEFAULT NULL)` — mirror chính xác kiến trúc `kpi_5s_evaluation_correct`
  (Phase 2): `p_appeal_id` có giá trị → đóng khiếu nại đó `'da_giai_quyet'` trong cùng
  transaction; `NULL` → admin tự điều chỉnh trực tiếp, tự tạo 1 dòng `kpi_appeals` mới đã
  `'da_giai_quyet'` làm audit trail duy nhất. Chặn cứng nếu điểm chưa `'da_khoa'` (bắt buộc khóa
  sổ trước khi điều chỉnh) hoặc thiếu lý do.
- `src/lib/kpi-appeals.ts` thêm 2 wrapper theo đúng tiền lệ 2 hàm 5S đã có (`resolveKpiLocation
  EvaluationAppeal`/`correctKpi5sEvaluationDirect`): `resolveKpiMonthlyScoreAppeal` (qua khiếu
  nại) và `adjustKpiMonthlyScoreDirect` (trực tiếp, chưa nối UI — dự phòng cho phase sau nếu cần
  1 nút "Điều chỉnh điểm" độc lập không qua khiếu nại, hiện chỉ dùng nội bộ qua đường khiếu nại).
- `src/lib/kpi-scores.ts` thêm `fetchKpiScoreAdjustments(monthlyScoreId)` — hiển thị lịch sử điều
  chỉnh ngay dưới card "Điểm của bạn" (chỉ khi có ít nhất 1 dòng), không cần mở trang riêng.

### 3. Nối `kpi_appeals.monthly_score_id` — khiếu nại điểm tháng

- RLS `kpi_appeals_insert` thêm nhánh thứ 3: chủ điểm tự khiếu nại được, **CHỈ khi điểm đã
  `'da_khoa'`** (`ms.user_id = auth.uid() AND ms.trang_thai = 'da_khoa'`) — defense-in-depth,
  khớp đúng điều kiện hiện nút "Khiếu nại điểm này" ở UI (chỉ hiện khi `myScoreThisMonth.trang_
  thai === "da_khoa"`).
- `/dashboard/kpi/scores`: nút "Khiếu nại điểm này" trên card "Điểm của bạn" → modal nhập nội
  dung → `createKpiAppealForMonthlyScore` → `sendKpiNotify` (Telegram, link `/dashboard/kpi/
  appeals`) → banner xanh xác nhận đã gửi.
- `/dashboard/kpi/appeals`: nạp thêm `monthlyScoreRefs` (song song `taskRefs`/`locationRefs`,
  cùng kiểu best-effort không chặn nếu lỗi), hiện link "Điểm KPI tháng X/Y (hiện Z điểm)". Đóng
  "Đã giải quyết" cho loại khiếu nại này (`isMonthlyScoreAdjustment`) mở thêm 2 trường bắt buộc
  trong modal — "Điểm mới" (number, mặc định = điểm hiện tại) và "Lý do điều chỉnh" (bắt buộc,
  khớp `ly_do NOT NULL` của `kpi_score_adjustments`) — gọi `resolveKpiMonthlyScoreAppeal`. "Từ
  chối" dùng chung `resolveKpiAppeal` (không điều chỉnh gì) như 2 loại khiếu nại kia.

### 4. Bảng xếp hạng ẩn danh theo Nhóm chuyên môn / Phòng ban

- 2 RPC SECURITY DEFINER `kpi_score_ranking_by_group`/`kpi_score_ranking_by_department` — chỉ
  yêu cầu `kpi.view` (KHÔNG cần `kpi.view_all`, vì mục đích chính là so sánh ẩn danh không lộ
  danh tính — khác hẳn bảng "Toàn nhà máy" ở sub-tab Tổng quan). Trả về **đúng** `{rank,
  diem_tong, is_me}` — không bao giờ trả `user_id`/tên, dùng `RANK() OVER (ORDER BY diem_tong
  DESC)`. Đây là cách DUY NHẤT một user thường (không có `kpi.view_all`) xem được điểm của người
  khác trong hệ thống — vì RLS `kpi_monthly_scores_select` chỉ cho đọc điểm của chính mình, client
  không thể tự query chéo; RPC bypass RLS ở tầng SQL (SECURITY DEFINER) nhưng chỉ lộ đúng
  rank+điểm, giữ đúng tinh thần "ẩn danh".
  - Ranking theo nhóm: chỉ tính thành viên có `is_primary=true` của đúng `group_id` đó (mirror
    logic "nhóm chính quyết định trọng số áp dụng" đã dùng xuyên suốt Phase 3/4) — KHÔNG gồm
    người chỉ "choàng" nhóm đó.
  - Ranking theo phòng ban: mirror đúng 3-way match của `/api/kpi/dept-users` (`department_id`
    FK, tên đầy đủ, code) viết lại bằng SQL thuần trong RPC.
- `/dashboard/kpi/scores`: sub-tab thứ 3 "Bảng xếp hạng" (`scoreView: "tong-quan" | "chi-tiet" |
  "xep-hang"`) — component `ScoreRankingView` (cuối file `page.tsx`), toggle Nhóm/Phòng ban +
  dropdown chọn cụ thể (mặc định = nhóm chính/lựa chọn đầu tiên), danh sách dòng dạng
  `"Hạng {rank}{" (bạn)" nếu is_me}: {điểm} điểm"` — đúng format ví dụ trong roadmap gốc, dòng
  của chính người xem tô nổi bật màu tím.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (4 file: `kpi-scores.ts`, `kpi-appeals.ts`,
`kpi/scores/page.tsx`, `kpi/appeals/page.tsx`), và `npm run build` đều sạch — build liệt kê đủ
`/dashboard/kpi/scores` và `/dashboard/kpi/appeals` (static), không có route KPI nào lỗi.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy migration trước

1. Chạy `supabase/migrations/20260814_kpi_score_lock_adjust_rank.sql` trên Supabase SQL Editor
   (sau khi đã chắc chắn `20260813_kpi_score_weights_monthly_scores.sql` đã chạy xong — bảng
   `kpi_monthly_scores` phải tồn tại trước).
2. **Khóa sổ**: tính điểm 1 tháng có dữ liệu → vào bảng "Toàn nhà máy" → bấm "Khóa" 1 dòng → xác
   nhận badge chuyển "Đã khóa", nút "Khóa" biến mất; bấm lại "Tính điểm tháng" cho cùng tháng →
   xác nhận điểm ĐÃ khóa giữ nguyên (không bị ghi đè), các điểm còn `'nhap'` vẫn cập nhật bình
   thường.
3. **Khiếu nại + điều chỉnh**: đăng nhập đúng người có điểm vừa khóa → xác nhận nút "Khiếu nại
   điểm này" xuất hiện (không có ở điểm chưa khóa) → gửi khiếu nại → xác nhận Telegram nhận
   được, xuất hiện ở `/dashboard/kpi/appeals` (cả người khiếu nại lẫn admin đều thấy, người khác
   không thấy). Admin bấm "Đã giải quyết" → nhập điểm mới khác điểm cũ + lý do → xác nhận
   `diem_tong` cập nhật đúng ở cả 2 trang (Bảng điểm KPI, chi tiết khiếu nại), lịch sử điều chỉnh
   hiện đúng dưới card "Điểm của bạn" (điểm trước → điểm sau, lý do, thời gian).
4. Thử để trống "Lý do điều chỉnh" khi "Đã giải quyết" 1 khiếu nại điểm tháng → phải bị chặn ở cả
   UI lẫn (nếu bỏ qua UI) RPC (`ly_do NOT NULL`).
5. Thử gọi thẳng RPC `kpi_monthly_score_adjust` cho 1 điểm CHƯA khóa (qua devtools) → phải bị
   chặn đúng lỗi "Chỉ được điều chỉnh điểm đã khóa sổ...".
6. **Bảng xếp hạng**: vào sub-tab "Bảng xếp hạng" bằng 1 tài khoản THƯỜNG (không có
   `kpi.view_all`) → xác nhận vẫn xem được (khác hẳn sub-tab "Tổng quan" — bảng "Toàn nhà máy"
   không hiện với tài khoản này) → đổi qua lại "Theo nhóm chuyên môn"/"Theo phòng ban", đổi
   dropdown → xác nhận danh sách hiện đúng "Hạng N: X điểm", dòng của chính mình có "(bạn)" và tô
   nổi bật, KHÔNG có tên ai khác xuất hiện ở bất kỳ đâu trong response (kiểm tra qua Network tab
   devtools để chắc chắn RPC không trả `user_id`).
7. Test 1 nhóm/phòng ban chưa có ai được tính điểm tháng đó → xác nhận thông báo rỗng phù hợp,
   không lỗi.
8. Test quyền: tài khoản `role=user` không có `kpi.manage_config` → không thấy nút "Khóa" ở bảng
   "Toàn nhà máy"; thử gọi thẳng RPC `kpi_monthly_score_lock` → phải bị chặn đúng lỗi "Bạn không
   có quyền khóa sổ điểm KPI."

## Cập nhật (phiên sau Phase 5) — Hạn chấm điểm 5S, Random riêng từng vị trí, Bỏ qua đợt phân
công, Redesign mobile toàn module — ĐÃ CODE XONG, CHƯA CHẠY MIGRATION, CHƯA TEST TAY

Kế hoạch chi tiết đã lập ở `C:\Users\Software\.claude\plans\misty-discovering-sky.md` (Plan Mode,
3 Explore agent + 4 câu hỏi xác nhận trực tiếp với người dùng trước khi code). 4 hạng mục:

### 1. Hạn chấm điểm hàng tuần cho Vị trí 5S (chọn Thứ + Giờ)

Đã hỏi lại đầu phiên và người dùng xác nhận **chỉ cần hạn trong tuần** (không có nhu cầu cadence
hàng ngày riêng) — thiết kế mảng `INTEGER[]` (tương thích ngược nếu sau này cần) là đủ dùng ngay,
không cần mở rộng gì thêm.

- Migration `supabase/migrations/20260815_kpi_5s_deadline.sql` (**CẦN CHẠY THỦ CÔNG, CHƯA
  CHẠY**) — thêm `kpi_5s_locations.deadline_weekdays INTEGER[]` (1=Thứ 2..7=CN, khớp
  `EXTRACT(ISODOW...)`) + `deadline_time TIME`, cả 2 nullable, CHECK constraint validate mảng
  1-7 phần tử trong `[1..7]`. Không backfill — dữ liệu cũ mặc định `NULL` = giữ nguyên hành vi
  "chấm bất kỳ ngày nào trong tuần". Không cần đổi RLS.
- `src/lib/kpi-5s.ts`: `Kpi5sLocation`/`LOCATION_COLS`/`Kpi5sLocationInput` thêm 2 field trên
  (tự động flow qua `createKpi5sLocation`/`updateKpi5sLocation` vì cả 2 spread `...input`, không
  cần sửa). Thêm 3 hàm: `computeKpi5sDeadline(location, weekStartISO)` (dùng
  `location.deadline_weekdays[0]` — UI chỉ cho chọn đúng 1 phần tử dù kiểu là mảng — cộng
  `addDaysISO` rồi ghép `deadline_time` thành `Date`), `isKpi5sDeadlineOverdue`/
  `isKpi5sDeadlineDueSoon` (mirror `isTaskOverdue`/`isTaskDueSoon` của `kpi-tasks.ts`, ngưỡng
  "sắp hạn" cố định 24h).
- `kpi-5s-locations-tab.tsx` (Cài đặt → KPI & 5S → Vị trí 5S, form Thêm/Sửa): thêm field "Hạn
  chấm điểm hàng tuần (tuỳ chọn)" — dãy pill-toggle 7 thứ (mirror style `template-form-modal.tsx`)
  nhưng **hành vi radio-deselectable** (bấm 1 thứ = chọn đúng thứ đó thay lựa chọn cũ; bấm lại
  thứ đang chọn = bỏ chọn hoàn toàn) — khác hẳn multi-select gốc của `apply_weekdays`, cố ý ghi
  rõ trong code để không nhầm là copy y nguyên. `<input type="time">` chỉ hiện khi đã chọn 1 thứ.
  Payload: `deadline_weekday === "" ? null : [deadline_weekday]`.
- `kpi/5s/page.tsx` (danh sách): mỗi card tính `deadline`/`overdue`/`dueSoon` (dựa vào tuần đã
  chấm hay chưa), hiện badge ngay trên tên vị trí — đỏ "Quá hạn — Hạn: Thứ X, HH:MM", cam "Hạn:
  Thứ X, HH:MM" (sắp tới), ẩn hẳn khi đã chấm tuần này hoặc chưa cấu hình hạn.
- `kpi/5s/location/[id]/page.tsx` (chi tiết): cùng badge trong header card (cạnh
  `is_active`/`iAmCleaner`/`iAmScorer`); banner "Đến lượt bạn chấm điểm" đổi màu đỏ + text "Đã
  quá hạn — " khi `overdue`.
- Badge là tính toán **client-side thuần túy tại thời điểm render** (`new Date()` phụ thuộc giờ
  local máy client) — không enforce nghiệp vụ cứng, không chặn chấm muộn, không lưu thêm gì vào
  `kpi_5s_evaluations`.

### 2a. Nút "Random vị trí này" trên mỗi thẻ Vị trí 5S

Chỉ ở `kpi-5s-locations-tab.tsx` (Cài đặt → KPI & 5S → Vị trí 5S — nơi DUY NHẤT có sẵn 3 nút Sửa/
Tạm ngưng/Xóa trên card; **cố ý KHÔNG thêm** nút tương tự ở `/dashboard/kpi/5s/page.tsx` — card ở
đó là `<Link>` nguyên khối mở trang chi tiết, không có hàng action nào để chèn thêm, ngoài phạm
vi đã xác nhận với người dùng).

- State mới `autoAssignLocation: Kpi5sLocation | null` (tách biệt `showAutoAssign` — state cho
  đợt bulk cũ, không overload ý nghĩa).
- Nút "Random vị trí này" (tím, icon `Shuffle`) chèn giữa "Sửa" và "Tạm ngưng".
- Render `<Kpi5sAutoAssignModal locations={[autoAssignLocation]} .../>` song song modal bulk hiện
  có, dùng chung state `assignSummary`/luồng `sendKpiNotify`.
- Đã xác nhận qua đọc code: `Kpi5sAutoAssignModal`/`buildAutoAssignSuggestions` không có chỗ nào
  giả định `locations.length >= 2` — hoạt động đúng với mảng 1 phần tử, không cần sửa gì trong
  modal cho case này (radio "toàn bộ N vị trí" chỉ hiện "N=1", chấp nhận được).

### 2b. Toggle "Bỏ qua đợt này" từng dòng trong modal Phân công thông minh

Chỉ ở `kpi-5s-auto-assign-modal.tsx` — **không đụng** `kpi-5s-auto-assign.ts` (thuật toán random
giữ nguyên, "bỏ qua" là quyết định UI thuần túy tách biệt khỏi đề xuất của thuật toán).

- State `skippedIds: Set<string>` **tách khỏi `RowState`** (không nhét vào field của từng dòng)
  để giữ nguyên trạng thái "đã bỏ qua" xuyên suốt các lần bấm "Random lại" (`generate()` tạo lại
  `rows` mới nhưng `locationId` không đổi, vì luôn xuất phát từ `locations` prop cố định).
- Mỗi dòng preview thêm checkbox "Bỏ qua đợt này" ở đầu cột đầu tiên (cạnh mã vị trí), làm mờ cả
  dòng (`opacity-40`) và **disable cả 2 `<select>`** Người dọn/Người chấm khi bị tắt — vẫn hiển
  thị giá trị đã random để tham khảo, chỉ khóa tương tác.
- `handleConfirm`'s `changed` filter và `changedCount` đều thêm điều kiện
  `!skippedIds.has(r.locationId)` — dòng bị tắt không bao giờ được ghi dù có thay đổi so với giá
  trị gốc.
- Modal mở từ nút 2a (1 phần tử) vẫn hiện toggle này bình thường, không ẩn theo điều kiện số
  dòng.

### 3+4. Redesign responsive mobile toàn module KPI

- **`kpi-shell.tsx`** (ảnh hưởng cả 6 trang cùng lúc): `NavTab` thêm `shortLabel` (6 nhãn rút
  gọn: Công việc/Định kỳ/5S/Chấm điểm/Khiếu nại/Bảng điểm), render `hidden sm:inline`/`sm:hidden`
  song song 2 nhãn; tap target `py-2.5 → py-3`; thêm gradient báo hiệu còn nội dung cuộn 2 bên
  thanh tab — **logic scroll-shadow (ResizeObserver + scroll listener) được NHÂN BẢN trực tiếp
  từ `ResponsiveTableWrapper`, KHÔNG refactor thành hook dùng chung** (quyết định có chủ đích thu
  hẹp rủi ro — refactor sẽ ảnh hưởng mọi module khác đang phụ thuộc component đó, ngoài phạm vi
  phiên này).
- **`kpi/templates/page.tsx`**: header đổi `flex flex-wrap items-start justify-between` →
  `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` (mirror mẫu chuẩn
  `kpi/tasks/page.tsx`); nút "Sinh việc hôm nay ngay" full-width trên mobile
  (`w-full sm:w-auto`); thêm `flex-wrap` cho hàng 2 sub-tab pill ("Việc định kỳ"/"Người thay thế
  tạm thời") để tránh tràn ngang khi nhãn dài.
- **`kpi/5s/page.tsx`**: cùng pattern header; 2 nút "Phân công thông minh"/"Quản lý vị trí"
  full-width trên mobile.
- **`kpi/evaluate/page.tsx`**, **`kpi/appeals/page.tsx`**: xác nhận qua plan — **không đổi**, cả
  2 header đơn giản/rủi ro thấp, phần chọn Ngày/Người/Nhóm ở `evaluate` đã dùng
  `grid grid-cols-1 sm:grid-cols-3` sẵn đủ responsive.
- **`kpi/scores/page.tsx`** (thay đổi lớn nhất, làm sau cùng):
  - Header đổi cùng pattern `flex-col sm:flex-row` như các trang khác; nút "Tính điểm tháng"
    full-width trên mobile.
  - **Dời dropdown "Theo phòng ban"** từ vị trí cũ (lồng trong card "Toàn nhà máy — Tháng X/Y",
    chỉ hiện ở nhánh `scoreView === "tong-quan"`) lên **header chính**, đặt sau `<select nam>` và
    trước nút "Tính điểm tháng" — **luôn hiển thị bất kể `scoreView`** (miễn
    `isAdmin && departments.length > 0`), đồng nhất với Tháng/Năm luôn cố định. Không đổi state
    `deptFilter`/logic `visibleFactoryScores` — chỉ đổi vị trí JSX. Chấp nhận dropdown "không có
    tác dụng gì" khi đang xem tab "Chi tiết"/"Bảng xếp hạng" — đổi lại UX nhất quán hơn (không
    "nhấp nháy" biến mất khi chuyển tab).
  - Rút gọn nhãn toggle "Chi tiết cách tính điểm của tôi" → "Chi tiết" trên mobile (2 nhãn còn
    lại "Tổng quan"/"Bảng xếp hạng" đã đủ ngắn, không đổi).
  - **Bọc cả 5 `<table>` bằng `ResponsiveTableWrapper`** (bảng "Toàn nhà máy" + 4 bảng A/B/C/D
    trong "Chi tiết cách tính điểm") — dùng `className="rounded-none border-0 shadow-none"` cho
    cả 5 (đúng convention `05-ui-components.md` khi bảng đã nằm sẵn trong 1 card có
    border/shadow riêng, tránh double-border). Bảng D có 1 dòng text phụ ("Số ngày có chấm
    chuyên môn: N") nằm ngoài phạm vi cuộn ngang — đã tách ra khỏi `ResponsiveTableWrapper`
    (trước đó nằm chung trong cùng `overflow-x-auto`), chỉ table mới cuộn, dòng text giữ nguyên
    vị trí dưới bảng.
  - **Cố ý KHÔNG bọc `FilterBar`** cho cụm Tháng/Năm/Phòng ban/nút "Tính điểm tháng" — đây là
    tham số truy vấn CHÍNH quyết định toàn bộ nội dung trang (khác "bộ lọc phụ trợ" của
    `tasks/page.tsx`), bọc `FilterBar` sẽ ẩn Tháng/Năm sau nút "Bộ lọc" trên mobile, đi ngược kỳ
    vọng luôn thấy ngay đang xem tháng nào.
- **Cố ý KHÔNG đổi** tap target các nút hành động nhỏ `text-[11px] px-2.5 py-1` (nút Sửa/Tạm
  ngưng/Xóa trong `kpi-5s-locations-tab.tsx`, nút Đã giải quyết/Từ chối trong `appeals/page.tsx`
  ...) — style đồng bộ dùng xuyên suốt toàn module, đổi riêng lẻ 1 chỗ sẽ gây lệch; đổi đồng loạt
  là quyết định ngoài phạm vi phiên này.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (8 file: `kpi-5s.ts`, `kpi-5s-locations-tab.tsx`,
`kpi/5s/page.tsx`, `kpi/5s/location/[id]/page.tsx`, `kpi-5s-auto-assign-modal.tsx`,
`kpi-shell.tsx`, `kpi/templates/page.tsx`, `kpi/scores/page.tsx`), và `npm run build` đều sạch —
build liệt kê đủ mọi route KPI (`/dashboard/kpi/5s/location/[id]`, `/dashboard/kpi/scores`...),
không route nào lỗi.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy migration trước

1. Chạy `supabase/migrations/20260815_kpi_5s_deadline.sql` trên Supabase SQL Editor.
2. **Mục 1**: cấu hình 1 vị trí với Thứ=CN, Giờ=17:00 (đúng ví dụ gốc: trạm bơm suối, RyTa là
   người chấm) → xác nhận badge "Hạn: CN, 17:00" hiện đúng ở cả `/dashboard/kpi/5s` lẫn trang chi
   tiết; qua khỏi mốc đó mà chưa chấm → badge chuyển đỏ "Quá hạn — Hạn: CN, 17:00", banner "Đến
   lượt bạn chấm điểm" cũng chuyển đỏ "Đã quá hạn — ..."; chấm xong → badge biến mất cho tới tuần
   sau. Vị trí chưa cấu hình hạn (dữ liệu cũ, `deadline_weekdays = NULL`) → không có badge nào,
   vẫn chấm được bất kỳ ngày nào như trước (regression check).
3. **Mục 2a**: bấm "Random vị trí này" trên 1 thẻ ở Cài đặt → KPI & 5S → Vị trí 5S → modal mở
   đúng chỉ 1 vị trí, "Tạo đề xuất" ra đúng 1 dòng, "Xác nhận & Giao" thành công không ảnh hưởng
   vị trí khác.
4. **Mục 2b**: mở "Phân công thông minh" bulk (từ Cài đặt hoặc nút ở `/dashboard/kpi/5s`) → tick
   "Bỏ qua đợt này" ở 1-2 dòng → xác nhận 2 dropdown của dòng đó bị khóa (mờ, không bấm được) →
   bấm "Random lại" → xác nhận các dòng đã tick VẪN giữ trạng thái tắt sau khi random lại →
   "Xác nhận & Giao" → xác nhận đúng những vị trí bị tắt KHÔNG bị đổi `nguoi_don_id`/
   `nguoi_cham_id`, kể cả khi thuật toán đề xuất giá trị khác giá trị gốc cho dòng đó.
5. **Mục 3+4**: test trên viewport 375px (iPhone SE) cho cả 6 trang:
   - Thanh tab (`KpiShell`): nhãn rút gọn đúng (Công việc/Định kỳ/5S/Chấm điểm/Khiếu nại/Bảng
     điểm), không tràn cứng, gradient mờ 2 bên xuất hiện đúng khi còn tab bị che (cuộn ngang thử
     xem gradient trái/phải bật/tắt đúng theo vị trí cuộn).
   - `kpi/templates/page.tsx`, `kpi/5s/page.tsx`: header không vỡ dòng, nút hành động full-width
     dễ bấm khi xuống hàng riêng.
   - `kpi/scores/page.tsx`: dropdown "Theo phòng ban" xuất hiện đúng vị trí mới (header chính,
     cạnh Tháng/Năm), hoạt động đúng ở tab "Tổng quan" (lọc đúng bảng "Toàn nhà máy"), không gây
     lỗi khi đang ở 2 tab còn lại (chỉ đơn giản không có tác dụng); 5 bảng cuộn ngang mượt có
     gradient báo hiệu, không double-border với card bọc ngoài; nhãn toggle "Chi tiết" hiện đúng
     trên mobile, "Chi tiết cách tính điểm của tôi" đầy đủ trên desktop.
   - `kpi/evaluate/page.tsx`, `kpi/appeals/page.tsx`: xác nhận KHÔNG có regression (không đổi gì
     nhưng cần xác nhận layout vẫn ổn định sau khi `KpiShell` đổi).

## Cập nhật (phiên sau) — Lọc "Gắn bản ghi tại chỗ" theo đúng module + banner nổi bật hơn — ĐÃ
CODE XONG, CHƯA CHẠY MIGRATION, CHƯA TEST TAY

Người dùng test "Gắn bản ghi tại chỗ" (`KpiLinkPrompt`, Phase 1a.1) và phát hiện bug thiết kế
thật: `fetchOpenKpiTasksForUser(factoryId, userId)` trả về **TẤT CẢ** việc KPI đang mở của người
dùng, không lọc theo module nào — Châu Nho được giao việc "Điều xe" thì khi vào Kho nguyên liệu
tạo ngăn/lưu vẫn bị gợi ý gắn nhầm việc "Điều xe" vào bản ghi Kho nguyên liệu. Đồng thời banner
hiện tại render **inline** trong luồng trang (dễ bị bỏ qua vì mắt người dùng đã rời khỏi khu vực
đó ngay sau khi bấm Lưu — xem ảnh chụp người dùng gửi kèm).

### Migration `supabase/migrations/20260816_kpi_task_module_code.sql` (CẦN CHẠY THỦ CÔNG, CHƯA
CHẠY)

- Thêm `module_code TEXT` (nullable) vào cả `kpi_tasks` và `kpi_task_templates`, CHECK constraint
  giới hạn đúng 6 giá trị khớp 6 nơi có `<KpiLinkPrompt>` (`dispatch`, `output`, `quality`,
  `storage`, `product`, `process`) — **lưu "họ module"**, KHÔNG phải chuỗi đầy đủ như
  `"process:measurement"`. Index `WHERE module_code IS NOT NULL`. Không backfill — mọi việc đã
  tạo trước migration này có `module_code = NULL`, đúng chủ đích (xem "Quyết định phạm vi" dưới).
- `CREATE OR REPLACE FUNCTION kpi_ensure_today_task_instances(...)` — copy `v_tpl.module_code`
  vào `INSERT INTO kpi_tasks (...)` để instance sinh ra mỗi ngày tự thừa hưởng đúng module của
  template gốc. Thân hàm lấy nguyên trạng từ bản mới nhất
  (`20260812_kpi_task_templates_skip_stuck.sql` — đã có check "còn task mở thì không sinh thêm" +
  lọc `trang_thai='da_duyet'` cho người thay thế + cột `phong_ban_id`), chỉ thêm `module_code` —
  **đã đối chiếu trực tiếp với file migration mới nhất trước khi viết**, không tái tạo từ trí
  nhớ/bản cũ để tránh vô tình revert 2 fix đó.

### Quyết định phạm vi đã chốt (không hỏi lại người dùng, cả 2 ví dụ họ đưa ra đều thỏa mãn)

- **"Việc định kỳ" (`kpi_task_templates`) đã có sẵn nút Sửa** — gắn/sửa Module cho 1 template có
  sẵn (vd "Đo mẫu") là thao tác free ngay được; instance sinh SAU đó tự mang đúng `module_code`.
- **"Công việc chuyên môn" giao tay 1 lần (`kpi_tasks`) KHÔNG có nút Sửa nào cả** (kể cả trước
  tính năng này) — phiên này chỉ thêm field "Module liên quan" lúc **TẠO MỚI**, không thêm khả
  năng sửa việc đã tạo. Ví dụ "Chau Nho được giao Điều xe" trong yêu cầu người dùng là ví dụ PHỦ
  ĐỊNH (không được hiện banner ở module khác) — thỏa mãn ngay cả khi việc đó chưa từng được gắn
  `module_code` (NULL không khớp bất kỳ module nào, nên không bao giờ hiện banner ở đâu cả).
- Việc/việc định kỳ KHÔNG gắn module (`module_code = NULL`, vd "Dọn dẹp phòng điều hành xử lý
  nước thải") sẽ KHÔNG BAO GIỜ hiện banner ở bất kỳ module nào — người thực hiện vẫn hoàn thành
  bình thường qua trang chi tiết việc (Nộp/Nghiệm thu, đã có từ Phase 1a).

### `src/lib/kpi-tasks.ts`

- `KPI_MODULE_OPTIONS` (6 phần tử `{code, label}`), `KpiModuleCode`, `KPI_MODULE_LABEL` — đặt
  cạnh `KPI_DUE_SOON_HOURS`.
- `KpiTask.module_code: string | null` + `TASK_COLS` thêm cột.
- `createKpiTask(input)` thêm `moduleCode?: string | null`, ghi vào payload insert.
- `fetchOpenKpiTasksForUser(factoryId, userId, moduleCode?: string)` — tham số thứ 3 mới, có giá
  trị thì `.eq("module_code", moduleCode)`; không truyền giữ nguyên hành vi cũ (không còn call
  site nào dùng nhánh này sau khi sửa `KpiLinkPrompt`, giữ lại chỉ để không breaking chữ ký hàm).

### `src/lib/kpi-templates.ts`

`KpiTaskTemplate`/`KpiTaskTemplateInput` thêm `module_code`/`moduleCode`; `createKpiTaskTemplate`/
`updateKpiTaskTemplate` ghi cột này vào payload.

### 2 form modal — thêm field "Module liên quan (tuỳ chọn)"

- `kpi-task-form-modal.tsx` (Giao việc mới) và `template-form-modal.tsx` (Việc định kỳ): cùng
  1 `<select>` dùng `KPI_MODULE_OPTIONS`, option đầu "-- Không liên kết module cụ thể --", mặc
  định rỗng (→ `null`). Đặt ngay sau field "Phòng ban". Hint: "Chọn đúng module để người thực
  hiện được gợi ý 'Gắn bằng chứng' ngay sau khi họ lưu 1 bản ghi ở module đó — để trống nếu việc
  không liên quan module nào."
- `kpi/templates/page.tsx`: mỗi card thêm badge module (nhãn từ `KPI_MODULE_LABEL`, màu sky) nếu
  có, hoặc badge xám "Chưa gắn module" nếu chưa — giúp admin rà soát nhanh các template cũ (Đo
  mẫu/Tạo ngăn lưu/Tạo phiếu điều xe...) cần được sửa lại để gắn đúng module.

### `src/app/dashboard/_components/kpi-link-prompt.tsx` — redesign

- `const moduleFamily = moduleCode.split(":")[0]` (component KHÔNG cần đổi prop `moduleCode` ở
  7 nơi gọi — vẫn nhận chuỗi đầy đủ như trước, tự tách ở đây), gọi
  `fetchOpenKpiTasksForUser(factoryId, userId, moduleFamily)`.
- Nếu lọc xong chỉ còn ĐÚNG 1 việc → tự `setSelectedTaskId` ngay khi tải xong (đỡ 1 bước mở
  dropdown).
- Đổi bố cục từ inline (`<div className="rounded-xl border ...">` nằm trong luồng trang) sang
  `position: fixed` **góc trên-phải** (`fixed top-4 right-4 z-[70] w-[calc(100vw-2rem)] sm:w-96`)
  — chọn góc này có chủ đích sau khi khảo sát: nhiều trang dùng toast top-center
  (`fixed top-4 left-1/2 -translate-x-1/2 z-50`), và **đúng 3/6 module mục tiêu** (Kiểm nghiệm,
  Điều xe, Kiểm soát quá trình) có toast riêng ở **bottom-right** (`fixed bottom-6 right-6 z-50`)
  — góc trên-phải là góc DUY NHẤT không đụng độ với bất kỳ toast đã khảo sát. `z-[70]` cao hơn
  toast/modal thường (`z-50`).
  - Thêm hiệu ứng xuất hiện `animate-[fadeInUp_0.3s_ease-out]` (keyframe có sẵn `globals.css`),
    `shadow-2xl`, viền `border-2` đậm hơn, và 1 "notification dot" pulse (`animate-ping`) cạnh
    icon `Link2` để thu hút mắt.
  - Áp dụng đồng nhất cho cả 2 trạng thái (chọn việc / đã hoàn thành `doneLabel`) — giữ nguyên
    auto-dismiss 3s của `doneLabel`, KHÔNG auto-dismiss trạng thái đang chờ chọn việc.
- Dọn 6/7 wrapper `<div className="mb-4">` thừa quanh `<KpiLinkPrompt>` ở `dispatch/page.tsx`,
  `output/page.tsx`, `quality/page.tsx`, `storage/page.tsx`, `product/page.tsx`,
  `process/measurements/page.tsx` (component giờ tự định vị bằng `fixed`, div bọc ngoài không
  còn tác dụng) — `product/confirm/page.tsx` vốn đã không có wrapper này, không cần sửa.

### Đã xác nhận

`npx tsc --noEmit` sạch. `npx eslint` trên toàn bộ 12 file đã sửa — 18 vấn đề còn lại trong
`quality/page.tsx`/`dispatch/page.tsx` đã đối chiếu qua `git diff` xác nhận là pre-existing, nằm
ngoài hoàn toàn phạm vi diff của lần sửa này (chỉ đụng đúng khối JSX gọi `<KpiLinkPrompt>`).
`npm run build` sạch — build liệt kê đủ mọi route KPI, không route nào lỗi.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy migration trước

1. Chạy `supabase/migrations/20260816_kpi_task_module_code.sql` trên Supabase SQL Editor.
2. Sửa lại 1 template "Đo mẫu" có sẵn (hoặc tạo mới), gắn Module = "Kiểm soát quá trình (Đo
   nhanh)" → bấm "Sinh việc hôm nay ngay" → xác nhận `kpi_tasks` mới sinh có đúng
   `module_code='process'`.
3. Đăng nhập đúng người được giao việc "Đo mẫu" đó → vào Kiểm soát quá trình → Đo nhanh chỉ tiêu
   → nhập kết quả → Lưu → xác nhận banner nổi **góc trên-phải** (không còn dễ bỏ qua như ảnh chụp
   cũ), dropdown CHỈ liệt kê đúng việc "Đo mẫu" (không lẫn việc khác của người đó ở module khác)
   → gắn thành công.
4. Cùng người đó, vào 1 module KHÁC (vd Kho nguyên liệu) mà họ KHÔNG có việc nào gắn
   `module_code='storage'` → tạo 1 ngăn lưu mới → Lưu → xác nhận KHÔNG có banner nào hiện ra (kể
   cả khi họ vẫn còn việc "Đo mẫu" đang mở ở module khác).
5. Test đúng ví dụ gốc: Châu Nho có việc "Điều xe" → vào Kho nguyên liệu tạo ngăn, Lưu → không
   hiện banner.
6. Test 1 người có ĐÚNG 1 việc khớp module → xác nhận dropdown tự chọn sẵn việc đó, chỉ cần bấm
   "Gắn & hoàn thành".
7. Test tạo 1 "Công việc chuyên môn" (Giao việc mới) có gắn Module → lặp lại bước 3-4 cho đúng
   module đã chọn.
8. Test regression: 1 template/task KHÔNG gắn module nào → xác nhận không bao giờ hiện banner ở
   bất kỳ module nào, người thực hiện vẫn hoàn thành việc bình thường qua trang chi tiết việc
   (Nộp/Nghiệm thu).
9. Test hiển thị: banner không bị modal khác che khuất (`z-[70]` cao hơn `ModalShell` mặc định
   `z-50`); trên mobile (viewport hẹp) banner không tràn màn hình
   (`w-[calc(100vw-2rem)] sm:w-96`).

### Cập nhật (cùng phiên, tiếp) — Bug thật đã xác nhận qua DB: "Hữu Thọ có việc Đo mẫu nhưng
không thấy banner" — ĐÃ FIX + ĐÃ BACKFILL DỮ LIỆU THẬT

Sau khi deploy migration `20260816_...`, người dùng test ngay và báo Hữu Thọ có việc "Đo mẫu tối
thiểu 4 mẫu..." (`CV-010826/002`, xem ảnh chụp "Việc hôm nay") nhưng lưu phiếu Đo nhanh chỉ tiêu
xong không có banner nào nổi lên. Đã điều tra bằng script đọc trực tiếp DB (không đoán) — xác
nhận **2 nguyên nhân**, không phải bug logic lọc module vừa code:

1. **Nguyên nhân chính (dữ liệu, không phải code)**: migration đã chạy đúng (cột `module_code`
   tồn tại), nhưng **5/6 template "Việc định kỳ"** (Tạo phiếu điều xe, Đo mẫu, Upload sản lượng,
   Upload kiểm nghiệm, Tạo ngăn lưu — đúng 5/6 template hiện có trong hệ thống, khớp chính xác 5
   module hook điểm) đều có `module_code = NULL` — chưa ai vào sửa lại để gắn Module (tính năng
   mới deploy, admin chưa kịp cấu hình). Vì `module_code = NULL` không khớp bất kỳ filter module
   nào, banner đúng là không hiện — **đây là hành vi ĐÚNG thiết kế**, không phải bug.
2. **Bug thật đã fix**: kể cả khi admin sửa lại 1 template để gắn Module, việc ĐANG MỞ đã sinh ra
   từ template đó trước khi sửa (như `CV-010826/002`) sẽ **KHÔNG tự động cập nhật** —
   `updateKpiTaskTemplate()` (`src/lib/kpi-templates.ts`) trước đây chỉ `UPDATE
   kpi_task_templates`, không đụng tới `kpi_tasks` đã sinh sẵn. Và `kpi_ensure_today_task_
   instances` chỉ sinh instance MỚI khi instance cũ đã đóng (`hoan_thanh`/`huy` — cơ chế chặn
   "mắc kẹt" từ `20260812_kpi_task_templates_skip_stuck.sql`), nên admin sửa Module xong vẫn phải
   đợi việc cũ đóng mới thấy tác dụng — quá chậm, gây đúng hiện tượng người dùng báo.

**Fix**: `updateKpiTaskTemplate()` giờ, ngay sau khi `UPDATE kpi_task_templates` thành công, chạy
thêm 1 câu `UPDATE kpi_tasks SET module_code = ... WHERE template_id = id AND trang_thai NOT IN
('hoan_thanh','huy')` — đồng bộ Module xuống MỌI instance đang mở của đúng template đó ngay lập
tức, không cần đợi việc cũ đóng. Chỉ đồng bộ `module_code` (không đồng bộ `tieu_de`/`mo_ta`/field
khác khi sửa template — ngoài phạm vi bug này, không mở rộng thêm).

**Đã backfill dữ liệu thật** (2 script tạm `scripts/investigate-kpi-module-code-banner.mjs` +
`scripts/backfill-kpi-template-module-code.mjs`, đã xác nhận với người dùng trước khi ghi, chạy
xong và **đã xóa** — không phải script tái sử dụng lâu dài): gắn đúng Module cho 5 template dựa
trực tiếp vào tiêu đề đã ghi rõ module (không đoán mò) — "Tạo phiếu điều xe..." → `dispatch`,
"Đo mẫu..." → `process`, "Upload... modun Sản lượng" → `output`, "Upload... modun Chất lượng" →
`quality`, "Tạo ngăn lưu" → `storage`; template "Dọn dẹp phòng điều hành xử lý nước thải" **giữ
nguyên `module_code = NULL`** (không liên quan module ERP nào, đúng thiết kế). Đồng thời đồng bộ
xuống cả 5 việc đang mở tương ứng (`CV-010826/001` đến `/005`) — đã verify qua log script: cả 5
đều chuyển từ `module_code=NULL` sang đúng module, `CV-010826/006` (Dọn dẹp) giữ nguyên `NULL`.

`npx tsc --noEmit`/`npx eslint src/lib/kpi-templates.ts` sạch sau fix. **Chưa test tay UI thật**
— cần: đăng nhập Hữu Thọ → vào Kiểm soát quá trình → Đo nhanh chỉ tiêu → nhập kết quả → Lưu →
xác nhận banner nổi góc trên-phải xuất hiện, dropdown có đúng việc "Đo mẫu tối thiểu 4 mẫu..." →
gắn thành công, task chuyển "Hoàn thành". Test tương tự cho 4 người còn lại với 4 module còn lại
(Điều xe/Sản lượng/Kiểm nghiệm/Kho nguyên liệu) nếu có tài khoản tương ứng. Test sửa 1 template
BẤT KỲ đổi Module khác → xác nhận việc đang mở (nếu có) của template đó cập nhật `module_code`
ngay, không cần đợi qua ngày.

### Cập nhật (cùng phiên, tiếp 2) — Redesign banner lần 2: căn giữa màn hình + kèm backdrop

Người dùng test tay ngay sau backfill — banner đã hiện đúng (xác nhận cơ chế lọc module hoạt
động), nhưng phản ánh bản góc trên-phải (`fixed top-4 right-4 w-96`) "quá nhỏ", muốn to hơn và
hiển thị **giữa màn hình**. Đã redesign `kpi-link-prompt.tsx` lần 2:

- Đổi từ `fixed top-4 right-4 w-96` sang `fixed inset-0 flex items-center justify-center` — thẻ
  nổi giữa màn hình, kèm backdrop `bg-black/30` (click backdrop = "Bỏ qua", tương đương nút có
  sẵn). Card rộng hơn hẳn (`max-w-lg`, padding `p-6 sm:p-7`, bo góc `rounded-3xl`).
  - Icon chuyển thành huy hiệu tròn lớn (`h-12 w-12 rounded-full bg-violet-100`) thay vì icon
    trần nhỏ, giữ nguyên chấm pulse `animate-ping` ở góc.
  - Tiêu đề tách 2 dòng rõ ràng (`text-base font-semibold` + dòng phụ `text-sm text-slate-500`
    "Gắn vào công việc KPI nào đang mở?") thay vì 1 câu dài gộp chung.
  - Dropdown/nút phóng to (`py-3`/`py-2.5`, `text-sm` thay `text-xs`), nút Bỏ qua/Gắn xếp hàng
    ngang bên phải trên desktop, xếp dọc full-width trên mobile
    (`flex-col-reverse sm:flex-row sm:justify-end`).
  - Trạng thái "đã hoàn thành" (`doneLabel`) áp dụng cùng bố cục căn giữa + backdrop, không còn
    lệch phong cách so với trạng thái chọn việc.
  - Giữ nguyên `z-[70]`, giữ nguyên toàn bộ logic lọc module/auto-dismiss 3s/fail-silent — chỉ
    đổi phần trình bày.

`npx tsc --noEmit`/`npx eslint`/`npm run build` đều sạch. **Chưa test tay lại bản này** — cần xác
nhận: card hiển thị đúng giữa màn hình trên cả desktop lẫn mobile, backdrop dim đúng toàn trang,
click backdrop đóng đúng như nút "Bỏ qua", không bị modal khác của trang che khuất.

### Cập nhật (cùng phiên, tiếp 3) — Backdrop không còn tự đóng, chỉ "nhấp nháy" + Hạn chấm điểm
hiện trên QR vị trí 5S — ĐÃ CODE XONG, KHÔNG CẦN MIGRATION, CHƯA TEST TAY

Người dùng test bản căn-giữa-màn-hình ở mục ngay trên, phản hồi 2 việc riêng biệt (không liên
quan nhau — 1 việc thuộc `KpiLinkPrompt`, 1 việc thuộc Vị trí 5S):

**1. Backdrop click không còn đóng banner — chỉ rung nhẹ để nhắc**

Trước đó backdrop `onClick={() => onDone?.()}` coi click ra ngoài = "Bỏ qua" (đúng ghi chú ở mục
"tiếp 2" phía trên). Người dùng muốn đổi: chỉ đúng nút "Bỏ qua" mới đóng được banner; click ra
ngoài chỉ làm thẻ "nhấp nháy" (rung nhẹ) để nhắc còn đang chờ xử lý, KHÔNG đóng.

- `src/app/globals.css` — thêm keyframe mới `attentionShake` (dịch ngang qua lại nhanh, tổng thời
  lượng phù hợp `0.4s`), đặt ngay sau `slideUp` — dùng chung được cho bất kỳ hộp thoại "bắt buộc
  tự đóng bằng nút" nào khác sau này, không riêng cho component này.
- `kpi-link-prompt.tsx`: thêm state `shake` + `shakeTimerRef`; hàm `nudge()` — reset `shake` về
  `false` rồi `requestAnimationFrame` bật lại `true` (đảm bảo class animation re-trigger được kể
  cả khi click liên tiếp nhanh, vì React sẽ không re-render lại className giống hệt nếu giá trị
  không đổi giữa 2 lần set liên tục) + `setTimeout` 420ms tắt lại. Backdrop của CẢ 2 trạng thái
  (chọn việc / `doneLabel` đã hoàn thành) đổi `onClick={() => onDone?.()}` → `onClick={nudge}`.
  Card áp dụng class động: `shake ? "animate-[attentionShake_0.4s_ease-in-out]" :
  "animate-[fadeInUp_0.3s_ease-out]"` — giữ hiệu ứng xuất hiện ban đầu khi chưa rung, chuyển sang
  rung khi người dùng bấm ra ngoài. Nút "Bỏ qua" và nút X góc trên đều giữ nguyên
  `onClick={() => onDone?.()}` — vẫn là 2 cách DUY NHẤT đóng được banner (cùng với "Gắn & hoàn
  thành" thành công).

**2. Hạn chấm điểm 5S hiển thị trên/cạnh QR**

Trước đó "hạn chấm" (Thứ + Giờ, `deadline_weekdays`/`deadline_time`, xem mục "Cập nhật (phiên sau
Phase 5)") chỉ hiện dưới dạng badge cảnh báo quá hạn/sắp hạn ở đầu trang chi tiết vị trí — KHÔNG
xuất hiện ở bất kỳ đâu gắn liền với chính mã QR (cả trên màn hình lẫn khi in ra dán hiện trường).
Người dùng muốn hạn chấm đi kèm QR.

- `src/lib/kpi-5s.ts` — thêm hàm dùng chung `formatKpi5sDeadlineLabel(location)` → trả về chuỗi
  `"Thứ X, HH:MM"` hoặc `null` nếu chưa cấu hình (dùng `KPI_WEEKDAY_LABEL` từ `kpi-templates.ts`,
  không có rủi ro circular import — `kpi-templates.ts` chỉ import `kpi-tasks.ts`, không import
  ngược lại `kpi-5s.ts`).
- `src/lib/kpi-5s-pdf.ts` (`downloadKpi5sLocationBulkQrPdf`) — `Pick<Kpi5sLocation, ...>` param
  mở rộng thêm `deadline_weekdays`/`deadline_time`. Ngân sách chiều cao ô nhãn
  (`computeGridLayout`) tăng thêm đúng 1 dòng cố định (`QR_LABEL_DEADLINE_LINE = 1`) — **áp dụng
  đồng nhất cho MỌI ô trong lưới, kể cả vị trí chưa cấu hình hạn** (để giữ chiều cao ô thống nhất
  toàn trang, các ô không có hạn chỉ đơn giản để trống dòng đó, không co lại — nếu co theo từng ô
  sẽ làm lưới lệch hàng). Sau khối in mã/tên vị trí (tối đa 3 dòng như cũ), nếu
  `formatKpi5sDeadlineLabel(location)` có giá trị thì in thêm 1 dòng riêng `"Hạn chấm: Thứ X,
  HH:MM"` — cỡ chữ nhỏ hơn (`QR_LABEL_DEADLINE_FONT_SIZE_PT = 6.5pt` so với `7.5pt` của mã/tên),
  in đậm, màu hổ phách (`rgb(180,83,9)`) để phân biệt rõ với 2 dòng thông tin định danh phía
  trên. Vị trí chưa cấu hình hạn không in dòng này (chỉ để trống khoảng đã dành sẵn).
- `src/app/dashboard/kpi/5s/location/[id]/page.tsx` — thêm `deadlineLabel` (tính qua
  `formatKpi5sDeadlineLabel(location)`, hiển thị **bất kể tuần này đã chấm hay chưa** — khác hẳn
  badge cảnh báo quá hạn/sắp hạn đã có sẵn ở đầu trang, vốn CHỈ hiện khi chưa chấm tuần này; đây
  là thông tin tham khảo cố định, không phải cảnh báo hành động). Chèn ngay dưới khối QR
  (`<QRCodeSVG>`) và trên nút "Tải QR": có cấu hình → dòng chữ hổ phách nhỏ kèm icon
  `AlertTriangle`, "Hạn chấm: Thứ X, HH:MM"; chưa cấu hình → dòng chữ xám nhạt "Chưa cấu hình hạn
  chấm" (giúp người xem biết ngay đây là trạng thái chưa thiết lập, không phải lỗi hiển thị).

`npx tsc --noEmit`, `npx eslint` (4 file: `kpi-link-prompt.tsx`, `kpi-5s.ts`, `kpi-5s-pdf.ts`,
`5s/location/[id]/page.tsx`), và `npm run build` đều sạch — build liệt kê đủ mọi route KPI, kể cả
`/dashboard/kpi/5s/location/[id]` (dynamic), không route nào lỗi. Không có migration nào cần chạy
cho cả 2 việc trong mục này (cột `deadline_weekdays`/`deadline_time` đã tồn tại sẵn từ trước).

**Chưa test tay** — cần:

1. Mở banner "Gắn bản ghi tại chỗ" (lưu 1 bản ghi ở module đã gắn Module cho task) → bấm ra
   NGOÀI card (vùng backdrop tối) nhiều lần liên tiếp nhanh → xác nhận thẻ rung nhẹ mỗi lần bấm
   (kể cả bấm dồn dập), KHÔNG bao giờ tự đóng; chỉ bấm đúng nút "Bỏ qua" hoặc nút X góc trên hoặc
   "Gắn & hoàn thành" thành công mới đóng được.
2. Mở 1 Vị trí 5S ĐÃ cấu hình hạn chấm (Thứ + Giờ) → xác nhận dòng "Hạn chấm: Thứ X, HH:MM" hiện
   đúng ngay dưới QR trên màn hình (màu hổ phách), hiển thị dù tuần này đã chấm xong hay chưa.
3. Mở 1 Vị trí 5S CHƯA cấu hình hạn → xác nhận dòng "Chưa cấu hình hạn chấm" (xám) hiện đúng chỗ,
   không vỡ layout.
4. Bấm "Tải QR" (in 1 vị trí đã có hạn chấm) hoặc vào Cài đặt → KPI & 5S → Vị trí 5S → chọn nhiều
   vị trí (trộn cả có/chưa cấu hình hạn) → "In QR hàng loạt" → xác nhận PDF có dòng "Hạn chấm:
   Thứ X, HH:MM" (chữ hổ phách, cỡ nhỏ hơn mã/tên) đúng dưới mỗi nhãn có cấu hình, các nhãn chưa
   cấu hình để trống đúng khoảng đó — toàn bộ lưới các ô vẫn thẳng hàng nhau (không lệch chiều
   cao giữa ô có/không có dòng hạn chấm).

## Cập nhật 2026-08-17 — Mở rộng liên kết module (Bảo trì/Xuất hàng/Kho vật tư), Việc đột xuất
5S kèm ảnh "before", nút Nhắc nhở thủ công (ĐÃ CODE XONG, CHƯA CHẠY MIGRATION, CHƯA TEST TAY)

Cùng đợt: điều tra và fix riêng biệt nguyên nhân "Ghi chú nhanh bị lag" (xem mục cuối cùng của
mục này) — không liên quan tới KPI, chỉ tình cờ làm cùng phiên vì cùng 1 yêu cầu của người dùng.

### A. Migration mới (2 file, **CẦN CHẠY THỦ CÔNG trên Supabase SQL Editor**, CHƯA CHẠY)

- `supabase/migrations/20260817_kpi_task_module_code_extend.sql` — mở rộng CHECK constraint
  `module_code` trên cả `kpi_tasks` và `kpi_task_templates` từ 6 lên **9 giá trị** (thêm
  `maintenance`, `export`, `inventory`). `DROP CONSTRAINT IF EXISTS` rồi `ADD CONSTRAINT` lại,
  đúng phong cách `20260816_kpi_task_module_code.sql`. Không backfill.
- `supabase/migrations/20260817_kpi_tasks_5s_adhoc.sql` — thêm 2 cột tuỳ chọn vào `kpi_tasks`:
  `kpi_5s_location_id UUID REFERENCES kpi_5s_locations(id) ON DELETE SET NULL` và
  `before_image_urls TEXT[] NULL DEFAULT NULL`, kèm index `WHERE kpi_5s_location_id IS NOT NULL`.
  Dùng cho "Việc đột xuất 5S" (mục C).

### B. Mở rộng `KpiLinkPrompt` sang Bảo trì/Xuất hàng/Kho vật tư

`src/lib/kpi-tasks.ts`'s `KPI_MODULE_OPTIONS` thêm 3 phần tử: `maintenance` (Bảo trì), `export`
(Xuất hàng), `inventory` (Kho vật tư) — `KpiModuleCode`/`KPI_MODULE_LABEL` tự suy theo. Kiểm nghiệm
đã có sẵn từ trước, không cần thêm. Tổng cộng **7 call site cũ + 5 call site mới = 12**:

- **Bảo trì** (`maintenance:save`) — `src/app/dashboard/maintenance/records/[id]/page.tsx`,
  `handleSave`. **Điểm rủi ro cao nhất trong cả đợt này**: nhánh `isNew` trước đây gọi
  `router.push(...)` NGAY sau khi tạo biên bản — nếu vẫn giữ nguyên, đổi `params.id` ngay lập tức
  sẽ remount route con và làm mất state `kpiPrompt` giữa chừng (banner chớp tắt/mất). Đã sửa: nhánh
  `isNew` giờ chỉ `setKpiPrompt({..., navigateTo: "/dashboard/maintenance/records/${recordId}"})`,
  `router.push` bị **delay tới `onDone`** của `KpiLinkPrompt` (đóng banner mới điều hướng). Nhánh
  sửa (không phải `isNew`) không có vấn đề này (không đổi route), set `kpiPrompt` không kèm
  `navigateTo`.
- **Xuất hàng** (`export:create`) — `src/app/dashboard/export/page.tsx`, `handleSave`. **Việc tiên
  quyết đã fix**: nhánh tạo đơn mới trước đây insert `export_orders` **không có
  `.select("id").single()`** — không có cách nào lấy `id` đơn vừa tạo để truyền vào
  `KpiLinkPrompt`. Đã thêm `.select("id").single()`, capture `insertedOrder.id`. `recordUrl` chỉ
  trỏ `/dashboard/export` (không có deep-link theo đơn cụ thể — trang này không hỗ trợ query param
  đó).
- **Kho vật tư** — 3 luồng **dùng chung 1 `module_code = "inventory"`** (mirror cách
  `process:measurement` gộp về family `process`): Nhập kho (`inventory:receipt`,
  `receipts/page.tsx`'s `postReceiptDraft`), Xuất kho (`inventory:issue`, `issues/page.tsx`'s
  `postIssueDraft`), Chuyển kho (`inventory:transfer`, `transfers/page.tsx`'s `postTransferDraft`)
  — cả 3 set `kpiPrompt` ngay sau khi RPC ghi sổ (`inventory_post_import_document`/
  `inventory_post_export_document`/`inventory_post_transfer_document`) thành công, `recordUrl` dùng
  đúng pattern `?documentId=` mà cả 3 trang đã đọc sẵn để deep-link. **Hệ quả cố ý chấp nhận**: 1
  việc "Kho vật tư" đang mở sẽ được gợi ý sau BẤT KỲ thao tác nào trong 3 luồng, không phân biệt
  đúng là Nhập/Xuất/Chuyển.

### C. Việc đột xuất 5S kèm ảnh "before" — model hoá bằng `kpi_tasks`, KHÔNG đụng
`kpi_5s_evaluations`

Đã chốt với người dùng qua `AskUserQuestion`: dùng lại nguyên hệ thống "Công việc" hiện có, thêm 2
field tuỳ chọn — **hoàn toàn tách biệt** với chấm điểm 5S định kỳ hàng tuần, không ảnh hưởng công
thức tính điểm C (5S) hàng tháng.

- `src/lib/kpi-tasks.ts`: `KpiTask` type + `TASK_COLS` thêm `kpi_5s_location_id`/
  `before_image_urls`. `createKpiTask()` thêm 3 tham số tuỳ chọn: `kpi5sLocationId`,
  `beforeImageUrls`, và **`id?: string`** (client-generated).
- **Vấn đề thiết kế đã giải quyết**: `kpi_tasks` hiện **không có màn Sửa** sau khi tạo — nếu insert
  task trước rồi mới upload ảnh, 1 lần upload/update lỗi sẽ để lại task vĩnh viễn không có ảnh
  before và không có cách bổ sung. Giải pháp: client tự sinh `id` (`crypto.randomUUID()`) TRƯỚC
  khi insert, upload ảnh lên đúng path Storage `{factory_id}/kpi/tasks/{id}/...` (dùng lại
  `uploadKpiEvidenceImage` có sẵn) rồi mới `createKpiTask({..., id})` với `id` tường minh — chỉ
  dùng nhánh này khi thực sự có ít nhất 1 ảnh (task thường vẫn để DB tự sinh `id` như cũ). Đã xác
  nhận an toàn qua đọc trực tiếp schema: `kpi_tasks.id` chỉ là `UUID DEFAULT gen_random_uuid()`
  (không phải `GENERATED ALWAYS`), RLS `kpi_tasks_insert` không tham chiếu `id`, không có
  `BEFORE INSERT` trigger nào can thiệp.
- `KpiTaskFormModal` (`kpi-task-form-modal.tsx`) — modal "Giao công việc mới" DÙNG CHUNG (không
  tách flow riêng cho 5S), thêm 2 field tuỳ chọn ngay sau "Module liên quan": dropdown "Vị trí 5S
  liên quan" (nguồn `kpi5sLocations` — tải 1 lần ở `kpi/tasks/page.tsx` qua `fetchKpi5sLocations`,
  truyền xuống modal qua prop mới, tránh fetch lại mỗi lần mở modal) và widget ảnh nhỏ gọn "Ảnh
  hiện trạng trước khi xử lý — before" (tối đa 4 ảnh, `taskId` sinh 1 lần qua
  `useState(() => crypto.randomUUID())`).
- Hiển thị (`kpi/tasks/[id]/page.tsx`): khối mới "Ảnh hiện trạng lúc giao việc (before)" (thumbnail
  grid, click mở ảnh gốc tab mới) render ngay dưới callout "Ghi chú / Hướng dẫn thực hiện", chỉ
  hiện khi `task.before_image_urls?.length`. Badge/link "Vị trí 5S liên quan: {mã} — {tên}" (icon
  `MapPin`, trỏ `/dashboard/kpi/5s/location/{id}`) khi `task.kpi_5s_location_id` có giá trị — tên
  vị trí resolve qua `fetchKpi5sLocation(id)` (1 lần, `useEffect` phụ thuộc
  `task?.kpi_5s_location_id`). Ảnh "after" do người thực hiện nộp qua đúng luồng nộp tiến độ đã có
  sẵn (không sửa gì thêm) — 2 bộ ảnh (before đầu trang, after trong nhật ký xử lý) tạo cặp đối
  chiếu.

### D. Nút "Nhắc nhở" thủ công — CHỈ Telegram, KHÔNG có cơ chế tự động

Đã chốt với người dùng: vì repo hoàn toàn không có hạ tầng cron nào (không Vercel Cron, không
route `/api/cron*`), nút "Nhắc nhở" chỉ là **hành động thủ công** — người giao/Admin tự bấm để gửi
Telegram ngay qua `sendKpiNotify()` có sẵn (không sửa `/api/kpi/notify`, không thêm bảng "đã nhắc"
nào). Mỗi nút tự khoá tạm 45 giây sau khi bấm (state cục bộ `remindCooldown`/`remindCooldownIds`,
KHÔNG ghi DB) chỉ để tránh gửi trùng do double-click — không phải cơ chế chống spam thật sự.

Áp dụng ở **4 nơi**, đều cùng công thức `{ factoryId, title, lines: [...], link }`:

1. `kpi/tasks/[id]/page.tsx` — nút cạnh "Hủy công việc" (header), gate `isOwner && open` (dùng
   đúng biến quyền có sẵn).
2. `kpi/5s/location/[id]/page.tsx` — nút cạnh "Tải QR" (khối actions bên QR), gate mới
   `isAssigner = user?.id === location?.assigned_by`, điều kiện hiện `(isAdmin || isAssigner) &&
   deadline && !hasEvaluatedThisWeek` (tái dùng `deadline`/`hasEvaluatedThisWeek` đã tính sẵn).
3. `kpi/tasks/page.tsx` (danh sách) — nút inline mỗi thẻ, gate `isGiver && (overdue || dueSoon)`.
   **Đã fix bug HTML lồng phần tử tương tác**: card gốc là `<button>` bao ngoài toàn bộ nội dung —
   thêm `<button>` "Nhắc nhở" lồng bên trong sẽ là button-trong-button (không hợp lệ, trình duyệt
   có thể tự đóng sớm phần tử ngoài, phá vỡ click-để-mở-chi-tiết). Đã đổi phần tử bao ngoài từ
   `<button>` sang `<div role="button" tabIndex={0} onClick=... onKeyDown=...>`, nút "Nhắc nhở" là
   `<button>` con độc lập với `onClick={(e) => { e.stopPropagation(); ... }}`.
4. `kpi/5s/page.tsx` (danh sách) — nút inline mỗi thẻ, gate
   `(isAdmin || user?.id === loc.assigned_by) && deadline && !hasEvaluatedThisWeek`. Card gốc là
   `<Link>` (render `<a>`) bao toàn bộ nội dung — cùng vấn đề lồng phần tử tương tác. Đã tách khác
   với cách xử lý ở mục 3: giữ `<Link>` chỉ bọc phần nội dung chính (title/body, `className="block"`),
   bọc ngoài đổi thành `<div>` KHÔNG tương tác, nút "Nhắc nhở" là `<button>` SIBLING độc lập nằm
   ngoài `<Link>` — không cần `stopPropagation` vì không còn lồng nhau.

### E. Bug thật đã fix trong lúc code — `useState` gọi sau early-return (React Hooks rule)

Khi thêm state `remindCooldown` ở `kpi/tasks/[id]/page.tsx`, lần đầu đặt nhầm vị trí (ngay trước
`handleCancelTransfer`, tức SAU dòng `if (loading || dataLoading) return ...`) — `eslint` (rule
`react-hooks/rules-of-hooks`) bắt được ngay: gọi Hook có điều kiện. Đã sửa: chuyển khai báo
`useState` lên đầu component cùng các state khác (trước early-return), chỉ giữ hàm `handleRemind`
ở vị trí cũ.

### F. Fix riêng biệt — "Ghi chú nhanh" bị lag/giật (không hard-code, thuần kiến trúc)

Điều tra bằng Explore agent xác nhận: **không có `setTimeout`/`sleep` giả nào** — nguyên nhân hoàn
toàn ở tầng kiến trúc. Đã sửa dứt điểm cả 6 nguyên nhân, toàn bộ ở tầng client, không đổi RLS:

1. **Debounce ô tìm kiếm 300ms** (`notes/page.tsx`) — tách `searchInput` (gõ tay) khỏi `search`
   (debounced, thật sự đẩy vào `loadData`) — trước đây mỗi ký tự gõ bắn ngay 1 query Supabase.
2. **Phân trang đúng cách** — `fetchOperationNotes` (`operation-notes.ts`) thêm `offset`, dùng
   `.range()` thay vì chỉ `.limit()`. "Tải thêm" (`notes/page.tsx`) giờ gọi với
   `offset = notes.length` và NỐI THÊM (`[...prev, ...more]`) thay vì tăng `limit` rồi truy vấn lại
   từ đầu (bug cũ: càng tải càng chậm, gần như O(n²)).
3. **Cập nhật cục bộ thay vì tải lại toàn bộ sau mỗi thao tác** — `createOperationNote`/
   `updateOperationNote` đổi từ trả `void` sang trả về **row đã lưu**
   (`.select(SELECT_COLS).single()`). `handleSave`/`handleDelete` (`notes/page.tsx`) và
   `handleSubmit` (`quick-notes-widget.tsx`) thay `void loadData(...)` bằng thao tác trực tiếp trên
   mảng `notes` cục bộ (prepend/patch/filter), có hàm `compareOperationNotes` (mới, export từ
   `operation-notes.ts`) để sắp xếp lại đúng vị trí sau khi thêm/sửa.
4. **Memo hoá `NoteCard`** — bọc `React.memo` (`NoteCardBase` → `export const NoteCard =
   memo(NoteCardBase)`). Đổi prop callback từ dạng "đã bind sẵn note" (tạo closure mới mỗi render,
   vô hiệu hoá memo) sang dạng nhận tham số (`onEdit?: (note) => void`, `onDelete?: (noteId) =>
   void`, `onShare?: (note) => void`) — `notes/page.tsx` giờ chỉ cần 1 `useCallback([])` ổn định
   cho cả danh sách (`openEdit`/`requestDelete`/`openShare`, mỗi hàm chỉ dùng setState setter nên
   an toàn giữ closure cũ).
5. **`loading="lazy"`** cho `<img>` trong `note-card.tsx` và `note-image-picker.tsx` (thumbnail
   grid — không thêm cho overlay phóng to toàn màn hình, vì người dùng đang chủ động chờ xem ngay).
6. **Tăng giới hạn ảnh 6 → 10**: `OPERATION_NOTE_MAX_IMAGES` (`operation-notes.ts`) — đúng 1 hằng
   số, không có chuỗi "6 ảnh" hard-code nào khác cần sửa (UI đọc động từ hằng số này).

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file đã sửa/thêm trong đợt này), và `npm run build` đều
sạch — build liệt kê đủ mọi route liên quan (`/dashboard/kpi/tasks`, `/dashboard/kpi/tasks/[id]`,
`/dashboard/kpi/5s`, `/dashboard/kpi/5s/location/[id]`, `/dashboard/maintenance/records/[id]`,
`/dashboard/export`, `/dashboard/inventory/receipts|issues|transfers`, `/dashboard/notes`), không
route nào lỗi.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy 2 migration trước

1. Chạy `20260817_kpi_task_module_code_extend.sql` rồi `20260817_kpi_tasks_5s_adhoc.sql` trên
   Supabase SQL Editor.
2. Gắn `module_code="maintenance"` cho 1 Việc/Việc định kỳ → tạo 1 biên bản bảo trì mới → xác nhận
   banner "Gắn bản ghi" hiện ra TRƯỚC khi điều hướng, đóng banner (gắn hoặc "Bỏ qua") mới chuyển
   sang `/records/{id}`, không mất banner giữa chừng, không lỗi console. Lặp lại cho biên bản SỬA
   (không phải tạo mới) — xác nhận vẫn có banner nhưng không có hành vi delay điều hướng nào.
3. Tương tự cho `module_code="export"` (tạo đơn xuất mới) — xác nhận `insertedOrder.id` lấy đúng,
   banner hiện đúng mã đơn.
4. Tương tự cho `module_code="inventory"` — ghi sổ lần lượt 1 phiếu Nhập/Xuất/Chuyển, xác nhận cả 3
   đều gợi ý đúng 1 việc "Kho vật tư" đang mở (dù việc đó ban đầu tạo không phân biệt Nhập/Xuất/
   Chuyển).
5. Tạo 1 Công việc mới, chọn 1 Vị trí 5S + đính 2-3 ảnh "before" → xác nhận task tạo thành công, mở
   trang chi tiết thấy đúng ảnh before + link vị trí 5S hoạt động; xác nhận việc này KHÔNG xuất
   hiện/ảnh hưởng gì trong lịch sử chấm điểm 5S định kỳ của vị trí đó (không có dòng mới trong
   `kpi_5s_evaluations`).
6. Thử bỏ trống ảnh before khi tạo việc (không đính ảnh nào) → xác nhận `id` vẫn để DB tự sinh
   (không set tường minh), task tạo bình thường như trước.
7. Nút Nhắc nhở: với 1 việc/1 vị trí 5S sắp/đã trễ hạn — đăng nhập người giao và Admin xác nhận
   thấy nút (cả ở trang chi tiết lẫn trang danh sách), bấm xác nhận Telegram nhận được tin đúng nội
   dung, nút tự khoá 45s sau khi bấm rồi mở lại. Đăng nhập người KHÔNG phải người giao/admin — xác
   nhận không thấy nút ở bất kỳ đâu.
8. Test riêng 2 trang danh sách sau khi đổi cấu trúc thẻ: `kpi/tasks/page.tsx` (thẻ giờ là `<div
   role="button">`) — xác nhận bấm vào thân thẻ vẫn mở đúng trang chi tiết (cả bằng chuột lẫn
   Tab+Enter/Space bàn phím), bấm nút "Nhắc nhở" KHÔNG vô tình điều hướng theo thẻ.
   `kpi/5s/page.tsx` (Link giờ chỉ bọc phần nội dung chính) — xác nhận tương tự, bấm nút "Nhắc nhở"
   không kích hoạt Link.
9. Ghi chú nhanh: gõ liên tục vào ô tìm kiếm — xác nhận không có query dồn dập (Network tab), chỉ 1
   query sau khi ngừng gõ ~300ms; lưu/xoá 1 ghi chú — xác nhận danh sách cập nhật ngay không "nhấp
   nháy" tải lại toàn bộ; "Tải thêm" nhiều lần — xác nhận mỗi lần chỉ fetch đúng 1 trang mới, không
   phình to dần; đính kèm tới 10 ảnh cho 1 ghi chú — xác nhận lưu và hiển thị đủ.

## Cập nhật 2026-08-19 — Redesign homepage KPI (badge có link chính xác) + 9 điểm feedback sau khi
dùng thử module (ĐÃ CODE XONG, CẦN CHẠY 3 MIGRATION MỚI, CHƯA TEST TAY)

Sau khi hoàn tất redesign `/dashboard/kpi` thành trang chủ thật (tách "Cần bạn LÀM"/"Cần bạn
DUYỆT", badge số đếm trên `KpiShell`), người dùng dùng thử và gửi 9 nhận xét — đã hỏi lại qua
`AskUserQuestion` cho 4 điểm rủi ro thiết kế cao trước khi code (Q1 dùng câu trả lời tự do, không
chọn 1 trong 3 lựa chọn đề xuất — xem đúng nguyên văn ở mục 4 bên dưới).

### Migration mới (**CẦN CHẠY THỦ CÔNG theo đúng thứ tự này**, sau mọi migration KPI trước đó)

1. `supabase/migrations/20260819_kpi_5s_appeal_correction_workflow.sql` — thêm cột
   `proposed_ket_qua/proposed_ly_do/proposed_by/proposed_at` vào `kpi_appeals`, thêm trạng thái
   `'cho_duyet_sua'`, RPC `kpi_appeal_propose_correction`/`kpi_appeal_decide_correction`, mở rộng
   `kpi_appeals_select`.
2. `supabase/migrations/20260819_kpi_5s_early_score_block.sql` — trigger `BEFORE INSERT` trên
   `kpi_5s_evaluations` chặn chấm điểm sớm hơn 48 giờ trước hạn (admin bypass).
3. `supabase/migrations/20260819_kpi_task_templates_quantity_and_day_of_month.sql` — thêm
   `days_of_month INTEGER[]`/`muc_tieu_so_luong INTEGER` vào `kpi_task_templates`, thêm
   `cadence_type='day_of_month'`, `CREATE OR REPLACE` lại `kpi_ensure_today_task_instances` (giữ
   nguyên mọi fix trước đó: skip-if-stuck, substitution `da_duyet`, `module_code`).

### 1. Badge/homepage phải link tới danh sách lọc CHÍNH XÁC (không rơi về "Việc của tôi" chung)

- `src/lib/kpi-tasks.ts` thêm `KpiTaskHighlight` (7 giá trị: `pendingMine/dueSoonMine/
  overdueMine/transferMine/approval/dueSoonGiven/overdueGiven`), `KPI_TASK_HIGHLIGHT_LABEL`, và
  `matchesKpiTaskHighlight(task, highlight, ctx)` — hàm predicate DÙNG CHUNG giữa
  `module-tasks.ts` (đếm số cho Bell) và `tasks/page.tsx` (lọc danh sách khi click vào) để 2 nơi
  không bao giờ lệch nhau.
- `module-tasks.ts`'s `getKpiTasks()`: mọi `link` trong `items[]` đổi từ `?tab=mine`/`?tab=all`
  chung chung sang `?highlight=<giá trị>` chính xác (riêng "Đăng ký thay thế chờ bạn duyệt" →
  `/dashboard/kpi/templates?tab=substitutions`, "Khiếu nại chờ xử lý" → `/dashboard/kpi/appeals`
  không đổi vì đã đúng).
- `tasks/page.tsx`: đọc `?highlight=` qua `useSearchParams()`, nếu khớp 1 trong 7 giá trị →
  ghi đè hoàn toàn hiển thị (banner tím "Đang lọc: {label} (N)" + nút "Xóa lọc", không kết hợp
  với tab today/mine/all/history).
- `5s/page.tsx`: tương tự nhưng riêng 2 giá trị `overdue`/`dueSoon` (khớp đúng `getKpi5sDueCounts`
  đã có từ 2026-08-10) — thêm `myOverdue`/`myDueSoon` memo mirror chính xác công thức đếm ở Bell.

### 2. Tab "Lịch sử" cho Công việc (hoàn thành + đã hủy)

`tasks/page.tsx`: `myTasksAll` (không lọc trạng thái) → `myTasks` (ẩn `hoan_thanh`/`huy` trừ khi
người dùng đã tự chọn filter trạng thái) + `historyTasks` (chỉ `hoan_thanh`/`huy`). Thêm nút tab
thứ 4 "Lịch sử (N)" cạnh "Việc hôm nay/Việc của tôi/Tất cả công việc".

### 3. Tab "Lịch sử" cho 5S (các lần đã chấm)

- `kpi-5s.ts` thêm `fetchRecentKpi5sEvaluations(factoryId, limit=60)` — 60 lần chấm gần nhất TOÀN
  NHÀ MÁY (RLS rộng, thiết kế "công khai trong factory" từ Phase 2); trang gọi hàm này rồi TỰ LỌC
  lại theo `visibleLocations` đã tính sẵn (không lộ ngoài phạm vi người xem).
- `5s/page.tsx` thêm tab thứ 3 "Lịch sử" (lazy-load khi bấm vào), mỗi dòng: vị trí + tuần + người
  chấm + badge kết quả, click vào trang chi tiết vị trí.

### 4. Khiếu nại 5S — quy trình 3 bước MỚI (thay thế "chỉ admin sửa trực tiếp")

**Nguyên văn câu trả lời tự do của người dùng (Q1)**: "Chỉ người bị chấm khiếu nại sau đó người
chấm sửa kết quả thông báo đến lãnh đạo phòng ban đó/admin duyệt/không duyệt quy trình kết thúc."
→ diễn giải thành: (1) người BỊ chấm (`nguoi_don_id`) nộp khiếu nại — **không đổi**, vẫn như cũ;
(2) **NGƯỜI CHẤM** (`nguoi_cham_id` của đúng lần chấm) tự đề xuất kết quả sửa lại — **MỚI**; (3)
**lãnh đạo phòng ban của vị trí đó** (`kpi_is_department_leader`, mirror
`20260807_kpi_department_scoping.sql`) hoặc admin/kpi.manage_config duyệt/từ chối — chỉ khi DUYỆT
mới thực sự ghi đè `kpi_5s_evaluations.ket_qua/ly_do`.

- `kpi-appeals.ts`: `KpiAppealStatus` thêm `"cho_duyet_sua"`; `KpiAppeal` thêm 4 field
  `proposed_*`; 2 wrapper mới `proposeKpi5sAppealCorrection()`/`decideKpi5sAppealCorrection()`.
- `5s/location/[id]/page.tsx`: nút "Khiếu nại" cũ **giữ nguyên** (chỉ `nguoi_don_id`, theo fix
  "Bug 1" trước đó). Thêm nút "Đề xuất sửa kết quả" (chỉ hiện cho `nguoi_cham_id` khi có 1 khiếu
  nại `cho_xu_ly` đang mở trên đúng lần chấm đó) → modal `Kpi5sResultPicker` → gọi
  `proposeKpi5sAppealCorrection`. Badge trạng thái đề xuất hiển thị ngay dưới nút hành động.
- `appeals/page.tsx`: nút "Đã giải quyết" (bypass sửa trực tiếp) **đã bị gỡ khỏi** nhánh khiếu
  nại 5S ở trạng thái `cho_xu_ly` (chỉ còn "Từ chối" thẳng nếu khiếu nại rõ ràng vô lý) — buộc đi
  qua đúng quy trình 3 bước; nhánh task/điểm tháng không đổi. Thêm 2 nút "Duyệt đề xuất"/"Từ chối
  đề xuất" khi `trang_thai === "cho_duyet_sua"`, gate bởi `canDecideAppeal()` (admin/
  kpi.manage_config hoặc đúng lãnh đạo phòng ban của vị trí — tra qua `locationRefs[...].location
  .phong_ban_id` so với `myLeaderDepartmentId`).
- **Cơ chế cũ `kpi_5s_evaluation_correct`/`correctKpi5sEvaluationDirect` (admin tự sửa NGAY,
  không qua khiếu nại) GIỮ NGUYÊN KHÔNG ĐỔI** — vẫn còn nút "Sửa kết quả" trên trang chi tiết vị
  trí, độc lập hoàn toàn với luồng 3 bước mới, là đường tắt dành riêng cho admin.

### 5. Kẽ hở chấm điểm 5S quá sớm — ĐÃ XÁC NHẬN CÓ, đã chặn cứng theo Q2 ("chặn cứng theo khung
giờ trước hạn", KPI_5S_EARLY_BLOCK_HOURS=48)

- `kpi-5s.ts`: `KPI_5S_EARLY_BLOCK_HOURS=48`, `isKpi5sTooEarlyToScore()`,
  `formatKpi5sEarliestAllowedLabel()` — bản mirror THUẦN CLIENT để hiện UI, nguồn thực thi chính
  là trigger DB (`kpi_5s_prevent_early_score`, migration #2 ở trên) — chỉ chặn INSERT (lần chấm
  gốc), không chặn UPDATE (2 RPC sửa kết quả sau này không INSERT dòng mới). Admin bypass cả 2
  tầng.
- `5s/location/[id]/page.tsx`: `canEvaluateThisWeek` thêm điều kiện `!tooEarly`; banner mới
  (khác banner "Đến lượt bạn chấm điểm") hiện khi quá sớm: "Chưa tới thời điểm được chấm điểm —
  hạn chấm là ..., có thể chấm từ ...".

### 6a. Hạn 5S chỉ hiện giờ, không hiện ngày → đã fix bằng nhãn đầy đủ có ngày

`kpi-5s.ts` thêm `formatKpi5sNextDeadlineLabel(location, nowISO?)` — "Thứ X, dd/mm/yyyy HH:MM"
dùng NGÀY THẬT từ `computeKpi5sNextDeadline()` (đã tự lùi tuần nếu cần) thay vì chỉ tên Thứ suông.
Áp dụng ở mọi nơi hiển thị hạn: card danh sách (`5s/page.tsx`), badge header + nhãn cạnh QR
(`5s/location/[id]/page.tsx`). `formatKpi5sDeadlineLabel()` cũ (không ngày) vẫn giữ nguyên — còn
dùng cho nhãn in QR PDF (`kpi-5s-pdf.ts`, không đổi vì in ra giấy dán cố định, không cần biết
"tuần nào").

### 6b. Nút nhắc nhở vẫn sáng dù đã chấm — ĐÃ XÁC NHẬN LÀ ĐÚNG, không phải bug

Đọc lại cả 2 nơi (`5s/page.tsx`'s `canRemindLocation`, `5s/location/[id]/page.tsx`'s dòng tương
đương): điều kiện đã có sẵn `!hasEvaluatedThisWeek` — nút tự tắt đúng khi tuần này đã chấm xong.
Không có thay đổi code cho mục này.

### 6c. "Lịch sử — 3 kết quả gần nhất" dưới badge kết quả

Giải quyết bằng chính tab "Lịch sử" mới (mục 3) — không thêm khối riêng trong từng card, vì tab
Lịch sử đã liệt kê đủ lịch sử (không giới hạn 3) và có thể lọc/xem theo vị trí qua click-through.

### 7. "Việc định kỳ" vs "5S" có trùng lặp không? — Trả lời: KHÔNG, bổ sung `day_of_month`

Ví dụ gốc "Dọn dẹp căn tin ngày 15 và 30 hàng tháng" không mô hình hóa được bằng 5S (5S là chấm
điểm THEO TUẦN cho 1 VỊ TRÍ cố định, không phải "việc cần làm 2 lần/tháng"). Đã thêm
`cadence_type='day_of_month'` (mảng `days_of_month`, vd `[15,30]`) làm lựa chọn thứ 3 song song
`weekday`/`interval` — không gộp 2 module lại, giữ đúng 2 khái niệm khác nhau (5S = đánh giá định
kỳ 1 vị trí vật lý; Việc định kỳ = giao việc lặp lại cho 1 người/nhóm).

- `kpi-templates.ts`: `KpiTaskCadenceType` thêm `"day_of_month"`, `buildTemplateCadencePayload()`
  validate nhánh mới.
- `template-form-modal.tsx`: thêm nút toggle thứ 3 "Ngày trong tháng" + lưới chọn 1-31.
- `templates/page.tsx`: badge card hiển thị "Ngày 15, 30 hàng tháng" cho cadence này.

### 8. Việc định kỳ hỗ trợ mục tiêu số lượng (vd "đo 4 mẫu mỗi ngày")

Tái dùng NGUYÊN VẸN cơ chế mục tiêu số lượng đã có cho việc giao tay (`kpi_tasks.
muc_tieu_so_luong`, `kpi_task_link_and_complete`, xem mục "Cập nhật 2026-07-25 (tiếp 2)" phía
trên) — không tạo cơ chế mới. `kpi_task_templates` thêm cột cùng tên; RPC
`kpi_ensure_today_task_instances` copy giá trị này xuống mỗi instance sinh ra + ép
`phan_loai='chinh'` cho người được giao (mirror đúng `createKpiTask()` khi có `nguoiChinhId`).
`template-form-modal.tsx` thêm field "Mục tiêu số lượng chung (tuỳ chọn)".

### 9. "Random 1 vị trí" — dropdown sửa tay quá hẹp + mặc định "Chỉ vị trí chưa gán đủ" gây khóa nút

- **9a (bug thật)**: modal "Phân công thông minh" mở với đúng 1 vị trí (đã có sẵn cả 2 người) →
  mặc định `onlyUnassigned=true` khiến `targetCount=0`, nút "Tạo đề xuất" khóa vĩnh viễn. Fix:
  `kpi-5s-auto-assign-modal.tsx`'s `onlyUnassigned` mặc định `locations.length !== 1` (đúng 1 vị
  trí → mặc định "Phân công lại toàn bộ").
- **9b (theo Q4, "mở rộng dropdown, chỉ ưu tiên khi random")**: `kpi-5s-auto-assign.ts` bỏ hẳn
  tầng lọc cứng "đã từng dọn/chấm" (`establishedUserIds` từng là HARD FILTER thu hẹp
  `eligibleUserIds` dùng cho dropdown) — giờ chỉ còn là TRỌNG SỐ ưu tiên khi random
  (`ESTABLISHED_WEIGHT_BOOST=4` nhân vào `weightedPick`). `eligibleUserIds` (dropdown sửa tay)
  giờ luôn là toàn bộ pool đã lọc Phòng ban + Khu vực — không còn ẩn người mới chưa từng làm 5S.
  Field `establishedRelaxed` đổi tên/ý nghĩa thành `noEstablishedCandidate` (thông báo trung tính
  "chưa có ai ưu tiên — random hoàn toàn ngẫu nhiên", không còn là cảnh báo "đã nới lỏng").

### Cập nhật trạng thái (2026-08-19, cùng ngày, sau khi 3 migration chạy xong)

- **Bug đã fix**: migration `20260819_kpi_task_templates_quantity_and_day_of_month.sql` lỗi
  `ERROR 0A000: cannot use subquery in check constraint` ở constraint
  `kpi_task_templates_days_of_month_check` (Postgres không cho `SELECT...FROM unnest(...)` bên
  trong `CHECK`). Đã sửa sang dùng array containment `days_of_month <@ ARRAY[1..31]` (literal
  tường minh, không subquery) — không cần file migration mới, sửa trực tiếp file cũ vì lần chạy
  trước đó lỗi giữa chừng, không để lại state nào trên DB.
- Cả 3 migration đã chạy xong trên Supabase, người dùng xác nhận **đã test trên localhost — đạt**
  (chưa rõ đã đi qua đủ hết 10 mục checklist chi tiết bên dưới hay chỉ test tổng quát/smoke test
  — session sau nên hỏi lại người dùng phạm vi cụ thể đã test nếu cần xác nhận từng mục).

### Chưa test tay — cần làm ở phiên sau (nếu người dùng xác nhận chưa test hết từng mục)

1. ~~Chạy 3 migration theo đúng thứ tự liệt kê ở đầu mục này trên Supabase SQL Editor.~~ ĐÃ CHẠY XONG.
2. **Mục 1**: bấm từng item trên trang chủ `/dashboard/kpi` (hoặc Bell) — xác nhận mỗi link dẫn
   đúng tới danh sách CHỈ chứa đúng số lượng item khớp con số đã hiện, không lẫn item khác; nút
   "Xóa lọc" trả về đúng view mặc định.
3. **Mục 2**: hoàn thành/hủy vài công việc → xác nhận chúng biến mất khỏi "Việc của tôi" nhưng
   xuất hiện đúng ở tab "Lịch sử"; test filter trạng thái thủ công vẫn hiện được `hoan_thanh`/
   `huy` khi người dùng chủ động chọn.
4. **Mục 3**: chấm điểm vài vị trí 5S → xác nhận tab "Lịch sử" của trang 5S liệt kê đúng, đúng
   phạm vi hiển thị (user thường không thấy lịch sử của vị trí ngoài phạm vi mình).
5. **Mục 4 (quan trọng nhất)**: người BỊ chấm nộp khiếu nại → xác nhận người CHẤM (không phải ai
   khác) thấy nút "Đề xuất sửa kết quả" → gửi đề xuất → xác nhận `kpi_5s_evaluations.ket_qua`
   KHÔNG đổi ngay (chỉ badge "Chờ duyệt đề xuất sửa") → đăng nhập đúng lãnh đạo phòng ban của vị
   trí đó (hoặc admin) → thấy 2 nút "Duyệt/Từ chối đề xuất" ở `/dashboard/kpi/appeals` → Duyệt →
   xác nhận kết quả gốc đổi đúng theo đề xuất, khiếu nại chuyển `da_giai_quyet`. Thử đăng nhập
   lãnh đạo phòng ban KHÁC (không phải phòng ban của vị trí đó) → xác nhận KHÔNG thấy 2 nút này.
6. **Mục 5**: cấu hình hạn chấm 1 vị trí xa hơn 48h từ hiện tại → xác nhận nút "Chấm điểm ngay"
   không xuất hiện, banner "Chưa tới thời điểm..." hiện đúng mốc giờ sớm nhất; thử gọi thẳng RPC
   `submitKpi5sEvaluation`/INSERT qua devtools trước mốc đó (không phải admin) → bị trigger DB
   chặn; admin thử chấm sớm → không bị chặn.
7. **Mục 6a**: xác nhận nhãn hạn ở mọi nơi hiện đủ "Thứ X, dd/mm/yyyy HH:MM" (không chỉ "CN,
   17:00" như trước).
8. **Mục 7**: tạo 1 Việc định kỳ "Ngày trong tháng" chọn 15 và 30 → xác nhận CHỈ sinh đúng 2 ngày
   đó trong tháng test (không sinh các ngày khác).
9. **Mục 8**: tạo 1 Việc định kỳ có "Mục tiêu số lượng" = 4 → xác nhận instance sinh ra có đúng
   `muc_tieu_so_luong=4`, người được giao là `phan_loai='chinh'`, task chỉ Hoàn thành sau khi gắn
   đủ 4 bằng chứng qua đúng module đã chọn.
10. **Mục 9**: mở "Phân công thông minh" cho ĐÚNG 1 vị trí đã có sẵn người → xác nhận nút "Tạo đề
    xuất" không còn bị khóa; xác nhận dropdown sửa tay hiện đủ nhân sự phòng ban (không chỉ người
    đã từng làm 5S trước đó); random nhiều lần → xác nhận người "đã từng dọn/chấm" có xu hướng
    được chọn nhiều hơn (không phải 100% luôn được chọn).

## Cập nhật (cùng ngày, tiếp) — Thêm thông báo Khiếu nại cho NGƯỜI CHẤM (trước đây chỉ admin/
lãnh đạo phòng ban có badge)

Người dùng phản hồi: tab "Khiếu nại" chỉ hiện số đếm (Bell + badge trên `KpiShell`) cho
admin/kpi.manage_config/lãnh đạo phòng ban (`getKpiAppealsPendingCount`, đếm mọi khiếu nại
`cho_xu_ly` toàn nhà máy) — người CHẤM (bước 2 của quy trình 3 bước, mục 4 ở trên) hoàn toàn
không có thông báo nào báo họ có khiếu nại đang chờ đề xuất sửa, phải tự nhớ vào kiểm tra.

- `module-tasks.ts`: thêm `getKpiAppealsPendingForScorer(factoryId, userId)` — đếm
  `kpi_appeals` (`trang_thai='cho_xu_ly'`) join `kpi_5s_evaluations!inner(nguoi_cham_id)` lọc
  đúng `nguoi_cham_id = userId` (RLS `kpi_appeals_select` đã cho phép người chấm đọc appeal của
  đúng lần chấm mình từ migration `20260819_kpi_5s_appeal_correction_workflow.sql`, và
  `kpi_5s_evaluations` SELECT vốn đã rộng trong factory nên embed filter không bị chặn). Thêm
  item mới `"Khiếu nại cần bạn đề xuất sửa"` (`role: "nhan"`, `tab: "appeals"`) — tự động cộng
  vào badge đỏ trên tab "Khiếu nại" (KpiShell) và hiện ở khối "Cần bạn LÀM" trên trang chủ
  `/dashboard/kpi`, độc lập với item `"Khiếu nại chờ xử lý"` (role `"giao"`, chỉ
  admin/kpi.manage_config).
- `appeals/page.tsx`: thêm luôn nút **"Đề xuất sửa kết quả"** trực tiếp trong danh sách (trước
  đây chỉ có ở trang chi tiết vị trí 5S, người chấm phải bấm thêm 1 lần qua link "Vị trí 5S:
  ..." mới tới được nút hành động) — hiện khi `a.trang_thai === "cho_xu_ly"` VÀ
  `locationRef.eval.nguoi_cham_id === user.id` (không phụ thuộc `canResolve`). Tách nút "Đã giải
  quyết"/"Từ chối" ra khỏi điều kiện `canResolve` chung ở div bọc ngoài — mỗi nút giờ tự gate
  riêng (Đã giải quyết + Từ chối vẫn `canResolve`-only, Đề xuất sửa kết quả chỉ theo đúng người
  chấm). Thêm `LocationEvalRef.nguoi_cham_id` (mở rộng SELECT `kpi_5s_evaluations`) + state/modal
  `proposeTarget`/`Kpi5sResultPicker` (tái dùng `proposeKpi5sAppealCorrection` đã có sẵn trong
  `kpi-appeals.ts`, mirror đúng modal ở `5s/location/[id]/page.tsx`). Cập nhật câu mô tả đầu
  trang cho người không phải admin: "...hoặc khiếu nại về lần chấm điểm bạn phụ trách (đề xuất
  sửa kết quả tại đây)".

`npx tsc --noEmit`, `npx eslint` (2 file: `module-tasks.ts`, `appeals/page.tsx`), và
`npm run build` đều sạch. Không cần migration mới (chỉ dùng RLS + bảng đã có từ migration
`20260819_kpi_5s_appeal_correction_workflow.sql`).

**Chưa test tay** — cần: người BỊ chấm nộp khiếu nại cho 1 lần chấm → đăng nhập đúng NGƯỜI CHẤM
của lần đó → xác nhận thấy badge đỏ trên tab "Khiếu nại" (cả `KpiShell` lẫn trang chủ
`/dashboard/kpi`, khối "Cần bạn LÀM") → vào `/dashboard/kpi/appeals` → xác nhận thấy nút "Đề
xuất sửa kết quả" NGAY trong danh sách (không cần bấm qua trang chi tiết vị trí) → gửi đề xuất →
xác nhận badge biến mất đúng (đổi sang `cho_duyet_sua`, không còn khớp điều kiện đếm nữa). Đăng
nhập 1 tài khoản KHÁC không phải người chấm của lần chấm đó → xác nhận KHÔNG thấy badge này (dù
có thể vẫn thấy dòng khiếu nại đó trong danh sách nếu họ là admin/lãnh đạo phòng ban, nhưng
không có badge "cần bạn đề xuất sửa").

## Cập nhật 2026-08-10 — Fix hạn chấm 5S "sinh non", thêm Việc định kỳ chu kỳ N ngày, gộp tín
hiệu 5 tab còn lại vào Bell (ĐÃ CODE XONG, CẦN CHẠY 2 MIGRATION MỚI, CHƯA TEST TAY)

Người dùng báo 2 vấn đề thật + 1 vấn đề UX sau khi dùng module 1 thời gian:

1. **Bug hạn chấm 5S "sinh non"**: nếu hôm nay Chủ nhật, cấu hình hạn chấm mới cho 1 vị trí là
   Thứ 7 (đã trôi qua trong TUẦN NÀY), app báo "Quá hạn" ngay lập tức dù chưa từng có cơ hội
   chấm đúng hạn — vì `computeKpi5sDeadline()` (`src/lib/kpi-5s.ts`) luôn tính occurrence theo
   TUẦN ISO HIỆN TẠI, không biết lịch này vừa mới được cấu hình.
2. **Thiếu cơ chế "N ngày một lần"**: "Việc định kỳ" (`kpi_task_templates`) chỉ hỗ trợ lặp theo
   tập hợp Thứ trong tuần (`apply_weekdays`) — không có cách nào diễn đạt "2 ngày 1 lần" (7 không
   chia hết cho nhiều số, weekday cố định không đại diện được chu kỳ lẻ).
3. **Tab-overload**: 6 tab, người dùng khó biết việc chuyên môn/5S cần làm/5S cần chấm ở đâu —
   Bell (`getKpiTasks()` trong `src/app/dashboard/_components/module-tasks.ts`) trước đây chỉ
   tổng hợp tín hiệu từ tab "Công việc chuyên môn" + chuyển giao, hoàn toàn thiếu 5S đến hạn,
   khiếu nại chờ xử lý, đăng ký thay thế chờ duyệt.

### 1. Fix hạn chấm 5S "sinh non"

- Migration `supabase/migrations/20260818_kpi_5s_deadline_effective_from.sql` (**cần chạy thủ
  công, CHƯA CHẠY**) — thêm `kpi_5s_locations.deadline_effective_from DATE`, do **trigger DB tự
  ghi** (`kpi_5s_locations_set_deadline_effective_from`, `BEFORE INSERT OR UPDATE`) mỗi khi
  `deadline_weekdays`/`deadline_time` THAY ĐỔI GIÁ TRỊ (không set lại khi sửa field khác như
  tên/mô tả/người dọn) — không phụ thuộc client nào ghi đúng. Backfill 1 lần cho dữ liệu cũ đã
  có sẵn deadline = `created_at::date` (coi như đã hiệu lực từ lâu).
- Hàm mới `computeKpi5sNextDeadline(location, nowISO?)` (`src/lib/kpi-5s.ts`) — mirror
  `computeKpi5sDeadline()` cho tuần hiện tại, nhưng tự **lùi sang tuần kế tiếp** nếu occurrence
  của tuần hiện tại rơi vào TRƯỚC `deadline_effective_from`. Đây là hàm NÊN DÙNG ở mọi nơi hiển
  thị badge/cảnh báo hạn — `computeKpi5sDeadline()` (1 tuần, không biết effective_from) chỉ còn
  là building block nội bộ, giữ nguyên chữ ký cũ (không phá vỡ call site nào khác).
- 2 call site đã đổi: `kpi/5s/page.tsx`, `kpi/5s/location/[id]/page.tsx` — cả 2 gọi
  `computeKpi5sNextDeadline(loc)` thay vì `computeKpi5sDeadline(loc, currentWeekStart)`.
  `hasEvaluatedThisWeek` (so với `currentWeekStart` thật) KHÔNG đổi — chỉ giá trị `deadline` dùng
  để tính overdue/dueSoon là được làm thông minh hơn.

### 2. Việc định kỳ theo chu kỳ N ngày

- Migration `supabase/migrations/20260818_kpi_task_templates_interval_cadence.sql` (**cần chạy
  thủ công, CHƯA CHẠY**) — thêm `kpi_task_templates.cadence_type TEXT NOT NULL DEFAULT
  'weekday'` (`'weekday'|'interval'`), `interval_days INTEGER`, `anchor_date DATE`, CHECK ràng
  buộc `cadence_type='interval'` bắt buộc có đủ `interval_days`+`anchor_date`.
  `CREATE OR REPLACE FUNCTION kpi_ensure_today_task_instances` — thân hàm giữ NGUYÊN VẸN mọi fix
  trước đó (skip-if-stuck từ `20260812`, lọc `trang_thai='da_duyet'` từ `20260807`, `module_code`
  từ `20260816`), chỉ mở rộng điều kiện chọn template đủ điều kiện sinh hôm nay:
  `(cadence_type='weekday' AND v_dow = ANY(apply_weekdays)) OR (cadence_type='interval' AND
  v_today >= anchor_date AND MOD((v_today - anchor_date), interval_days) = 0)`.
- `src/lib/kpi-templates.ts`: `KpiTaskCadenceType`, `KpiTaskTemplate`/`KpiTaskTemplateInput`
  thêm 3 field trên. Hàm nội bộ `buildTemplateCadencePayload()` validate đúng field bắt buộc theo
  từng kiểu lịch — khi `cadenceType='interval'`, luôn ghi `apply_weekdays=[1..7]` (cột NOT NULL,
  giá trị này KHÔNG được RPC đọc tới khi `cadence_type='interval'`, chỉ để thỏa constraint).
- `template-form-modal.tsx`: thêm toggle "Theo Thứ trong tuần" / "Theo chu kỳ N ngày" — nhánh
  interval hiện 2 input "Lặp lại mỗi (ngày)" + "Ngày bắt đầu chu kỳ" (mặc định hôm nay). Card
  danh sách (`kpi/templates/page.tsx`) hiện badge teal "Mỗi N ngày (từ dd/mm/yyyy)" thay vì dãy
  chip Thứ khi `cadence_type='interval'`.

### 3. Gộp tín hiệu 5 tab còn lại vào Bell

`getKpiTasks()` (`module-tasks.ts`) — vẫn 1 hàm duy nhất cho route `/dashboard/kpi/*`, thêm 2
helper mới cùng file:

- `getKpi5sDueCounts(factoryId, userId)` — lọc `kpi_5s_locations` đang áp dụng + có cấu hình hạn
  chấm mà user là người chấm HOẶC nằm trong đội ngũ dọn dẹp (dùng lại `getEffectiveCleanerIds`),
  tính overdue/dueSoon qua đúng `computeKpi5sNextDeadline`/`isKpi5sDeadlineOverdue`/`DueSoon` như
  trang 5S đang dùng — không viết logic tính hạn thứ 2.
- `getKpiAppealsPendingCount(factoryId)` — chỉ gọi khi `isAdmin || hasPermission(user,
  "kpi.manage_config")` (đúng phạm vi THỰC SỰ xử lý được, khác RLS `kpi_appeals_select` vốn còn
  cho chủ khiếu nại thấy CỦA CHÍNH HỌ dù họ không giải quyết được).
- Tái dùng `fetchPendingSubstitutionsForApprover(userId, factoryId)` có sẵn (từ Phase "Việc định
  kỳ") cho mục "Đăng ký thay thế chờ bạn duyệt".

4 item mới nối vào `items[]` của `getKpiTasks()`: "Vị trí 5S đã quá hạn", "Vị trí 5S sắp đến hạn
(24h)" (cả 2 link `/dashboard/kpi/5s`), "Đăng ký thay thế chờ bạn duyệt" (link
`/dashboard/kpi/templates`), "Khiếu nại chờ xử lý" (link `/dashboard/kpi/appeals`) — Bell UI
(`layout.tsx`) không cần sửa gì, danh sách item vốn đã render generic (`moduleTasks.items.map`).

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (toàn bộ file đã sửa), và `npm run build` đều sạch — build liệt
kê đủ mọi route KPI.

### Chưa test tay — cần làm ở phiên sau, BẮT BUỘC chạy 2 migration mới trước

1. Chạy `20260818_kpi_5s_deadline_effective_from.sql` rồi
   `20260818_kpi_task_templates_interval_cadence.sql` trên Supabase SQL Editor.
2. Đúng kịch bản gốc: hôm nay Chủ nhật (hoặc giả lập), cấu hình 1 vị trí 5S mới với hạn Thứ 7 →
   xác nhận KHÔNG báo "Quá hạn" ngay (badge chỉ xuất hiện khi thực sự qua mốc Thứ 7 TUẦN KẾ TIẾP
   nếu chưa chấm). Sửa lại hạn của 1 vị trí đã tồn tại lâu (đổi Thứ/giờ) → xác nhận
   `deadline_effective_from` cũng reset đúng theo trigger; sửa các field KHÔNG liên quan hạn (vd
   đổi tên/mô tả) → xác nhận `deadline_effective_from` KHÔNG bị reset.
3. Tạo 1 Việc định kỳ "Theo chu kỳ N ngày" (vd mỗi 2 ngày, bắt đầu hôm nay) → xác nhận hôm nay
   sinh việc, ngày mai KHÔNG sinh (vì việc hôm nay còn đang mở — đúng rule "skip nếu còn instance
   mở"), sau khi hoàn thành việc hôm nay + đợi đúng 2 ngày kể từ anchor_date → xác nhận sinh đúng
   nhịp độ (không lệch sang thứ khác trong tuần qua nhiều chu kỳ).
4. Xác nhận card "Việc định kỳ" hiện đúng badge "Mỗi N ngày (từ ...)" cho template interval, vẫn
   hiện dãy chip Thứ như cũ cho template weekday (regression check).
5. Test Bell: tạo 1 vị trí 5S quá hạn cho user A (A là người chấm hoặc trong đội dọn dẹp) → đăng
   nhập A, mở Bell ở bất kỳ trang nào dưới `/dashboard/kpi/*` → xác nhận mục "Vị trí 5S đã quá
   hạn" đúng số, bấm vào tới đúng `/dashboard/kpi/5s`. Tương tự cho "Đăng ký thay thế chờ bạn
   duyệt" (đăng nhập đúng người có quyền duyệt) và "Khiếu nại chờ xử lý" (chỉ admin/
   kpi.manage_config thấy số > 0, tài khoản khác thấy 0 dù có khiếu nại của chính họ đang chờ).

## Cập nhật 2026-08-19 — Redesign IA: trang chủ tổng hợp `/dashboard/kpi` + badge số trên tab
(ĐÃ CODE XONG, KHÔNG CẦN MIGRATION, CHƯA TEST TAY)

Người dùng phản ánh "quá nhiều tab, không biết việc chuyên môn/5S cần làm hay cần chấm nằm ở
đâu". Đã hỏi qua `AskUserQuestion` (3 câu, xác nhận cả 3 phương án khuyến nghị) trước khi code:
xây trang chủ tổng hợp **kèm** badge số trên tab, tách theo 2 vai trò LÀM/DUYỆT, badge là số đếm
cụ thể (không phải chấm tròn đơn thuần).

### 1. `getKpiTasks()` (`src/app/dashboard/_components/module-tasks.ts`) — gắn `role`/`tab` vào
từng item, tách đôi due-soon/overdue theo vai trò

- `ModuleTaskItem` thêm 2 field optional: `role?: "nhan" | "giao"`, `tab?: "tasks" | "5s" |
  "templates" | "appeals"` — **chỉ `getKpiTasks()` set 2 field này**, mọi `getXxxTasks()` khác
  (ISO/Văn bản/Xuất hàng/Kho vật tư/Chất lượng) không đụng tới, Bell/`TasksSummaryWidget` không
  đọc 2 field mới nên không bị ảnh hưởng gì (đã build sạch, không có regression).
- Trước đây "Việc sắp đến hạn (24h)"/"Việc đã quá hạn" gộp chung `iAmMember || iAmGiver` vào 1
  con số — không tách được "việc của tôi" khỏi "việc tôi giao đang trễ ở người khác". Đã tách
  vòng lặp thành 4 counter riêng: `dueSoonMineCount`/`overdueMineCount` (chỉ `iAmMember`) và
  `dueSoonGivenCount`/`overdueGivenCount` (chỉ `iAmGiver`) — Bell giờ hiện **11 item** thay vì 9
  (2 item cũ tách đôi thành 4), nhãn đổi rõ ràng hơn ("Việc của bạn sắp đến hạn" vs "Việc bạn
  giao sắp đến hạn") — cải thiện luôn độ rõ ràng của chính Bell, không chỉ phục vụ trang chủ mới.
- Mapping `role`: `nhan` = việc cần cập nhật/nộp, việc của bạn sắp/quá hạn, lời mời chuyển giao,
  2 mục 5S (đã quá hạn/sắp đến hạn). `giao` = việc chờ nghiệm thu, việc bạn giao sắp/quá hạn,
  đăng ký thay thế chờ duyệt, khiếu nại chờ xử lý.
- Mapping `tab`: mọi item gốc "Công việc chuyên môn" → `"tasks"`; 2 item 5S → `"5s"`; "Đăng ký
  thay thế" → `"templates"`; "Khiếu nại" → `"appeals"`. Tab "Chấm điểm chuyên môn" và "Bảng điểm
  KPI" **không có tín hiệu nào** trong `getKpiTasks()` hiện tại — 2 tab này không bao giờ hiện
  badge (không phải bug, chỉ đơn giản là chưa có khái niệm "việc chờ xử lý" ở 2 khu vực đó).

### 2. `KpiShell` (`src/app/dashboard/kpi/_components/kpi-shell.tsx`) — tự bootstrap + tự gọi
`getKpiTasks()` độc lập, không nhận props

- Quyết định kiến trúc: KpiShell được render ở **8 nơi** (6 trang danh sách + 2 trang chi tiết
  `tasks/[id]`, `5s/location/[id]`) — thay vì thread `user`/`factoryId` props qua cả 8 file (rủi
  ro cao, đụng nhiều trang đang chạy ổn định), Shell **tự fetch độc lập** (session qua
  `getActiveFactoryId()`+`hydrateActiveSession()`, rồi `getKpiTasks()`) — mirror đúng cách Bell ở
  `layout.tsx` đã làm từ trước (tự fetch theo `pathname`, không nhận state từ trang cha). Đánh
  đổi: có 1 lượt query nhẹ trùng lặp giữa Shell và trang con (mỗi trang vẫn tự bootstrap session
  riêng như cũ) — chấp nhận được, nhất quán với pattern hiện có của cả app (không nơi nào trong
  app dùng React Context để chia sẻ state giữa layout và children).
- Badge tính bằng cách gộp `summary.items` theo field `tab` (không suy luận qua label) —
  `badgeByTab: Partial<Record<"tasks"|"5s"|"templates"|"appeals", number>>`. Refetch mỗi lần đổi
  `pathname` trong module KPI (mirror đúng Bell) — hoàn thành 1 việc rồi chuyển tab thấy badge
  giảm ngay, không cần F5.
- Badge render dạng chấm tròn đỏ góc trên-phải mỗi tab (`absolute -top-1.5 -right-1.5`), số cụ
  thể (`99+` nếu vượt 99), chỉ hiện khi `count > 0`. Fail-silent hoàn toàn — lỗi/thiếu quyền
  `kpi.view`/thiếu migration chỉ khiến không có badge nào, không phá layout hay chặn nav.

### 3. `/dashboard/kpi/page.tsx` — từ redirect-stub thành trang chủ thật

- Bootstrap giống hệt 6 trang KPI khác (cached permission check → `getActiveFactoryId` →
  `hydrateActiveSession`). Gọi `getKpiTasks(factoryId, user)` (1 lần độc lập với Shell — xem lý
  do ở mục 2) + `resolveMyLeaderDepartmentId` (bỏ qua nếu đã `isAdmin`, tiết kiệm 1 round-trip).
- 2 khối:
  - **"Cần bạn LÀM"** (`role="nhan"`) — luôn hiện cho mọi `kpi.view` user.
  - **"Cần bạn DUYỆT / XỬ LÝ"** (`role="giao"`) — chỉ hiện khi `isAdmin || isDeptLeader ||
    hasPermission(user, "kpi.manage_config")` — tránh nhân viên thường thấy 1 khối toàn số 0.
- Mỗi khối chỉ liệt kê item có `count > 0` (khác Bell — Bell là dropdown tham chiếu nên hiện đủ
  cả 11 item kể cả 0 để giữ ngữ cảnh; trang chủ là landing chính, mục đích duy nhất là "việc cần
  chú ý ngay", liệt kê toàn số 0 sẽ gây rối mắt không cần thiết). Nếu TOÀN BỘ (cả 2 khối gộp lại)
  đều 0 → 1 banner ăn mừng duy nhất thay cho 2 card rỗng.
- Tô màu mỗi dòng theo mức khẩn cấp suy từ chính label (`toneOf()`, thuần cosmetic, chỉ dùng ở
  trang này): chứa "quá hạn" → đỏ; chứa "sắp đến hạn" → hổ phách; còn lại (chờ nghiệm thu/chờ
  duyệt/chờ xử lý) → tím — không thêm field mới vào `ModuleTaskItem` cho việc này vì chỉ 1 nơi
  dùng, không cần tái sử dụng.
- **Cố ý KHÔNG duplicate banner "Nhóm chính"** (đã có sẵn ở đầu `kpi/tasks/page.tsx` từ Fix 6) —
  giữ nguyên 1 chỗ duy nhất, tránh hiện trùng 2 lần khi người dùng bấm tiếp vào tab "Công việc".
- `kpi-shell.tsx`'s `tabs[]` không có mục "Trang chủ" (giữ nguyên từ trước) — trang chủ không
  active-highlight bất kỳ tab nào, đúng như hành vi cũ khi route này còn là redirect-stub.

### Đã xác nhận

`npx tsc --noEmit`, `npx eslint` (3 file: `module-tasks.ts`, `kpi-shell.tsx`, `kpi/page.tsx`), và
`npm run build` đều sạch — build liệt kê đúng `/dashboard/kpi` (static), không route KPI nào lỗi.
Không cần migration nào (không đổi schema, chỉ đổi tầng tính toán/hiển thị client-side).

### Chưa test tay — cần làm ở phiên sau

1. Đăng nhập 1 nhân viên thường (không phải admin/lãnh đạo phòng ban) đang có 1 việc chuyên môn
   sắp đến hạn + 1 vị trí 5S cần chấm tuần này → vào `/dashboard/kpi` → xác nhận chỉ thấy khối
   "Cần bạn LÀM" (không thấy khối "Cần bạn DUYỆT"), đúng 2 dòng liệt kê, bấm vào từng dòng dẫn
   đúng tới `/dashboard/kpi/tasks?tab=mine` và `/dashboard/kpi/5s`; đồng thời xác nhận 2 tab
   "Công việc" và "5S" trên thanh điều hướng có đúng số đỏ tương ứng.
2. Đăng nhập 1 lãnh đạo phòng ban đang có việc chờ nghiệm thu + 1 đăng ký thay thế chờ duyệt →
   xác nhận thấy đủ cả 2 khối, khối "Cần bạn DUYỆT" liệt kê đúng 2 dòng, tab "Công việc" và
   "Định kỳ" có badge đúng số.
3. Đăng nhập 1 tài khoản không có việc gì (mọi thứ đã xử lý xong) → xác nhận trang chủ hiện đúng
   banner ăn mừng duy nhất, không có card rỗng nào, mọi tab trên thanh điều hướng không có badge
   (hoặc badge = 0, ẩn hẳn).
4. Hoàn thành 1 việc (nộp/nghiệm thu) rồi bấm sang tab khác trong module KPI → quay lại tab "Công
   việc" hoặc trang chủ → xác nhận badge/số đếm giảm đúng ngay, không cần tải lại trang (F5).
5. Đối chiếu lại Bell (chuông thông báo góc trên) ở bất kỳ trang `/dashboard/kpi/*` nào — xác
   nhận giờ hiện đủ 11 mục (không còn 9), 2 mục cũ "Việc sắp đến hạn"/"Việc đã quá hạn" đã tách
   thành 4 mục rõ vai trò hơn; kiểm tra `TasksSummaryWidget` ở Dashboard chính (`/dashboard`)
   cũng phản ánh đúng danh sách 11 mục mới, không lỗi hiển thị do tăng số lượng item.
6. Test tài khoản `kpi.manage_config` nhưng KHÔNG phải admin/lãnh đạo phòng ban nào (nếu có cấu
   hình role này trong hệ thống) — xác nhận vẫn thấy khối "Cần bạn DUYỆT" (điều kiện OR đã cộng
   `hasPermission(user, "kpi.manage_config")`).

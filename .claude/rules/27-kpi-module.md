# Module Quản lý công việc & Đánh giá KPI nhân viên (`/dashboard/kpi`)

> **Dọn gọn 2026-08-22**: file này trước đây >5.500 dòng (chủ yếu là nhật ký chi tiết
> từng phiên code/fix/test). Toàn bộ nhật ký lịch sử đã chuyển sang
> `.claude/history/kpi-module-history.md` (không tự nạp vào ngữ cảnh mỗi phiên).
> File này chỉ giữ lại **quy tắc/trạng thái hiện hành** + 1 bảng tình trạng migration.
> Nếu cần biết lý do/diễn biến của một quyết định cụ thể (vd "vì sao ngưỡng người
> chính lại là CEIL(tổng×0.5)?"), tra trong file lịch sử — đừng đoán, đừng tự quyết
> định lại các quyết định đã chốt được liệt kê dưới đây.
>
> ⚠️ Các mục **Database Schema / RLS / UI** bên dưới là bản thiết kế BAN ĐẦU
> (Phase 0-1) và **không còn đầy đủ** — rất nhiều cột/bảng đã được bổ sung qua các
> migration liệt kê ở mục "Migration đã chạy" bên dưới. Coi các mục đó là khung sườn
> tham khảo, KHÔNG phải schema chính xác hiện tại — khi cần chắc chắn, đọc trực tiếp
> migration mới nhất liên quan hoặc kiểm tra schema thật trên Supabase.

## Phạm vi

Module giao việc (cá nhân/nhiều người, theo dõi tiến độ %, chuyển giao khi về tua),
đánh giá 5S theo khu vực bằng QR (người dọn/người chấm tách biệt), khung tiêu chí
KPI theo từng nhóm/vị trí chấm hàng ngày, và bảng tổng hợp điểm KPI hàng tháng. Mục
tiêu xuyên suốt: công bằng, minh bạch, hiện đại — có bằng chứng, có log bất biến,
có cơ chế khiếu nại.

Route: `/dashboard/kpi`. Permissions: `kpi.view`, `kpi.assign`, `kpi.evaluate`,
`kpi.view_all`, `kpi.manage_config`.

6 tab hiện có trong `KpiShell`: **Công việc chuyên môn**, **Việc định kỳ**, **Đánh
giá 5S**, **Chấm điểm chuyên môn**, **Khiếu nại**, **Bảng điểm KPI**. Trang chủ
`/dashboard/kpi` (từ 2026-08-19) là 1 dashboard tổng hợp "Cần bạn LÀM" / "Cần bạn
DUYỆT" gộp tín hiệu từ cả 6 tab, không còn là redirect-stub.

## Quyết định thiết kế then chốt

### "Nhóm nhân sự" TÁI DÙNG `personnel_groups`, không có bảng riêng

Không có bảng `kpi_groups`/`kpi_group_members` — mọi "nhóm chuyên môn" trong module
này chính là `personnel_groups`/`personnel_group_members` đã có sẵn tại **Cài đặt →
Hệ thống → Nhân sự**. Chỉ ALTER thêm 1 cột:

```sql
personnel_group_members.is_primary BOOLEAN NOT NULL DEFAULT false
-- UNIQUE INDEX ... ON personnel_group_members(staff_id) WHERE is_primary
```

Form Nhân sự (`settings/page.tsx`) có dropdown **"Nhóm chính"** ngay dưới checklist
tick nhóm, chỉ liệt kê các nhóm đã tick.

**Lưu ý phân biệt 2 khái niệm "khu vực/nhóm" khác nhau trong module này — không được
lẫn lộn**:
- `personnel_groups` = **nhóm CHUYÊN MÔN** (dùng cho điểm D — Chấm điểm chuyên môn
  theo ngày). 1 người có thể thuộc nhóm chuyên môn "KT Lương" nhưng phụ trách khu
  vực 5S "VP Kế Toán" — không liên kết 2 khái niệm này.
- `kpi_5s_zones` = **"Khu vực" 5S** (tầng lớn, vd Văn phòng/Kho 1/Kho 2 — chỉ dùng để
  giới hạn pool ứng viên khi "Phân công thông minh" random). Hoàn toàn độc lập với
  `personnel_groups`, xem mục Database Schema.

### `is_primary` KHÔNG loại trừ các nhóm khác khỏi tính điểm

Nhà máy có nhân sự đi tua (về nhà theo lịch tự đăng ký), người ở lại phải đảm nhận
đầy đủ nhiều nhóm cùng lúc — **mọi nhóm đã tick đều tính điểm chuyên môn đầy đủ**,
chỉ khác hệ số:

- Nhóm `is_primary = true` ("nhóm chính") → hệ số **×10**.
- Các nhóm khác đã tick ("nhóm choàng") → hệ số **×5 MỖI nhóm** (không giới hạn số
  lượng nhóm choàng được chấm cùng ngày).

### Không có module lịch nghỉ/tua cá nhân — đã chốt, không tự ý thêm lại

Lịch tua tự đăng ký, không cố định theo chu kỳ — **không** xây hệ thống lịch nghỉ/tua,
**không** nhắc nhở tự động trước khi về tua. Nhân viên tự chịu trách nhiệm chủ động
bấm "Chuyển giao" trước khi đi.

### Nhưng công việc CÓ deadline thì có lịch xem theo tháng + nút nhắc nhở thủ công

Khác hẳn mục trên — đây là về `kpi_tasks` (giao việc có hạn), không phải lịch tua:

- Tab "Công việc" có view dạng lịch tháng (mỗi ngày hiện task có `han_hoan_thanh` rơi
  vào ngày đó, màu theo `trang_thai`) — bổ sung cho danh sách "Việc của tôi"/"Tất cả
  công việc", không thay thế.
- **Nhắc nhở deadline là THỦ CÔNG, không có cron/tự động** (đã chốt — repo không có
  hạ tầng lịch chạy nền): nút "Nhắc nhở" ở trang chi tiết công việc và trang chi tiết
  vị trí 5S, chỉ người giao/admin thấy, bấm gửi ngay 1 tin Telegram qua
  `sendKpiNotify()`. Tự khoá 45 giây sau khi bấm (chỉ chống double-click, không phải
  chống spam thật).

### Việc đột xuất 5S (kèm ảnh "before") dùng lại nguyên hệ thống Công việc

Không có bảng/luồng riêng — `kpi_tasks` có thêm 2 cột tuỳ chọn `kpi_5s_location_id`
(liên kết 1 Vị trí 5S) và `before_image_urls` (ảnh hiện trạng lúc giao việc). Hoàn
toàn tách biệt với chấm điểm 5S định kỳ hàng tuần (`kpi_5s_evaluations`), không ảnh
hưởng công thức điểm C.

## Công thức tính điểm

```
KPI tháng = (A%×Hoàn thành + B%×Đúng hạn + C%×5S + D%×Chuyên môn) × Hệ số chuyên cần
```

A/B/C/D% cấu hình ở Settings (`kpi_score_weights`), mặc định **30/25/20/25**, tổng
phải = 100 (validate tầng app). Hệ số chuyên cần nhân lên TOÀN BỘ điểm tổng.

**Renormalize khi thiếu dữ liệu (chốt cuối 2026-08-25, migration `20260825`)** — đã
thay thế hoàn toàn ý tưởng ban đầu "mặc định 100 cho thành phần thiếu dữ liệu":

- Thiếu dữ liệu ở CẢ 4 thành phần A,B,C,D trong tháng đó → **không tạo dòng điểm nào**
  cho user đó tháng đó (không hiện ở bảng "Toàn nhà máy"/bảng xếp hạng).
- Thiếu MỘT SỐ thành phần (vd chỉ có A,B, không có C,D) → **renormalize trọng số chỉ
  trên các thành phần CÓ dữ liệu** — vd `diem_tong = (wA×A + wB×B)/(wA+wB) × hệ_số_chuyên_cần`.
  Tuyệt đối không mặc định thành phần thiếu = 100 rồi cộng vào.
- Migration `20260827` bổ sung: RPC tự xoá các dòng điểm "mồ côi" (dòng cũ từ lần
  tính trước, nay user không còn dữ liệu gì) mỗi lần chạy "Tính điểm tháng" — chỉ
  với dòng `trang_thai <> 'da_khoa'`.

### Ví dụ đối chiếu công thức gốc (đủ cả 4 thành phần — không renormalize)

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
  - Không có giao việc nào trong tháng: không tính A (renormalize theo B/C/D còn lại,
    xem mục renormalize ở trên — KHÔNG mặc định 100)
```

### B — Điểm đúng hạn

```
B = (Số việc nộp đúng/trước hạn ÷ Số việc ĐÃ ĐẾN HẠN trong tháng) × 100
  - Chỉ tính việc đã đến deadline (chưa đến hạn thì bỏ hẳn khỏi tử số lẫn mẫu số)
  - Việc đã chuyển: tính cho người phụ trách hiện tại
  - "Nộp" = mốc lần đầu nhân viên bấm "Nộp" (không phải lúc quản lý chốt nghiệm thu)
```

Bấm "Nộp" khi thiếu bằng chứng theo `yeu_cau_bao_cao` của task sẽ bị **chặn cứng cả
2 tầng** (client + RPC `kpi_task_member_update`, migration `20260826`) — "Cập nhật
tiến độ" (không phải Nộp) vẫn cho lưu dù thiếu bằng chứng.

### C — Điểm 5S

```
C (tháng) = Trung bình các lần chấm vị trí mà NGƯỜI ĐÓ chịu trách nhiệm
            (nguoi_don_id SNAPSHOT của đúng tuần đó), chia cho SỐ LẦN người đó
            thực sự chịu trách nhiệm trong tháng — KHÔNG chia cho tổng số tuần.

3 mức kết quả: Đạt=100, Tương đối=50, Không đạt=0 (thêm mức "Tương đối" 2026-07-25).

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

"Ngày có mặt/có chấm" = ngày có ít nhất 1 bản chấm **việc chính**.

### Hệ số chuyên cần

```
Hệ số chuyên cần = CLAMP(Số ngày có chấm D trong tháng ÷ Ngày chuẩn, 0.75, 1.10)
```

`Ngày chuẩn` mặc định 24 (cấu hình Settings). Sàn 0.75, trần 1.10.

## Database Schema (khung sườn Phase 0 — xem cảnh báo đầu file)

Tất cả bảng có `factory_id`.

```sql
-- Nhóm & Chuyên môn (D)
kpi_criteria_templates ( id, factory_id, group_id → personnel_groups, ten_tieu_chi,
  mo_ta, sort_order, is_active, created_at, updated_at )

kpi_daily_evaluations (   -- 1 dòng = 1 lượt chấm 1 nhóm, 1 người, 1 ngày
  id, factory_id, user_id, ngay DATE, group_id → personnel_groups,
  loai TEXT CHECK (loai IN ('chinh','choang')),   -- snapshot is_primary TẠI THỜI ĐIỂM CHẤM
  nguoi_cham_id, ghi_chu, created_at, updated_at,
  UNIQUE(factory_id, user_id, ngay, group_id)
)
kpi_daily_evaluation_items ( id, evaluation_id → kpi_daily_evaluations ON DELETE CASCADE,
  criteria_id → kpi_criteria_templates,
  ket_qua TEXT CHECK (ket_qua IN ('dat','tuong_doi','chua_dat')),
  created_at, UNIQUE(evaluation_id, criteria_id) )

-- Giao việc (A + B)
kpi_tasks ( id, factory_id, ma_cong_viec,   -- CV-ddmmyy/XXX
  tieu_de, mo_ta, nguoi_giao_id, ngay_giao, han_hoan_thanh,
  yeu_cau_bao_cao TEXT[],   -- 'anh'|'file'|'dinh_vi'|'van_ban'
  da_chuyen_giao BOOLEAN,   -- chặn chuyển tiếp lần 2
  trang_thai CHECK IN ('moi_giao','dang_thuc_hien','cho_nghiem_thu','hoan_thanh','tra_ve','huy'),
  muc_tieu_so_luong INTEGER NULL,       -- (migration 20260725) mục tiêu chung nhiều người
  module_code TEXT NULL,                -- (20260816/20260817) 9 giá trị: dispatch/output/
                                         -- quality/storage/product/process/maintenance/export/inventory
  template_id UUID NULL,                -- (20260728) nếu sinh từ Việc định kỳ
  kpi_5s_location_id UUID NULL,         -- (20260817) nếu là "Việc đột xuất 5S"
  before_image_urls TEXT[] NULL,        -- (20260817) ảnh "before" của việc đột xuất 5S
  phong_ban_id UUID NULL,               -- (20260807) phòng ban chịu trách nhiệm
  created_at, updated_at )

kpi_task_members ( id, task_id → kpi_tasks ON DELETE CASCADE, user_id,
  tien_do INTEGER, tien_do_nghiem_thu INTEGER NULL, da_nop_luc TIMESTAMPTZ NULL,
  phan_loai TEXT NULL,   -- 'chinh'|'choang', chỉ set khi task có muc_tieu_so_luong
  is_active BOOLEAN,     -- false nếu đã chuyển giao thành công
  UNIQUE(task_id, user_id) )

kpi_task_logs (   -- audit trail BẤT BIẾN — insert-only
  id, task_id → kpi_tasks ON DELETE CASCADE, member_user_id, nguoi_thuc_hien_id,
  hanh_dong CHECK IN ('cap_nhat_tien_do','nop','nghiem_thu','dieu_chinh','tra_ve',
    'yeu_cau_bo_sung','gan_ban_ghi','chuyen_giao','gia_han'),
  tien_do_truoc, tien_do_sau, noi_dung, image_urls, file_urls,
  vi_do, kinh_do, dia_diem_text, created_at )

kpi_task_evidence_links (   -- (migration 20260725) "Gắn bản ghi tại chỗ"
  id, factory_id, task_id, member_user_id, module_code, record_id, record_label,
  record_url, created_at, UNIQUE(task_id, module_code, record_id) )

kpi_task_transfers ( id, factory_id, task_id, tu_nguoi_id, den_nguoi_id,
  tien_do_luc_chuyen, ghi_chu,
  trang_thai CHECK IN ('cho_duyet','da_nhan','tu_choi'), ngay_chuyen, phan_hoi_luc )

kpi_task_templates (   -- (migration 20260728) "Việc định kỳ" — KHÔNG có trong Phase 0
  id, factory_id, group_id → personnel_groups, assigned_user_id, tieu_de, mo_ta,
  apply_weekdays INTEGER[],             -- 1=Thứ2..7=CN
  gio_han TIME, is_active, created_by,
  module_code TEXT NULL,                -- (20260816/17)
  cadence_type TEXT DEFAULT 'weekday',  -- 'weekday'|'interval'|'day_of_month' (20260818/19)
  interval_days INTEGER NULL, anchor_date DATE NULL,   -- khi cadence_type='interval'
  days_of_month INTEGER[] NULL,                        -- khi cadence_type='day_of_month'
  muc_tieu_so_luong INTEGER NULL,       -- (20260819) mirror kpi_tasks
  kpi_5s_location_id UUID NULL,         -- (20260821) tạo trực tiếp từ trang Vị trí 5S
  phong_ban_id UUID NULL )              -- (20260807)

kpi_user_substitutions (   -- (migration 20260728, mở rộng 20260807) "Người thay thế tạm thời"
  id, factory_id, original_user_id, substitute_user_id,
  template_id NULL,   -- NULL = áp dụng mọi việc định kỳ của người đó
  tu_ngay, den_ngay, ly_do, created_by,
  trang_thai TEXT DEFAULT 'cho_duyet' CHECK IN ('cho_duyet','da_duyet','tu_choi'),  -- (20260807)
  nguoi_duyet_id, duyet_luc, ly_do_tu_choi )
-- RPC "sinh lười" kpi_ensure_today_task_instances chỉ tôn trọng substitution 'da_duyet',
-- chỉ sinh instance mới cho template không còn kpi_tasks nào đang mở (chặn "mắc kẹt").

-- 5S — mô hình 2 TẦNG (đổi tên 2026-08-05, xem lịch sử để biết lý do)
kpi_5s_locations (   -- Tầng 1, NHỎ — đơn vị QR chấm điểm hàng tuần (vd PGĐ, PH01)
  id, factory_id, ma_vi_tri, ten_vi_tri, mo_ta,
  nguoi_don_id UUID NULL,   -- người chịu trách nhiệm HIỆN TẠI (standing)
  nguoi_cham_id UUID NULL,  -- người chấm HIỆN TẠI (standing)
  zone_id UUID NULL → kpi_5s_zones,   -- Khu vực (tầng 2) chứa vị trí này
  phong_ban_id UUID NULL,             -- (20260807)
  assigned_by, assigned_at,           -- (20260807) người/lúc gán gần nhất
  deadline_weekdays INTEGER[] NULL, deadline_time TIME NULL,   -- (20260815) hạn chấm hàng tuần
  deadline_effective_from DATE NULL,  -- (20260818) tránh "sinh non" khi vừa đổi hạn
  is_active, sort_order,
  CHECK (nguoi_don_id IS NULL OR nguoi_cham_id IS NULL OR nguoi_don_id <> nguoi_cham_id) )

kpi_5s_location_cleaners ( id, factory_id, location_id → kpi_5s_locations, user_id,
  UNIQUE(location_id, user_id) )   -- (20260806) đội ngũ dọn dẹp NHIỀU người/vị trí

kpi_5s_evaluations ( id, factory_id, location_id → kpi_5s_locations, tuan_bat_dau DATE,
  nguoi_don_id UUID,    -- SNAPSHOT người chịu trách nhiệm ĐÚNG TUẦN ĐÓ
  nguoi_cham_id UUID,
  ket_qua TEXT CHECK IN ('dat','tuong_doi','khong_dat'),   -- 3 mức
  ly_do,   -- bắt buộc khi khác 'dat'
  image_urls,   -- (20260806) BẮT BUỘC ≥1 ảnh
  danh_gia_luc, UNIQUE(location_id, tuan_bat_dau) )
-- Trigger chặn chấm sớm hơn 48h trước hạn (migration 20260819, admin bypass).

kpi_5s_zones (   -- Tầng 2, LỚN (vd Văn phòng, Kho 1, Kho 2) — chỉ để giới hạn pool
                  -- random của "Phân công thông minh", KHÔNG liên quan personnel_groups
  id, factory_id, ten, is_active, sort_order, UNIQUE(factory_id, lower(ten)) )
kpi_5s_zone_members ( id, factory_id, zone_id → kpi_5s_zones ON DELETE CASCADE, user_id,
  UNIQUE(zone_id, user_id) )

-- Trọng số & bảng điểm tháng
kpi_score_weights ( id, factory_id, group_id NULL → personnel_groups,   -- NULL = mặc định
  trong_so_hoan_thanh DEFAULT 30, trong_so_dung_han DEFAULT 25,
  trong_so_5s DEFAULT 20, trong_so_chuyen_mon DEFAULT 25,
  ngay_chuan_chuyen_can DEFAULT 24, he_so_chuyen_can_min DEFAULT 0.75,
  he_so_chuyen_can_max DEFAULT 1.10, UNIQUE(factory_id, group_id) )
-- + UNIQUE INDEX riêng ON kpi_score_weights(factory_id) WHERE group_id IS NULL

kpi_monthly_scores ( id, factory_id, user_id, nam, thang,
  diem_hoan_thanh, diem_dung_han, diem_5s, diem_chuyen_mon,   -- NULL hợp lệ nếu thiếu dữ liệu
  he_so_chuyen_can, so_ngay_co_cham, diem_tong, chi_tiet JSONB,
  trang_thai DEFAULT 'nhap' CHECK IN ('nhap','da_khoa'),   -- chỉ có KHÓA, không có "mở khóa"
  khoa_boi, khoa_luc, UNIQUE(factory_id, user_id, nam, thang) )

kpi_score_adjustments ( id, factory_id, monthly_score_id → kpi_monthly_scores,
  ly_do NOT NULL, diem_truoc, diem_sau, nguoi_dieu_chinh_id, created_at )
-- Audit bất biến — chỉ ghi được qua RPC kpi_monthly_score_adjust (điểm phải đã khóa sổ)

kpi_appeals ( id, factory_id, monthly_score_id NULL, task_id NULL, location_evaluation_id NULL,
  nguoi_khieu_nai_id, noi_dung NOT NULL,
  trang_thai DEFAULT 'cho_xu_ly' CHECK IN ('cho_xu_ly','cho_duyet_sua','da_giai_quyet','tu_choi'),
  proposed_ket_qua, proposed_ly_do, proposed_by, proposed_at,   -- (20260819) quy trình 3 bước 5S
  phan_hoi, nguoi_xu_ly_id )
```

## RLS (điểm cần nhớ)

- `kpi_tasks` ↔ `kpi_task_members` ↔ `kpi_task_evidence_links`: chéo RLS, phải dùng
  hàm `SECURITY DEFINER` (`kpi_is_task_owner`, `kpi_is_task_active_member`...) để
  tránh "infinite recursion" — mirror `operation_notes`/`operation_note_shares`
  (`.claude/rules/26-operation-notes-module.md`).
- `kpi_5s_evaluations` INSERT: chỉ đúng người đang là `nguoi_cham_id` của vị trí đó,
  **không có ngoại lệ admin**.
- `kpi_monthly_scores`: `user_id = auth.uid() OR admin OR
  current_profile_has_permission('kpi.view_all')`.
- Lãnh đạo phòng ban (chức vụ đúng 1 trong 6 chức danh chuẩn qua
  `kpi_is_department_leader`, tra `maintenance_staff.chuc_vu`/`chuc_vu_chinh_quyen`,
  EXACT MATCH không phải substring) tự quản lý được `kpi_5s_locations`/
  `kpi_5s_zones`/`kpi_task_templates`/duyệt `kpi_user_substitutions` đúng
  `phong_ban_id` của họ, không cần `kpi.manage_config`. Bảng
  `kpi_department_managers` (cấu hình tay GĐ/PGĐ) đã bị **loại bỏ khỏi RLS/UI**
  (không xoá DB) — thay bằng cơ chế tự phát hiện lãnh đạo này.
- `kpi_task_logs`/`kpi_task_transfers`: đọc giới hạn theo người liên quan (thành
  viên, người giao, `tu_nguoi_id`/`den_nguoi_id`) hoặc `kpi.evaluate`/
  `kpi.view_all`/admin.

## UI

### Cài đặt → KPI & 5S

4 sub-tab: **Vị trí 5S** (CRUD `kpi_5s_locations`, multi-select "Người dọn hiện tại"
ngay trong form, nút "Phân công thông minh" + "In QR hàng loạt" + hạn chấm điểm hàng
tuần) · **Khu vực** (CRUD `kpi_5s_zones` + quản lý thành viên) · **Khung tiêu chí
KPI** (CRUD `kpi_criteria_templates` theo nhóm chuyên môn) · **Trọng số công thức**
(CRUD `kpi_score_weights`, mặc định toàn nhà máy + cấu hình riêng theo nhóm).

Lãnh đạo phòng ban (không cần `kpi.manage_config`) vào được tab này, chỉ thao tác
được đúng phạm vi phòng ban của mình.

### 6 tab module `/dashboard/kpi`

1. **Trang chủ** (`/dashboard/kpi`) — dashboard tổng hợp "Cần bạn LÀM" (mọi
   `kpi.view` user) / "Cần bạn DUYỆT — XỬ LÝ" (chỉ admin/lãnh đạo phòng ban/
   `kpi.manage_config`), mỗi dòng link thẳng tới đúng danh sách đã lọc sẵn
   (`?highlight=...`), không rơi về view chung chung.
2. **Công việc chuyên môn** — "Việc hôm nay" (mặc định) / "Việc của tôi" / "Tất cả
   công việc" / "Lịch sử" (hoàn thành+hủy) + view Lịch tháng; chi tiết task có
   timeline log bất biến, nút Cập nhật tiến độ/Nộp/Chuyển giao/Nghiệm thu/Điều
   chỉnh/Trả về/Yêu cầu bổ sung/Gia hạn/Khiếu nại/Nhắc nhở theo vai trò. Badge
   "Được giao cho bạn"/"Bạn là người giao" + hạn dạng "Quá hạn N ngày".
3. **Việc định kỳ** (`/dashboard/kpi/templates`) — CRUD `kpi_task_templates` (mọi
   `kpi.view` user xem được, chỉ admin/`kpi.manage_config`/lãnh đạo phòng ban thao
   tác) + sub-tab "Người thay thế tạm thời" (mọi người tự đăng ký được cho chính
   mình, cần duyệt) + nút "Sinh việc hôm nay ngay".
4. **Đánh giá 5S** (`/dashboard/kpi/5s`) — "Việc hôm nay" / danh sách / "Lịch sử".
   Mỗi vị trí có URL cố định `/dashboard/kpi/5s/location/{id}` (QR encode thẳng URL
   này, bắt buộc đăng nhập). Nút "Chấm điểm tuần này" chỉ hiện cho đúng
   `nguoi_cham_id`, chặn cứng nếu sớm hơn 48h trước hạn (trigger DB, admin bypass).
   Nút "Phân công thông minh" (bulk hoặc từng vị trí riêng).
5. **Chấm điểm chuyên môn** (`/dashboard/kpi/evaluate`) — nhập theo ngày, lọc 2
   chiều Nhóm ↔ Người, gộp nhiều lần chấm/ngày (UPSERT), hỗ trợ nhiều nhóm choàng.
6. **Khiếu nại** (`/dashboard/kpi/appeals`) — khiếu nại 3 loại (task/5S/điểm tháng),
   quy trình 5S riêng 3 bước (người bị chấm khiếu nại → người chấm đề xuất sửa →
   lãnh đạo phòng ban/admin duyệt) khác với sửa trực tiếp của admin.
7. **Bảng điểm KPI** (`/dashboard/kpi/scores`) — "Điểm của bạn" + "Toàn nhà máy"
   (lọc theo phòng ban) + "Chi tiết cách tính điểm" (breakdown A/B/C/D real-time,
   admin/lãnh đạo xem được của người khác) + "Bảng xếp hạng" ẩn danh (theo nhóm/
   phòng ban, chỉ trả rank+điểm+is_me). Nút "Tính điểm tháng"/"Khóa sổ" chỉ
   admin/`kpi.manage_config`.

## Migration đã chạy / chưa chạy (cập nhật lần cuối 2026-08-22)

Toàn bộ migration từ `20260607_create_personnel_groups.sql` đến
`20260821_kpi_task_templates_5s_location.sql` (36 file, xem danh sách đầy đủ trong
`supabase/migrations/`) **đã chạy và đã qua 1 vòng test trên localhost** (người dùng
xác nhận "đạt" ở mức tổng quát — không chắc đã test hết từng mục checklist chi tiết
của mọi migration, tra `.claude/history/kpi-module-history.md` nếu cần đối chiếu
từng mục cụ thể).

**3 migration SAU CÙNG — CHƯA XÁC NHẬN ĐÃ CHẠY, cần chạy theo đúng thứ tự này trước
khi tin tưởng các tính năng liên quan**:

1. `20260825_kpi_score_renormalize.sql` — công thức renormalize (xem mục "Công thức
   tính điểm" ở trên). Chưa chạy → RPC `kpi_compute_monthly_scores` vẫn dùng công
   thức CŨ (mặc định 100 cho thành phần thiếu dữ liệu, ra điểm sai/ảo).
2. `20260826_kpi_task_evidence_required_on_submit.sql` — chặn cứng "Nộp" khi thiếu
   bằng chứng theo `yeu_cau_bao_cao`. Chưa chạy → RPC không chặn (chỉ UI chặn được).
3. `20260827_kpi_score_cleanup_stale_rows.sql` — tự xoá dòng điểm "mồ côi". Phải
   chạy SAU 2 file trên.

## Rủi ro/quy tắc bắt buộc

- **"Nhóm chính" KHÔNG loại trừ nhóm khác khỏi tính điểm** — chỉ khác hệ số (chính
  ×10, choàng ×5 mỗi nhóm). Đây là lỗi thiết kế v1 đã bị phát hiện và sửa.
- **Điểm chuyên môn chuẩn hóa theo max của ĐÚNG ngày đó** (10 + 5×số choàng ngày
  đó), tuyệt đối không chia cố định 1 hằng số.
- **Renormalize khi thiếu dữ liệu điểm tháng** (xem "Công thức tính điểm") — tuyệt
  đối không mặc định thành phần thiếu = 100.
- Engine tính điểm tháng là 1 RPC/transaction dùng `GROUP BY`, không loop-per-user.
- `kpi_score_weights` cần partial unique index cho dòng mặc định (`group_id IS NULL`).
- Không có module lịch nghỉ/tua cá nhân, không nhắc nhở tự động theo lịch — chỉ có
  nút nhắc nhở THỦ CÔNG qua Telegram. Không tự ý thêm cron/tự động.
- Mọi query bảng lớn (log, chấm ngày, 5S) phải phân trang `.range()` nếu có khả
  năng vượt 1000 dòng (`.claude/rules/04-code-patterns.md`).
- **Không được quay lại ý tưởng "code tự dò hành động nghiệp vụ để tự đóng việc
  ngầm"** (auto-detect/auto-complete không cần xác nhận người dùng) — đã bị loại bỏ
  hoàn toàn, thay bằng "Gắn bản ghi tại chỗ" (`kpi_task_evidence_links`): người dùng
  LUÔN phải tự xác nhận bằng 1 cú click, lọc đúng theo `module_code` của task (banner
  chỉ gợi ý việc cùng module với bản ghi vừa lưu, không gợi ý toàn bộ việc đang mở).
- Việc mục tiêu số lượng chung (`muc_tieu_so_luong`, nhiều người cùng làm 1 việc):
  điểm A của người "chính" (`phan_loai='chinh'`) tính theo ĐÓNG GÓP THẬT của chính
  họ so với ngưỡng `CEIL(muc_tieu_so_luong × 0.5)` — KHÔNG tự động = 100% chỉ vì việc
  chung đã hoàn thành nhờ người "choàng" bù. Người "choàng" luôn = 100% khi việc
  chung xong. Nghiệm thu/Điều chỉnh tay bị CHẶN CỨNG cho loại việc này — điểm chỉ
  tính qua "Gắn bản ghi tại chỗ".
- 3 khái niệm dễ nhầm, không được gộp: `personnel_groups` (nhóm chuyên môn, điểm D)
  ≠ `kpi_5s_zones` (Khu vực 5S tầng lớn, chỉ giới hạn pool random) ≠ `kpi_5s_locations`
  (Vị trí 5S tầng nhỏ, đơn vị QR chấm điểm hàng tuần).

## Lịch sử phát triển chi tiết

Toàn bộ diễn biến từng phase (bug đã fix, quyết định thiết kế, checklist "chưa test
tay" nguyên văn theo từng phiên) nằm ở `.claude/history/kpi-module-history.md`. Tra
file đó khi cần biết **vì sao** một quyết định được chốt như hiện tại, hoặc cần đối
chiếu lại đúng nguyên văn 1 bug đã từng gặp.

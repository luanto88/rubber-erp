-- Module Chấm công — GĐ C2 "Điểm danh ca" (2026-11-20). Kế hoạch: .claude/plans/cham-cong-2026-11-19.md mục 10.
--
-- 1. attendance_qr_points: mã QR dán tại ca (token cố định, có thể thu hồi / tạo lại).
-- 2. attendance_daily_sheets: 1 phiếu / ngày / dây chuyền (F01 Mủ tạp, F02 Mủ nước) — trạng thái SUY từ các phần.
-- 3. attendance_sheet_sections: phần của phiếu (Tổ tiếp nhận / Cơ điện / Nâng hàng = 1 phần / ngày, ca NULL;
--    Ca sản xuất = 1 phần / ca). Gửi / duyệt / trả về THEO TỪNG PHẦN.
-- 4. attendance_sheet_lines: dòng điểm danh (công việc, xe, A/B, có / vắng, lý do, người thay, ghi chú).
-- 5. attendance_records.sheet_line_id: ngày công đã duyệt từ phiếu ⇒ KHOÁ: chấm tay / xoá chấm không đổi được
--    (chỉ admin, có lý do). attendance_logs thêm hanh_dong 'duyet_phieu'.
-- 6. RPC: resolve QR, mở phần, lưu phần, gửi phần, duyệt / trả về, thêm nhanh công nhân. Thông báo chuông.
-- Chạy TAY trên Supabase SQL Editor SAU 20261204, TRƯỚC deploy. Idempotent.
-- Về sau mọi CREATE OR REPLACE attendance_set_days / attendance_clear_days PHẢI chép từ file này.

-- ── 0. Hàm quyền ──────────────────────────────────────────────────────────────
-- Quyền của 1 user BẤT KỲ (không phải người đang đăng nhập) — mirror current_profile_has_permission.
create or replace function public.attendance_user_has_permission(p_uid uuid, p_code text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_uid and status = 'active';
  if v_role is null then return false; end if;
  if v_role = 'admin' then return true; end if;
  if exists (select 1 from public.user_permissions where user_id = p_uid and granted = true) then
    return exists (select 1 from public.user_permissions where user_id = p_uid and granted = true and permission_code = p_code);
  end if;
  return exists (select 1 from public.role_permissions where role = v_role and permission_code = p_code);
end $$;

-- Được mở / điểm danh phiếu ca (trực ca hoặc người chấm công).
create or replace function public.attendance_can_shift()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.shift_check')
      or public.current_profile_has_permission('attendance.mark')
      or public.current_profile_has_permission('attendance.mark_all');
$$;

-- Sửa được MỌI phần (không chỉ phần mình lập), chọn ca tay không cảnh báo.
create or replace function public.attendance_can_edit_any_section()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.mark')
      or public.current_profile_has_permission('attendance.mark_all');
$$;

create or replace function public.attendance_can_review()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.approve')
      or public.current_profile_has_permission('attendance.mark_all');
$$;

create or replace function public.attendance_new_qr_token()
returns text language sql volatile set search_path = public, extensions as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;

-- ── 1. Điểm QR ────────────────────────────────────────────────────────────────
create table if not exists public.attendance_qr_points (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  token text not null default public.attendance_new_qr_token() check (token ~ '^[A-Za-z0-9_-]{22}$'),
  ten_diem text not null check (length(btrim(ten_diem)) > 0),
  day_chuyen_mac_dinh text check (day_chuyen_mac_dinh in ('Mủ tạp', 'Mủ nước')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_attendance_qr_points_token on public.attendance_qr_points (token);
create index if not exists idx_attendance_qr_points_factory on public.attendance_qr_points (factory_id, sort_order);
drop trigger if exists trg_attendance_qr_points_updated_at on public.attendance_qr_points;
create trigger trg_attendance_qr_points_updated_at before update on public.attendance_qr_points
  for each row execute function public.set_updated_at();

alter table public.attendance_qr_points enable row level security;
drop policy if exists attendance_qr_points_select on public.attendance_qr_points;
create policy attendance_qr_points_select on public.attendance_qr_points for select to authenticated
  using (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_qr_points_insert on public.attendance_qr_points;
create policy attendance_qr_points_insert on public.attendance_qr_points for insert to authenticated
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());
drop policy if exists attendance_qr_points_update on public.attendance_qr_points;
create policy attendance_qr_points_update on public.attendance_qr_points for update to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config())
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());
drop policy if exists attendance_qr_points_delete on public.attendance_qr_points;
create policy attendance_qr_points_delete on public.attendance_qr_points for delete to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());

-- ── 2. Phiếu ngày + phần + dòng ───────────────────────────────────────────────
create table if not exists public.attendance_daily_sheets (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  ngay date not null,
  day_chuyen text not null check (day_chuyen in ('Mủ tạp', 'Mủ nước')),
  ma_phieu text not null,
  trang_thai text not null default 'dang_lap' check (trang_thai in ('dang_lap', 'da_gui', 'da_duyet', 'tra_ve')),
  chi_thi_ctsx text,
  trien_khai_khac text,
  ghi_chu text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_attendance_daily_sheets on public.attendance_daily_sheets (factory_id, ngay, day_chuyen);
drop trigger if exists trg_attendance_daily_sheets_updated_at on public.attendance_daily_sheets;
create trigger trg_attendance_daily_sheets_updated_at before update on public.attendance_daily_sheets
  for each row execute function public.set_updated_at();

create table if not exists public.attendance_sheet_sections (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.attendance_daily_sheets(id) on delete cascade,
  factory_id uuid not null references public.factories(id),
  loai text not null check (loai in ('tiep_nhan', 'co_dien', 'nang_hang', 'ca_san_xuat')),
  ca text check (ca in ('A', 'B', 'C')),
  ca_truong_ten text,
  to_truong_staff_id uuid references public.maintenance_staff(id) on delete set null,
  to_pho_staff_id uuid references public.maintenance_staff(id) on delete set null,
  truc_ca_user_id uuid not null references auth.users(id),
  truc_ca_staff_id uuid references public.maintenance_staff(id) on delete set null,
  ngoai_phan_cong boolean not null default false,
  bat_dau_luc timestamptz not null default now(),
  ket_thuc_luc timestamptz,
  trang_thai text not null default 'dang_lam' check (trang_thai in ('dang_lam', 'da_gui', 'da_duyet', 'tra_ve')),
  gui_luc timestamptz,
  gui_boi uuid references auth.users(id),
  duyet_luc timestamptz,
  duyet_boi uuid references auth.users(id),
  tra_ve_ly_do text,
  tra_ve_luc timestamptz,
  tra_ve_boi uuid references auth.users(id),
  ghi_chu text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sheet_sections_ca check ((loai = 'ca_san_xuat') = (ca is not null))
);
create unique index if not exists uniq_attendance_sheet_sections on public.attendance_sheet_sections (sheet_id, loai, coalesce(ca, '-'));
create index if not exists idx_attendance_sheet_sections_status on public.attendance_sheet_sections (factory_id, trang_thai);
drop trigger if exists trg_attendance_sheet_sections_updated_at on public.attendance_sheet_sections;
create trigger trg_attendance_sheet_sections_updated_at before update on public.attendance_sheet_sections
  for each row execute function public.set_updated_at();

create table if not exists public.attendance_sheet_lines (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.attendance_sheet_sections(id) on delete cascade,
  sheet_id uuid not null references public.attendance_daily_sheets(id) on delete cascade,
  factory_id uuid not null references public.factories(id),
  stt integer not null default 0,
  staff_id uuid not null references public.maintenance_staff(id),
  cong_viec_id uuid references public.attendance_job_types(id) on delete set null,
  vehicle_id uuid references public.dispatch_vehicles(id) on delete set null,
  xep_loai text check (xep_loai in ('A', 'B')),
  diem_danh text not null default 'co' check (diem_danh in ('co', 'vang')),
  vang_loai text check (vang_loai in ('co_phep', 'khong_phep')),
  ly_do_id uuid references public.attendance_absence_reasons(id) on delete set null,
  ly_do text,
  thay_cho_staff_id uuid references public.maintenance_staff(id) on delete set null,
  ghi_chu text,
  la_them_ngoai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sheet_lines_diem_danh check (
    (diem_danh = 'co' and vang_loai is null and xep_loai is not null)
    or (diem_danh = 'vang' and vang_loai is not null and xep_loai is null)
  ),
  constraint attendance_sheet_lines_ly_do check (vang_loai is distinct from 'khong_phep' or nullif(btrim(ly_do), '') is not null)
);
create unique index if not exists uniq_attendance_sheet_lines_staff on public.attendance_sheet_lines (section_id, staff_id);
create index if not exists idx_attendance_sheet_lines_sheet on public.attendance_sheet_lines (sheet_id);
create index if not exists idx_attendance_sheet_lines_staff on public.attendance_sheet_lines (staff_id);
drop trigger if exists trg_attendance_sheet_lines_updated_at on public.attendance_sheet_lines;
create trigger trg_attendance_sheet_lines_updated_at before update on public.attendance_sheet_lines
  for each row execute function public.set_updated_at();

-- RLS: chỉ SELECT (mọi ghi qua RPC).
alter table public.attendance_daily_sheets enable row level security;
alter table public.attendance_sheet_sections enable row level security;
alter table public.attendance_sheet_lines enable row level security;
drop policy if exists attendance_daily_sheets_select on public.attendance_daily_sheets;
create policy attendance_daily_sheets_select on public.attendance_daily_sheets for select to authenticated
  using (factory_id = public.current_profile_factory_id()
    and (public.attendance_can_shift() or public.attendance_can_review() or public.current_profile_has_permission('attendance.view')));
drop policy if exists attendance_sheet_sections_select on public.attendance_sheet_sections;
create policy attendance_sheet_sections_select on public.attendance_sheet_sections for select to authenticated
  using (factory_id = public.current_profile_factory_id()
    and (public.attendance_can_shift() or public.attendance_can_review() or public.current_profile_has_permission('attendance.view')));
drop policy if exists attendance_sheet_lines_select on public.attendance_sheet_lines;
create policy attendance_sheet_lines_select on public.attendance_sheet_lines for select to authenticated
  using (factory_id = public.current_profile_factory_id()
    and (public.attendance_can_shift() or public.attendance_can_review() or public.current_profile_has_permission('attendance.view')));

-- ── 3. Ngày công ↔ dòng phiếu đã duyệt ────────────────────────────────────────
alter table public.attendance_records
  add column if not exists sheet_line_id uuid references public.attendance_sheet_lines(id) on delete set null;
create index if not exists idx_attendance_records_sheet_line on public.attendance_records (sheet_line_id);

alter table public.attendance_logs drop constraint if exists attendance_logs_hanh_dong_check;
alter table public.attendance_logs add constraint attendance_logs_hanh_dong_check
  check (hanh_dong in ('cham', 'xoa', 'duyet_phieu'));

-- ── 4. Hàm nội bộ ─────────────────────────────────────────────────────────────
create or replace function public.attendance_recompute_sheet(p_sheet_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_duyet int; v_tra int; v_gui int; v_status text;
begin
  select count(*),
         count(*) filter (where trang_thai = 'da_duyet'),
         count(*) filter (where trang_thai = 'tra_ve'),
         count(*) filter (where trang_thai in ('da_gui', 'da_duyet'))
    into v_total, v_duyet, v_tra, v_gui
    from public.attendance_sheet_sections where sheet_id = p_sheet_id;
  v_status := case
    when v_total = 0 then 'dang_lap'
    when v_duyet = v_total then 'da_duyet'
    when v_tra > 0 then 'tra_ve'
    when v_gui = v_total then 'da_gui'
    else 'dang_lap' end;
  update public.attendance_daily_sheets set trang_thai = v_status where id = p_sheet_id and trang_thai is distinct from v_status;
  return v_status;
end $$;

create or replace function public.attendance_section_label(p_loai text, p_ca text)
returns text language sql immutable as $$
  select case p_loai
    when 'tiep_nhan' then 'Tổ tiếp nhận'
    when 'co_dien' then 'Tổ cơ điện'
    when 'nang_hang' then 'Tổ nâng hàng'
    else 'Ca sản xuất ' || coalesce(p_ca, '') end;
$$;

-- ── 5. RPC ────────────────────────────────────────────────────────────────────
-- Đọc mã QR dán tại ca.
create or replace function public.attendance_resolve_qr(p_token text)
returns table (id uuid, factory_id uuid, ten_diem text, day_chuyen_mac_dinh text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  return query
    select q.id, q.factory_id, q.ten_diem, q.day_chuyen_mac_dinh
    from public.attendance_qr_points q
    where q.token = btrim(coalesce(p_token, '')) and q.is_active
      and q.factory_id = public.current_profile_factory_id();
  if not found then raise exception 'Mã QR điểm danh không hợp lệ hoặc đã ngừng dùng.'; end if;
end $$;

-- Mở (tạo nếu chưa có) phiếu ngày + phần. Trả về id phần.
create or replace function public.attendance_open_section(
  p_factory_id uuid, p_ngay date, p_day_chuyen text, p_loai text, p_ca text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ca text := case when p_loai = 'ca_san_xuat' then nullif(btrim(coalesce(p_ca, '')), '') else null end;
  v_sheet_id uuid;
  v_section_id uuid;
  v_ca_truong text;
  v_ngoai boolean := false;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not public.attendance_can_shift() then raise exception 'Bạn không có quyền điểm danh ca.'; end if;
  if p_day_chuyen not in ('Mủ tạp', 'Mủ nước') then raise exception 'Dây chuyền không hợp lệ.'; end if;
  if p_loai not in ('tiep_nhan', 'co_dien', 'nang_hang', 'ca_san_xuat') then raise exception 'Phần không hợp lệ.'; end if;
  if p_loai = 'ca_san_xuat' and (v_ca is null or v_ca not in ('A', 'B', 'C')) then raise exception 'Chọn ca sản xuất (A / B / C).'; end if;
  if p_ngay is null or p_ngay > v_today then raise exception 'Không điểm danh cho ngày chưa tới.'; end if;
  if not public.attendance_can_edit_any_section() and p_ngay < v_today - 1 then
    raise exception 'Trực ca chỉ điểm danh hôm nay hoặc hôm qua (ca đêm). Ngày cũ hơn nhờ người chấm công.';
  end if;

  insert into public.attendance_daily_sheets (factory_id, ngay, day_chuyen, ma_phieu, created_by)
  values (p_factory_id, p_ngay, p_day_chuyen,
          (case when p_day_chuyen = 'Mủ tạp' then 'F01' else 'F02' end) || '-' || to_char(p_ngay, 'DDMMYY'), v_uid)
  on conflict (factory_id, ngay, day_chuyen) do nothing;
  select s.id into v_sheet_id from public.attendance_daily_sheets s
    where s.factory_id = p_factory_id and s.ngay = p_ngay and s.day_chuyen = p_day_chuyen;

  select sec.id into v_section_id from public.attendance_sheet_sections sec
    where sec.sheet_id = v_sheet_id and sec.loai = p_loai and coalesce(sec.ca, '-') = coalesce(v_ca, '-');
  if v_section_id is not null then return v_section_id; end if;

  if v_ca is not null then
    select n.ca_truong into v_ca_truong from public.production_shift_names n
      where n.factory_id = p_factory_id and n.ca = v_ca and n.hieu_luc_tu <= p_ngay
      order by n.hieu_luc_tu desc limit 1;
    if not public.attendance_can_edit_any_section() then
      v_ngoai := not exists (
        select 1 from public.production_shift_assignments a
        where a.factory_id = p_factory_id and a.ca = v_ca and a.assigned_user_id = v_uid and a.is_active);
    end if;
  end if;

  insert into public.attendance_sheet_sections (sheet_id, factory_id, loai, ca, ca_truong_ten, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong)
  values (v_sheet_id, p_factory_id, p_loai, v_ca, v_ca_truong, v_uid,
          (select ms.id from public.maintenance_staff ms where ms.profile_id = v_uid and ms.factory_id = p_factory_id limit 1),
          v_ngoai)
  on conflict do nothing
  returning id into v_section_id;
  if v_section_id is null then
    select sec.id into v_section_id from public.attendance_sheet_sections sec
      where sec.sheet_id = v_sheet_id and sec.loai = p_loai and coalesce(sec.ca, '-') = coalesce(v_ca, '-');
  end if;
  perform public.attendance_recompute_sheet(v_sheet_id);
  return v_section_id;
end $$;

-- Kiểm quyền sửa 1 phần (khoá dòng phần). Trả về bản ghi phần + ngày.
create or replace function public.attendance_lock_section_for_edit(p_section_id uuid)
returns table (section_id uuid, sheet_id uuid, factory_id uuid, ngay date, trang_thai text)
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select sec.id, sec.sheet_id, sec.factory_id, sec.trang_thai, sec.truc_ca_user_id, s.ngay
    into v
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id
    for update of sec;
  if not found or v.factory_id is distinct from public.current_profile_factory_id() then raise exception 'Không tìm thấy phần điểm danh.'; end if;
  if not (public.attendance_can_edit_any_section() or (v.truc_ca_user_id = auth.uid() and public.attendance_can_shift())) then
    raise exception 'Phần này do trực ca khác lập — bạn chỉ xem được.';
  end if;
  if v.trang_thai = 'da_gui' then raise exception 'Phần đã gửi chấm công, đang chờ văn phòng duyệt — không sửa được.'; end if;
  if v.trang_thai = 'da_duyet' then raise exception 'Phần đã được duyệt — không sửa được nữa.'; end if;
  return query select v.id, v.sheet_id, v.factory_id, v.ngay, v.trang_thai;
end $$;

-- Lưu phần (header + toàn bộ dòng, 1 giao dịch). Trả về số dòng.
-- p_header: {to_truong_staff_id, to_pho_staff_id, ghi_chu}
-- p_lines: [{id, stt, staff_id, cong_viec_id, vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do,
--            thay_cho_staff_id, ghi_chu, la_them_ngoai}]
create or replace function public.attendance_save_section(p_section_id uuid, p_header jsonb, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_line jsonb;
  v_staff record;
  v_seen uuid[] := '{}';
  v_staff_id uuid;
  v_diem text;
  v_vang text;
  v_xep text;
  v_ly_do_id uuid;
  v_ly_do text;
  v_count int := 0;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 dòng mỗi phần.'; end if;

  update public.attendance_sheet_sections set
    to_truong_staff_id = nullif(p_header ->> 'to_truong_staff_id', '')::uuid,
    to_pho_staff_id = nullif(p_header ->> 'to_pho_staff_id', '')::uuid,
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;
    if v_staff_id = any(v_seen) then raise exception '% có 2 dòng trong cùng phần.', v_staff.ten; end if;
    v_seen := v_seen || v_staff_id;
    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;
    v_diem := coalesce(nullif(v_line ->> 'diem_danh', ''), 'co');
    if v_diem not in ('co', 'vang') then raise exception 'Điểm danh không hợp lệ (%).', v_staff.ten; end if;
    if v_diem = 'co' then
      v_xep := coalesce(nullif(v_line ->> 'xep_loai', ''), 'A');
      if v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ A hoặc B (%).', v_staff.ten; end if;
      v_vang := null; v_ly_do_id := null; v_ly_do := null;
    else
      v_xep := null;
      v_vang := coalesce(nullif(v_line ->> 'vang_loai', ''), 'co_phep');
      if v_vang not in ('co_phep', 'khong_phep') then raise exception 'Loại vắng không hợp lệ (%).', v_staff.ten; end if;
      v_ly_do_id := nullif(v_line ->> 'ly_do_id', '')::uuid;
      v_ly_do := nullif(btrim(coalesce(v_line ->> 'ly_do', '')), '');
      if v_ly_do_id is not null then
        select r.ten into v_ly_do from public.attendance_absence_reasons r
          where r.id = v_ly_do_id and r.factory_id = v_sec.factory_id;
      end if;
      if v_vang = 'khong_phep' and v_ly_do is null then
        raise exception '% vắng không phép — bắt buộc chọn lý do.', v_staff.ten;
      end if;
      if v_vang = 'co_phep' then v_ly_do_id := null; v_ly_do := null; end if;
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, vehicle_id,
      xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_cho_staff_id, ghi_chu, la_them_ngoai)
    values (
      coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid()), p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id,
      nullif(v_line ->> 'cong_viec_id', '')::uuid, nullif(v_line ->> 'vehicle_id', '')::uuid,
      v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do,
      case when v_diem = 'co' then nullif(v_line ->> 'thay_cho_staff_id', '')::uuid else null end,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false));
    v_count := v_count + 1;
  end loop;

  if v_sec.trang_thai = 'tra_ve' then
    -- Sửa sau khi bị trả về: giữ trạng thái "Bị trả về" cho tới khi gửi lại.
    null;
  end if;
  return v_count;
end $$;

-- Gửi phần cho văn phòng duyệt.
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phần chưa có dòng điểm danh nào — lưu trước khi gửi.'; end if;
  update public.attendance_sheet_sections
    set trang_thai = 'da_gui', gui_luc = now(), gui_boi = auth.uid(), tra_ve_ly_do = null
    where id = p_section_id;
  perform public.attendance_recompute_sheet(v_sec.sheet_id);

  select s.ma_phieu, s.day_chuyen, sec.loai, sec.ca into v_info
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id;
  insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
  select v_sec.factory_id, p.id, 'diem_danh_cho_duyet', v_sec.sheet_id, 'attendance_sheet',
         'Phiếu điểm danh chờ duyệt',
         v_info.ma_phieu || ' · ' || v_info.day_chuyen || ' · ' || public.attendance_section_label(v_info.loai, v_info.ca)
           || ' (' || v_n || ' người)',
         '/dashboard/attendance/sheet/' || v_sec.sheet_id
  from public.profiles p
  where p.factory_id = v_sec.factory_id and p.status = 'active' and p.id <> auth.uid()
    and (public.attendance_user_has_permission(p.id, 'attendance.approve')
         or public.attendance_user_has_permission(p.id, 'attendance.mark_all'));
  return 'da_gui';
end $$;

-- Duyệt / trả về các phần. p_hanh_dong: 'duyet' | 'tra_ve'. Trả về {sections, records, skipped_manual}.
create or replace function public.attendance_review_sections(p_section_ids uuid[], p_hanh_dong text, p_ly_do text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_sec record;
  v_pair record;
  v_old record;
  v_new_status text;
  v_new_xep text;
  v_new_ly_do text;
  v_line_id uuid;
  v_sections int := 0;
  v_records int := 0;
  v_skipped int := 0;
  v_sheet_ids uuid[] := '{}';
  v_pairs_staff uuid[] := '{}';
  v_pairs_ngay date[] := '{}';
  v_label text;
  i int;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.attendance_can_review() then raise exception 'Bạn không có quyền duyệt phiếu điểm danh.'; end if;
  if p_hanh_dong not in ('duyet', 'tra_ve') then raise exception 'Thao tác không hợp lệ.'; end if;
  if p_hanh_dong = 'tra_ve' and v_ly_do is null then raise exception 'Trả về phải nhập lý do.'; end if;
  if coalesce(array_length(p_section_ids, 1), 0) = 0 then return jsonb_build_object('sections', 0); end if;

  for v_sec in
    select sec.id, sec.sheet_id, sec.factory_id, sec.loai, sec.ca, sec.trang_thai, sec.truc_ca_user_id, s.ngay, s.ma_phieu, s.day_chuyen
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = any(p_section_ids)
    for update of sec
  loop
    if v_sec.factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
    v_label := v_sec.ma_phieu || ' · ' || public.attendance_section_label(v_sec.loai, v_sec.ca);
    if v_sec.trang_thai <> 'da_gui' then
      raise exception '% không ở trạng thái chờ duyệt.', v_label;
    end if;
    if p_hanh_dong = 'tra_ve' then
      update public.attendance_sheet_sections
        set trang_thai = 'tra_ve', tra_ve_ly_do = v_ly_do, tra_ve_luc = now(), tra_ve_boi = v_uid
        where id = v_sec.id;
      insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
      values (v_sec.factory_id, v_sec.truc_ca_user_id, 'diem_danh_tra_ve', v_sec.sheet_id, 'attendance_sheet',
              'Phiếu điểm danh bị trả về', v_label || ' — ' || v_ly_do,
              '/dashboard/attendance/shift?section=' || v_sec.id);
    else
      update public.attendance_sheet_sections set trang_thai = 'da_duyet', duyet_luc = now(), duyet_boi = v_uid where id = v_sec.id;
      for v_pair in select distinct l.staff_id from public.attendance_sheet_lines l where l.section_id = v_sec.id loop
        v_pairs_staff := v_pairs_staff || v_pair.staff_id;
        v_pairs_ngay := v_pairs_ngay || v_sec.ngay;
      end loop;
    end if;
    if not v_sec.sheet_id = any(v_sheet_ids) then v_sheet_ids := v_sheet_ids || v_sec.sheet_id; end if;
    v_sections := v_sections + 1;
  end loop;

  -- Ghi ngày công: gộp MỌI dòng đã duyệt của người đó trong ngày (mọi phiếu / phần).
  -- Có mặt nếu có mặt ở ≥ 1 phần; xếp B nếu bất kỳ phần nào B. Vắng mọi phần ⇒ không phép nếu có phần không phép.
  for i in 1 .. coalesce(array_length(v_pairs_staff, 1), 0) loop
    select
      case when bool_or(l.diem_danh = 'co') then 'co_mat'
           when bool_or(l.vang_loai = 'khong_phep') then 'nghi_khong_phep'
           else 'nghi_co_phep' end,
      case when bool_or(l.diem_danh = 'co') then
        case when bool_or(l.xep_loai = 'B') then 'B' else 'A' end end,
      (array_agg(l.ly_do order by l.updated_at desc) filter (where l.vang_loai = 'khong_phep'))[1],
      (array_agg(l.id order by (l.diem_danh = 'co') desc, l.updated_at desc))[1]
      into v_new_status, v_new_xep, v_new_ly_do, v_line_id
    from public.attendance_sheet_lines l
    join public.attendance_sheet_sections sec on sec.id = l.section_id
    join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where l.staff_id = v_pairs_staff[i] and s.ngay = v_pairs_ngay[i]
      and s.factory_id = public.current_profile_factory_id() and sec.trang_thai = 'da_duyet';
    if v_new_status <> 'co_mat' then v_new_xep := null; end if;
    if v_new_status <> 'nghi_khong_phep' then v_new_ly_do := null; end if;

    select trang_thai, xep_loai, nguon, sheet_line_id into v_old
      from public.attendance_records
      where factory_id = public.current_profile_factory_id() and staff_id = v_pairs_staff[i] and ngay = v_pairs_ngay[i]
      for update;
    if found and v_old.nguon = 'bo_sung_tay' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.attendance_records (factory_id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, updated_by, sheet_line_id)
    values (public.current_profile_factory_id(), v_pairs_staff[i], v_pairs_ngay[i], v_new_status, 'truc_ca',
            v_new_xep, v_new_ly_do, v_uid, v_line_id)
    on conflict (factory_id, staff_id, ngay) do update
      set trang_thai = excluded.trang_thai, nguon = excluded.nguon, xep_loai = excluded.xep_loai,
          ly_do = excluded.ly_do, dung_phep_thuong = false, updated_by = excluded.updated_by,
          sheet_line_id = excluded.sheet_line_id;
    insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
      xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
    values (public.current_profile_factory_id(), v_pairs_staff[i], v_pairs_ngay[i], 'duyet_phieu',
            v_old.trang_thai, v_new_status, v_old.xep_loai, v_new_xep, v_old.nguon, 'truc_ca',
            'Duyệt phiếu điểm danh' || coalesce(' — ' || v_ly_do, ''), v_uid);
    v_records := v_records + 1;
  end loop;

  for i in 1 .. coalesce(array_length(v_sheet_ids, 1), 0) loop
    perform public.attendance_recompute_sheet(v_sheet_ids[i]);
  end loop;
  return jsonb_build_object('sections', v_sections, 'records', v_records, 'skipped_manual', v_skipped);
end $$;

-- Thêm nhanh công nhân ngoài danh sách (văn phòng xác nhận / gộp trùng sau). Trùng tên ⇒ trả người cũ.
create or replace function public.attendance_quick_add_worker(
  p_factory_id uuid, p_ten text, p_day_chuyen text, p_ca text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ten text := regexp_replace(btrim(coalesce(p_ten, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not public.attendance_can_shift() then raise exception 'Bạn không có quyền thêm người vào ca.'; end if;
  if length(v_ten) < 2 then raise exception 'Nhập họ tên (ít nhất 2 ký tự).'; end if;
  select ms.id into v_id from public.maintenance_staff ms
    where ms.factory_id = p_factory_id and lower(btrim(ms.ten)) = lower(v_ten)
    order by ms.active desc nulls last limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.maintenance_staff (factory_id, ten, active, loai_nhan_su, day_chuyen_mac_dinh, ca_mac_dinh,
    nguon_tao, cho_xac_nhan, department_id)
  values (p_factory_id, v_ten, true, 'cong_nhan',
          case when p_day_chuyen in ('Mủ tạp', 'Mủ nước') then p_day_chuyen end,
          case when p_ca in ('A', 'B', 'C') then p_ca end,
          'them_nhanh_truc_ca', true, public.attendance_my_department_id())
  returning id into v_id;
  return v_id;
end $$;

-- ── 6. Khoá ngày công đã duyệt từ phiếu (chỉ admin sửa, có lý do) ─────────────
-- Chép từ 20261203 + kiểm sheet_line_id.
create or replace function public.attendance_set_days(
  p_factory_id uuid,
  p_staff_ids uuid[],
  p_ngays date[],
  p_trang_thai text,
  p_xep_loai text,
  p_ly_do text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_xep text := case when p_trang_thai = 'co_mat' then coalesce(nullif(p_xep_loai, ''), 'A') else null end;
  v_log_ly_do text;
  v_is_admin boolean := public.current_profile_is_admin();
  v_staff record;
  v_ngay date;
  v_old record;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if p_trang_thai not in ('co_mat', 'nghi_tua', 'nghi_co_phep', 'nghi_khong_phep') then raise exception 'Trạng thái không hợp lệ.'; end if;
  if v_xep is not null and v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ được A hoặc B.'; end if;
  if v_ly_do is null and not (p_trang_thai = 'co_mat' and v_xep = 'A') then
    raise exception 'Bắt buộc nhập lý do (chỉ "Có mặt" xếp loại A được bỏ trống).';
  end if;
  v_log_ly_do := coalesce(v_ly_do, 'Chấm có mặt (A)');
  if coalesce(array_length(p_staff_ids, 1), 0) = 0 or coalesce(array_length(p_ngays, 1), 0) = 0 then return 0; end if;
  if array_length(p_staff_ids, 1) * array_length(p_ngays, 1) > 2000 then raise exception 'Chọn tối đa 2.000 ô mỗi lần.'; end if;
  if p_trang_thai = 'co_mat' and exists (select 1 from unnest(p_ngays) d where d > v_today) then
    raise exception 'Không chấm "Có mặt" cho ngày chưa tới.';
  end if;

  for v_staff in
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec
    from public.maintenance_staff ms
    where ms.id = any(p_staff_ids) and ms.factory_id = p_factory_id
  loop
    if not public.attendance_can_mark_staff(v_staff.id) then
      raise exception 'Bạn không có quyền chấm công cho %.', v_staff.ten;
    end if;
    foreach v_ngay in array p_ngays loop
      if (v_staff.ngay_vao_lam is not null and v_ngay < v_staff.ngay_vao_lam)
         or (v_staff.ngay_nghi_viec is not null and v_ngay > v_staff.ngay_nghi_viec) then
        raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_ngay, 'DD/MM/YYYY');
      end if;
      select trang_thai, xep_loai, nguon, sheet_line_id into v_old
        from public.attendance_records
        where factory_id = p_factory_id and staff_id = v_staff.id and ngay = v_ngay
        for update;
      if found and v_old.sheet_line_id is not null and not v_is_admin then
        raise exception 'Ngày % của % đã duyệt từ phiếu điểm danh ca — không sửa được (chỉ admin).', to_char(v_ngay, 'DD/MM/YYYY'), v_staff.ten;
      end if;
      if found and v_old.sheet_line_id is not null and v_ly_do is null then
        raise exception 'Sửa ngày công đã duyệt từ phiếu ca phải nhập lý do.';
      end if;
      if found and v_old.trang_thai = p_trang_thai and v_old.xep_loai is not distinct from v_xep and v_old.nguon = 'bo_sung_tay' then
        continue;
      end if;
      insert into public.attendance_records (factory_id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, dung_phep_thuong, updated_by)
      values (p_factory_id, v_staff.id, v_ngay, p_trang_thai, 'bo_sung_tay', v_xep, v_ly_do, false, v_uid)
      on conflict (factory_id, staff_id, ngay) do update
        set trang_thai = excluded.trang_thai, nguon = excluded.nguon, xep_loai = excluded.xep_loai,
            ly_do = excluded.ly_do, dung_phep_thuong = false, updated_by = excluded.updated_by;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (p_factory_id, v_staff.id, v_ngay, 'cham', v_old.trang_thai, p_trang_thai,
        v_old.xep_loai, v_xep, v_old.nguon, 'bo_sung_tay', v_log_ly_do, v_uid);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

create or replace function public.attendance_clear_days(
  p_factory_id uuid,
  p_staff_ids uuid[],
  p_ngays date[],
  p_ly_do text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_is_admin boolean := public.current_profile_is_admin();
  v_row record;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if v_ly_do is null then raise exception 'Bắt buộc nhập lý do.'; end if;
  for v_row in
    select r.id, r.staff_id, r.ngay, r.trang_thai, r.xep_loai, r.nguon, r.sheet_line_id, ms.ten
    from public.attendance_records r join public.maintenance_staff ms on ms.id = r.staff_id
    where r.factory_id = p_factory_id and r.staff_id = any(p_staff_ids) and r.ngay = any(p_ngays)
    for update of r
  loop
    if not public.attendance_can_mark_staff(v_row.staff_id) then
      raise exception 'Bạn không có quyền chấm công cho %.', v_row.ten;
    end if;
    if v_row.sheet_line_id is not null and not v_is_admin then
      raise exception 'Ngày % của % đã duyệt từ phiếu điểm danh ca — không xoá được (chỉ admin).', to_char(v_row.ngay, 'DD/MM/YYYY'), v_row.ten;
    end if;
    delete from public.attendance_records where id = v_row.id;
    insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
      xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
    values (p_factory_id, v_row.staff_id, v_row.ngay, 'xoa', v_row.trang_thai, null, v_row.xep_loai, null, v_row.nguon, null, v_ly_do, v_uid);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── 7. Quyền thực thi ─────────────────────────────────────────────────────────
revoke all on function public.attendance_user_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.attendance_recompute_sheet(uuid) from public, anon, authenticated;
revoke all on function public.attendance_lock_section_for_edit(uuid) from public, anon, authenticated;
revoke all on function public.attendance_resolve_qr(text) from public, anon;
revoke all on function public.attendance_open_section(uuid, date, text, text, text) from public, anon;
revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
revoke all on function public.attendance_review_sections(uuid[], text, text) from public, anon;
revoke all on function public.attendance_quick_add_worker(uuid, text, text, text) from public, anon;
grant execute on function public.attendance_resolve_qr(text) to authenticated;
grant execute on function public.attendance_open_section(uuid, date, text, text, text) to authenticated;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;
grant execute on function public.attendance_review_sections(uuid[], text, text) to authenticated;
grant execute on function public.attendance_quick_add_worker(uuid, text, text, text) to authenticated;
revoke all on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) from public, anon;
revoke all on function public.attendance_clear_days(uuid, uuid[], date[], text) from public, anon;
grant execute on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) to authenticated;
grant execute on function public.attendance_clear_days(uuid, uuid[], date[], text) to authenticated;

-- Module Chấm công — Ca / Tổ là đơn vị điểm danh (2026-11-24). Người dùng chốt:
-- • Ngoài Ca A/B/C có các TỔ (Tổ tiếp nhận mủ tạp, Tổ xử lý nước thải, Tổ cơ điện – Bảo trì – Xe nâng), thêm mới được.
-- • Mỗi ca/tổ điểm danh 1 phiếu con trong phiếu ngày của dây chuyền NGƯỜI ĐIỂM DANH chọn (cùng dây chuyền + ngày ⇒ cùng
--   phiếu TKSX). Ca có Ca trưởng / Ca phó, tổ có Tổ trưởng / Tổ phó; chưa phân công ⇒ để trống trên phiếu.
-- • Người thuộc ca/tổ theo ô "Ca/Tổ mặc định" (maintenance_staff.ca_mac_dinh = mã đơn vị). Vai trò trưởng/phó là của
--   chính đơn vị đó (to_pham_vi bỏ dùng).
-- • Phân công điểm danh (production_shift_assignments.ca = mã đơn vị) + điểm QR chọn được ca/tổ. Người không có quyền
--   chấm toàn nhà máy chỉ mở được ca/tổ mình được phân công.
-- • Mã phiếu: TKSXMT-ddmmyy (Mủ tạp), TKSXMN-ddmmyy (Mủ nước) — đổi cả phiếu cũ.
-- Kỹ thuật: phiếu con vẫn là attendance_sheet_sections loai = 'ca_san_xuat', cột `ca` = MÃ ĐƠN VỊ (A/B/C/TN_MT/…) —
-- không đổi các RPC lưu / gửi / duyệt. vi_tri đổi thành 2 khoá {"truong", "pho"}.
-- Chạy TAY trên Supabase SQL Editor SAU 20261209, TRƯỚC deploy. Idempotent.
-- Về sau mọi CREATE OR REPLACE attendance_open_section / attendance_save_section PHẢI chép từ file này.

-- ── 1. Danh mục Ca / Tổ ───────────────────────────────────────────────────────
create table if not exists public.attendance_units (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  code text not null check (code ~ '^[A-Z0-9_]{1,12}$'),
  ten text not null check (length(btrim(ten)) > 0),
  ten_khmer text,
  loai text not null check (loai in ('ca', 'to')),
  -- Loại việc hiện ở tấm chọn việc (NULL = mọi loại việc).
  to_nhom text check (to_nhom is null or to_nhom in ('tiep_nhan', 'co_dien', 'ca_san_xuat')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_attendance_units_code on public.attendance_units (factory_id, code);
drop trigger if exists trg_attendance_units_updated_at on public.attendance_units;
create trigger trg_attendance_units_updated_at before update on public.attendance_units
  for each row execute function public.set_updated_at();

alter table public.attendance_units enable row level security;
drop policy if exists attendance_units_select on public.attendance_units;
create policy attendance_units_select on public.attendance_units for select to authenticated
  using (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_units_insert on public.attendance_units;
create policy attendance_units_insert on public.attendance_units for insert to authenticated
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());
drop policy if exists attendance_units_update on public.attendance_units;
create policy attendance_units_update on public.attendance_units for update to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config())
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());
-- Không xoá (đã có phiếu tham chiếu theo mã) — chỉ tắt "Đang dùng".

insert into public.attendance_units (factory_id, code, ten, ten_khmer, loai, to_nhom, sort_order)
select f.id, u.code, u.ten, u.ten_khmer, u.loai, u.to_nhom, u.sort_order
from public.factories f
cross join (values
  ('TN_MT', 'Tổ tiếp nhận mủ tạp', 'ក្រុមទទួលជ័រ', 'to', 'tiep_nhan', 10),
  ('XLNT', 'Tổ xử lý nước thải', 'ក្រុមប្រព្រឹត្តកម្មទឹកកខ្វក់', 'to', 'tiep_nhan', 20),
  ('CD', 'Tổ cơ điện – Bảo trì – Xe nâng', 'ក្រុមជួសជុល ថែទាំ និងលើកទំនិញ', 'to', 'co_dien', 30),
  ('A', 'Ca A', 'វេន A', 'ca', 'ca_san_xuat', 40),
  ('B', 'Ca B', 'វេន B', 'ca', 'ca_san_xuat', 50),
  ('C', 'Ca C', 'វេន C', 'ca', 'ca_san_xuat', 60)
) as u(code, ten, ten_khmer, loai, to_nhom, sort_order)
on conflict (factory_id, code) do nothing;

-- ── 2. Bỏ ràng buộc "chỉ A/B/C" ───────────────────────────────────────────────
alter table public.maintenance_staff drop constraint if exists maintenance_staff_ca_mac_dinh_check;
alter table public.production_shift_assignments drop constraint if exists production_shift_assignments_ca_check;
alter table public.attendance_sheet_sections drop constraint if exists attendance_sheet_sections_ca_check;
comment on column public.maintenance_staff.ca_mac_dinh is 'Mã Ca/Tổ mặc định (attendance_units.code).';
comment on column public.attendance_sheet_sections.ca is 'Mã Ca/Tổ (attendance_units.code) của phiếu con.';

-- Vai trò tổ trưởng/tổ phó cũ theo to_pham_vi ⇒ gán Ca/Tổ mặc định tương ứng (chỉ người chưa có ca/tổ).
update public.maintenance_staff set ca_mac_dinh = 'CD'
  where to_vai_tro is not null and to_pham_vi = 'co_dien' and ca_mac_dinh is null;
update public.maintenance_staff set ca_mac_dinh = 'TN_MT'
  where to_vai_tro is not null and to_pham_vi = 'tiep_nhan' and ca_mac_dinh is null
    and coalesce(day_chuyen_mac_dinh, 'Mủ tạp') = 'Mủ tạp';

-- ── 3. Vị trí phụ trách: 2 khoá truong / pho ──────────────────────────────────
update public.attendance_sheet_sections
  set vi_tri = jsonb_strip_nulls(jsonb_build_object('truong', vi_tri -> 'ca_san_xuat.to_truong', 'pho', vi_tri -> 'ca_san_xuat.to_pho'))
  where vi_tri ? 'ca_san_xuat.to_truong' or vi_tri ? 'ca_san_xuat.to_pho';

-- ── 4. Điểm QR chọn được Ca/Tổ ────────────────────────────────────────────────
alter table public.attendance_qr_points add column if not exists unit_code text;

drop function if exists public.attendance_resolve_qr(text);
create function public.attendance_resolve_qr(p_token text)
returns table (id uuid, factory_id uuid, ten_diem text, day_chuyen_mac_dinh text, unit_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  return query
    select q.id, q.factory_id, q.ten_diem, q.day_chuyen_mac_dinh, q.unit_code
    from public.attendance_qr_points q
    where q.token = btrim(coalesce(p_token, '')) and q.is_active
      and q.factory_id = public.current_profile_factory_id();
  if not found then raise exception 'Mã QR điểm danh không hợp lệ hoặc đã ngừng dùng.'; end if;
end $$;
revoke all on function public.attendance_resolve_qr(text) from public, anon;
grant execute on function public.attendance_resolve_qr(text) to authenticated;

-- ── 5. Mã phiếu TKSXMT / TKSXMN (đổi cả phiếu cũ) ─────────────────────────────
update public.attendance_daily_sheets
  set ma_phieu = (case when day_chuyen = 'Mủ tạp' then 'TKSXMT' else 'TKSXMN' end) || '-' || to_char(ngay, 'DDMMYY')
  where ma_phieu not like 'TKSXM%';

-- Nhãn phiếu con (chuông / nhật ký): tên Ca/Tổ trong danh mục.
create or replace function public.attendance_section_label(p_loai text, p_ca text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_loai = 'ca_san_xuat' and p_ca is not null then
    select u.ten into v from public.attendance_units u
      where u.code = p_ca and u.factory_id = public.current_profile_factory_id() limit 1;
    return coalesce(v, 'Ca ' || p_ca);
  end if;
  return case p_loai when 'tiep_nhan' then 'Tổ tiếp nhận' when 'co_dien' then 'Tổ cơ điện' when 'nang_hang' then 'Tổ nâng hàng' else coalesce(p_ca, '') end;
end $$;

-- ── 6. Mở phiếu con theo Ca/Tổ ────────────────────────────────────────────────
create or replace function public.attendance_open_section(
  p_factory_id uuid, p_ngay date, p_day_chuyen text, p_loai text, p_ca text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ca text := nullif(btrim(coalesce(p_ca, '')), '');
  v_unit record;
  v_sheet_id uuid;
  v_section_id uuid;
  v_ca_truong text;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not public.attendance_can_shift() then raise exception 'Bạn không có quyền điểm danh.'; end if;
  if p_day_chuyen not in ('Mủ tạp', 'Mủ nước') then raise exception 'Dây chuyền không hợp lệ.'; end if;
  if coalesce(p_loai, 'ca_san_xuat') <> 'ca_san_xuat' then raise exception 'Phiếu con không hợp lệ.'; end if;
  select u.code, u.ten, u.loai, u.is_active into v_unit
    from public.attendance_units u where u.factory_id = p_factory_id and u.code = v_ca;
  if not found or not v_unit.is_active then raise exception 'Ca/Tổ không hợp lệ hoặc đã ngừng dùng.'; end if;
  if p_ngay is null or p_ngay > v_today then raise exception 'Không điểm danh cho ngày chưa tới.'; end if;
  if not public.attendance_can_edit_any_section() then
    if p_ngay < v_today - 1 then
      raise exception 'Trực ca chỉ điểm danh hôm nay hoặc hôm qua (ca đêm). Ngày cũ hơn nhờ người chấm công.';
    end if;
    if not exists (
      select 1 from public.production_shift_assignments a
      where a.factory_id = p_factory_id and a.ca = v_ca and a.assigned_user_id = v_uid and a.is_active
    ) then
      raise exception 'Bạn chưa được phân công điểm danh %.', v_unit.ten;
    end if;
  end if;

  insert into public.attendance_daily_sheets (factory_id, ngay, day_chuyen, ma_phieu, created_by)
  values (p_factory_id, p_ngay, p_day_chuyen,
          (case when p_day_chuyen = 'Mủ tạp' then 'TKSXMT' else 'TKSXMN' end) || '-' || to_char(p_ngay, 'DDMMYY'), v_uid)
  on conflict (factory_id, ngay, day_chuyen) do nothing;
  select s.id into v_sheet_id from public.attendance_daily_sheets s
    where s.factory_id = p_factory_id and s.ngay = p_ngay and s.day_chuyen = p_day_chuyen;

  select sec.id into v_section_id from public.attendance_sheet_sections sec
    where sec.sheet_id = v_sheet_id and sec.loai = 'ca_san_xuat' and sec.ca = v_ca;
  if v_section_id is not null then return v_section_id; end if;

  if v_unit.loai = 'ca' then
    select n.ca_truong into v_ca_truong from public.production_shift_names n
      where n.factory_id = p_factory_id and n.ca = v_ca and n.hieu_luc_tu <= p_ngay
      order by n.hieu_luc_tu desc limit 1;
  end if;

  insert into public.attendance_sheet_sections (sheet_id, factory_id, loai, ca, ca_truong_ten, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong)
  values (v_sheet_id, p_factory_id, 'ca_san_xuat', v_ca, v_ca_truong, v_uid,
          (select ms.id from public.maintenance_staff ms where ms.profile_id = v_uid and ms.factory_id = p_factory_id limit 1),
          false)
  on conflict do nothing
  returning id into v_section_id;
  if v_section_id is null then
    select sec.id into v_section_id from public.attendance_sheet_sections sec
      where sec.sheet_id = v_sheet_id and sec.loai = 'ca_san_xuat' and sec.ca = v_ca;
  end if;
  perform public.attendance_recompute_sheet(v_sheet_id);
  return v_section_id;
end $$;

-- ── 7. Lưu phiếu con: vị trí {truong, pho} (thân dòng chép NGUYÊN từ 20261208) ─────
create or replace function public.attendance_save_section(p_section_id uuid, p_header jsonb, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_line jsonb;
  v_staff record;
  v_seen uuid[] := '{}';
  v_staff_id uuid;
  v_jobs uuid[];
  v_diem text;
  v_vang text;
  v_xep text;
  v_ly_do_id uuid;
  v_ly_do text;
  v_thay_id uuid;
  v_thay_ten text;
  v_count int := 0;
  v_vt jsonb;
  v_kv record;
  v_pid uuid;
  v_gid uuid;
  v_truong uuid;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  if jsonb_typeof(p_header -> 'vi_tri') = 'object' then
    v_vt := '{}'::jsonb;
    for v_kv in select key, value from jsonb_each(p_header -> 'vi_tri') loop
      if v_kv.key not in ('truong', 'pho') then raise exception 'Vị trí không hợp lệ (%).', v_kv.key; end if;
      if jsonb_typeof(v_kv.value) <> 'object' then continue; end if;
      v_pid := nullif(v_kv.value ->> 'staff_id', '')::uuid;
      v_gid := nullif(v_kv.value ->> 'goc_staff_id', '')::uuid;
      if v_pid is not null and not exists (select 1 from public.maintenance_staff ms where ms.id = v_pid and ms.factory_id = v_sec.factory_id) then
        raise exception 'Người giữ vị trí không thuộc nhà máy.';
      end if;
      if v_gid is not null and not exists (select 1 from public.maintenance_staff ms where ms.id = v_gid and ms.factory_id = v_sec.factory_id) then
        raise exception 'Người mặc định của vị trí không thuộc nhà máy.';
      end if;
      v_vt := v_vt || jsonb_build_object(v_kv.key, jsonb_build_object('staff_id', v_pid, 'goc_staff_id', v_gid));
    end loop;
    v_truong := nullif(v_vt -> 'truong' ->> 'staff_id', '')::uuid;
    update public.attendance_sheet_sections set
      vi_tri = v_vt,
      to_truong_staff_id = v_truong,
      to_pho_staff_id = nullif(v_vt -> 'pho' ->> 'staff_id', '')::uuid,
      ca_truong_ten = coalesce((select ms.ten from public.maintenance_staff ms where ms.id = v_truong), ca_truong_ten)
    where id = p_section_id;
  end if;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;
    if v_staff_id = any(v_seen) then raise exception '% có 2 dòng trong cùng phiếu.', v_staff.ten; end if;
    v_seen := v_seen || v_staff_id;
    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into v_jobs
      from jsonb_array_elements_text(case when jsonb_typeof(v_line -> 'cong_viec_ids') = 'array' then v_line -> 'cong_viec_ids' else '[]'::jsonb end) x;
    v_diem := coalesce(nullif(v_line ->> 'diem_danh', ''), 'co');
    if v_diem not in ('co', 'vang') then raise exception 'Điểm danh không hợp lệ (%).', v_staff.ten; end if;
    v_thay_id := null; v_thay_ten := null; v_vang := null; v_ly_do_id := null; v_ly_do := null; v_xep := null;
    if v_diem = 'co' then
      v_xep := coalesce(nullif(v_line ->> 'xep_loai', ''), 'A');
      if v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ A hoặc B (%).', v_staff.ten; end if;
    else
      v_vang := nullif(v_line ->> 'vang_loai', '');
      if v_vang is not null and v_vang not in ('co_phep', 'khong_phep') then raise exception 'Loại vắng không hợp lệ (%).', v_staff.ten; end if;
      v_thay_id := nullif(v_line ->> 'thay_the_staff_id', '')::uuid;
      v_thay_ten := nullif(btrim(coalesce(v_line ->> 'thay_the_ten', '')), '');
      if v_thay_id is not null then
        v_thay_ten := null;
        if v_thay_id = v_staff_id then raise exception '% không thể tự thay cho chính mình.', v_staff.ten; end if;
        if not exists (select 1 from public.maintenance_staff ms where ms.id = v_thay_id and ms.factory_id = v_sec.factory_id) then
          raise exception 'Người thay của % không thuộc nhà máy.', v_staff.ten;
        end if;
      end if;
      if v_vang = 'khong_phep' then
        v_ly_do_id := nullif(v_line ->> 'ly_do_id', '')::uuid;
        v_ly_do := nullif(btrim(coalesce(v_line ->> 'ly_do', '')), '');
        if v_ly_do_id is not null then
          select r.ten into v_ly_do from public.attendance_absence_reasons r where r.id = v_ly_do_id and r.factory_id = v_sec.factory_id;
        end if;
        if v_ly_do is null then raise exception '% vắng không phép — bắt buộc chọn lý do.', v_staff.ten; end if;
      end if;
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai)
    values (
      coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid()), p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      nullif(v_line ->> 'vehicle_id', '')::uuid, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Kiểm chứng:
--   select code, ten, loai, to_nhom, sort_order from attendance_units order by factory_id, sort_order;
--   select ma_phieu from attendance_daily_sheets order by ngay desc limit 5;

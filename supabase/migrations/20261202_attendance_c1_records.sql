-- Module Chấm công — GĐ C1 "Ngày công + chấm tay" (2026-11-20). Kế hoạch: .claude/plans/cham-cong-2026-11-19.md mục 9.
--
-- 1. attendance_records: 1 dòng / nhân sự / ngày (ngày công). Chi tiết theo ca (công việc, xe, người thay) để C2.
-- 2. attendance_logs: nhật ký BẤT BIẾN mọi thay đổi ngày công.
-- 3. RPC attendance_set_days / attendance_clear_days: chấm / xoá chấm tay, kiểm quyền theo phòng ban, lý do bắt buộc.
-- 4. RLS chỉ SELECT; mọi ghi qua RPC.
-- Ngày nghiệp vụ theo giờ nhà máy (Asia/Ho_Chi_Minh). Chạy TAY trên Supabase SQL Editor TRƯỚC deploy. Idempotent.

-- ── 1. Bảng ───────────────────────────────────────────────────────────────────
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  staff_id uuid not null references public.maintenance_staff(id) on delete cascade,
  ngay date not null,
  trang_thai text not null check (trang_thai in ('co_mat', 'nghi_tua', 'nghi_co_phep', 'nghi_khong_phep')),
  nguon text not null check (nguon in ('auto_app', 'cham_diem_d', 'truc_ca', 'bo_sung_tay')),
  xep_loai text check (xep_loai in ('A', 'B')),
  ly_do text,
  dung_phep_thuong boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_xep_loai_co_mat check (xep_loai is null or trang_thai = 'co_mat'),
  constraint attendance_records_phep_thuong check (not dung_phep_thuong or trang_thai = 'nghi_co_phep'),
  constraint attendance_records_ly_do_tay check (nguon <> 'bo_sung_tay' or nullif(btrim(ly_do), '') is not null)
);
create unique index if not exists uniq_attendance_records_day on public.attendance_records (factory_id, staff_id, ngay);
create index if not exists idx_attendance_records_month on public.attendance_records (factory_id, ngay);

drop trigger if exists trg_attendance_records_updated_at on public.attendance_records;
create trigger trg_attendance_records_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  staff_id uuid not null references public.maintenance_staff(id) on delete cascade,
  ngay date not null,
  hanh_dong text not null check (hanh_dong in ('cham', 'xoa')),
  trang_thai_truoc text,
  trang_thai_sau text,
  xep_loai_truoc text,
  xep_loai_sau text,
  nguon_truoc text,
  nguon_sau text,
  ly_do text not null,
  nguoi_thuc_hien_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_logs_month on public.attendance_logs (factory_id, ngay);
create index if not exists idx_attendance_logs_staff on public.attendance_logs (staff_id, ngay);

create or replace function public.attendance_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Nhật ký chấm công không được sửa hoặc xoá.';
end $$;
drop trigger if exists trg_attendance_logs_immutable on public.attendance_logs;
create trigger trg_attendance_logs_immutable before update or delete on public.attendance_logs
  for each row execute function public.attendance_logs_immutable();

-- ── 2. Hàm quyền ──────────────────────────────────────────────────────────────
-- Phòng ban của người đang đăng nhập: ưu tiên hồ sơ nhân sự, dự phòng profiles.
create or replace function public.attendance_my_department_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ms.department_id from public.maintenance_staff ms
      where ms.profile_id = auth.uid() and ms.factory_id = public.current_profile_factory_id() and ms.department_id is not null
      limit 1),
    (select p.department_id from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function public.attendance_can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.mark_all')
      or public.current_profile_has_permission('attendance.approve');
$$;

-- Người đang đăng nhập có được XEM / CHẤM công của nhân sự này không.
create or replace function public.attendance_can_view_staff(p_staff_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.maintenance_staff ms
    where ms.id = p_staff_id
      and ms.factory_id = public.current_profile_factory_id()
      and (
        ms.profile_id = auth.uid()
        or public.attendance_can_view_all()
        or (public.current_profile_has_permission('attendance.mark')
            and ms.department_id is not null
            and ms.department_id = public.attendance_my_department_id())
      )
  );
$$;

create or replace function public.attendance_can_mark_staff(p_staff_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.maintenance_staff ms
    where ms.id = p_staff_id
      and ms.factory_id = public.current_profile_factory_id()
      and (
        public.current_profile_is_admin()
        or public.current_profile_has_permission('attendance.mark_all')
        or (public.current_profile_has_permission('attendance.mark')
            and ms.department_id is not null
            and ms.department_id = public.attendance_my_department_id())
      )
  );
$$;

-- ── 3. RLS (chỉ đọc) ──────────────────────────────────────────────────────────
alter table public.attendance_records enable row level security;
drop policy if exists attendance_records_select on public.attendance_records;
create policy attendance_records_select on public.attendance_records for select to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_view_staff(staff_id));

alter table public.attendance_logs enable row level security;
drop policy if exists attendance_logs_select on public.attendance_logs;
create policy attendance_logs_select on public.attendance_logs for select to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_view_staff(staff_id));

-- ── 4. RPC chấm tay ───────────────────────────────────────────────────────────
-- Chấm cùng 1 trạng thái cho mọi cặp (nhân sự × ngày). Trả về số ô đã đổi.
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
  v_staff record;
  v_ngay date;
  v_old record;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if p_trang_thai not in ('co_mat', 'nghi_tua', 'nghi_co_phep', 'nghi_khong_phep') then raise exception 'Trạng thái không hợp lệ.'; end if;
  if v_xep is not null and v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ được A hoặc B.'; end if;
  if v_ly_do is null then raise exception 'Bắt buộc nhập lý do.'; end if;
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
      select trang_thai, xep_loai, nguon into v_old
        from public.attendance_records
        where factory_id = p_factory_id and staff_id = v_staff.id and ngay = v_ngay
        for update;
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
        v_old.xep_loai, v_xep, v_old.nguon, 'bo_sung_tay', v_ly_do, v_uid);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- Xoá ngày công (đưa về "chưa ghi nhận"), lý do bắt buộc. Trả về số ô đã xoá.
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
  v_row record;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if v_ly_do is null then raise exception 'Bắt buộc nhập lý do.'; end if;
  for v_row in
    select r.id, r.staff_id, r.ngay, r.trang_thai, r.xep_loai, r.nguon, ms.ten
    from public.attendance_records r join public.maintenance_staff ms on ms.id = r.staff_id
    where r.factory_id = p_factory_id and r.staff_id = any(p_staff_ids) and r.ngay = any(p_ngays)
    for update of r
  loop
    if not public.attendance_can_mark_staff(v_row.staff_id) then
      raise exception 'Bạn không có quyền chấm công cho %.', v_row.ten;
    end if;
    delete from public.attendance_records where id = v_row.id;
    insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
      xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
    values (p_factory_id, v_row.staff_id, v_row.ngay, 'xoa', v_row.trang_thai, null, v_row.xep_loai, null, v_row.nguon, null, v_ly_do, v_uid);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) from public, anon;
revoke all on function public.attendance_clear_days(uuid, uuid[], date[], text) from public, anon;
grant execute on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) to authenticated;
grant execute on function public.attendance_clear_days(uuid, uuid[], date[], text) to authenticated;

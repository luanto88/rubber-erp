-- C4 Chấm công — Sổ phép thưởng + chuỗi 3 tháng (2026-11-25). CHẠY TAY trên Supabase SQL Editor TRƯỚC khi deploy.
-- Người dùng chốt 2026-11-25:
--   * Chỉ NHÂN VIÊN quốc tịch VIỆT NAM được xét (cột mới maintenance_staff.quoc_tich, để trống ⇒ chưa xét).
--   * Tháng đủ = có mặt (attendance_records.trang_thai = 'co_mat') đủ MỌI ngày lịch, tháng đã kết thúc, làm trọn tháng.
--   * Đủ 3 tháng liên tiếp trong cùng năm ⇒ +1 phép (đếm lại từ 0). Tháng không đủ ⇒ chuỗi về 0.
--   * Phép năm N chỉ dùng trong năm N, cho ngày từ đầu tháng sau chuỗi (chuỗi T10–T12 ⇒ hiệu lực 01/01 năm sau ⇒ mất).
--   * Dùng phép = người chấm tick "Dùng phép thưởng" khi chấm Nghỉ có phép (attendance_records.dung_phep_thuong).
--     Số ngày đã dùng KHÔNG ghi sổ — đếm từ attendance_records ⇒ đổi trạng thái / xoá chấm tự hoàn phép.
--   * Sửa ngược làm tháng hết đủ ⇒ attendance_leave_recompute tự ghi dòng thu hồi (−1). Đã dùng ⇒ số dư âm (UI cảnh báo).
--   * Chỉ admin cộng / trừ tay (lý do bắt buộc).
-- Mọi CREATE OR REPLACE attendance_set_days về sau chép từ file này.

-- ── 1. Quốc tịch ─────────────────────────────────────────────────────────────
alter table public.maintenance_staff add column if not exists quoc_tich text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_quoc_tich_check') then
    alter table public.maintenance_staff
      add constraint maintenance_staff_quoc_tich_check check (quoc_tich is null or quoc_tich in ('VN', 'KH', 'KHAC'));
  end if;
end $$;
comment on column public.maintenance_staff.quoc_tich is 'VN | KH | KHAC — NULL = chưa khai. Phép thưởng chỉ cho nhân viên VN.';

create or replace function public.attendance_leave_eligible(p_staff_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.maintenance_staff ms
    where ms.id = p_staff_id
      and coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien'
      and ms.quoc_tich = 'VN'
  );
$$;

-- ── 2. Sổ phép (chỉ thêm, không sửa / xoá) ───────────────────────────────────
create table if not exists public.attendance_leave_ledger (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  staff_id uuid not null references public.maintenance_staff(id) on delete cascade,
  nam integer not null check (nam between 2000 and 2100),
  loai text not null check (loai in ('tich_luy', 'thu_hoi', 'dieu_chinh')),
  so_ngay integer not null check (so_ngay <> 0 and so_ngay between -60 and 60),
  chuoi_key text,
  hieu_luc_tu date not null,
  ly_do text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint attendance_leave_ledger_chuoi check ((loai = 'dieu_chinh') = (chuoi_key is null)),
  constraint attendance_leave_ledger_ly_do check (loai <> 'dieu_chinh' or nullif(btrim(coalesce(ly_do, '')), '') is not null)
);
create index if not exists attendance_leave_ledger_staff_nam on public.attendance_leave_ledger (factory_id, staff_id, nam);

create or replace function public.attendance_leave_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Sổ phép chỉ được thêm dòng, không sửa / xoá.';
end $$;
drop trigger if exists trg_attendance_leave_ledger_immutable on public.attendance_leave_ledger;
create trigger trg_attendance_leave_ledger_immutable
  before update or delete on public.attendance_leave_ledger
  for each row execute function public.attendance_leave_ledger_immutable();

alter table public.attendance_leave_ledger enable row level security;
drop policy if exists attendance_leave_ledger_select on public.attendance_leave_ledger;
create policy attendance_leave_ledger_select on public.attendance_leave_ledger for select to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_view_staff(staff_id));

create index if not exists attendance_records_phep_thuong
  on public.attendance_records (factory_id, staff_id, ngay) where dung_phep_thuong;

-- ── 3. Cờ từng tháng (nội bộ, không lọc người xem) ───────────────────────────
-- tinh_trang: du | thieu | khong_tron | chua_het.
create or replace function public.attendance_leave_flags_internal(p_factory_id uuid, p_nam integer, p_staff_ids uuid[])
returns table (staff_id uuid, thang integer, tinh_trang text)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as d),
  st as (
    select ms.id, ms.ngay_vao_lam, ms.ngay_nghi_viec
    from public.maintenance_staff ms
    where ms.factory_id = p_factory_id
      and coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien'
      and ms.quoc_tich = 'VN'
      and (p_staff_ids is null or ms.id = any(p_staff_ids))
  ),
  mo as (
    select m, make_date(p_nam, m, 1) as m0, (make_date(p_nam, m, 1) + interval '1 month' - interval '1 day')::date as m1
    from generate_series(1, 12) m
  ),
  cnt as (
    select r.staff_id, extract(month from r.ngay)::int as m, count(*) as n
    from public.attendance_records r
    where r.factory_id = p_factory_id and r.trang_thai = 'co_mat'
      and r.ngay >= make_date(p_nam, 1, 1) and r.ngay <= make_date(p_nam, 12, 31)
      and r.staff_id in (select id from st)
    group by 1, 2
  )
  select st.id, mo.m,
    case
      when (select d from today) <= mo.m1 then 'chua_het'
      when (st.ngay_vao_lam is not null and st.ngay_vao_lam > mo.m0)
        or (st.ngay_nghi_viec is not null and st.ngay_nghi_viec < mo.m1) then 'khong_tron'
      when coalesce(cnt.n, 0) >= (mo.m1 - mo.m0 + 1) then 'du'
      else 'thieu'
    end
  from st cross join mo
  left join cnt on cnt.staff_id = st.id and cnt.m = mo.m;
$$;

-- Bản cho giao diện: chỉ người mình xem được.
create or replace function public.attendance_leave_month_flags(p_factory_id uuid, p_nam integer)
returns table (staff_id uuid, thang integer, tinh_trang text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  return query
    select f.staff_id, f.thang, f.tinh_trang
    from public.attendance_leave_flags_internal(p_factory_id, p_nam, null) f
    where public.attendance_can_view_staff(f.staff_id);
end $$;

-- ── 4. Xét chuỗi + tự cộng / thu hồi ─────────────────────────────────────────
create or replace function public.attendance_leave_recompute(p_factory_id uuid, p_nam integer, p_staff_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_staff uuid;
  v_flag record;
  v_run integer;
  v_start integer;
  v_expected text[];
  v_key text;
  v_net integer;
  v_end_m integer;
  v_bad integer;
  v_changes integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('attendance.view')) then
    raise exception 'Không có quyền xem chấm công.';
  end if;
  if p_nam is null or p_nam < 2000 or p_nam > 2100 then raise exception 'Năm không hợp lệ.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_leave_recompute:' || p_factory_id::text || ':' || p_nam));

  -- Người đủ điều kiện + người đã có dòng chuỗi trong năm (đổi quốc tịch / loại ⇒ phải thu hồi).
  for v_staff in
    select ms.id from public.maintenance_staff ms
    where ms.factory_id = p_factory_id
      and (p_staff_ids is null or ms.id = any(p_staff_ids))
      and (
        (coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien' and ms.quoc_tich = 'VN')
        or exists (select 1 from public.attendance_leave_ledger l
                   where l.staff_id = ms.id and l.nam = p_nam and l.chuoi_key is not null)
      )
  loop
    v_expected := '{}';
    v_run := 0;
    for v_flag in
      select f.thang, f.tinh_trang from public.attendance_leave_flags_internal(p_factory_id, p_nam, array[v_staff]) f
      order by f.thang
    loop
      if v_flag.tinh_trang = 'du' then
        if v_run = 0 then v_start := v_flag.thang; end if;
        v_run := v_run + 1;
        if v_run = 3 then
          v_expected := v_expected || (p_nam::text || '-' || lpad(v_start::text, 2, '0') || '..'
                                       || p_nam::text || '-' || lpad(v_flag.thang::text, 2, '0'));
          v_run := 0;
        end if;
      else
        v_run := 0;
      end if;
    end loop;

    -- Cộng chuỗi mới đạt.
    foreach v_key in array v_expected loop
      select coalesce(sum(so_ngay), 0) into v_net from public.attendance_leave_ledger
        where factory_id = p_factory_id and staff_id = v_staff and nam = p_nam and chuoi_key = v_key;
      if v_net < 1 then
        v_end_m := substring(v_key from 15 for 2)::int;
        insert into public.attendance_leave_ledger (factory_id, staff_id, nam, loai, so_ngay, chuoi_key, hieu_luc_tu, ly_do, created_by)
        values (p_factory_id, v_staff, p_nam, 'tich_luy', 1 - v_net, v_key,
                (make_date(p_nam, v_end_m, 1) + interval '1 month')::date,
                'Đủ ngày công 3 tháng liên tiếp ' || to_char(make_date(p_nam, substring(v_key from 6 for 2)::int, 1), 'MM') || '–'
                  || to_char(make_date(p_nam, v_end_m, 1), 'MM/YYYY'),
                v_uid);
        v_changes := v_changes + 1;
      end if;
    end loop;

    -- Thu hồi chuỗi không còn đạt.
    for v_key, v_net in
      select l.chuoi_key, sum(l.so_ngay)::int from public.attendance_leave_ledger l
      where l.factory_id = p_factory_id and l.staff_id = v_staff and l.nam = p_nam and l.chuoi_key is not null
      group by l.chuoi_key
    loop
      if v_net > 0 and not (v_key = any(v_expected)) then
        select f.thang into v_bad
          from public.attendance_leave_flags_internal(p_factory_id, p_nam, array[v_staff]) f
          where f.thang between substring(v_key from 6 for 2)::int and substring(v_key from 15 for 2)::int
            and f.tinh_trang <> 'du'
          order by f.thang limit 1;
        insert into public.attendance_leave_ledger (factory_id, staff_id, nam, loai, so_ngay, chuoi_key, hieu_luc_tu, ly_do, created_by)
        values (p_factory_id, v_staff, p_nam, 'thu_hoi', -v_net, v_key,
                (make_date(p_nam, substring(v_key from 15 for 2)::int, 1) + interval '1 month')::date,
                case when v_bad is null
                  then 'Tự thu hồi: không còn đủ điều kiện (nhân viên Việt Nam)'
                  else 'Tự thu hồi: tháng ' || lpad(v_bad::text, 2, '0') || '/' || p_nam || ' không còn đủ ngày công' end,
                v_uid);
        v_changes := v_changes + 1;
      end if;
    end loop;
  end loop;
  return v_changes;
end $$;

-- ── 5. Admin cộng / trừ tay ─────────────────────────────────────────────────
create or replace function public.attendance_leave_adjust(
  p_factory_id uuid, p_staff_id uuid, p_nam integer, p_so_ngay integer, p_ly_do text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not public.current_profile_is_admin() then raise exception 'Chỉ admin được điều chỉnh sổ phép.'; end if;
  if v_ly_do is null then raise exception 'Bắt buộc nhập lý do.'; end if;
  if p_so_ngay is null or p_so_ngay = 0 or abs(p_so_ngay) > 60 then raise exception 'Số ngày điều chỉnh không hợp lệ.'; end if;
  if p_nam is null or p_nam < 2000 or p_nam > 2100 then raise exception 'Năm không hợp lệ.'; end if;
  if not exists (select 1 from public.maintenance_staff where id = p_staff_id and factory_id = p_factory_id) then
    raise exception 'Không tìm thấy nhân sự.';
  end if;
  if not public.attendance_leave_eligible(p_staff_id) then
    raise exception 'Chỉ nhân viên quốc tịch Việt Nam có sổ phép thưởng.';
  end if;
  insert into public.attendance_leave_ledger (factory_id, staff_id, nam, loai, so_ngay, chuoi_key, hieu_luc_tu, ly_do, created_by)
  values (p_factory_id, p_staff_id, p_nam, 'dieu_chinh', p_so_ngay, null, make_date(p_nam, 1, 1), v_ly_do, v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- ── 6. Chấm tay có "Dùng phép thưởng" (chép từ 20261205, thêm p_dung_phep_thuong) ──
drop function if exists public.attendance_set_days(uuid, uuid[], date[], text, text, text);

create or replace function public.attendance_set_days(
  p_factory_id uuid,
  p_staff_ids uuid[],
  p_ngays date[],
  p_trang_thai text,
  p_xep_loai text,
  p_ly_do text,
  p_dung_phep_thuong boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_xep text := case when p_trang_thai = 'co_mat' then coalesce(nullif(p_xep_loai, ''), 'A') else null end;
  v_dung boolean := coalesce(p_dung_phep_thuong, false);
  v_log_ly_do text;
  v_is_admin boolean := public.current_profile_is_admin();
  v_staff record;
  v_ngay date;
  v_old record;
  v_found boolean;
  v_avail_at integer;
  v_avail_year integer;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if p_trang_thai not in ('co_mat', 'nghi_tua', 'nghi_co_phep', 'nghi_khong_phep') then raise exception 'Trạng thái không hợp lệ.'; end if;
  if v_xep is not null and v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ được A hoặc B.'; end if;
  if v_dung and p_trang_thai <> 'nghi_co_phep' then raise exception 'Chỉ dùng phép thưởng cho ngày Nghỉ có phép.'; end if;
  if v_ly_do is null and not (p_trang_thai = 'co_mat' and v_xep = 'A') then
    raise exception 'Bắt buộc nhập lý do (chỉ "Có mặt" xếp loại A được bỏ trống).';
  end if;
  v_log_ly_do := coalesce(v_ly_do, 'Chấm có mặt (A)') || case when v_dung then ' (dùng phép thưởng)' else '' end;
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
    if v_dung and not public.attendance_leave_eligible(v_staff.id) then
      raise exception '% không có sổ phép thưởng (chỉ nhân viên quốc tịch Việt Nam).', v_staff.ten;
    end if;
    -- Ngày tăng dần để kiểm số dư theo thứ tự thời gian.
    foreach v_ngay in array (select array_agg(d order by d) from (select distinct unnest(p_ngays) d) x) loop
      if (v_staff.ngay_vao_lam is not null and v_ngay < v_staff.ngay_vao_lam)
         or (v_staff.ngay_nghi_viec is not null and v_ngay > v_staff.ngay_nghi_viec) then
        raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_ngay, 'DD/MM/YYYY');
      end if;
      select trang_thai, xep_loai, nguon, sheet_line_id, dung_phep_thuong into v_old
        from public.attendance_records
        where factory_id = p_factory_id and staff_id = v_staff.id and ngay = v_ngay
        for update;
      v_found := found;
      if v_found and v_old.sheet_line_id is not null and not v_is_admin then
        raise exception 'Ngày % của % đã duyệt từ phiếu điểm danh ca — không sửa được (chỉ admin).', to_char(v_ngay, 'DD/MM/YYYY'), v_staff.ten;
      end if;
      if v_found and v_old.sheet_line_id is not null and v_ly_do is null then
        raise exception 'Sửa ngày công đã duyệt từ phiếu ca phải nhập lý do.';
      end if;
      if v_found and v_old.trang_thai = p_trang_thai and v_old.xep_loai is not distinct from v_xep
         and v_old.nguon = 'bo_sung_tay' and v_old.dung_phep_thuong = v_dung then
        continue;
      end if;
      if v_dung and not (v_found and v_old.dung_phep_thuong) then
        -- Phép có hiệu lực tới ngày đó − đã dùng tới ngày đó (không tính chính ngày này).
        select
          coalesce((select sum(l.so_ngay) from public.attendance_leave_ledger l
                    where l.factory_id = p_factory_id and l.staff_id = v_staff.id
                      and l.nam = extract(year from v_ngay)::int and l.hieu_luc_tu <= v_ngay), 0)
          - (select count(*) from public.attendance_records r
             where r.factory_id = p_factory_id and r.staff_id = v_staff.id and r.dung_phep_thuong
               and r.ngay >= date_trunc('year', v_ngay)::date and r.ngay <= v_ngay and r.ngay <> v_ngay),
          coalesce((select sum(l.so_ngay) from public.attendance_leave_ledger l
                    where l.factory_id = p_factory_id and l.staff_id = v_staff.id
                      and l.nam = extract(year from v_ngay)::int), 0)
          - (select count(*) from public.attendance_records r
             where r.factory_id = p_factory_id and r.staff_id = v_staff.id and r.dung_phep_thuong
               and extract(year from r.ngay) = extract(year from v_ngay) and r.ngay <> v_ngay)
        into v_avail_at, v_avail_year;
        if v_avail_at < 1 or v_avail_year < 1 then
          raise exception '% không còn phép thưởng dùng được cho ngày % (phép năm nào dùng trong năm đó, từ tháng sau chuỗi).',
            v_staff.ten, to_char(v_ngay, 'DD/MM/YYYY');
        end if;
      end if;
      insert into public.attendance_records (factory_id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, dung_phep_thuong, updated_by)
      values (p_factory_id, v_staff.id, v_ngay, p_trang_thai, 'bo_sung_tay', v_xep, v_ly_do, v_dung, v_uid)
      on conflict (factory_id, staff_id, ngay) do update
        set trang_thai = excluded.trang_thai, nguon = excluded.nguon, xep_loai = excluded.xep_loai,
            ly_do = excluded.ly_do, dung_phep_thuong = excluded.dung_phep_thuong, updated_by = excluded.updated_by;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (p_factory_id, v_staff.id, v_ngay, 'cham', v_old.trang_thai, p_trang_thai,
        v_old.xep_loai, v_xep, v_old.nguon, 'bo_sung_tay', v_log_ly_do, v_uid);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- ── 7. Quyền thực thi ─────────────────────────────────────────────────────────
revoke all on function public.attendance_leave_eligible(uuid) from public, anon;
revoke all on function public.attendance_leave_flags_internal(uuid, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.attendance_leave_month_flags(uuid, integer) from public, anon;
revoke all on function public.attendance_leave_recompute(uuid, integer, uuid[]) from public, anon;
revoke all on function public.attendance_leave_adjust(uuid, uuid, integer, integer, text) from public, anon;
revoke all on function public.attendance_set_days(uuid, uuid[], date[], text, text, text, boolean) from public, anon;
grant execute on function public.attendance_leave_eligible(uuid) to authenticated;
grant execute on function public.attendance_leave_month_flags(uuid, integer) to authenticated;
grant execute on function public.attendance_leave_recompute(uuid, integer, uuid[]) to authenticated;
grant execute on function public.attendance_leave_adjust(uuid, uuid, integer, integer, text) to authenticated;
grant execute on function public.attendance_set_days(uuid, uuid[], date[], text, text, text, boolean) to authenticated;

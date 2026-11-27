-- Chấm công A2 (2026-11-26): người của TỔ (đơn vị loại 'to') phải chọn ca làm (Ca A/B/C, nhiều ca; "Cả ngày" = đủ mọi ca).
-- - attendance_sheet_lines.ca_lam text[]: mã đơn vị loại 'ca' đang dùng. NULL = dòng cũ / dòng của Ca sản xuất.
-- - attendance_save_section (chép NGUYÊN từ 20261210, chỉ thêm ca_lam): kiểm mã hợp lệ; nháp KHÔNG bắt buộc.
-- - attendance_submit_section (chép NGUYÊN từ 20261206, chỉ thêm kiểm): phiếu tổ ⇒ mọi dòng CÓ việc phải có ca_lam.
-- Về sau mọi CREATE OR REPLACE attendance_save_section / attendance_submit_section PHẢI chép từ file này.
-- Chạy tay trong Supabase SQL Editor TRƯỚC deploy. An toàn chạy lại.

alter table public.attendance_sheet_lines add column if not exists ca_lam text[];

comment on column public.attendance_sheet_lines.ca_lam is
  'A2: mã đơn vị loại ca (Ca A/B/C) mà người của TỔ làm. NULL = dòng cũ hoặc dòng Ca sản xuất.';

-- ── Lưu phiếu con (thân chép từ 20261210 + ca_lam) ─────────────────────────────
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
  v_is_to boolean;
  v_ca_lam text[];
  v_bad text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  select exists (
    select 1 from public.attendance_units u
    where u.factory_id = v_sec.factory_id and u.code = v_sec.ca and u.loai = 'to'
  ) into v_is_to;

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

    -- A2: ca làm (chỉ phiếu của TỔ). Nháp được để trống; bắt buộc ở bước Gửi.
    v_ca_lam := null;
    if v_is_to then
      select array_agg(distinct btrim(x) order by btrim(x)) into v_ca_lam
        from jsonb_array_elements_text(case when jsonb_typeof(v_line -> 'ca_lam') = 'array' then v_line -> 'ca_lam' else '[]'::jsonb end) x
        where btrim(x) <> '';
      if v_ca_lam is not null then
        select string_agg(c, ', ') into v_bad from unnest(v_ca_lam) c
          where not exists (
            select 1 from public.attendance_units u
            where u.factory_id = v_sec.factory_id and u.code = c and u.loai = 'ca' and u.is_active
          );
        if v_bad is not null then raise exception 'Ca làm không hợp lệ (%): %.', v_staff.ten, v_bad; end if;
      end if;
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai, ca_lam)
    values (
      coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid()), p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      nullif(v_line ->> 'vehicle_id', '')::uuid, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false),
      v_ca_lam);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── Gửi phiếu con (thân chép từ 20261206 + kiểm ca làm của tổ) ─────────────────
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.section_id = p_section_id and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;

  -- A2: phiếu của TỔ ⇒ mọi dòng có việc phải chọn ca làm (tên = người làm thật: người thay nếu có).
  if exists (
    select 1 from public.attendance_units u
    where u.factory_id = v_sec.factory_id and u.code = v_sec.ca and u.loai = 'to'
  ) then
    select string_agg(coalesce(mt.ten, nullif(l.thay_the_ten, ''), ms.ten), ', ') into v_missing
      from public.attendance_sheet_lines l
      join public.maintenance_staff ms on ms.id = l.staff_id
      left join public.maintenance_staff mt on mt.id = l.thay_the_staff_id
      where l.section_id = p_section_id
        and coalesce(array_length(l.cong_viec_ids, 1), 0) > 0
        and coalesce(array_length(l.ca_lam, 1), 0) = 0;
    if v_missing is not null then raise exception 'Chưa chọn ca làm cho: %.', v_missing; end if;
  end if;

  update public.attendance_sheet_sections
    set trang_thai = 'da_gui', gui_luc = now(), gui_boi = auth.uid(), tra_ve_ly_do = null
    where id = p_section_id;
  perform public.attendance_recompute_sheet(v_sec.sheet_id);

  select s.ma_phieu, s.day_chuyen, sec.ca into v_info
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id;
  insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
  select v_sec.factory_id, p.id, 'diem_danh_cho_duyet', v_sec.sheet_id, 'attendance_sheet',
         'Phiếu điểm danh chờ duyệt',
         v_info.ma_phieu || ' · ' || v_info.day_chuyen || ' · Ca ' || coalesce(v_info.ca, '') || ' (' || v_n || ' người)',
         '/dashboard/attendance/sheet/' || v_sec.sheet_id
  from public.profiles p
  where p.factory_id = v_sec.factory_id and p.status = 'active' and p.id <> auth.uid()
    and (public.attendance_user_has_permission(p.id, 'attendance.approve')
         or public.attendance_user_has_permission(p.id, 'attendance.mark_all'));
  return 'da_gui';
end $$;

revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;

-- Kiểm chứng:
--   select l.staff_id, l.cong_viec_ids, l.ca_lam from attendance_sheet_lines l where l.ca_lam is not null limit 20;

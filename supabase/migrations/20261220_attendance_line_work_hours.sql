-- Chấm công A2 — sửa sau test 2026-11-26: bỏ khung ngày/đêm trên màn điểm danh + bỏ thẻ ngày/đêm khi phân việc.
-- Tổ theo khung giờ nay ghi GIỜ LÀM TỪNG NGƯỜI (attendance_sheet_lines.gio_bd / gio_kt), hiện sau khi chọn việc, tự điền:
--   auto (Tổ tiếp nhận mủ tạp) ⇒ theo giờ điểm danh: 5h–17h ⇒ 05:00–17:00, còn lại ⇒ 17:00–05:00;
--   24h (Tổ XLNT) ⇒ 05:00–05:00;  ngay (Đội xe cơ khí / sửa chữa cơ khí) ⇒ 05:00–17:00. Sửa được.
-- Phiếu TKSX khối tổ theo khung chia nhóm theo giờ làm ("05:00 – 17:00" / "17:00 – 05:00").
-- viec_theo_khung + attendance_sheet_sections.khung_gio (20261219) để lại, không dùng nữa.
-- Về sau mọi CREATE OR REPLACE attendance_save_section / attendance_submit_section PHẢI chép từ file này.
-- Chạy tay trong Supabase SQL Editor (sau 20261219). An toàn chạy lại.

-- ── 1. Cột + chế độ khung ──────────────────────────────────────────────────────
alter table public.attendance_sheet_lines add column if not exists gio_bd text;
alter table public.attendance_sheet_lines add column if not exists gio_kt text;
comment on column public.attendance_sheet_lines.gio_bd is 'Tổ theo khung giờ: giờ bắt đầu làm của người (HH:MM).';
comment on column public.attendance_sheet_lines.gio_kt is 'Tổ theo khung giờ: giờ kết thúc (HH:MM, nhỏ hơn giờ bắt đầu = sang ngày hôm sau).';
comment on column public.attendance_sheet_lines.viec_theo_khung is 'LEGACY (20261219) — không dùng nữa.';
comment on column public.attendance_sheet_sections.khung_gio is 'LEGACY (20261219) — không dùng nữa.';

alter table public.attendance_units drop constraint if exists attendance_units_khung_mac_dinh_check;
alter table public.attendance_units add constraint attendance_units_khung_mac_dinh_check
  check (khung_mac_dinh is null or khung_mac_dinh in ('auto', '24h', 'ngay'));
comment on column public.attendance_units.khung_mac_dinh is
  'NULL = tổ/ca thường; auto = giờ làm theo giờ điểm danh (ngày 05–17 / đêm 17–05); 24h = 05–05; ngay = 05–17.';
update public.attendance_units set khung_mac_dinh = 'ngay' where code = 'XE_CK';

-- ── 2. Lưu phiếu con (chép 20261219; tổ theo khung: giờ làm TỪNG NGƯỜI gio_bd/gio_kt thay viec_theo_khung) ──
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
  v_khung_mode text;
  v_old_by_id jsonb;
  v_old_by_staff jsonb;
  v_line_id uuid;
  v_giao timestamptz;
  v_bd text;
  v_kt text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  -- Đơn vị của phiếu (attendance_lock_section_for_edit KHÔNG trả cột ca).
  select u.khung_mac_dinh into v_khung_mode
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;

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

  -- Giữ giờ giao việc cũ (lưu = xoá + chèn lại dòng): theo id dòng, dự phòng theo người.
  select coalesce(jsonb_object_agg(l.id::text, l.giao_luc), '{}'::jsonb),
         coalesce(jsonb_object_agg(l.staff_id::text, l.giao_luc), '{}'::jsonb)
    into v_old_by_id, v_old_by_staff
    from public.attendance_sheet_lines l
    where l.section_id = p_section_id and l.giao_luc is not null;

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

    -- Tổ theo khung: giờ làm của người (HH:MM). Nháp được trống; bắt buộc khi Gửi.
    v_bd := null; v_kt := null;
    if v_khung_mode is not null and cardinality(v_jobs) > 0 then
      v_bd := nullif(btrim(coalesce(v_line ->> 'gio_bd', '')), '');
      v_kt := nullif(btrim(coalesce(v_line ->> 'gio_kt', '')), '');
      if (v_bd is not null and v_bd !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
         or (v_kt is not null and v_kt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
        raise exception 'Giờ làm của % phải dạng HH:MM.', v_staff.ten;
      end if;
    end if;

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

    v_line_id := coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid());
    v_giao := null;
    if cardinality(v_jobs) > 0 then
      v_giao := coalesce((v_old_by_id ->> v_line_id::text)::timestamptz, (v_old_by_staff ->> v_staff_id::text)::timestamptz, now());
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai,
      giao_luc, gio_bd, gio_kt)
    values (
      v_line_id, p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      nullif(v_line ->> 'vehicle_id', '')::uuid, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false),
      v_giao, v_bd, v_kt);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── 3. Gửi phiếu con (chép 20261219; tổ theo khung ⇒ dòng có việc phải có giờ làm) ────
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
  v_khung_mode text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.section_id = p_section_id and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;

  select u.khung_mac_dinh into v_khung_mode
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;
  if v_khung_mode is not null then
    select string_agg(coalesce(mt.ten, nullif(l.thay_the_ten, ''), ms.ten), ', ') into v_missing
      from public.attendance_sheet_lines l
      join public.maintenance_staff ms on ms.id = l.staff_id
      left join public.maintenance_staff mt on mt.id = l.thay_the_staff_id
      where l.section_id = p_section_id
        and coalesce(array_length(l.cong_viec_ids, 1), 0) > 0
        and (l.gio_bd is null or l.gio_kt is null);
    if v_missing is not null then raise exception 'Chưa có giờ làm cho: %.', v_missing; end if;
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
--   select code, ten, khung_mac_dinh from attendance_units order by sort_order;
--   select staff_id, cong_viec_ids, gio_bd, gio_kt, giao_luc from attendance_sheet_lines where gio_bd is not null limit 20;

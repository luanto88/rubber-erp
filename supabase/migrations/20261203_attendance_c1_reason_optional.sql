-- Module Chấm công — C1 sau test tay (2026-11-20): chấm "Có mặt" xếp loại A KHÔNG bắt buộc lý do.
-- Các trường hợp khác (Có mặt xếp B, nghỉ tua / có phép / không phép, xoá chấm) vẫn bắt buộc lý do.
-- Nhật ký (attendance_logs.ly_do NOT NULL) ghi chữ mặc định "Chấm có mặt (A)" khi không nhập.
-- Chạy TAY trên Supabase SQL Editor SAU 20261202_attendance_c1_records.sql. Idempotent.
-- Về sau mọi CREATE OR REPLACE attendance_set_days PHẢI chép từ file này.

alter table public.attendance_records drop constraint if exists attendance_records_ly_do_tay;
alter table public.attendance_records add constraint attendance_records_ly_do_tay check (
  nguon <> 'bo_sung_tay'
  or nullif(btrim(ly_do), '') is not null
  or (trang_thai = 'co_mat' and xep_loai = 'A')
);

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
        v_old.xep_loai, v_xep, v_old.nguon, 'bo_sung_tay', v_log_ly_do, v_uid);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

revoke all on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) from public, anon;
grant execute on function public.attendance_set_days(uuid, uuid[], date[], text, text, text) to authenticated;

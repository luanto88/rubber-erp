-- Module Chấm công — sửa sau test GĐ3 (2026-11-24).
-- 1. Ràng buộc attendance_logs.hanh_dong trên DB thật CHƯA có 'mo_lai_phieu' (phần đó của 20261207 không được áp dụng)
--    ⇒ "Mở lại để sửa" lỗi. Thêm lại + 'xoa_phieu'.
-- 2. RPC attendance_delete_sheet(p_sheet_id, p_ly_do): CHỈ admin xoá cả phiếu điểm danh ngày (mọi phiếu ca + dòng).
--    Ngày công nguồn truc_ca lấy từ phiếu này được tính lại từ phiếu ca đã duyệt KHÁC cùng ngày (cùng quy tắc duyệt);
--    không còn nguồn ⇒ xoá ngày công đó. Chấm tay giữ nguyên. Nhật ký 'xoa_phieu' (bất biến).
-- 3. Bản cứng F01/F02 bất biến giữ làm lịch sử: bỏ khoá ngoại sheet_id → attendance_daily_sheets để xoá được phiếu.
-- Chạy TAY trên Supabase SQL Editor SAU 20261208. Idempotent.

alter table public.attendance_logs drop constraint if exists attendance_logs_hanh_dong_check;
alter table public.attendance_logs add constraint attendance_logs_hanh_dong_check
  check (hanh_dong in ('cham', 'xoa', 'duyet_phieu', 'mo_lai_phieu', 'xoa_phieu'));

alter table public.attendance_sheet_snapshots drop constraint if exists attendance_sheet_snapshots_sheet_id_fkey;
comment on column public.attendance_sheet_snapshots.sheet_id is
  'Phiếu điểm danh lúc dựng bản cứng (không khoá ngoại — phiếu có thể bị admin xoá, bản cứng giữ làm lịch sử).';

create or replace function public.attendance_delete_sheet(p_sheet_id uuid, p_ly_do text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid := public.current_profile_factory_id();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_sheet record;
  v_sid uuid;
  v_staff uuid[];
  v_old record;
  v_new_status text;
  v_new_xep text;
  v_new_ly_do text;
  v_line_id uuid;
  v_updated int := 0;
  v_deleted int := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.current_profile_is_admin() then raise exception 'Chỉ quản trị viên được xoá phiếu điểm danh.'; end if;
  if v_ly_do is null then raise exception 'Xoá phiếu phải nhập lý do.'; end if;

  select s.id, s.factory_id, s.ngay, s.ma_phieu into v_sheet
    from public.attendance_daily_sheets s where s.id = p_sheet_id for update;
  if not found or v_sheet.factory_id is distinct from v_fid then raise exception 'Không tìm thấy phiếu điểm danh.'; end if;

  -- Người có ngày công có thể lấy từ phiếu này (dòng của phiếu ca đã duyệt + người thay).
  select coalesce(array_agg(distinct x), '{}') into v_staff from (
    select l.staff_id as x from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      where l.sheet_id = p_sheet_id and sec.trang_thai = 'da_duyet'
    union
    select l.thay_the_staff_id from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      where l.sheet_id = p_sheet_id and sec.trang_thai = 'da_duyet' and l.diem_danh = 'vang' and l.thay_the_staff_id is not null
  ) t;

  -- Loại phiếu này khỏi nguồn tính trước khi tính lại, rồi xoá hẳn.
  delete from public.attendance_daily_sheets where id = p_sheet_id;

  foreach v_sid in array v_staff loop
    v_new_status := null; v_new_xep := null; v_new_ly_do := null; v_line_id := null;
    with src as (
      select l.id, l.diem_danh, l.xep_loai, l.vang_loai, l.ly_do, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.staff_id = v_sid and s.ngay = v_sheet.ngay and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
      union all
      select l.id, 'co', 'A', null, null, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.thay_the_staff_id = v_sid and l.diem_danh = 'vang'
        and s.ngay = v_sheet.ngay and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
    )
    select
      case when bool_or(src.diem_danh = 'co') then 'co_mat'
           when bool_or(src.vang_loai = 'khong_phep') then 'nghi_khong_phep'
           else 'nghi_co_phep' end,
      case when bool_or(src.diem_danh = 'co') then case when bool_or(src.xep_loai = 'B') then 'B' else 'A' end end,
      (array_agg(src.ly_do order by src.updated_at desc) filter (where src.vang_loai = 'khong_phep'))[1],
      (array_agg(src.id order by (src.diem_danh = 'co') desc, src.updated_at desc))[1]
      into v_new_status, v_new_xep, v_new_ly_do, v_line_id
    from src
    having count(*) > 0;

    select id, trang_thai, xep_loai, nguon into v_old
      from public.attendance_records
      where factory_id = v_fid and staff_id = v_sid and ngay = v_sheet.ngay
      for update;
    if not found or v_old.nguon <> 'truc_ca' then continue; end if;

    if v_new_status is null then
      delete from public.attendance_records where id = v_old.id;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (v_fid, v_sid, v_sheet.ngay, 'xoa_phieu', v_old.trang_thai, null, v_old.xep_loai, null, v_old.nguon, null,
              'Xoá phiếu ' || v_sheet.ma_phieu || ' — ' || v_ly_do, v_uid);
      v_deleted := v_deleted + 1;
    else
      if v_new_status <> 'co_mat' then v_new_xep := null; end if;
      if v_new_status <> 'nghi_khong_phep' then v_new_ly_do := null; end if;
      update public.attendance_records
        set trang_thai = v_new_status, xep_loai = v_new_xep, ly_do = v_new_ly_do, dung_phep_thuong = false,
            updated_by = v_uid, sheet_line_id = v_line_id
        where id = v_old.id;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (v_fid, v_sid, v_sheet.ngay, 'xoa_phieu', v_old.trang_thai, v_new_status, v_old.xep_loai, v_new_xep,
              v_old.nguon, 'truc_ca', 'Xoá phiếu ' || v_sheet.ma_phieu || ' — ' || v_ly_do, v_uid);
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('records_updated', v_updated, 'records_deleted', v_deleted);
end $$;

revoke all on function public.attendance_delete_sheet(uuid, text) from public, anon;
grant execute on function public.attendance_delete_sheet(uuid, text) to authenticated;

-- Kiểm chứng:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'attendance_logs_hanh_dong_check';

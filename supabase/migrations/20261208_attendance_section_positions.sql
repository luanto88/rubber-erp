-- Module Chấm công — GĐ3 mục 1b: VỊ TRÍ PHỤ TRÁCH trên phiếu ca (2026-11-23).
-- Người dùng chốt: (a) người giữ vị trí tính CÓ MẶT A dù không có việc; (b) người gốc bị thay ⇒ tự VẮNG, chọn phép lúc
-- gửi; (c) cả 3 tổ (ca SX, Tổ tiếp nhận, Cơ điện – nâng hàng); (d) Ca trưởng = Tổ trưởng ca (1 ô).
--
-- 1. attendance_sheet_sections.vi_tri jsonb: {"ca_san_xuat.to_truong": {"staff_id": uuid|null, "goc_staff_id": uuid|null}, …}
--    6 khoá: ca_san_xuat / tiep_nhan / co_dien × to_truong / to_pho. {} = chưa từng lưu (màn trực ca điền mặc định).
-- 2. attendance_save_section nhận p_header.vi_tri (chép từ 20261206 — thân dòng KHÔNG đổi): kiểm khoá + nhân sự thuộc nhà
--    máy, ghi vi_tri, đồng bộ to_truong_staff_id / to_pho_staff_id (= ca SX) và ca_truong_ten (= tên người giữ Ca trưởng).
--    Dòng "có mặt A" của người giữ vị trí + dòng "vắng có người thay" của người gốc do màn trực ca gửi kèm p_lines.
-- Chạy TAY trên Supabase SQL Editor SAU 20261207, TRƯỚC deploy. Idempotent.
-- Về sau mọi CREATE OR REPLACE attendance_save_section PHẢI chép từ file này.

alter table public.attendance_sheet_sections add column if not exists vi_tri jsonb not null default '{}'::jsonb;
comment on column public.attendance_sheet_sections.vi_tri is
  'Vị trí phụ trách: {"<pham_vi>.<to_truong|to_pho>": {"staff_id", "goc_staff_id"}}. Ca trưởng = ca_san_xuat.to_truong.';

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
  v_ca_truong uuid;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu ca.'; end if;

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  -- Vị trí phụ trách (chỉ khi client gửi; client cũ không gửi ⇒ giữ nguyên).
  if jsonb_typeof(p_header -> 'vi_tri') = 'object' then
    v_vt := '{}'::jsonb;
    for v_kv in select key, value from jsonb_each(p_header -> 'vi_tri') loop
      if v_kv.key not in ('ca_san_xuat.to_truong', 'ca_san_xuat.to_pho', 'tiep_nhan.to_truong', 'tiep_nhan.to_pho',
                          'co_dien.to_truong', 'co_dien.to_pho') then
        raise exception 'Vị trí không hợp lệ (%).', v_kv.key;
      end if;
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
    v_ca_truong := nullif(v_vt -> 'ca_san_xuat.to_truong' ->> 'staff_id', '')::uuid;
    update public.attendance_sheet_sections set
      vi_tri = v_vt,
      to_truong_staff_id = v_ca_truong,
      to_pho_staff_id = nullif(v_vt -> 'ca_san_xuat.to_pho' ->> 'staff_id', '')::uuid,
      ca_truong_ten = coalesce((select ms.ten from public.maintenance_staff ms where ms.id = v_ca_truong), ca_truong_ten)
    where id = p_section_id;
  end if;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;
    if v_staff_id = any(v_seen) then raise exception '% có 2 dòng trong cùng phiếu ca.', v_staff.ten; end if;
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
--   select column_name from information_schema.columns where table_name = 'attendance_sheet_sections' and column_name = 'vi_tri';

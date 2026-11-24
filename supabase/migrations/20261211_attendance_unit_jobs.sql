-- Chấm công — Ca/Tổ: dây chuyền + việc gắn theo tổ (rule 31, người dùng chốt 2026-11-24). CHẠY TAY sau 20261210.
--
-- Người dùng chốt:
--  * Nhóm nhân sự chỉ còn là nhóm CHUYÊN MÔN (KPI, người thực hiện biên bản bảo trì, người trực xuất hàng) — màn điểm danh
--    KHÔNG còn thẻ nhóm; điểm danh CHỈ theo Ca/Tổ được phân công.
--  * Ca A/B/C: chọn dây chuyền khi điểm danh, việc = việc ca sản xuất của dây chuyền đó.
--  * Tổ tiếp nhận mủ tạp (Mủ tạp), Tổ tiếp nhận mủ nước (Mủ nước, MỚI) thuộc 1 dây chuyền.
--  * Tổ độc lập (Cơ điện – Bảo trì – Xe nâng, Xử lý nước thải, Đội xe cơ khí MỚI): không thuộc dây chuyền, nhưng vẫn
--    điểm danh RIÊNG cho từng dây chuyền (tổ trưởng phân công người khác nhau) ⇒ in ở cả TKSXMT lẫn TKSXMN; cùng 1 người
--    có ở cả 2 thì in cả 2 phiếu, ngày công vẫn tính 1 lần.
--  * Việc của TỔ gắn theo tổ (attendance_job_types.unit_code), không theo dây chuyền; việc của CA theo dây chuyền.
--
-- Về sau mọi CREATE OR REPLACE attendance_open_section PHẢI chép từ file này.

-- ── 1. Dây chuyền của Ca/Tổ ──────────────────────────────────────────────────
alter table public.attendance_units add column if not exists day_chuyen text;
alter table public.attendance_units drop constraint if exists attendance_units_day_chuyen_check;
alter table public.attendance_units add constraint attendance_units_day_chuyen_check
  check (day_chuyen is null or day_chuyen in ('Mủ tạp', 'Mủ nước'));
comment on column public.attendance_units.day_chuyen is
  'NULL = chọn dây chuyền khi điểm danh (Ca A/B/C, tổ độc lập); Mủ tạp / Mủ nước = tổ chỉ thuộc dây chuyền đó.';

update public.attendance_units set day_chuyen = 'Mủ tạp' where code = 'TN_MT' and day_chuyen is null;

insert into public.attendance_units (factory_id, code, ten, loai, to_nhom, day_chuyen, sort_order)
select f.id, 'TN_MN', 'Tổ tiếp nhận mủ nước', 'to', 'tiep_nhan', 'Mủ nước', 15 from public.factories f
on conflict (factory_id, code) do nothing;
insert into public.attendance_units (factory_id, code, ten, loai, to_nhom, day_chuyen, sort_order)
select f.id, 'XE_CK', 'Đội xe cơ khí', 'to', null, null, 35 from public.factories f
on conflict (factory_id, code) do nothing;

-- ── 2. Việc gắn theo Ca/Tổ ───────────────────────────────────────────────────
alter table public.attendance_job_types add column if not exists unit_code text;
comment on column public.attendance_job_types.unit_code is
  'Mã Ca/Tổ (attendance_units.code) của việc của TỔ; NULL = việc ca sản xuất theo day_chuyen (dùng cho mọi Ca).';
alter table public.attendance_job_types alter column day_chuyen drop not null;
alter table public.attendance_job_types drop constraint if exists attendance_job_types_day_chuyen_check;
alter table public.attendance_job_types add constraint attendance_job_types_day_chuyen_check
  check (day_chuyen is null or day_chuyen in ('Mủ tạp', 'Mủ nước'));
drop index if exists public.uniq_attendance_job_types_name;
create unique index if not exists uniq_attendance_job_types_name2
  on public.attendance_job_types (factory_id, coalesce(unit_code, ''), coalesce(day_chuyen, ''), to_nhom, lower(btrim(ten)));
create index if not exists idx_attendance_job_types_unit on public.attendance_job_types (factory_id, unit_code);

-- Tiếp nhận mủ tạp ⇒ TN_MT
update public.attendance_job_types set unit_code = 'TN_MT'
  where unit_code is null and to_nhom = 'tiep_nhan' and day_chuyen = 'Mủ tạp';
-- "Trực hồ XLNT" ⇒ Tổ xử lý nước thải (độc lập)
update public.attendance_job_types set unit_code = 'XLNT', day_chuyen = null
  where unit_code is null and to_nhom = 'tiep_nhan' and btrim(ten) = 'Trực hồ XLNT';
-- Tiếp nhận mủ nước còn lại ⇒ TN_MN
update public.attendance_job_types set unit_code = 'TN_MN'
  where unit_code is null and to_nhom = 'tiep_nhan' and day_chuyen = 'Mủ nước';
-- Cơ điện: bản Mủ tạp ⇒ việc CHUNG của tổ CD (bỏ dây chuyền); bản Mủ nước trùng tên ⇒ ngừng dùng (dòng cũ vẫn trỏ được).
update public.attendance_job_types j set is_active = false, unit_code = 'CD'
  where j.unit_code is null and j.to_nhom = 'co_dien' and j.day_chuyen = 'Mủ nước'
    and exists (select 1 from public.attendance_job_types k
                where k.factory_id = j.factory_id and k.to_nhom = 'co_dien' and k.day_chuyen = 'Mủ tạp'
                  and lower(btrim(k.ten)) = lower(btrim(j.ten)));
update public.attendance_job_types set unit_code = 'CD', day_chuyen = null
  where unit_code is null and to_nhom = 'co_dien';

-- ── 3. Mở phiếu con: kiểm dây chuyền cố định của tổ (chép từ 20261210, thêm v_unit.day_chuyen) ─────
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
  select u.code, u.ten, u.loai, u.is_active, u.day_chuyen into v_unit
    from public.attendance_units u where u.factory_id = p_factory_id and u.code = v_ca;
  if not found or not v_unit.is_active then raise exception 'Ca/Tổ không hợp lệ hoặc đã ngừng dùng.'; end if;
  if v_unit.day_chuyen is not null and v_unit.day_chuyen <> p_day_chuyen then
    raise exception '% chỉ thuộc dây chuyền %.', v_unit.ten, v_unit.day_chuyen;
  end if;
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

-- ── 4. Thẻ nhóm trên màn điểm danh: tắt (nhóm chỉ còn là chuyên môn) ─────────
update public.personnel_groups set hien_diem_danh = false where hien_diem_danh;

-- Kiểm tra sau khi chạy:
--   select code, ten, loai, day_chuyen, sort_order from attendance_units order by sort_order;
--   select unit_code, day_chuyen, to_nhom, ten, is_active from attendance_job_types order by unit_code nulls first, day_chuyen, sort_order;

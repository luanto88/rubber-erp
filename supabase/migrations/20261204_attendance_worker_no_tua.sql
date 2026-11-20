-- Module Chấm công — Công nhân KHÔNG có chế độ nghỉ tua (2026-11-20, người dùng chốt).
-- Công nhân là người địa phương, hưởng lương theo công thực tế + sản lượng tháng; ngày nghỉ chỉ là
-- có phép / không phép (dùng cùng xếp loại A/B để phân loại thi đua cuối năm).
-- Chặn ở tầng DB bằng trigger trên attendance_records ⇒ phủ mọi đường ghi (chấm tay, trực ca C2, tự động sau này).
-- Chạy TAY trên Supabase SQL Editor SAU 20261203. Idempotent.
--
-- Kiểm dữ liệu cũ TRƯỚC khi chạy (phải ra 0 dòng; có dòng ⇒ chấm lại các ô đó trước):
--   select ms.ten, r.ngay from attendance_records r join maintenance_staff ms on ms.id = r.staff_id
--   where r.trang_thai = 'nghi_tua' and ms.loai_nhan_su = 'cong_nhan' order by 1, 2;

create or replace function public.attendance_records_worker_no_tua()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ten text;
begin
  if new.trang_thai = 'nghi_tua' then
    select ms.ten into v_ten from public.maintenance_staff ms
      where ms.id = new.staff_id and ms.loai_nhan_su = 'cong_nhan';
    if found then
      raise exception '% là công nhân — không có chế độ nghỉ tua (chỉ nghỉ có phép / không phép).', v_ten;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_attendance_records_worker_no_tua on public.attendance_records;
create trigger trg_attendance_records_worker_no_tua before insert or update of trang_thai, staff_id on public.attendance_records
  for each row execute function public.attendance_records_worker_no_tua();

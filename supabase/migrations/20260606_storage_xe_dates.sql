alter table ngans
  add column if not exists xe_tu_ngay date,
  add column if not exists xe_den_ngay date;

update ngans
set
  xe_tu_ngay = coalesce(xe_tu_ngay, ngay_bd + 1),
  xe_den_ngay = coalesce(xe_den_ngay, ngay_kt + 1)
where ngay_bd is not null;

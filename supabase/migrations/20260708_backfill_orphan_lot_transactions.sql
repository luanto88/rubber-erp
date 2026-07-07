-- Backfill lot_transactions cho cac lo "mo coi" (lots.tong_banh > 0 nhung khong
-- co bat ky lot_transactions nao) — hau qua cua thao tac tay ngoai luong app
-- (Supabase Table Editor "Export as CSV" -> sua id -> "Insert data from CSV" de
-- ghi de truc tiep vao bang `lots`, bo qua hoan toan `lot_transactions`).
-- Xem chi tiet: .claude/rules/06-module-production.md muc "Invariant bat buoc:
-- moi lo co tong_banh > 0 phai co lot_transactions backing".
--
-- Xac nhan 2026-07-08 (SELECT truc tiep tren DB that): dung 21 lo con lai thuoc
-- nhom nay, toan bo deu o trang thai "Xuat hang", da co du du lieu can thiet
-- (kien_a-d, tong_banh, tong_kg, ngan_id, ca, ngay_sx/ngay_ht) — day la dung 21 lo
-- da duoc ghi nhan la "co y chua backfill" tu su co 2026-07-01, khong tang them.
--
-- QUAN TRONG — day la backfill XAP XI, KHONG phai khoi phuc su that:
-- File CSV ghi de goc chi con giu lai SNAPSHOT CUOI CUNG cua moi lo (1 dong/lo),
-- nen lich su chi tiet that (co the lo da san xuat qua nhieu ngay/nhieu ca/nhieu
-- ngan khac nhau) da mat vinh vien. Migration nay tao DUNG 1 giao dich duy nhat
-- cho moi lo mo coi, copy y nguyen tong so lieu hien co tren `lots` — dam bao
-- dung TONG (kien_a-d/tong_banh/tong_kg khop UI/bao cao) nhung KHONG khoi phuc
-- duoc chi tiet ngay/ca/ngan that cua tung phan dong gop — giong dung cach da
-- lam va da chap nhan cho 65 lo truoc do (cung su co, da backfill 2026-07-03).
--
-- KHONG sua/xoa bat ky dong `lots` nao (id, ma_lo, kien_a-d, tong_banh giu nguyen
-- vi dang duoc export_orders/qc_results tham chieu that) — migration chi INSERT
-- them vao `lot_transactions`.
--
-- Dieu kien loc la dinh nghia CHINH XAC cua invariant vi pham (tong_banh > 0 VA
-- khong co lot_transactions), nen an toan de chay lai nhieu lan (idempotent qua
-- NOT EXISTS) va khong gioi han chi 21 lo hien tai — neu phat sinh lo mo coi moi
-- tu cung nguyen nhan (thao tac tay ngoai luong), migration nay van backfill dung.
--
-- Tat trigger trong luc insert de tranh trigger update_lot_master_totals() ghi
-- de sai trang_thai (ha cap nham lo da "Xuat hang", hoac ghi ASCII khong dau truoc
-- khi co fix trong 20260708_fix_lot_status_trigger.sql).

BEGIN;

ALTER TABLE lot_transactions DISABLE TRIGGER trigger_update_lot_master;

INSERT INTO lot_transactions (
  lot_id, ngan_id, ca, ngay_nhap,
  kien_a, kien_b, kien_c, kien_d, so_banh, so_kg
)
SELECT
  l.id,
  l.ngan_id,
  l.ca,
  COALESCE(l.ngay_ht, l.ngay_sx),
  l.kien_a, l.kien_b, l.kien_c, l.kien_d,
  l.tong_banh, l.tong_kg
FROM lots l
WHERE l.tong_banh > 0
  AND l.ngan_id IS NOT NULL
  AND l.ca IS NOT NULL
  AND COALESCE(l.ngay_ht, l.ngay_sx) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM lot_transactions lt WHERE lt.lot_id = l.id
  );

ALTER TABLE lot_transactions ENABLE TRIGGER trigger_update_lot_master;

COMMIT;

-- Verify sau khi chay (chay rieng, khong nam trong transaction tren):
-- SELECT COUNT(*) AS con_mo_coi
-- FROM lots l
-- WHERE l.tong_banh > 0
--   AND NOT EXISTS (SELECT 1 FROM lot_transactions lt WHERE lt.lot_id = l.id);
-- Ky vong: 0 (hoac chi con lai cac lo thieu ngan_id/ca/ngay — can ra soat tay rieng).

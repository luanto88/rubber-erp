-- Fix: trigger update_lot_master_totals() ghi trang_thai bang ASCII khong dau
-- ('Hoan thanh' / 'Do dang'), khac chuan co dau ('Hoàn thành' / 'Dở dang') ma
-- toan bo app dung. Gay tach slice sai tren bieu do "Trang thai lo" o Dashboard
-- va rui ro am tham mat du lieu o cac noi filter .in("trang_thai", [...]) bang
-- gia tri co dau (vd warehouse/page.tsx, module-tasks.ts).
--
-- Bo sung: trigger truoc day co the "ha cap" nham 1 lo da "Xuat hang" ve lai
-- "Hoan thanh"/"Do dang" neu co giao dich lot_transactions cu bi sua/xoa sau
-- khi lo da xuat hang. Ban vaas nay giu nguyen trang_thai neu lo hien tai dang
-- la 'Xuat hang'.

CREATE OR REPLACE FUNCTION update_lot_master_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_tong_banh NUMERIC;
    v_tong_kg NUMERIC;
    v_loai_banh NUMERIC;
    v_lo_tron NUMERIC;
    v_trang_thai TEXT;
    v_current_status TEXT;
BEGIN
    -- Tinh tong so banh va kg tu tat ca cac giao dich cua lo nay
    SELECT COALESCE(SUM(so_banh), 0), COALESCE(SUM(so_kg), 0)
    INTO v_tong_banh, v_tong_kg
    FROM lot_transactions
    WHERE lot_id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Lay thong tin loai_banh va trang_thai hien tai tu bang lots
    SELECT loai_banh, trang_thai INTO v_loai_banh, v_current_status
    FROM lots WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Xac dinh quy tac lo tron (20kg -> 240 banh, khac -> 144 banh)
    IF v_loai_banh = 20 THEN v_lo_tron := 240; ELSE v_lo_tron := 144; END IF;

    -- Xac dinh trang thai moi (chuan co dau)
    IF v_tong_banh >= v_lo_tron THEN v_trang_thai := 'Hoàn thành'; ELSE v_trang_thai := 'Dở dang'; END IF;

    IF v_current_status = 'Xuất hàng' THEN
        -- Lo da xuat hang: chi cap nhat lai tong banh/kg, khong ha cap trang_thai
        UPDATE lots
        SET tong_banh = v_tong_banh, tong_kg = v_tong_kg
        WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);
    ELSE
        UPDATE lots
        SET tong_banh = v_tong_banh, tong_kg = v_tong_kg, trang_thai = v_trang_thai
        WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger da ton tai tu 20260515_refactor_lots_master_detail.sql, khong can
-- tao lai, chi CREATE OR REPLACE function la du vi trigger tham chieu ten ham.

-- Chuan hoa du lieu hien co: cac dong lots.trang_thai dang mang gia tri ASCII
-- khong dau do trigger cu ghi truoc khi co fix nay.
UPDATE lots SET trang_thai = 'Hoàn thành' WHERE trang_thai = 'Hoan thanh';
UPDATE lots SET trang_thai = 'Dở dang' WHERE trang_thai = 'Do dang';

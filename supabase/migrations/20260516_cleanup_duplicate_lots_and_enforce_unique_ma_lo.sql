-- Archive and remove duplicate lot rows that share the same business lot code.
-- Keep the "best" snapshot per (factory_id, ma_lo), then enforce uniqueness
-- so one business lot can no longer be split into multiple master rows.

CREATE TABLE IF NOT EXISTS lot_duplicate_archive (
    source_lot_id UUID PRIMARY KEY,
    factory_id UUID NOT NULL,
    ma_lo TEXT NOT NULL,
    reason TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lot_row JSONB NOT NULL,
    transactions JSONB NOT NULL DEFAULT '[]'::JSONB
);

UPDATE lots
SET trang_thai = CASE
    WHEN lower(trim(trang_thai)) IN ('do dang', 'dở dang') THEN 'Dở dang'
    WHEN lower(trim(trang_thai)) IN ('hoan thanh', 'hoàn thành') THEN 'Hoàn thành'
    WHEN lower(trim(trang_thai)) IN ('xuat hang', 'xuất hàng') THEN 'Xuất hàng'
    ELSE COALESCE(NULLIF(trang_thai, ''), 'Dở dang')
END;

WITH ranked AS (
    SELECT
        l.*,
        ROW_NUMBER() OVER (
            PARTITION BY l.factory_id, lower(trim(l.ma_lo))
            ORDER BY
                CASE
                    WHEN l.trang_thai = 'Xuất hàng' THEN 3
                    WHEN l.trang_thai = 'Hoàn thành' THEN 2
                    ELSE 1
                END DESC,
                COALESCE(l.tong_banh, 0) DESC,
                COALESCE(l.updated_at, l.created_at) DESC,
                l.id DESC
        ) AS rn
    FROM lots l
),
dupes AS (
    SELECT * FROM ranked WHERE rn > 1
)
INSERT INTO lot_duplicate_archive (
    source_lot_id,
    factory_id,
    ma_lo,
    reason,
    lot_row,
    transactions
)
SELECT
    d.id,
    d.factory_id,
    d.ma_lo,
    'Removed duplicate master lot row before enforcing unique ma_lo',
    to_jsonb(d) - 'rn',
    COALESCE(
        (
            SELECT jsonb_agg(to_jsonb(lt) ORDER BY lt.ngay_nhap, lt.created_at)
            FROM lot_transactions lt
            WHERE lt.lot_id = d.id
        ),
        '[]'::JSONB
    )
FROM dupes d
ON CONFLICT (source_lot_id) DO NOTHING;

WITH ranked AS (
    SELECT
        l.id,
        ROW_NUMBER() OVER (
            PARTITION BY l.factory_id, lower(trim(l.ma_lo))
            ORDER BY
                CASE
                    WHEN l.trang_thai = 'Xuất hàng' THEN 3
                    WHEN l.trang_thai = 'Hoàn thành' THEN 2
                    ELSE 1
                END DESC,
                COALESCE(l.tong_banh, 0) DESC,
                COALESCE(l.updated_at, l.created_at) DESC,
                l.id DESC
        ) AS rn
    FROM lots l
)
DELETE FROM lots
WHERE id IN (
    SELECT id
    FROM ranked
    WHERE rn > 1
);

DROP INDEX IF EXISTS idx_lots_factory_ma_lo_unique;

CREATE UNIQUE INDEX idx_lots_factory_ma_lo_unique
ON lots (factory_id, lower(trim(ma_lo)));

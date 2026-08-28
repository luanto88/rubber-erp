-- ============================================================
-- Hệ thống ký số dùng chung — Giai đoạn 0, mục 5: TẠO MỚI 6 bảng lõi
-- (xem CLAUDE.md "Kế hoạch phiên sau 2026-08-27" và
--  cung_cap_dl/du_an_ky_so_dung_chung - new.docx mục 5 "Lược đồ dữ liệu"
--  + mục 6 "Ràng buộc cưỡng chế ở tầng database")
--
-- CHỈ TẠO BẢNG — chưa module nào dùng tới, không đổi hành vi/schema của bất kỳ
-- bảng nào đang chạy thật (iso_documents, iso_form_instances, van_ban_documents,
-- doc_approval_log giữ nguyên 100%, đúng quyết định #2 trong docx: tách dịch vụ
-- dùng chung từ chính ISO/Văn bản, không tạo bảng dữ liệu mới cho 2 module đó).
--
-- 6 bảng: yeu_cau_ky, nguoi_ky, truong_ky, mau_vi_tri, nhat_ky_ky, cau_hinh_tai_lieu.
--
-- Lệch nhỏ so với schema phác thảo trong docx (ghi lại để không nhầm là thiếu sót
-- ở phiên sau, theo đúng tinh thần đã làm ở kpi_tasks/kpi_task_logs):
--   - Mọi bảng đều có factory_id (docx không liệt kê tường minh nhưng đây là
--     invariant bắt buộc toàn hệ thống — CLAUDE.md "Invariant bắt buộc" #1).
--   - yeu_cau_ky có thêm updated_at (+ trigger tự cập nhật) vì đây là "chứng từ"
--     bị ghi đè nhiều lần trong vòng đời (file_hien_tai/hash_hien_tai/trang_thai) —
--     đúng convention updated_at đã áp dụng cho hầu hết bảng mutable khác trong repo.
--   - modun/loai_tai_lieu/loai (truong_ky) để TEXT tự do, KHÔNG CHECK cứng danh sách
--     giá trị — các danh sách này (8 module, hàng chục loại tài liệu/loại trường)
--     sẽ còn mở rộng qua nhiều phiên, khóa cứng sẽ buộc phải sửa migration liên tục.
--     Mirror đúng cách kpi_tasks.module_code đang làm (TEXT tự do, liệt kê giá trị
--     kỳ vọng trong comment, không CHECK).
--   - ban_ghi_id (yeu_cau_ky) là tham chiếu ĐA HÌNH tới bản ghi nghiệp vụ gốc của
--     module tương ứng (lots/dispatch_entries/maintenance_records/iso_documents...)
--     — không thể đặt 1 FK cứng vì mỗi module trỏ tới 1 bảng khác nhau, để UUID
--     trần không FK, đúng bản chất bài toán.
--
-- RLS: bật trên cả 6 bảng. Chỉ thêm policy SELECT (đọc) theo đúng phạm vi liên quan
-- (factory + người tạo/người ký/admin, hoặc factory-wide cho 2 bảng cấu hình dùng
-- chung mau_vi_tri/cau_hinh_tai_lieu). CỐ Ý KHÔNG thêm policy INSERT/UPDATE/DELETE
-- cho client ở bất kỳ bảng nào trong đợt này — toàn bộ ràng buộc nghiệp vụ quan
-- trọng (idempotent ký, hash toàn vẹn, ghi nhật ký bất biến, ánh xạ vai trò→người
-- qua dinh_tuyen) còn phụ thuộc RPC/route mà Giai đoạn 1 mới xây — nếu mở INSERT
-- tự do cho client ngay bây giờ, dữ liệu tạo ra trước khi có RPC chuẩn sẽ không đi
-- qua được các ràng buộc đó. service_role (dùng trong mọi API route ký hiện tại)
-- luôn bỏ qua RLS nên không bị chặn bởi việc thiếu các policy này. Khi Giai đoạn 1/8
-- chốt xong mô hình quyền cụ thể (khả năng cao sẽ thêm nhóm permission `signing.*`),
-- một migration riêng sẽ bổ sung policy ghi phù hợp — không tự suy diễn ở đây.
-- ============================================================

-- ── 1. yeu_cau_ky — chứng từ yêu cầu ký (header) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.yeu_cau_ky (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  ma_ho_so          TEXT,
  phien_ban         INTEGER NOT NULL DEFAULT 1,
  phien_ban_truoc   UUID REFERENCES public.yeu_cau_ky(id),
  modun             TEXT NOT NULL,   -- dispatch|output|storage|quality|export|maintenance|iso|documents
  loai_tai_lieu     TEXT NOT NULL,   -- khớp cau_hinh_tai_lieu.loai_tai_lieu của đúng modun đó
  ban_ghi_id        UUID,            -- id bản ghi nghiệp vụ gốc — đa hình theo modun, không có FK
  nguon             TEXT NOT NULL CHECK (nguon IN ('render','upload')),
  file_goc          TEXT,            -- URL Storage file gốc — bất biến sau khi set
  file_hien_tai     TEXT,            -- URL Storage bản mới nhất — ghi đè sau mỗi lượt ký
  hash_hien_tai     TEXT,            -- SHA-256 (hex) của file_hien_tai tại thời điểm cập nhật gần nhất
  trang_thai        TEXT NOT NULL DEFAULT 'dang_luan_chuyen'
    CHECK (trang_thai IN ('dang_luan_chuyen','hoan_tat','tu_choi','huy')),
  nguoi_tao         UUID NOT NULL REFERENCES auth.users(id),
  han_xu_ly         TIMESTAMPTZ,
  tao_luc           TIMESTAMPTZ NOT NULL DEFAULT now(),
  hoan_tat_luc      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.yeu_cau_ky.phien_ban_truoc IS
  'Hồ sơ bị từ chối (tu_choi) giữ nguyên vĩnh viễn, không sửa đè. Bản sửa là 1 dòng MỚI với phien_ban+1, trỏ phien_ban_truoc về dòng cũ — vừa đúng yêu cầu ISO vừa bảo vệ chữ ký của người đã ký ở bản cũ.';
COMMENT ON COLUMN public.yeu_cau_ky.ban_ghi_id IS
  'Tham chiếu đa hình tới bản ghi nghiệp vụ gốc (lots/dispatch_entries/maintenance_records/iso_documents/van_ban_documents...) tuỳ theo modun — không có FK vì mỗi modun trỏ 1 bảng khác nhau.';

CREATE INDEX IF NOT EXISTS idx_yeu_cau_ky_factory_trang_thai ON public.yeu_cau_ky(factory_id, trang_thai);
CREATE INDEX IF NOT EXISTS idx_yeu_cau_ky_modun_loai ON public.yeu_cau_ky(modun, loai_tai_lieu);
CREATE INDEX IF NOT EXISTS idx_yeu_cau_ky_ban_ghi ON public.yeu_cau_ky(ban_ghi_id);
CREATE INDEX IF NOT EXISTS idx_yeu_cau_ky_nguoi_tao ON public.yeu_cau_ky(nguoi_tao);
CREATE INDEX IF NOT EXISTS idx_yeu_cau_ky_phien_ban_truoc ON public.yeu_cau_ky(phien_ban_truoc);

-- ── 2. nguoi_ky — từng người tham gia luồng ký của 1 yeu_cau_ky ──────────────
CREATE TABLE IF NOT EXISTS public.nguoi_ky (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  yeu_cau_id        UUID NOT NULL REFERENCES public.yeu_cau_ky(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  thu_tu            INTEGER NOT NULL,   -- bước nhảy 10; trùng số giữa 2 dòng = ký song song
  vai_tro           TEXT NOT NULL CHECK (vai_tro IN ('ky','phe_duyet','nhan_ban_sao')),
  loai_chu_ky       TEXT CHECK (loai_chu_ky IN ('anh','smartca')),
  trang_thai        TEXT NOT NULL DEFAULT 'cho'
    CHECK (trang_thai IN ('cho','dang_mo','da_ky','tu_choi')),
  ky_luc            TIMESTAMPTZ,
  ip                TEXT,
  thiet_bi          TEXT,
  ly_do_tu_choi     TEXT,
  tran_id           TEXT,   -- chỉ dùng khi loai_chu_ky = 'smartca'
  chung_thu_so      TEXT,   -- chỉ dùng khi loai_chu_ky = 'smartca'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mục 6.3 — "Ký không lặp": mỗi người chỉ có đúng 1 dòng ký cho mỗi yêu cầu, dù
-- bấm gửi 2 lần hay rớt mạng bấm lại. Đặt tên constraint khớp nguyên văn docx.
-- Bọc trong DO block kiểm tra pg_constraint để idempotent nếu migration chạy lại
-- (Postgres không hỗ trợ ADD CONSTRAINT IF NOT EXISTS trực tiếp) — mirror đúng
-- idiom đã dùng ở 20260618_export_orders_approval.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mot_lan_ky_moi_nguoi'
  ) THEN
    ALTER TABLE public.nguoi_ky
      ADD CONSTRAINT mot_lan_ky_moi_nguoi UNIQUE (yeu_cau_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nguoi_ky_yeu_cau ON public.nguoi_ky(yeu_cau_id);
CREATE INDEX IF NOT EXISTS idx_nguoi_ky_user ON public.nguoi_ky(user_id);
CREATE INDEX IF NOT EXISTS idx_nguoi_ky_factory ON public.nguoi_ky(factory_id);

-- Mục 6.2 — SmartCA phải ở vòng ký cuối: nếu PDF bị đóng thêm ảnh chữ ký sau khi
-- đã ký PAdES, Acrobat báo tài liệu đã thay đổi sau khi ký — bằng chứng hỏng.
-- Kiểm tra cả 2 chiều: chèn dòng smartca thì nó phải >= mọi thu_tu đã có; chèn
-- dòng thường thì không được có thu_tu vượt quá dòng smartca đã tồn tại (nếu có).
CREATE OR REPLACE FUNCTION public.signing_check_smartca_last() RETURNS TRIGGER AS $$
DECLARE
  v_max_thu_tu INTEGER;
  v_smartca_thu_tu INTEGER;
BEGIN
  IF NEW.loai_chu_ky = 'smartca' THEN
    SELECT MAX(thu_tu) INTO v_max_thu_tu
    FROM public.nguoi_ky
    WHERE yeu_cau_id = NEW.yeu_cau_id;
    IF v_max_thu_tu IS NOT NULL AND NEW.thu_tu < v_max_thu_tu THEN
      RAISE EXCEPTION 'Người ký SmartCA phải ở vòng ký cuối cùng của hồ sơ (thu_tu %, hiện đã có bước lớn nhất %)', NEW.thu_tu, v_max_thu_tu;
    END IF;
  ELSE
    SELECT thu_tu INTO v_smartca_thu_tu
    FROM public.nguoi_ky
    WHERE yeu_cau_id = NEW.yeu_cau_id AND loai_chu_ky = 'smartca'
    LIMIT 1;
    IF v_smartca_thu_tu IS NOT NULL AND NEW.thu_tu > v_smartca_thu_tu THEN
      RAISE EXCEPTION 'Không thể thêm bước ký sau bước SmartCA đã đặt tại thu_tu %', v_smartca_thu_tu;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nguoi_ky_smartca_last ON public.nguoi_ky;
CREATE TRIGGER trg_nguoi_ky_smartca_last
  BEFORE INSERT ON public.nguoi_ky
  FOR EACH ROW EXECUTE FUNCTION public.signing_check_smartca_last();

-- ── 3. truong_ky — vị trí trường ký thực tế của từng người, trên từng yêu cầu ─
CREATE TABLE IF NOT EXISTS public.truong_ky (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  yeu_cau_id        UUID NOT NULL REFERENCES public.yeu_cau_ky(id) ON DELETE CASCADE,
  nguoi_ky_id       UUID NOT NULL REFERENCES public.nguoi_ky(id) ON DELETE CASCADE,
  trang             INTEGER NOT NULL,
  x_pt              NUMERIC NOT NULL,
  y_pt              NUMERIC NOT NULL,   -- point, gốc góc dưới-trái (chuẩn pdf-lib)
  w_pt              NUMERIC NOT NULL,
  h_pt              NUMERIC NOT NULL,
  loai              TEXT NOT NULL,      -- vd 'chu_ky' | 'ten' | 'ngay_ky' | 'qr' — tự do, xem ghi chú đầu file
  nhan              TEXT,
  bat_buoc          BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.truong_ky.y_pt IS
  'Point, gốc tọa độ góc DƯỚI-TRÁI (chuẩn pdf-lib). jsPDF dùng gốc góc TRÊN-TRÁI — bắt buộc quy đổi y_pt_pdf = chieuCaoTrang - y_jspdf - h_pt ngay tại hàm render trả về, không lưu lẫn 2 hệ quy chiếu trong cùng cột.';

CREATE INDEX IF NOT EXISTS idx_truong_ky_yeu_cau ON public.truong_ky(yeu_cau_id);
CREATE INDEX IF NOT EXISTS idx_truong_ky_nguoi_ky ON public.truong_ky(nguoi_ky_id);
CREATE INDEX IF NOT EXISTS idx_truong_ky_factory ON public.truong_ky(factory_id);

-- ── 4. mau_vi_tri — mẫu vị trí trường ký theo loại tài liệu (nhóm C, upload) ──
CREATE TABLE IF NOT EXISTS public.mau_vi_tri (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  loai_tai_lieu     TEXT NOT NULL,
  phien_ban         INTEGER NOT NULL DEFAULT 1,
  khung             JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(khung) = 'array'),
  tao_boi           UUID NOT NULL REFERENCES auth.users(id),
  tao_luc           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, loai_tai_lieu, phien_ban)
);

COMMENT ON COLUMN public.mau_vi_tri.khung IS
  'Mảng khung theo VAI TRÒ (không phải người cụ thể): [{ vai_tro, neo_trang, so_trang, x_pt, y_pt, w_pt, h_pt }]. neo_trang: "dau" (trang thứ N từ đầu), "cuoi" (trang thứ N từ cuối; so_trang=0 nghĩa là trang cuối cùng dù tài liệu dài bao nhiêu), "moi_trang" (nhân bản mọi trang, vd ký nháy). Lúc áp mẫu, vai_tro được ánh xạ sang người thật qua cau_hinh_tai_lieu.dinh_tuyen.';
COMMENT ON COLUMN public.mau_vi_tri.phien_ban IS
  'Không tự ghi đè mẫu cũ khi người soạn thảo chỉnh khung đã áp — tạo dòng mới với phien_ban+1, giữ nguyên bản cũ để không ảnh hưởng các yeu_cau_ky đã tham chiếu.';

CREATE INDEX IF NOT EXISTS idx_mau_vi_tri_factory_loai ON public.mau_vi_tri(factory_id, loai_tai_lieu, phien_ban DESC);

-- ── 5. nhat_ky_ky — audit trail BẤT BIẾN của toàn bộ vòng đời 1 yeu_cau_ky ────
CREATE TABLE IF NOT EXISTS public.nhat_ky_ky (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id          UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  yeu_cau_id          UUID NOT NULL REFERENCES public.yeu_cau_ky(id) ON DELETE CASCADE,
  thoi_diem           TIMESTAMPTZ NOT NULL DEFAULT now(),
  hanh_dong           TEXT NOT NULL,
  user_id             UUID REFERENCES auth.users(id),
  ip                  TEXT,
  thiet_bi            TEXT,
  hash_sau_thao_tac   TEXT,
  chi_tiet            JSONB
);

CREATE INDEX IF NOT EXISTS idx_nhat_ky_ky_yeu_cau_thoi_diem ON public.nhat_ky_ky(yeu_cau_id, thoi_diem DESC);
CREATE INDEX IF NOT EXISTS idx_nhat_ky_ky_factory ON public.nhat_ky_ky(factory_id);

-- Mục 6.1 — Nhật ký bất biến. RLS insert-only KHÔNG đủ vì API route ký sẽ dùng
-- service role (bỏ qua toàn bộ RLS) — trigger áp dụng với MỌI role, kể cả service
-- role. Tái dùng chính hàm chan_sua_nhat_ky() đã tạo cho doc_approval_log
-- (20260901_doc_approval_log_hardening.sql) — hàm generic, không tham chiếu tên
-- bảng cụ thể nào, gắn thêm trigger cho nhat_ky_ky ở đây.
CREATE OR REPLACE FUNCTION chan_sua_nhat_ky() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký ký số là bất biến, không được sửa hoặc xoá';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nhat_ky_ky_bat_bien ON public.nhat_ky_ky;
CREATE TRIGGER nhat_ky_ky_bat_bien
  BEFORE UPDATE OR DELETE ON public.nhat_ky_ky
  FOR EACH ROW EXECUTE FUNCTION chan_sua_nhat_ky();

-- ── 6. cau_hinh_tai_lieu — cấu hình luồng ký theo từng loại tài liệu/phiếu ───
CREATE TABLE IF NOT EXISTS public.cau_hinh_tai_lieu (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id            UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  loai_tai_lieu         TEXT NOT NULL,
  modun                 TEXT NOT NULL,
  ten_hien_thi          TEXT NOT NULL,
  dinh_tuyen            JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(dinh_tuyen) = 'array'),
  muc_xac_thuc          TEXT NOT NULL DEFAULT 'pin'
    CHECK (muc_xac_thuc IN ('pin','pin_otp','smartca')),
  yeu_cau_chu_ky_so     TEXT NOT NULL DEFAULT 'khong'
    CHECK (yeu_cau_chu_ky_so IN ('khong','bat_buoc_buoc_cuoi','tuy_chon')),
  sla_gio               INTEGER,
  can_dat_truong        BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, loai_tai_lieu)
);

COMMENT ON COLUMN public.cau_hinh_tai_lieu.dinh_tuyen IS
  'Mảng vai trò + thứ tự CỦA CHÍNH loai_tai_lieu này (không phải map keyed theo loai_tai_lieu, vì bảng đã có cột loai_tai_lieu riêng). Dùng để ánh xạ vai_tro trong mau_vi_tri.khung / snapshot vào nguoi_ky.user_id thật lúc tạo yeu_cau_ky.';
COMMENT ON COLUMN public.cau_hinh_tai_lieu.yeu_cau_chu_ky_so IS
  '"khong": chỉ ký ảnh. "bat_buoc_buoc_cuoi": người ký vòng cuối bắt buộc phải có chứng thư SmartCA hợp lệ (chặn ngay lúc tạo hồ sơ nếu không có). "tuy_chon": người soạn thảo có thể bật SmartCA nếu người ký có chứng thư, nhưng không được hạ cấp ngược lại — đổi mức phải sửa chính dòng cấu hình này.';

CREATE INDEX IF NOT EXISTS idx_cau_hinh_tai_lieu_modun ON public.cau_hinh_tai_lieu(factory_id, modun);

CREATE OR REPLACE FUNCTION public.cau_hinh_tai_lieu_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cau_hinh_tai_lieu_updated_at ON public.cau_hinh_tai_lieu;
CREATE TRIGGER trg_cau_hinh_tai_lieu_updated_at
  BEFORE UPDATE ON public.cau_hinh_tai_lieu
  FOR EACH ROW EXECUTE FUNCTION public.cau_hinh_tai_lieu_set_updated_at();

CREATE OR REPLACE FUNCTION public.yeu_cau_ky_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_yeu_cau_ky_updated_at ON public.yeu_cau_ky;
CREATE TRIGGER trg_yeu_cau_ky_updated_at
  BEFORE UPDATE ON public.yeu_cau_ky
  FOR EACH ROW EXECUTE FUNCTION public.yeu_cau_ky_set_updated_at();

-- ============================================================
-- RLS — chỉ SELECT theo phạm vi liên quan; KHÔNG có policy ghi cho client (xem
-- ghi chú đầu file). Cần 2 hàm SECURITY DEFINER để tránh "infinite recursion
-- detected in policy" khi yeu_cau_ky/nguoi_ky tham chiếu chéo RLS lẫn nhau —
-- mirror đúng cách đã dùng ở operation_notes/operation_note_shares
-- (.claude/rules/26-operation-notes-module.md) và kpi_tasks/kpi_task_members
-- (20260724_kpi_tasks_phase1a.sql).
-- ============================================================

ALTER TABLE public.yeu_cau_ky ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nguoi_ky ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.truong_ky ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mau_vi_tri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhat_ky_ky ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cau_hinh_tai_lieu ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.signing_is_yeu_cau_owner(p_yeu_cau_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.yeu_cau_ky WHERE id = p_yeu_cau_id AND nguoi_tao = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.signing_is_participant(p_yeu_cau_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nguoi_ky WHERE yeu_cau_id = p_yeu_cau_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.signing_is_yeu_cau_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signing_is_yeu_cau_owner(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.signing_is_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signing_is_participant(UUID, UUID) TO authenticated;

-- yeu_cau_ky: người tạo, người tham gia ký (nguoi_ky), hoặc admin.
DROP POLICY IF EXISTS "yeu_cau_ky_select" ON public.yeu_cau_ky;
CREATE POLICY "yeu_cau_ky_select" ON public.yeu_cau_ky
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      nguoi_tao = auth.uid()
      OR public.signing_is_participant(id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- nguoi_ky: chính mình, người tạo yêu cầu (owner), hoặc admin.
DROP POLICY IF EXISTS "nguoi_ky_select" ON public.nguoi_ky;
CREATE POLICY "nguoi_ky_select" ON public.nguoi_ky
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      user_id = auth.uid()
      OR public.signing_is_yeu_cau_owner(yeu_cau_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- truong_ky: owner hoặc participant của đúng yeu_cau_id đó, hoặc admin.
DROP POLICY IF EXISTS "truong_ky_select" ON public.truong_ky;
CREATE POLICY "truong_ky_select" ON public.truong_ky
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.signing_is_yeu_cau_owner(yeu_cau_id, auth.uid())
      OR public.signing_is_participant(yeu_cau_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- nhat_ky_ky: owner hoặc participant của đúng yeu_cau_id đó, hoặc admin — không
-- lọc riêng theo user_id của dòng log (khác nguoi_ky) vì mục đích là xem TOÀN BỘ
-- lịch sử của hồ sơ mình liên quan, không chỉ hành động của chính mình.
DROP POLICY IF EXISTS "nhat_ky_ky_select" ON public.nhat_ky_ky;
CREATE POLICY "nhat_ky_ky_select" ON public.nhat_ky_ky
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.signing_is_yeu_cau_owner(yeu_cau_id, auth.uid())
      OR public.signing_is_participant(yeu_cau_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- mau_vi_tri / cau_hinh_tai_lieu: dữ liệu cấu hình cấp nhà máy, không gắn với
-- 1 hồ sơ cụ thể nào — đọc rộng cho mọi user cùng factory (giống cách các bảng
-- danh mục/cấu hình khác trong app cho phép đọc rộng, chỉ giới hạn ghi).
DROP POLICY IF EXISTS "mau_vi_tri_select" ON public.mau_vi_tri;
CREATE POLICY "mau_vi_tri_select" ON public.mau_vi_tri
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "cau_hinh_tai_lieu_select" ON public.cau_hinh_tai_lieu;
CREATE POLICY "cau_hinh_tai_lieu_select" ON public.cau_hinh_tai_lieu
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
  );

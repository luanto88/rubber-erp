# Prompt phiên sau — "Thực hiện hồ sơ ISO": N bước ký động như Văn bản

## Đã sửa xong ở phiên 2026-09-15 (KHÔNG làm lại)

Người dùng test thật trên `main`, báo 5 vấn đề. Đã xử lý **4/5**, `tsc` sạch, **chưa test tay**:

1. **Xem/Tải file trên mobile nằm tận dưới đáy** (`iso/documents/[id]`) — đã đưa cụm Xem/Tải
   lên **header trang**.
   ⚠️ Nguyên nhân gốc để không tái phạm: thẻ "File tài liệu" nằm ở **cột phải**; trên mobile
   grid 1 cột nên cột phải xếp xuống **dưới toàn bộ cột trái**. `order-first` trên thẻ đó chỉ
   sắp xếp trong **nội bộ cột phải** → không bao giờ nhảy lên trên được. Header là nơi duy nhất
   đứng trên cả 2 cột. Đừng "sửa" lại bằng `order-*` nữa.
2. **Bố cục lệch trái/phải** (`iso/forms/[id]`) — đổi `lg:grid-cols-3` (2+1) sang
   `lg:grid-cols-5` (3+2) + `items-stretch` + `lg:flex-1` ở thẻ cuối mỗi cột, mirror trang chi
   tiết Văn bản.
3. **Mọi bước đều thấy nút "Cài đặt vị trí ký"** — nay chỉ hiện khi `isEditable && isNguoiTao`
   (thao tác cấu hình MỘT LẦN cho biểu mẫu, không phải việc của người xem xét/phê duyệt), và
   **disabled tới khi chọn đủ người ký** (`signStepsReady`).
4. **Các bước sau vẫn kéo-thả/nhân bản tự do dù đã cài đặt vị trí** — khung mẫu nay là
   **VÙNG CHO PHÉP** (`templateBox`/`templateQrBox`): 3 khối chữ ký / tên / chức vụ vẫn kéo và
   co giãn được nhưng **không ra khỏi khung** (`boundsIn()` + `maxSizeIn()` + kẹp lần cuối bằng
   `clampRectToBox` khi xác nhận). Có viền đứt hiển thị vùng cho phép. Ẩn nút "Nhân bản" khi có
   mẫu (bản sao nằm ngoài vùng, không kẹp vào đâu được). Chữ mặc định Times New Roman 13pt, mỗi
   khối có icon con mắt bật/tắt riêng.
   ⚠️ Bản đầu làm SAI (khoá cứng kéo + co giãn) — người dùng đã chỉnh lại; thiết kế chung là
   "di chuyển tự do TRONG khung", giống module Văn bản.
   ⚠️ **Còn thiếu**: server (`finalize/route.ts`) chưa kẹp lại toạ độ client gửi lên (route
   không nạp mẫu). Bổ sung khi làm N bước ký động — xem đầu việc 3.

**Còn lại 1 việc lớn (mục 5) — nội dung chính của phiên sau.**

---

## Việc chính: bỏ Cấp 1/Cấp 2, chuyển sang N bước ký động

### Yêu cầu nguyên văn của người dùng

> "Bắt buộc phải chọn bước ký mới vào được cài đặt vị trí […] khi đã chọn bước ký thì bỏ hẳn
> logic Cấp 1 cấp 2, màn chọn bước ký phải tương tự như văn bản, vì thực hiện iso không theo
> mẫu cố định và cũng không cố định nguyên tắc tối đa 3 bước soạn thảo xem xét phê duyệt, thêm
> ghi chú, ngày ký màn cài đặt"

Tức: hồ sơ thực hiện ISO **không** chỉ có 3 bước cố định (soạn thảo → xem xét → phê duyệt).
Người soạn thảo tự chọn **N bước ký** với người cụ thể từng bước, y hệt module Văn bản.

### Vì sao đây là việc LỚN, không phải sửa giao diện

`iso_form_instances` đang lưu **cột cố định cho đúng 3 vai trò**:
`cap_tl`, `soan_thao_user_id` / `xem_xet_user_id` / `phe_duyet_user_id`,
`soan_thao_placement` / `xem_xet_placement` / `phe_duyet_placement`,
`soan_thao` / `xem_xet` / `phe_duyet` (tên snapshot), `ky_*_at`, `soan_thao_signed_url`.

Mô hình N bước của Văn bản (`van_ban_documents`) dùng:
`thu_tu_ky_json JSONB` (mảng bước) · `buoc_hien_tai` · `so_buoc_tong` · `nguoi_ky JSONB` ·
`placement_ky JSONB`.

⇒ Cần **migration + viết lại `finalize/route.ts`** (route ký THẬT đang chạy production) + viết
lại trang chi tiết. Không có đường tắt.

### Ràng buộc bắt buộc

- **9 hồ sơ đang tồn tại** (8 `da_phe_duyet`, 1 `draft` — số liệu đo 2026-09-14). Hồ sơ cũ
  **phải mở/xem/tải được y nguyên**. Cách an toàn: giữ nguyên toàn bộ cột cũ, **thêm** cột mới;
  route đọc `thu_tu_ky_json` nếu có, **không có thì rơi về đường 3-vai-trò cũ**, và tuyệt đối
  **không sửa một dòng nào của đường cũ** (đúng nguyên tắc đã áp dụng xuyên suốt dự án ký số).
- `finalize/route.ts` bước `phe_duyet` **vẽ lại TẤT CẢ placement từ file gốc** → khi chuyển sang
  N bước, vòng lặp đó phải duyệt `thu_tu_ky_json` thay vì 3 cột cứng. Đây là chỗ dễ làm mất chữ
  ký các bước trước nhất.
- Mọi dữ liệu snapshot (tên người ký, **chức vụ** `chucVuText`) phải nằm **trong từng placement**
  của bước đó, không tra lại lúc stamp — lý do đã ghi ở
  `.claude/rules/20-iso-forms-module.md` mục "Cập nhật 2026-09-14".

### Việc cần làm

1. **Migration** `iso_form_instances`: thêm `thu_tu_ky_json JSONB DEFAULT '[]'`,
   `buoc_hien_tai INTEGER DEFAULT 0`, `so_buoc_tong INTEGER DEFAULT 0`,
   `nguoi_ky JSONB DEFAULT '{}'`, `placement_ky JSONB DEFAULT '{}'`.
   **Giữ nguyên** mọi cột cũ (đánh dấu LEGACY bằng `COMMENT`, không drop).
2. **Màn chọn bước ký** trong "Cấu hình phê duyệt" — copy mô hình step-builder của
   `documents/new/page.tsx`: thêm/xoá/sắp thứ tự bước, mỗi bước chọn 1 người cụ thể. Bỏ hẳn
   nút "Cấp 1 / Cấp 2". `WorkflowStepper` (dòng ~94) phải render động theo `so_buoc_tong` thay
   vì 2 mảng cứng `stepsC1`/`stepsC2`.
3. **`finalize/route.ts`**: tách 2 luồng theo `so_buoc_tong > 0` (mới) hay không (cũ), kiểm
   **theo từng hồ sơ**. Luồng mới lưu vào `nguoi_ky`/`placement_ky` theo khoá bước.
   Đồng thời **kẹp toạ độ ở server** (`applySignerLayoutToEntry` — đã có sẵn trong
   `template-layout.ts`): hiện client kẹp rồi nhưng server vẫn tin toạ độ gửi lên. Khi
   `placement_ky` mang sẵn khung mẫu (như Văn bản) thì server kẹp được, đóng nốt khoảng trống này.
4. **Màn cài đặt vị trí** (`ky/mau-vi-tri`): thêm vai trò **`ngay_ky`** và **`ghi_chu`** vào
   `ISO_ROLE_ORDER` / `ISO_ROLE_DEFS` / `ISO_ROLE_COLORS` (`src/lib/signing/templates.ts` —
   hiện chỉ có `soan_thao | xem_xet | phe_duyet | qr`), và vai trò ký phải sinh động theo N
   bước chứ không cố định 3. Route ký vẽ 2 khối này bằng `drawTextFit` / `drawTextWrapped` đã
   có sẵn trong `stamp-pdf.ts`.
5. **Chặn vào màn cài đặt vị trí khi chưa chọn bước ký** — đã có `signStepsReady` ở phiên
   trước, chỉ cần đổi điều kiện sang `so_buoc_tong > 0 && mọi bước đã có người`.

### Tham chiếu để copy mô hình (đọc trước khi code)

- `src/app/dashboard/documents/new/page.tsx` — step-builder N bước.
- `src/app/dashboard/documents/[id]/page.tsx` — timeline động + "vị trí CỨNG" + khoá kéo-thả.
- `src/lib/signing/apply-template.ts` — ánh xạ vai trò mẫu → `placement_ky` theo bước
  (`ky_buoc`, `ky_buoc__banN` → `"1"`, `"2"`…). **Mô hình này dùng lại được gần như nguyên vẹn.**
- `.claude/rules/22-documents-module.md` mục "Bước ký đích danh" và "Vị trí CỨNG".

### Bẫy đã biết

- `stepSignerUserId` / `canSignStep` (`documents-types.ts`) được **mirror y hệt** ở tầng server
  trong `documents/sign/route.ts` (không import chéo được vì khác runtime boundary). Nếu làm
  tương tự cho ISO forms, nhớ để comment chéo — đây là cặp dễ trôi lệch nhất.
- `ISO_ROLE_DEFS` hiện đặt `showNameDefault: false` / `showChucVuDefault: false`. Mẫu ISO thật
  đang lưu (`iso:loai:QT` v14) lại bật `show_chuc_vu: true` cho cả 3 vai trò — đừng giả định
  theo giá trị mặc định trong code.
- Mẫu lưu **toạ độ tuyệt đối theo khổ trang lúc vẽ**. Mẫu `iso:loai:QT` thật là **A4 ngang**
  (842×595), không phải A4 dọc — kiểm thử nào giả định 595×842 sẽ báo "ngoài khổ giấy" sai.

---

## Prompt

```
Đọc `.claude/plans/iso-thuc-hien-n-buoc-ky-2026-09-15.md` và
`.claude/rules/20-iso-forms-module.md` (mục "Cập nhật 2026-09-14" và "Cập nhật 2026-09-15").
4/5 vấn đề người dùng báo đã sửa xong ở phiên trước — CHƯA test tay. Nếu tôi báo lỗi ở những
mục đó thì sửa trước.

Việc chính phiên này: chuyển "Thực hiện hồ sơ ISO" từ 3 bước cố định (Cấp 1/Cấp 2) sang
N BƯỚC KÝ ĐỘNG như module Văn bản — xem mục "Việc cần làm" (5 đầu việc) trong plan file.

BẮT BUỘC hỏi tôi qua AskUserQuestion trước khi code, tối thiểu 2 câu:
(a) Làm trọn gói trong 1 phiên (migration + step-builder + finalize route + màn cài đặt vị
    trí), hay tách: phiên này chỉ migration + step-builder + UI, để finalize route phiên sau?
(b) 9 hồ sơ đang tồn tại (8 đã phê duyệt, 1 nháp) xử lý thế nào — giữ nguyên chạy đường cũ
    mãi mãi, hay migrate dữ liệu sang mô hình N bước?

Nguyên tắc bắt buộc: `api/iso/forms/[id]/finalize/route.ts` là route ký THẬT đang chạy
production. Tách 2 luồng theo cờ, kiểm theo TỪNG hồ sơ; hồ sơ cũ rơi về đường cũ và KHÔNG
sửa một dòng nào của đường cũ. Verify bằng script gọi thẳng code thật qua
`node --experimental-strip-types` rồi trích lại nội dung PDF bằng `pdfjs` — `process.cwd()`
phải là gốc repo, nếu không `loadSignerNameFont()` trả `null` và mọi hàm vẽ text im lặng bỏ
qua khiến test "pass" giả. Bắt buộc có phép thử **byte-identical** chứng minh hồ sơ đang luân
chuyển dở không đổi một nét.

Chỉ dùng `npx tsc --noEmit` + `npx eslint <file>` — không chạy `npm run build`.
```

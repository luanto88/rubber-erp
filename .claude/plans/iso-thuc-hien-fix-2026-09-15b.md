# Prompt phiên sau — "Thực hiện hồ sơ ISO": 5 lỗi test deploy + N bước ký động

## Trạng thái

Người dùng test bản deploy (sau `876c9d1`) và báo 5 lỗi. **CHƯA sửa lỗi nào trong số này** —
phiên trước chỉ kịp chẩn đoán nguyên nhân (ghi đầy đủ bên dưới, **không phải suy đoán**: đã đối
chiếu ảnh chụp thật với code).

Ảnh người dùng gửi: `cung_cap_dl/` — ảnh 1 & 2 (mobile, tràn ngang), ảnh 3 (modal ký phê duyệt).

### Đã sửa xong ở các phiên trước (KHÔNG làm lại)

- Xem/Tải file đưa lên header (`iso/documents/[id]`) — thẻ file nằm cột phải, `order-first`
  không cứu được trên mobile.
- Bố cục 2 cột `lg:grid-cols-5` (3+2) + `items-stretch` + `lg:flex-1`.
- Nút "Cài đặt vị trí ký" chỉ hiện với người soạn thảo ở bước nháp, disabled tới khi chọn đủ
  người ký.
- Khung mẫu = **vùng cho phép** (`templateBox`), kéo/co giãn được bên trong, kẹp bằng
  `clampRectToBox`.
- `persistApprovalConfig()` — lưu cấu hình TRƯỚC mọi thao tác rời trang (sửa bug mất người ký).
- `mustSetupTemplate` — khoá "Ký & Gửi" khi hồ sơ PDF chưa có mẫu.
- Vai trò `ngay_ky` + `ghi_chu` cho ISO + `drawMetaTextBoxes()`.

---

## 5 lỗi cần sửa (đã chẩn đoán nguyên nhân)

### Lỗi 1 — Mobile: stepper và cụm nút tràn sang phải (ảnh 1, 2)

Ảnh 1: "④ Đã phê duyệt" bị cắt mất bên phải; nút "Cài đặt vị trí ký" và icon đồng bộ tràn khỏi
thẻ. Ảnh 2 tương tự ở trạng thái "Chờ xem xét".

**Nguyên nhân**: `WorkflowStepper` (`iso/forms/[id]/page.tsx`, đầu file) là flex row với vòng
tròn `w-6` + đường nối `w-6` + nhãn `whitespace-nowrap`. Bề rộng tối thiểu ≈ 4 bước × (24px +
nhãn ~90px) + 3 × 24px ≈ **480px+**, vượt khổ mobile 360–430px. Thẻ cha là
`flex items-center justify-between gap-4 flex-wrap` — `flex-wrap` chỉ đẩy được **cụm nút** xuống
dòng, còn bản thân stepper **không co được** (nhãn nowrap) nên tràn ra ngoài.

**Hướng sửa**: bọc stepper trong `overflow-x-auto` + `min-w-0` (flex item mặc định
`min-width:auto`, không đặt `min-w-0` thì cha vẫn bị đẩy rộng ra); hoặc làm biến thể gọn cho
mobile (chỉ hiện bước hiện tại + "2/4"). Cụm nút nên `w-full sm:w-auto` và các nút `flex-1` trên
mobile để xuống dòng gọn gàng.

### Lỗi 2 — Khối Tên / Chức vụ hiện dù mẫu KHÔNG bật (vi phạm quy tắc 2 tầng)

Người dùng vẽ mẫu **chỉ bật hiển thị tên, không bật chức vụ** cho cả 3 bước, nhưng modal ký vẫn
hiện **cả 2 thẻ**.

**Nguyên nhân**: `applyTemplate()` chỉ đặt `setShowName()` / `setShowChucVu()` (trạng thái
bật/tắt), còn **điều kiện RENDER** thì không đọc mẫu: khối tên render vô điều kiện, khối chức vụ
render theo `{userChucVu && (...)}`. Quy tắc 2 tầng nói mẫu = "CHO PHÉP hiển thị" → mẫu tắt thì
**không được dựng khối đó** (người ký không thấy, không bật lên được).

**Hướng sửa**: thêm state `tmplAllowName` / `tmplAllowChucVu` (mặc định `true` khi KHÔNG có mẫu —
giữ nguyên chế độ kéo-thả tự do cũ), dùng làm điều kiện render. Mirror đúng Văn bản:
`nameCan = box.show_name && layout.name`.

### Lỗi 3 — ⚠️ NẶNG NHẤT: khối Tên/Chức vụ nằm NGOÀI khung, chỉ nhảy vào khi kéo (ảnh 3)

Nguyên văn: *"tên và chức vụ … nằm bên ngoài ô cài đặt (góc trái bên dưới tài liệu), khi chọn
vào di chuyển nó mới nhảy vào nằm trong khung; nếu không di chuyển, để nguyên vị trí góc trái
đó, sau khi ký xong lại nằm trong ô cài đặt"*.

**Nguyên nhân (2 tầng, phải sửa cả hai)**:

1. `computeDefaultSubLayout(box, { withName, withChucVu })` trả **`null`** cho khối bị tắt →
   `setNameState()` / `setCvState()` **không được gọi** → 2 khối giữ nguyên vị trí MẶC ĐỊNH đặt
   trong `loadPdf()`: `{ x: 60, y: cH - 85 }` và `{ x: 60, y: cH - 57 }` — tức **góc trái dưới
   trang**, đúng như ảnh.
2. `bounds` của react-draggable **chỉ kẹp trong lúc KÉO**, không kẹp giá trị `position` ban đầu
   → khối vẫn vẽ ở ngoài vùng cho tới khi người dùng chạm vào kéo, lúc đó mới "nhảy" vào.

Còn chuyện *"không kéo mà ký xong vẫn nằm đúng ô"* là do `handleConfirm()` gọi `fit()` =
`clampRectToBox` kéo toạ độ về trong khung trước khi gửi. Tức **bản xem trước và bản đóng dấu
đang lệch nhau** — đúng thứ tính năng này sinh ra để tránh.

**Hướng sửa**: sau khi áp mẫu, **luôn** đặt vị trí cho cả 3 khối từ khung mẫu, không phụ thuộc
cờ bật/tắt — ví dụ gọi `computeDefaultSubLayout(box, { withName: true, withChucVu: true })` để
lấy TOẠ ĐỘ, rồi dùng cờ của mẫu chỉ để quyết định **có render hay không** (lỗi 2). Bổ sung kẹp
`clampRectToBox` ngay lúc áp mẫu để state không bao giờ ở ngoài vùng.

### Lỗi 4 — Chữ ký không được có icon con mắt

*"Chữ ký có hình mắt là sai vì chữ ký là bắt buộc, chỉ tắt được tên và chức vụ"*.

**Hướng sửa**: bỏ nút mắt khỏi khối chữ ký (cả khối chính lẫn khối bản sao `extraSigBoxes`), bỏ
luôn state `showSig` và nhánh "Ẩn chữ ký". Giữ nguyên mắt cho Tên và Chức vụ.
⚠️ `FullPlacement.showSignature` và tham số của `drawSignatureImage` **giữ nguyên** (placement cũ
và module ISO/Văn bản khác vẫn dùng) — chỉ luôn gửi `true` từ màn này.

### Lỗi 5 — Bước phê duyệt thừa logic "Ký thay" (ảnh 3)

Ảnh 3 hiện nhóm radio "Ký thay (tùy chọn): Ký trực tiếp / KT. / TM. / TL. / TUQ." ngay dưới
canvas ở bước phê duyệt.

**Nguyên nhân**: `showSignAsPicker = action === "phe_duyet" && showCanvas` — không xét mẫu. Theo
mô hình chung (rule 22, module Văn bản), tiền tố ký thay do **người soạn thảo chọn 1 lần lúc vẽ
mẫu** (`SignTemplateBox.sign_as`), không hỏi lại người ký mỗi lượt.

**Hướng sửa**: khi có mẫu → ẩn nhóm radio, lấy `sign_as` từ `roleBox.sign_as` của mẫu. Không có
mẫu → giữ nguyên nhóm radio như cũ (tương thích ngược).
⚠️ Cần xác nhận màn `ky/mau-vi-tri` có cho chọn `sign_as` với vai trò ISO hay không — nếu chưa,
phải bổ sung, nếu không sẽ **mất hẳn** tính năng ký thay.

---

## Việc lớn còn lại: N bước ký động (chưa làm)

Bỏ Cấp 1/Cấp 2, người soạn thảo tự chọn N bước ký như Văn bản. Cần **migration +
viết lại `finalize/route.ts`**. Chi tiết đầy đủ (schema, 5 đầu việc, bẫy đã biết) ở
`.claude/plans/iso-thuc-hien-n-buoc-ky-2026-09-15.md` — **đọc file đó**, không lặp lại ở đây.

Lưu ý: sửa xong 5 lỗi trên rồi mới làm việc này thì hợp lý hơn, vì N bước động sẽ đụng lại đúng
những chỗ đó (stepper, vai trò mẫu, modal ký).

---

## Bẫy đã biết (đừng giẫm lại)

- **`bounds` của react-draggable không kẹp `position` ban đầu** — chỉ kẹp khi kéo. Mọi vị trí
  khởi tạo phải tự kẹp bằng `clampRectToBox`.
- **Mẫu ISO thật lưu toạ độ tuyệt đối theo khổ trang lúc vẽ.** Mẫu `iso:loai:QT` đang có là
  **A4 ngang** (842×595) — test nào giả định A4 dọc sẽ báo "ngoài khổ giấy" sai.
- **27 mẫu ISO hiện có đều là `iso:loai:QT`** (tài liệu cha); biểu mẫu `F` chưa có mẫu nào → muốn
  test phải tự vẽ mẫu trước.
- `iso/documents/[id]/page.tsx` có nhiều cảnh báo lint **pre-existing** (`placementDocIsCon`,
  `handleConvertToPdf`, `nameH_pt`…) — không phải của đợt này, đừng "dọn" nhầm.
- Repo thỉnh thoảng có file thay đổi bởi phiên khác chạy song song — kiểm `git status` trước khi
  commit, chỉ stage đúng file của mình.

---

## Prompt

```
Đọc `.claude/plans/iso-thuc-hien-fix-2026-09-15b.md` (5 lỗi + nguyên nhân đã chẩn đoán) và
`.claude/rules/20-iso-forms-module.md` (3 mục "Cập nhật 2026-09-14/15").

Việc phiên này: sửa 5 lỗi người dùng báo sau khi test deploy. Nguyên nhân từng lỗi đã ghi sẵn
trong plan — KHÔNG chẩn đoán lại từ đầu, nhưng PHẢI đọc code xác nhận trước khi sửa.

Thứ tự đề xuất (rủi ro tăng dần):
1. Lỗi 4 — bỏ icon mắt khỏi khối chữ ký (chữ ký là bắt buộc).
2. Lỗi 1 — stepper + cụm nút tràn ngang trên mobile.
3. Lỗi 2 + 3 — khối Tên/Chức vụ: chỉ render khi mẫu CHO PHÉP, và luôn đặt vị trí từ khung mẫu
   (kẹp `clampRectToBox` ngay lúc áp mẫu) để bản xem trước không lệch bản đóng dấu.
4. Lỗi 5 — ẩn nhóm radio "Ký thay" khi có mẫu, lấy `sign_as` từ mẫu. Kiểm tra màn
   `ky/mau-vi-tri` có cho chọn `sign_as` cho vai trò ISO chưa; chưa có thì bổ sung, nếu không
   sẽ mất hẳn tính năng ký thay.

Sau khi sửa xong 5 lỗi, HỎI tôi qua AskUserQuestion có làm tiếp N bước ký động không (kế hoạch
đầy đủ ở `.claude/plans/iso-thuc-hien-n-buoc-ky-2026-09-15.md`) — KHÔNG tự ý bắt đầu, vì việc đó
cần migration và viết lại route ký đang chạy production.

Verify: với lỗi 2/3/5 phải có phép thử gọi thẳng code thật qua `node --experimental-strip-types`
rồi trích lại nội dung PDF bằng `pdfjs` — `process.cwd()` phải là gốc repo, nếu không
`loadSignerNameFont()` trả `null` và mọi hàm vẽ text im lặng bỏ qua khiến test "pass" giả. Riêng
lỗi 3 cần chứng minh: vị trí XEM TRƯỚC và vị trí ĐÓNG DẤU trùng nhau khi người ký KHÔNG chạm vào
khối nào.

Chỉ dùng `npx tsc --noEmit` + `npx eslint <file>` — không chạy `npm run build`.
```

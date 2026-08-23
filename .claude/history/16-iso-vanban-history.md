# Lịch sử quyết định — Kế hoạch ban đầu "Hợp nhất eye-icon + tiền tố ký thay" module ISO
(`.claude/rules/16-iso-vanban-module.md`)

> Tách ra 2026-08-22. Đây là bản kế hoạch/rà soát BAN ĐẦU trước khi triển khai — đã được
> triển khai xong và tóm tắt lại ở mục "Hợp nhất eye-icon chữ ký/tên + tiền tố ký thay
> KT/TM/TL/TUQ cho toàn bộ module ISO" trong rule file chính. Giữ lại đây chỉ để tra cứu
> lịch sử quyết định nếu cần, không phải quy tắc hiện hành.

## Kế hoạch ban đầu (lịch sử quyết định — đã triển khai theo bản tóm tắt ở trên)

**CHƯA LÀM** — đây là kế hoạch đã rà soát và chốt phạm vi với người dùng, để session sau triển khai. Không tự ý code phần này nếu chưa đọc kỹ mục "Việc cần làm ở ĐẦU session sau" bên dưới.

### Bối cảnh

Người dùng yêu cầu thống nhất toàn bộ logic ký PDF trong module ISO theo đúng pattern đã ổn định ở Văn bản nội bộ (`.claude/rules/22-documents-module.md`, mục "Tổng quát hóa 'KT.' thành 4 lựa chọn KT./TM./TL./TUQ." và "PDF nhiều trang trong SignPlacementModal"): mọi khung ký (chữ ký, tên, tiền tố chức danh) đều dùng eye-icon để ẩn/hiện, và hỗ trợ đặt chữ ký ở bất kỳ trang nào (đã xong — xem mục "Fix 2026-07-13" trong `.claude/rules/20-iso-forms-module.md`).

### Đã rà soát và xác nhận hiện trạng (2026-07-13)

- **Thực hiện hồ sơ ISO** (`iso/forms/[id]/page.tsx`, `SignPlacementModal`): đã có eye-icon (`Eye`/`EyeOff`) thật cho cả chữ ký lẫn tên, đã hỗ trợ đặt chữ ký nhiều trang (fix cùng ngày). **Chưa có** khái niệm tiền tố ký thay (KT./TM./TL./TUQ.) ở bất kỳ đâu.
- **Soạn thảo ISO** (`iso/documents/[id]/page.tsx`, modal đặt chữ ký inline): `placementModal` state **đã có sẵn** `showSignature`/`showSignerName` (không phải thiếu như nghi ngờ ban đầu), đã hỗ trợ nhiều trang. Nhưng nút ẩn/hiện hiện là **nút chữ** ("Ẩn chữ ký (X)"/"Hiện chữ ký", "Ẩn tên (X)"/"Hiện tên", dòng ~4286-4299), không phải icon mắt. Nút "Ẩn chữ ký" chỉ render khi `placementDocIsCon` (dòng 754-762: hồ sơ con hoặc file phụ soát xét `change_request`/`review_request`) — tài liệu cha chỉ thấy nút "Ẩn tên", không có nút ẩn chữ ký. **Chưa có** khái niệm tiền tố ký thay ở đâu cả (đã grep `KT\.|signAs|SignAsType|phe_duyet_is_kt|prefixText|prefixX` trong cả `documents/[id]/page.tsx` lẫn `src/app/api/sign/generate-pdf/route.ts` — 0 kết quả).
- `SignPlacement`/`ExtraSignPlacement` type trong `src/app/api/sign/generate-pdf/route.ts` (dòng 66-86) đã có `showSignature?`/`showSignerName?` (dùng đúng, check tại dòng ~1490/1502/1535/1545 và bản sao thứ 2 ~1668/1680) nhưng **chưa có** field `prefixX/Y/width/height` như `ExtraSignPlacement` của Văn bản (`src/app/api/documents/sign/route.ts` dòng 31-37).
- `iso_documents` và `iso_form_instances` **chưa có cột `sign_as`/`is_kt` nào** — khác với `van_ban_documents` đã có `phe_duyet_sign_as` (migration `20260706_van_ban_sign_as.sql`) — nghĩa là đây là tính năng hoàn toàn mới cho ISO, không cần lo tương thích ngược với dữ liệu `is_kt` cũ như Văn bản từng phải xử lý.

### Quyết định đã chốt với người dùng (2026-07-13)

1. **Phạm vi KT/TM/TL/TUQ**: áp dụng cho **cả 2 module ISO** (Soạn thảo ISO lẫn Thực hiện hồ sơ ISO), không chỉ Soạn thảo.
2. **Ẩn chữ ký ở tài liệu cha (Soạn thảo ISO)**: **GIỮ NGUYÊN** quy tắc cũ — tài liệu cha vẫn chỉ ẩn được "tên", không ẩn được "chữ ký" (chỉ hồ sơ con mới ẩn được cả 2). Việc "hợp nhất eye-icon" ở đây **chỉ là đổi trình bày** (nút chữ → icon mắt thật, mirror đúng UI pattern của `forms/[id]/page.tsx`), **không đổi điều kiện quyền** `placementDocIsCon` đang gate nút ẩn chữ ký.
3. **Eye-icon riêng cho khung tiền tố**: **KHÔNG thêm** — giữ nguyên cơ chế của Văn bản (chọn "Không chọn"/`signAs="none"` = ẩn khung tiền tố; chọn KT/TM/TL/TUQ = hiện khung kéo-thả). Không cần trạng thái `showPrefix` độc lập với `signAs`.
4. **Đồng bộ ngược Văn bản**: vì mục 3 chọn giữ cơ chế cũ (không có pattern mới nào phát sinh), **không có việc gì cần backport vào Văn bản** — Văn bản giữ nguyên làm reference implementation, không đụng vào.

### Việc cần làm

#### A. Hợp nhất UI eye-icon ở Soạn thảo ISO (thuần túy trình bày, không đổi logic quyền)

- `iso/documents/[id]/page.tsx` dòng ~4286-4299: đổi 2 nút chữ thành nút icon tròn nhỏ overlay góc trên-phải khung kéo-thả (mirror đúng style đã dùng trong `forms/[id]/page.tsx` `SignPlacementModal`, ví dụ khung chữ ký dòng ~415-420: `className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50"`, icon `{showSig ? <EyeOff size={10}/> : <Eye size={10}/>}`).
- Giữ nguyên điều kiện `{placementDocIsCon && (...)}` cho nút ẩn chữ ký, không có điều kiện cho nút ẩn tên — chỉ đổi phần render bên trong.
- `Eye`/`EyeOff` đã import sẵn trong file (dùng ở chỗ khác) — không cần thêm import.

#### B. Tiền tố ký thay KT./TM./TL./TUQ. — chỉ bật ở bước Phê duyệt (cần xác nhận lại — xem mục C)

Mirror kiến trúc Văn bản (`src/app/api/documents/sign/route.ts`, `.claude/rules/22-documents-module.md` mục "2. Tổng quát hóa 'KT.'"):

**B1. Soạn thảo ISO (`iso_documents`)**
- Migration mới: `ALTER TABLE iso_documents ADD COLUMN phe_duyet_sign_as TEXT` — không cần cột `is_kt` (không có dữ liệu cũ phải tương thích ngược).
- `SignPlacement` (`generate-pdf/route.ts` dòng ~80-86) thêm `prefixX?/prefixY?/prefixWidth?/prefixHeight?`.
- Cần đọc lại chính xác luồng gọi API của action `phe_duyet` trong `iso/documents/[id]/page.tsx` trước khi code (route đích, request shape hiện tại) — plan này suy đoán dựa trên cấu trúc `generate-pdf/route.ts` đã biết, chưa xác nhận trực tiếp cách `documents/[id]/page.tsx` gọi route này cho action `phe_duyet`.
- `placementModal` state thêm `signAs: SignAsType`, `prefixX/Y/W/H` — chỉ hiển thị radio picker + khung kéo-thả tiền tố khi placement hiện tại là bước Phê duyệt.
- Hàm vẽ chữ ký trong `generate-pdf/route.ts` thêm tham số `prefixText: string | null`, vẽ vào khung riêng tại `prefixX/Y/W/H` khi có tọa độ — mirror `stampPdfStep` của Văn bản (`documents/sign/route.ts` dòng ~317-386). **Không** ghép prefix vào `signerName` dùng cho tag DOCX/XLSX (giữ nguyên tắc "tiền tố chỉ áp dụng khi ký PDF" đã chốt cho Văn bản).
- UI hiển thị tên phê duyệt (trang chi tiết, timeline) thêm tiền tố theo `sign_as` — mirror `signAsPrefixLabel()` của Văn bản.

**B2. Thực hiện hồ sơ ISO (`iso_form_instances`)**
- Migration mới: `ALTER TABLE iso_form_instances ADD COLUMN phe_duyet_sign_as TEXT`.
- `SignPlacement`/`FullPlacement` (cả `forms/[id]/page.tsx` lẫn `finalize/route.ts`) thêm `prefixX?/prefixY?/prefixWidth?/prefixHeight?`.
- `SignPlacementModal` (`forms/[id]/page.tsx`) thêm state `signAs: SignAsType`, `prefixState: ElemState` — radio picker + khung kéo-thả viền emerald (mirror Văn bản) chỉ hiện khi `action === "phe_duyet"`.
- `handleConfirm`/`handleSignConfirm` gửi thêm `sign_as` trong body POST `/api/iso/forms/[id]/finalize` (hiện tại body chỉ có `token, action, placement, cap_tl`).
- `finalize/route.ts`, nhánh `action === "phe_duyet"` trong `stampPdf` (đã đọc kỹ ở phiên trước, dòng ~79-170): đọc `sign_as` từ body, tính `prefixText = signAs !== "none" ? \`${signAs}.\` : null`, vẽ vào khung riêng, lưu `phe_duyet_sign_as` vào DB cùng lúc set `trang_thai = "da_phe_duyet"`.
- UI hiển thị tên phê duyệt (card "Tiến trình & Lịch sử") thêm tiền tố tương tự.

#### C. Việc cần làm ở ĐẦU session sau (trước khi code bất cứ gì)

1. **Xác nhận lại phạm vi bước áp dụng tiền tố**: plan này giả định tiền tố KT/TM/TL/TUQ chỉ bật ở bước **Phê duyệt** cho cả 2 module (không bật ở Soạn thảo/Xem xét) — suy luận từ cách Văn bản chỉ bật `allowSignAs` cho step `phong_ban` + toàn bộ `phê duyệt`, loại trừ step `ca_nhân` (soạn thảo/xem xét ISO có bản chất gần với "cá nhân tự ký" hơn là "ký thay đại diện phòng ban"). **Đây là suy luận của tôi, chưa phải câu trả lời trực tiếp từ người dùng** — phải hỏi lại xác nhận trước khi code, đặc biệt nếu người dùng muốn tiền tố áp dụng luôn cho cả 3 bước.
2. Đọc lại chính xác `iso/documents/[id]/page.tsx` để xác định route/luồng gọi API thật của action `phe_duyet` trước khi sửa (mục B1 đang dựa trên suy đoán cấu trúc, chưa verify trực tiếp).
3. Sau khi code xong, chạy `npx tsc --noEmit` + `npx eslint` + `npm run build`, và ghi rõ "chưa test tay" — đúng quy ước của rule này.

---


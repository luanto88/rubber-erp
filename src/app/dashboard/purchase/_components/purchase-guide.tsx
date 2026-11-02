"use client"

import {
  AlertTriangle, BadgeDollarSign, BookOpen, Boxes, ClipboardCheck, FileSignature, GitBranch, HelpCircle,
  PackageCheck, Scale, Warehouse, Wrench,
} from "lucide-react"
import { InspectorCard } from "@/app/dashboard/_components/doc-ui/inspector-card"

// Tab "Hướng dẫn" — mô tả ĐÚNG hành vi code hiện tại của luồng Biên bản bảo trì ↔ Đề nghị mua ↔ Kho
// (rule 14 + rule 28, src/lib/maintenance-kt.ts, maintenance-ext-price.ts, purchase/server.ts).
// Đổi logic ở các file đó thì cập nhật cả trang này.

const FLOW: [string, string][] = [
  ["1. Lập biên bản bảo trì", "Ghi thiết bị + vật tư cần dùng. Mỗi vật tư chọn nguồn: Trong kho / Mua ngoài / Gia công ngoài."],
  ["2. Lập đề nghị mua", "Biên bản thiếu hàng ⇒ bấm “Lập đề nghị mua” trên biên bản (tạo phiếu NHÁP điền sẵn phần thiếu)."],
  ["3. Ký duyệt đề nghị", "Ký số 3 bước: Người đề nghị → Giám đốc → Kế toán."],
  ["4. Ghi nhận mua", "Người đề nghị ghi nhận nhập kho (vật tư) và/hoặc xác nhận hoàn thành (gia công)."],
  ["5. Gửi ký biên bản", "Khi kho đủ hàng + gia công đã xong, biên bản mới gửi ký được."],
  ["6. Ký xong biên bản", "Hệ thống TỰ xuất kho phiếu X-BT-<mã biên bản> từ kho của từng vật tư."],
]

const SOURCES: [string, string, string][] = [
  ["Trong kho", "Vật tư đang có sẵn trong kho.", "Không lập đề nghị. Ký xong tự xuất kho từ kho chính của vật tư."],
  ["Mua ngoài", "Vật tư phải mua về, có mã trong danh mục vật tư.", "Lập đề nghị → nhập kho (kho mặc định của vật tư) → ký biên bản → tự xuất kho."],
  ["Gia công ngoài", "Dịch vụ thuê ngoài (tiện, hàn, vá…), không có tồn kho.", "Lập đề nghị → “Xác nhận hoàn thành” trên phiếu (không nhập kho) → ký biên bản."],
]

const PRICE_ORDER: [string, string][] = [
  ["Giá nhập thực tế", "Bình quân theo số lượng các lần nhập kho / xác nhận gia công của dòng đề nghị gắn biên bản."],
  ["Theo đề nghị", "Đơn giá trên phiếu đề nghị GẦN NHẤT gắn biên bản (mọi trạng thái trừ Huỷ)."],
  ["Lần mua gần nhất", "Lần mua đã duyệt gần nhất của chính vật tư đó."],
  ["Giá danh mục kho", "Đơn giá khai trong danh mục vật tư (nếu > 0)."],
  ["Nhập tay", "Không có giá nào ở trên ⇒ người lập biên bản tự nhập."],
]

const FAQ: [string, string][] = [
  [
    "Đã nhập kho rồi mà biên bản vẫn báo thiếu?",
    "Hàng trong kho được CHIA cho các biên bản chưa duyệt. Hàng nhập từ dòng đề nghị gắn biên bản A được giữ cho A trước; phần còn lại chia theo thứ tự TẠO biên bản (biên bản tạo trước nhận trước), kể cả nhu cầu “Trong kho”. Ngoài ra kho có thể đã bị xuất cho việc khác. Xem khối “Vật tư mua ngoài” trên biên bản: khả dụng / thiếu / đang chờ phiếu nào.",
  ],
  [
    "Biên bản ghi “chờ nhập kho theo đề nghị NN/ĐNMVT” là sao?",
    "Phần thiếu đã có phiếu đề nghị đủ số lượng, chỉ còn chờ người đề nghị ghi nhận nhập kho (hoặc xác nhận gia công). Nếu ghi “cần lập thêm đề nghị cho N” thì phiếu hiện có chưa đủ — bấm “Lập đề nghị mua” / “Cập nhật đề nghị nháp”.",
  ],
  [
    "Sửa số lượng trên biên bản sau khi đã có phiếu nháp?",
    "Bấm “Cập nhật đề nghị nháp” trên biên bản: hệ thống CHỈ TĂNG số lượng / thêm dòng còn thiếu, không giảm, không xoá dòng (giữ phần mua dư và dòng người mua tự thêm). Phiếu đã gửi ký hoặc bị trả về thì không đồng bộ — người đề nghị tự sửa trên phiếu.",
  ],
  [
    "Muốn mua thêm số lượng sau khi phiếu đã duyệt?",
    "Lập phiếu đề nghị MỚI. Phiếu điều chỉnh không được tăng số lượng (chỉ giảm, đổi mã khi chưa nhập, đổi giá).",
  ],
  [
    "Mua dư so với biên bản (cần 1 mua 4)?",
    "Phần dư nằm trong kho, các biên bản sau cùng vật tư sẽ dùng tiếp theo thứ tự tạo. Đề nghị không bắt buộc bằng đúng nhu cầu biên bản.",
  ],
  [
    "Đơn giá trên biên bản không sửa được?",
    "Đúng thiết kế: khi đã có giá từ đề nghị / nhập thực tế, ô Đơn giá chỉ đọc và có dòng chú thích nguồn giá. Muốn đổi giá ⇒ sửa trên phiếu đề nghị (khi còn nháp) hoặc “Sửa giá” lần nhập / lập phiếu điều chỉnh.",
  ],
  [
    "Không thấy nút “Gửi ký duyệt” trên phiếu lập từ biên bản?",
    "Người đứng tên đề nghị chưa có quyền mua hàng (purchase.create). Người có quyền trong nhóm phụ trách biên bản (người tạo, NV phụ trách) bấm “Gửi ký duyệt” và chọn Giám đốc/Kế toán — gửi xong phiếu đứng tên người gửi. Người ngoài nhóm có quyền thì bấm “Nhận xử lý” trước.",
  ],
  [
    "Biên bản đã ký hoàn tất nhưng vẫn “Chờ duyệt” (kẹt)?",
    "Xuất kho lúc ký bị lỗi (vd thiếu hàng). Admin dùng “Thử xuất kho lại” hoặc “Huỷ ký duyệt (về chờ ký)” trên biên bản.",
  ],
  [
    "Huỷ / đóng phiếu đề nghị?",
    "Người đề nghị huỷ được khi Nháp hoặc Bị trả về (chưa ai ký). Admin huỷ được mọi trạng thái trừ Huỷ/Hoàn tất, kể cả phiếu Đã duyệt chưa nhập kho. Phiếu Đang mua (đã nhập một phần) không huỷ được — dùng “Đóng phiếu” (bắt buộc lý do).",
  ],
]

function KeyValueTable({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <table className="enterprise-table dense w-full">
      <thead>
        <tr><th className="w-48">{head[0]}</th><th>{head[1]}</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}><td className="font-semibold text-slate-800 align-top">{k}</td><td className="text-slate-600">{v}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

export function PurchaseGuide() {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <InspectorCard title="Luồng tổng quát: Biên bản bảo trì → Đề nghị mua → Kho" icon={GitBranch}>
        <KeyValueTable head={["Bước", "Việc cần làm"]} rows={FLOW} />
        <p className="mt-2 text-xs text-slate-500">
          Đề nghị mua cũng lập độc lập được (không gắn biên bản) — khi đó dòng vật tư chọn “Dự trữ kho”.
        </p>
      </InspectorCard>

      <InspectorCard title="3 nguồn vật tư trên biên bản" icon={Boxes}>
        <table className="enterprise-table dense w-full">
          <thead><tr><th className="w-36">Nguồn</th><th>Là gì</th><th>Đi qua những bước nào</th></tr></thead>
          <tbody>
            {SOURCES.map(([k, a, b]) => (
              <tr key={k}><td className="font-semibold text-slate-800 align-top">{k}</td><td className="text-slate-600">{a}</td><td className="text-slate-600">{b}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>Vật tư mua ngoài / gia công phải có <b>mã trong danh mục</b>. Chưa có ⇒ bấm “+ Thêm mã vật tư ngoài” trên biên bản (chọn “Dịch vụ gia công” cho gia công).</li>
          <li>Mã dịch vụ gia công không có tồn kho, không xuất hiện ở Nhập / Xuất / Tồn.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Lập đề nghị mua từ biên bản" icon={ClipboardCheck}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Ai lập được: <b>người tạo biên bản</b>, <b>NV phụ trách</b>, người có quyền <b>mua hàng</b>, hoặc admin.</li>
          <li>Phiếu tạo ở trạng thái <b>Nháp</b>, điền sẵn phần còn thiếu (thiếu − đang đề nghị). Bấm lại khi đã có nháp ⇒ “Cập nhật đề nghị nháp” (chỉ tăng / thêm dòng).</li>
          <li>Mỗi dòng có ô <b>“Cho biên bản”</b>: gắn dòng với biên bản cần hàng, hoặc “Dự trữ kho”. Cùng 1 vật tư cho 2 biên bản ⇒ tách 2 dòng.</li>
          <li>Người tạo + NV phụ trách là <b>nhóm phụ trách</b>: cùng sửa / gửi ký / huỷ phiếu khi Nháp hoặc Bị trả về. Người đầu tiên bấm “Gửi ký duyệt” sẽ đứng tên người đề nghị.</li>
          <li>Phiếu thiếu Giám đốc / Kế toán ⇒ khi gửi ký hiện bảng chọn người ký (gợi ý sẵn theo chức vụ).</li>
          <li>Không gửi ký được nếu có dòng đơn giá = 0.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Ký duyệt & theo dõi" icon={FileSignature}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Thứ tự cứng: Người đề nghị → Giám đốc → Kế toán. Tab <b>“Chờ tôi xử lý”</b> gom phiếu tới lượt bạn ký hoặc ghi nhận mua.</li>
          <li>Màn ký: nhập PIN rồi nhấn <b>Enter</b> để xác nhận ký, <b>Esc</b> để để sau.</li>
          <li>Người duyệt xem ngăn <b>“Bằng chứng tồn kho”</b>: tồn thực tế, phần <b>đang giữ cho biên bản</b>, tồn trống, tiêu hao 90 ngày, lần mua trước, phiếu khác còn chờ. Số liệu được chụp lúc gửi ký.</li>
          <li>Cảnh báo “Tồn còn nhiều” tính trên <b>tồn trống</b> (đã trừ hàng giữ cho biên bản chưa duyệt).</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Ghi nhận mua: nhập kho & xác nhận gia công" icon={PackageCheck}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Chỉ <b>người đề nghị</b> (hoặc admin) ghi nhận. Phiếu tới lượt bạn có nút <b>“Ghi nhận nhập kho” / “Xác nhận gia công” / “Ghi nhận mua”</b> ngay cột Thao tác của danh sách.</li>
          <li>Trình ghi nhận chạy tuần tự: <b>Bước 1 nhập kho</b> vật tư → <b>Bước 2 xác nhận hoàn thành</b> gia công.</li>
          <li>Nhập kho: tự tạo + ghi sổ phiếu nhập <code>N-&lt;kho&gt;-…</code>; vật tư gắn biên bản phải nhập đúng <b>kho mặc định</b> của vật tư; không vượt số lượng còn lại; đơn giá lệch tối đa <b>10%</b> so với giá duyệt; vật tư quản lý lô phải có số lô.</li>
          <li>Gia công: nhập số lượng, đơn giá (lệch ≤ 10%), ngày, đơn vị gia công, ảnh. Không tạo phiếu kho.</li>
          <li>Nhập đủ mọi dòng ⇒ phiếu <b>Hoàn tất</b>; nhập một phần ⇒ <b>Đang mua</b>. Xong phần của biên bản ⇒ quay lại biên bản để gửi ký.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Giữ hàng cho biên bản (chia tồn kho)" icon={Warehouse}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Tầng 1:</b> hàng đã nhập từ dòng đề nghị gắn biên bản A được giữ cho A trước (tối đa đúng nhu cầu của A).</li>
          <li><b>Tầng 2:</b> phần tồn còn lại chia cho các biên bản chưa duyệt theo <b>thứ tự tạo biên bản</b> (gồm cả vật tư “Trong kho”).</li>
          <li>Chỉ <b>giữ chỗ trên giấy</b> — tồn kho chỉ thực sự giảm khi biên bản ký xong (xuất kho X-BT-…).</li>
          <li>Trước khi ký bước cuối, hệ thống kiểm lại tồn; thiếu thì từ chối ký, chưa ghi gì.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Giá vật tư mua ngoài / gia công trên biên bản" icon={BadgeDollarSign}>
        <p className="mb-2">Biên bản tự lấy giá theo thứ tự ưu tiên (giá nào có trước thì dùng):</p>
        <KeyValueTable head={["Nguồn giá", "Cách lấy"]} rows={PRICE_ORDER} />
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>Có giá ⇒ ô Đơn giá chỉ đọc, dưới ô ghi nguồn giá và giá vừa đổi.</li>
          <li>Đồng bộ khi: mở biên bản, trước khi gửi ký, lưu / huỷ đề nghị, nhập kho, xác nhận gia công, sửa giá, duyệt phiếu điều chỉnh.</li>
          <li>Chỉ biên bản <b>Chờ duyệt chưa gửi ký</b> mới được cập nhật giá; biên bản đã gửi ký / đã duyệt giữ nguyên.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Sửa giá sau khi đã nhập / phiếu điều chỉnh" icon={Wrench}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Sửa giá</b> (lịch sử nhập kho / gia công trên phiếu): lệch ≤ 10% so với giá duyệt, bắt buộc lý do. Không đổi số lượng, tồn kho.</li>
          <li>Lệch &gt; 10%, đổi mã (dòng chưa nhập), giảm số lượng ⇒ <b>Lập phiếu điều chỉnh</b>, ký lại đủ 3 bước. Phiếu đã Hoàn tất vẫn lập được phiếu điều chỉnh <b>chỉ đổi giá</b>.</li>
          <li>Phiếu điều chỉnh đổi giá duyệt xong ⇒ giá mới áp cho <b>mọi lần nhập / gia công</b> của dòng đó và đồng bộ về biên bản.</li>
          <li><b>Huỷ xác nhận gia công</b>: được khi biên bản gắn dòng chưa gửi ký và chưa duyệt.</li>
        </ul>
      </InspectorCard>

      <InspectorCard title="Phân loại Sửa chữa lớn / nhỏ" icon={Scale}>
        <p>
          Biên bản <b>Sửa chữa</b> có tổng chi phí (quy USD) <b>lớn hơn ngưỡng</b> ⇒ Sửa chữa lớn, còn lại là nhỏ. Tự tính, không ai chọn tay.
          Ngưỡng cấu hình tại <b>Cài đặt → Bảo trì → Giá trị sửa chữa lớn</b> (mặc định 200 USD).
        </p>
      </InspectorCard>

      <InspectorCard title="Tình huống thường gặp" icon={HelpCircle}>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <p className="flex items-start gap-1.5 font-bold text-slate-800"><BookOpen size={14} className="mt-0.5 shrink-0 text-mod-600" /> {q}</p>
              <p className="mt-0.5 pl-5 text-slate-600">{a}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Phiếu đề nghị và biên bản đã ký số là bất biến — muốn thay đổi sau khi duyệt, dùng phiếu điều chỉnh / sửa giá, không sửa trực tiếp.
        </p>
      </InspectorCard>
    </div>
  )
}

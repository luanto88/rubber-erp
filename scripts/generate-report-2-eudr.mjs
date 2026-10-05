import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  ShadingType,
} from "docx";

const FONT_NAME = "Times New Roman";
const SIZE_BODY = 26; // 13pt
const SIZE_H1 = 28; // 14pt bold
const SIZE_H2 = 27; // 13.5pt bold
const SIZE_H3 = 26; // 13pt bold italic
const LINE_SPACING = 276; // 1.15 line spacing
const SPACE_AFTER_PARA = 120; // 6pt after paragraph

function createPara(text, options = {}) {
  const {
    bold = false,
    italics = false,
    alignment = AlignmentType.JUSTIFIED,
    size = SIZE_BODY,
    spaceBefore = 0,
    spaceAfter = SPACE_AFTER_PARA,
    indent = 0,
    underline = false,
    color,
  } = options;

  return new Paragraph({
    alignment,
    spacing: {
      line: LINE_SPACING,
      before: spaceBefore,
      after: spaceAfter,
    },
    indent: indent ? { firstLine: indent } : undefined,
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size,
        bold,
        italics,
        underline: underline ? {} : undefined,
        color,
      }),
    ],
  });
}

function createRunsPara(runs, options = {}) {
  const {
    alignment = AlignmentType.JUSTIFIED,
    spaceBefore = 0,
    spaceAfter = SPACE_AFTER_PARA,
    indent = 0,
  } = options;

  return new Paragraph({
    alignment,
    spacing: {
      line: LINE_SPACING,
      before: spaceBefore,
      after: spaceAfter,
    },
    indent: indent ? { firstLine: indent } : undefined,
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT_NAME,
          size: r.size || SIZE_BODY,
          bold: r.bold || false,
          italics: r.italics || false,
          underline: r.underline ? {} : undefined,
          color: r.color,
        })
    ),
  });
}

function createHeading1(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 240,
      after: 120,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H1,
        bold: true,
      }),
    ],
  });
}

function createHeading2(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 180,
      after: 100,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H2,
        bold: true,
      }),
    ],
  });
}

function createHeading3(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 140,
      after: 80,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H3,
        bold: true,
        italics: true,
      }),
    ],
  });
}

function createCell(content, options = {}) {
  const {
    bold = false,
    italics = false,
    alignment = AlignmentType.LEFT,
    shadingColor,
    widthPercent,
    size = 24, // 12pt in table
  } = options;

  let paras = [];
  if (Array.isArray(content)) {
    paras = content;
  } else {
    paras = [
      new Paragraph({
        alignment,
        spacing: { line: 240, before: 40, after: 40 },
        children: [
          new TextRun({
            text: String(content),
            font: FONT_NAME,
            size,
            bold,
            italics,
          }),
        ],
      }),
    ];
  }

  return new TableCell({
    width: widthPercent ? { size: widthPercent, type: WidthType.PERCENTAGE } : undefined,
    shading: shadingColor
      ? { fill: shadingColor, type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    margins: {
      top: 100,
      bottom: 100,
      left: 140,
      right: 140,
    },
    children: paras,
  });
}

// Bảng so sánh trước và sau cho Báo cáo 2 (EUDR & Truy xuất nguồn gốc)
function buildComparisonTableReport2() {
  const headers = [
    { text: "STT", width: 7 },
    { text: "Tiêu chí đánh giá", width: 23 },
    { text: "Trước khi áp dụng sáng kiến\n(Quản lý thủ công qua 6-8 sổ giấy)", width: 35 },
    { text: "Sau khi áp dụng sáng kiến\n(Hệ thống QR & Bản đồ số GIS Rubber ERP)", width: 35 },
  ];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      createCell(h.text, {
        bold: true,
        alignment: AlignmentType.CENTER,
        shadingColor: "C6E0B4",
        widthPercent: h.width,
        size: 23,
      })
    ),
  });

  const data = [
    [
      "1",
      "Thời gian truy xuất nguồn gốc lô hàng",
      "Mất từ 4 đến 8 giờ cho 1 lô đơn giản. Với đơn hàng xuất khẩu lớn có nhiều lô rải rác, mất từ 2 đến 4 ngày để lật tìm nhiều tập sổ sách.",
      "Dưới 30 giây bằng thao tác quét mã QR trên kiện mủ hoặc nhập mã lô/mã đơn trên máy tính; chuỗi cung ứng hiển thị tức thì.",
    ],
    [
      "2",
      "Mức độ đáp ứng quy định quốc tế EUDR",
      "Hoàn toàn không có dữ liệu bản đồ số; nguy cơ 100% bị từ chối nhập khẩu vào Châu Âu hoặc bị xử phạt nặng theo Quy định (EU) 2023/1115.",
      "Đáp ứng 100% yêu cầu EUDR; tự động trích xuất bản đồ đa giác polygon lô vườn WGS84 và gói hồ sơ thẩm tra Due Diligence Statement (DDS).",
    ],
    [
      "3",
      "Độ chính xác chuỗi hành trình mủ cao su",
      "Ghi chép tay qua 6–8 sổ trung gian (cân, xe, ngăn ủ, lò sấy, kho); rủi ro nhầm lẫn ngăn mủ hoặc ghép sai chuyến xe lên tới 5 – 10%.",
      "Chuỗi hành trình liên kết dữ liệu quan hệ chặt chẽ: Kiện mủ QR -> Lô thành phẩm -> Ngăn ủ mủ -> Chuyến xe trạm cân -> Lô vườn GPS; sai sót 0%.",
    ],
    [
      "4",
      "Kiểm soát hao hụt & Tỷ lệ cân đối (Thu hồi)",
      "Số liệu DRC và quy khô phân mảnh; đến cuối tháng kế toán đối soát mới phát hiện hao hụt bất thường, không truy cứu được trách nhiệm.",
      "Kiểm soát thời gian thực (Real-time); hệ thống tự động khóa và cảnh báo sớm nếu tỷ lệ thành phẩm/nguyên liệu nằm ngoài dải chuẩn 100% – 110%.",
    ],
    [
      "5",
      "Kiểm tra, phân hạng chất lượng (KCS/Lab)",
      "Ghi chép sổ Lab thủ công; nguy cơ lô chưa kiểm nghiệm hoặc lô không đạt chuẩn bị xuất nhầm vào container thành phẩm chất lượng cao.",
      "Số hóa toàn bộ chỉ tiêu lý hóa (Po, Pri, Tro, Tạp chất, Mooney...); tự động phân hạng tiêu chuẩn; chỉ các lô ĐẠT HẠNG mới cho phép chọn xuất hàng.",
    ],
    [
      "6",
      "Quy trình đóng hàng & Xuất kho container",
      "Thủ kho đếm từng kiện bằng mắt và tích sổ giấy; dễ bốc nhầm pallet khác chủng loại; tỷ lệ nhầm lẫn thực tế dao động 1.0 – 1.5%.",
      "Quét mã QR từng kiện mủ khi xếp vào container; hệ thống kiểm tra đối soát tức thì đúng đơn - đúng khách hàng; tự động hoàn thành phiếu xuất và trừ kho.",
    ],
    [
      "7",
      "Thời gian lập bộ hồ sơ thẩm định DDS",
      "Phải làm thủ công trên Word/Excel; mất 2 đến 3 ngày làm việc của cán bộ kỹ thuật để tổng hợp tọa độ, diện tích và các cam kết pháp lý.",
      "Tự động kết xuất trọn bộ gói nén .ZIP gồm 3 tệp DDS (PDF), tệp GeoJSON đã xử lý làm sạch hình học và CSV đối chiếu chỉ trong 5 giây bằng 1 cú nhấp chuột.",
    ],
    [
      "8",
      "Giao tiếp minh bạch với khách hàng quốc tế",
      "Khách hàng phải gửi email yêu cầu và chờ đợi nhà máy scan giấy tờ gửi lại; thông tin thiếu tính khách quan và thiếu dữ liệu định vị.",
      "Cổng khách hàng (Customer Portal) bảo mật bằng mã Token riêng biệt; khách hàng tự quét QR tra cứu trọn bộ chứng thư xuất xứ của đúng đơn hàng của họ.",
    ],
    [
      "9",
      "Chi phí đầu tư công nghệ & Vận hành",
      "Nếu mua phần mềm chuỗi cung ứng / GIS thương mại: Chi phí từ 300 – 500 triệu VNĐ + phí duy trì 50 – 80 triệu VNĐ/năm.",
      "0 USD chi phí bản quyền (nội bộ tự nghiên cứu, thiết kế và lập trình kết hợp AI); tận dụng điện thoại và máy in sẵn có; máy chủ Cloud chỉ ~300 USD/năm.",
    ],
  ];

  const rows = [
    headerRow,
    ...data.map(
      (row) =>
        new TableRow({
          children: [
            createCell(row[0], {
              alignment: AlignmentType.CENTER,
              widthPercent: 7,
              size: 23,
            }),
            createCell(row[1], {
              bold: true,
              widthPercent: 23,
              size: 23,
            }),
            createCell(row[2], {
              widthPercent: 35,
              size: 23,
            }),
            createCell(row[3], {
              widthPercent: 35,
              size: 23,
            }),
          ],
        })
    ),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
    },
    rows,
  });
}

export async function generateReport2Docx(outputPath) {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_NAME,
            size: SIZE_BODY,
          },
        },
      },
    },
    sections: [
      // ==========================================
      // SECTION 1: TRANG BÌA CHÍNH
      // ==========================================
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 }, // Lề trái 3cm, khác 2cm
          },
        },
        children: [
          createPara("TẬP ĐOÀN CÔNG NGHIỆP CAO SU VIỆT NAM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("NHÀ MÁY CHẾ BIẾN CAO SU", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 24,
            spaceAfter: 200,
          }),
          createPara("------------------------***", {
            alignment: AlignmentType.CENTER,
            spaceAfter: 600,
          }),

          createPara("BÁO CÁO KẾT QUẢ NGHIÊN CỨU, ỨNG DỤNG SÁNG KIẾN CẢI TIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 30,
            spaceAfter: 400,
          }),

          createPara("TÊN ĐỀ TÀI SÁNG KIẾN:", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 120,
          }),
          createPara(
            "\"XÂY DỰNG HỆ THỐNG TRUY XUẤT NGUỒN GỐC CHUỖI CUNG ỨNG MỦ CAO SU KHÉP KÍN TỪ VƯỜN CÂY ĐẾN THÀNH PHẨM XUẤT KHẨU, ĐÁP ỨNG QUY ĐỊNH EUDR BẰNG CÔNG NGHỆ MÃ QR ĐỘNG VÀ BẢN ĐỒ SỐ GIS TRÊN NỀN TẢNG RUBBER ERP\"",
            {
              bold: true,
              alignment: AlignmentType.CENTER,
              size: 28,
              spaceAfter: 600,
            }
          ),

          createPara("Lĩnh vực áp dụng: Quản lý Chuỗi Cung ứng, Công nghệ Bản đồ số GIS, Truy xuất nguồn gốc Quốc tế & Điều hành Sản xuất", {
            italics: true,
            alignment: AlignmentType.CENTER,
            size: 25,
            spaceAfter: 500,
          }),

          createPara("NHÓM TÁC GIẢ THỰC HIỆN:", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 160,
          }),

          new Table({
            alignment: AlignmentType.CENTER,
            width: { size: 90, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell("1. Vương Nguyễn Phương Lâm", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Tổng Giám đốc phụ trách điều hành (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2. Tô Thành Luân", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Giám đốc Nhà máy (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3. Chau Chók", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Giám đốc Nhà máy (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4. Nguyễn Hữu Thọ", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Kỹ thuật (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5. Néang Ry Ta", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Kế toán (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("6. Chau Nho", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Phụ trách Đội xe (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 800 }),
          createPara("Kampong Thom, Năm 2026", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 0,
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 2: TRANG BÌA PHỤ
          // ==========================================
          createPara("CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("HỘI ĐỒNG KHOA HỌC CÔNG NGHỆ & SÁNG KIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 25,
            spaceAfter: 300,
          }),
          createPara("------------------------***", {
            alignment: AlignmentType.CENTER,
            spaceAfter: 400,
          }),

          createPara("BÁO CÁO KẾT QUẢ THỰC HIỆN SÁNG KIẾN CẢI TIẾN CẤP CÔNG TY", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 28,
            spaceAfter: 300,
          }),

          createPara(
            "Đề tài: \"Xây dựng hệ thống truy xuất nguồn gốc chuỗi cung ứng mủ cao su khép kín từ vườn cây đến thành phẩm xuất khẩu, đáp ứng quy định EUDR bằng công nghệ mã QR động và bản đồ số GIS trên nền tảng Rubber ERP\"",
            {
              bold: true,
              italics: true,
              alignment: AlignmentType.CENTER,
              size: 26,
              spaceAfter: 500,
            }
          ),

          createPara("THÔNG TIN CHI TIẾT VỀ TÁC GIẢ VÀ ĐƠN VỊ CÔNG TÁC:", {
            bold: true,
            alignment: AlignmentType.LEFT,
            size: 26,
            spaceAfter: 140,
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              left: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              right: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
              insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
            },
            rows: [
              new TableRow({
                children: [
                  createCell("STT", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 8, shadingColor: "F2F2F2" }),
                  createCell("Họ và tên", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 28, shadingColor: "F2F2F2" }),
                  createCell("Chức vụ", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 32, shadingColor: "F2F2F2" }),
                  createCell("Đơn vị công tác", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 32, shadingColor: "F2F2F2" }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("1", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Vương Nguyễn Phương Lâm", { bold: true, widthPercent: 28 }),
                  createCell("Phó Tổng Giám đốc điều hành", { widthPercent: 32 }),
                  createCell("Ban Giám đốc Công ty", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Tô Thành Luân", { bold: true, widthPercent: 28 }),
                  createCell("Phó Giám đốc Nhà máy", { widthPercent: 32 }),
                  createCell("Nhà máy Chế biến", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Chau Chók", { bold: true, widthPercent: 28 }),
                  createCell("Phó Giám đốc Nhà máy", { widthPercent: 32 }),
                  createCell("Nhà máy Chế biến", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Nguyễn Hữu Thọ", { bold: true, widthPercent: 28 }),
                  createCell("Nhân viên Kỹ thuật", { widthPercent: 32 }),
                  createCell("Bộ phận Kỹ thuật - Quản lý chất lượng", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Néang Ry Ta", { bold: true, widthPercent: 28 }),
                  createCell("Nhân viên Kế toán", { widthPercent: 32 }),
                  createCell("Bộ phận Kế toán - Thống kê", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("6", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Chau Nho", { bold: true, widthPercent: 28 }),
                  createCell("Phụ trách Đội xe", { widthPercent: 32 }),
                  createCell("Bộ phận Vận tải - Tiếp nhận mủ", { widthPercent: 32 }),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 400 }),
          createPara("ĐƠN VỊ ÁP DỤNG CHÍNH:", { bold: true, size: 25, spaceAfter: 60 }),
          createPara("Nhà máy Chế biến Cao su và Khối Nông trường Vườn cây – Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom (Xã Boeng Lvea, Huyện Santuk, Tỉnh Kampong Thom, Vương quốc Campuchia).", { size: 25, spaceAfter: 300 }),

          createPara("THỜI GIAN NGHIÊN CỨU VÀ TRIỂN KHAI:", { bold: true, size: 25, spaceAfter: 60 }),
          createPara("Khảo sát và xây dựng cấu trúc GIS từ tháng 01/2026, tích hợp chuỗi cung ứng và thử nghiệm quét QR xuất khẩu từ tháng 02/2026, chính thức vận hành trên toàn bộ các đơn hàng xuất khẩu từ tháng 03/2026.", { size: 25, spaceAfter: 500 }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 3: MỤC LỤC
          // ==========================================
          createPara("MỤC LỤC BÁO CÁO SÁNG KIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 28,
            spaceAfter: 300,
          }),

          createRunsPara([
            { text: "PHẦN I: MỞ ĐẦU", bold: true },
            { text: " ................................................................................................................................... Trang 4" },
          ], { spaceAfter: 80 }),
          createPara("  1. Lý do chọn đề tài (Tính cấp thiết của đề tài) ............................................................................. Trang 4", { spaceAfter: 60 }),
          createPara("  2. Mục đích và nhiệm vụ của sáng kiến ...................................................................................... Trang 5", { spaceAfter: 60 }),
          createPara("  3. Đối tượng và phạm vi nghiên cứu ........................................................................................... Trang 6", { spaceAfter: 60 }),
          createPara("  4. Phương pháp nghiên cứu ....................................................................................................... Trang 7", { spaceAfter: 60 }),
          createPara("  5. Điểm mới của sáng kiến ......................................................................................................... Trang 7", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN II: NỘI DUNG SÁNG KIẾN", bold: true },
            { text: " .......................................................................................................... Trang 9" },
          ], { spaceAfter: 80 }),
          createPara("  1. Cơ sở lý luận và cơ sở thực tiễn ............................................................................................. Trang 9", { spaceAfter: 60 }),
          createPara("     1.1. Nền tảng pháp lý quốc tế và tiêu chuẩn kỹ thuật liên quan (Quy định EUDR) ................... Trang 9", { spaceAfter: 40 }),
          createPara("     1.2. Thực trạng chuỗi cung ứng và công tác truy xuất trước khi áp dụng ................................. Trang 10", { spaceAfter: 60 }),
          createPara("  2. Các giải pháp, biện pháp đã thực hiện ................................................................................... Trang 11", { spaceAfter: 60 }),
          createPara("     2.1. Chuẩn hóa chuỗi cung ứng mủ khép kín 6 công đoạn trên nền tảng số ............................. Trang 11", { spaceAfter: 40 }),
          createPara("     2.2. Xây dựng phân hệ Bản đồ số GIS tích hợp dữ liệu thuộc tính lô vườn cao su .................... Trang 14", { spaceAfter: 40 }),
          createPara("     2.3. Phát triển thuật toán truy xuất ngược đa tầng (Multi-tier Traceability) ................................ Trang 15", { spaceAfter: 40 }),
          createPara("     2.4. Thuật toán làm sạch hình học không gian (Geometric Cleaning Algorithm) ........................ Trang 16", { spaceAfter: 40 }),
          createPara("     2.5. Tự động hóa kết xuất trọn bộ hồ sơ thẩm tra Due Diligence Statement (DDS) ................... Trang 17", { spaceAfter: 40 }),
          createPara("     2.6. Cổng khách hàng (Customer Portal) bảo mật và Giao diện song ngữ Việt - Khmer ............. Trang 18", { spaceAfter: 60 }),
          createPara("  3. Hiệu quả của sáng kiến ......................................................................................................... Trang 19", { spaceAfter: 60 }),
          createPara("     3.1. Hiệu quả về mặt chuyên môn, kỹ thuật và quản lý ............................................................ Trang 19", { spaceAfter: 40 }),
          createPara("     3.2. Hiệu quả kinh tế và xã hội ................................................................................................. Trang 20", { spaceAfter: 40 }),
          createPara("     3.3. Bảng số liệu minh chứng so sánh kết quả Trước và Sau khi áp dụng .................................. Trang 21", { spaceAfter: 60 }),
          createPara("  4. Khả năng áp dụng và mở rộng của sáng kiến ......................................................................... Trang 23", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN III: KẾT LUẬN VÀ KIẾN NGHỊ", bold: true },
            { text: " ................................................................................................. Trang 24" },
          ], { spaceAfter: 80 }),
          createPara("  1. Kết luận ................................................................................................................................. Trang 24", { spaceAfter: 60 }),
          createPara("  2. Kiến nghị và đề xuất ............................................................................................................. Trang 25", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN TÀI LIỆU THAM KHẢO VÀ PHỤ LỤC", bold: true },
            { text: " ........................................................................................ Trang 26" },
          ], { spaceAfter: 80 }),
          createPara("  1. Danh mục tài liệu tham khảo .................................................................................................. Trang 26", { spaceAfter: 60 }),
          createPara("  2. Phụ lục minh họa kỹ thuật ................................................................................................... Trang 27", { spaceAfter: 200 }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 4: NỘI DUNG CHÍNH BÁO CÁO 2
          // ==========================================
          createHeading1("PHẦN I: MỞ ĐẦU"),

          createHeading2("1. Lý do chọn đề tài (Tính cấp thiết của đề tài)"),
          createPara(
            "Liên minh Châu Âu (EU) đã chính thức ban hành Quy định chống phá rừng và suy thoái rừng (EU Deforestation Regulation - gọi tắt là EUDR, Quy định (EU) 2023/1115). Đây là một đạo luật mang tính bước ngoặt và có hiệu lực bắt buộc đối với tất cả các doanh nghiệp xuất khẩu các mặt hàng nông sản chính vào thị trường Châu Âu, trong đó cao su tự nhiên là một trong 7 ngành hàng chịu tác động trực tiếp và nghiêm ngặt nhất. Theo các điều khoản khắt khe của EUDR:",
            { indent: 400 }
          ),
          createPara(
            "1. Yêu cầu về mốc thời gian không phá rừng (Deforestation-free): Mọi sản phẩm cao su tự nhiên khi nhập khẩu vào EU phải chứng minh được khai thác từ những diện tích đất không gây mất rừng hoặc suy thoái rừng sau ngày 31 tháng 12 năm 2020.",
            { indent: 400 }
          ),
          createPara(
            "2. Yêu cầu bắt buộc về định vị địa lý (Geolocation/Polygon): Các nhà nhập khẩu và cơ quan thẩm quyền Châu Âu bắt buộc bên bán phải cung cấp chính xác tọa độ GPS (nếu diện tích dưới 4 ha) hoặc đa giác ranh giới khép kín (Polygon GPS) đối với các lô đất từ 4 ha trở lên nơi thu hoạch mủ, kèm theo chứng minh quyền sử dụng đất hợp pháp và sự tuân thủ luật pháp nước sở tại.",
            { indent: 400 }
          ),
          createPara(
            "3. Bắt buộc kết xuất hồ sơ thẩm tra Due Diligence Statement (DDS): Mỗi lô hàng xuất khẩu phải có một bản giải trình trách nhiệm giải trình (DDS) hoàn chỉnh, tương thích với Cổng thông tin thẩm định điện tử của Liên minh Châu Âu (EU Information System / EU TRACES), liên kết chặt chẽ từng kiện mủ thành phẩm với đúng lô vườn xuất xứ.",
            { indent: 400 }
          ),
          createPara(
            "Châu Âu từ lâu đã là thị trường tiêu thụ truyền thống, chiến lược và có giá trị gia tăng cao nhất của Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom cũng như Tập đoàn Công nghiệp Cao su Việt Nam. Nếu không đáp ứng đầy đủ và chuẩn xác các quy định EUDR, công ty sẽ đối mặt với nguy cơ bị từ chối nhập khẩu, mất thị trường xuất khẩu cốt lõi và chịu các chế tài xử phạt nặng nề (mức phạt lên tới 4% tổng doanh thu hàng năm tại EU).",
            { indent: 400 }
          ),
          createPara(
            "Tuy nhiên, khi đối chiếu với thực trạng quản lý chuỗi cung ứng tại Nhà máy Chế biến trước năm 2026, công tác quản lý bộc lộ những điểm nghẽn nghiêm trọng:",
            { indent: 400 }
          ),
          createPara(
            "Thứ nhất, chuỗi tác nghiệp kéo dài và vận hành rời rạc qua 6 đến 8 cuốn sổ giấy độc lập: Từ khâu điều xe đón mủ tại nông trường -> Trạm cân tiếp nhận mủ nguyên liệu -> Phân loại ngăn ủ mủ đông -> Cắt xé, lưu ủ 21 ngày -> Đưa mủ vào dây chuyền sấy mủ -> Cân bành, đóng pallet -> Kiểm nghiệm KCS phòng Lab -> Lưu kho thành phẩm -> Đóng container xuất hàng. Toàn bộ các công đoạn này trước đây ghi chép trên các cuốn sổ tay riêng rẽ do các bộ phận độc lập quản lý.",
            { indent: 400 }
          ),
          createPara(
            "Thứ hai, thời gian truy xuất nguồn gốc quá chậm và rủi ro nhầm lẫn cao: Khi khách hàng Châu Âu hoặc tổ chức kiểm toán quốc tế yêu cầu truy xuất nguồn gốc của một lô cao su xuất khẩu (ví dụ lô SVR 10 hoặc SVR 3L), cán bộ kỹ thuật phải mất từ 4 đến 8 giờ (đối với lô đơn giản), và mất từ 2 đến 4 ngày (đối với đơn hàng lớn gồm nhiều lô thành phẩm sản xuất cách quãng) để lật tìm từng cuốn sổ cân xe, sổ ngăn mủ và sổ điều xe. Rủi ro ghép nhầm chuyến xe hoặc nhầm ngăn ủ lên tới 5 - 10%, và đặc biệt là nhà máy hoàn toàn KHÔNG THỂ xuất được tệp dữ liệu không gian địa lý GeoJSON chuẩn để nộp lên cổng thẩm định EU.",
            { indent: 400 }
          ),
          createPara(
            "Thứ ba, dữ liệu khối lượng và chỉ số DRC phân mảnh, thất thoát khó kiểm soát: Việc kiểm tra hàm lượng cao su khô (DRC) và khối lượng quy khô tại trạm cân không được kết nối tự động với sản lượng đầu ra của lò sấy. Thống kê thủ công cuối tháng mới phát hiện chênh lệch hao hụt, không thể cảnh báo sớm tỷ lệ thu hồi sản phẩm (100% – 110%) trong thời gian thực.",
            { indent: 400 }
          ),
          createPara(
            "Thứ tư, rào cản ngôn ngữ đối với người lao động: Đa số công nhân vận hành dây chuyền tại Campuchia là người bản địa, trình độ tin học hạn chế, không thể sử dụng các phần mềm phức tạp nếu không có giao diện song ngữ Khmer - Việt trực quan và thao tác đơn giản.",
            { indent: 400 }
          ),
          createPara(
            "Trước tình hình cấp bách đó, Nhóm tác giả đã tập trung nghiên cứu, thiết kế và phát triển sáng kiến: \"Xây dựng hệ thống truy xuất nguồn gốc chuỗi cung ứng mủ cao su khép kín từ vườn cây đến thành phẩm xuất khẩu, đáp ứng quy định EUDR bằng công nghệ mã QR động và bản đồ số GIS trên nền tảng Rubber ERP\". Sáng kiến đã giải quyết triệt để bài toán tuân thủ EUDR, bảo đảm giữ vững thị trường xuất khẩu Châu Âu và nâng tầm năng lực quản trị chuỗi cung ứng số của công ty.",
            { indent: 400 }
          ),

          createHeading2("2. Mục đích và nhiệm vụ của sáng kiến"),
          createHeading3("2.1. Mục đích tổng quát:"),
          createPara(
            "Xây dựng một hệ thống truy xuất nguồn gốc chuỗi cung ứng mủ cao su khép kín 100% trong thời gian thực (Real-time Full Traceability System), tích hợp công nghệ mã QR động trên từng kiện mủ thành phẩm và nền tảng Bản đồ số GIS đa giác polygon lô vườn cao su trên ứng dụng Rubber ERP. Hệ thống cho phép truy xuất tức thì từ bành mủ xuất khẩu về đến tọa độ vườn cây thu hoạch dưới 30 giây, tự động kết xuất trọn bộ hồ sơ thẩm định Due Diligence Statement (DDS) và tệp dữ liệu không gian địa lý tương thích 100% Cổng thông tin thẩm định EU Information System (EU TRACES), bảo đảm duy trì xuất khẩu ổn định sang thị trường Châu Âu.",
            { indent: 400 }
          ),

          createHeading3("2.2. Nhiệm vụ cụ thể của sáng kiến:"),
          createPara("1. Số hóa khâu điều xe và trạm cân tiếp nhận nguyên liệu: Cấp mã định danh điện tử cho từng chuyến xe gắn liền với thông tin đội xe, lái xe và mã lô vườn thu hoạch; tự động nạp số liệu cân xe, kết quả đo DRC và tính toán khối lượng mủ quy khô chuyển thẳng vào ngăn ủ lưu trữ.", { indent: 400 }),
          createPara("2. Số hóa vòng đời quản lý kho nguyên liệu (Ngăn ủ mủ): Thiết lập thuật toán kiểm soát tự động vòng đời ngăn mủ theo mốc ngày: 'Đang nhận' -> 'Đóng' -> Tự động chuyển 'Chờ sản xuất' sau đủ 21 ngày lưu ủ (bảo đảm ổn định các chỉ tiêu cơ lý tính) -> Chuyển 'Đang sản xuất' khi nạp vào dây chuyền chế biến.", { indent: 400 }),
          createPara("3. Số hóa dây chuyền chế biến và gắn tem mã QR động cho kiện mủ: Tự động sinh mã lô/mã pallet chuẩn hóa; in tem nhãn dán mã QR động cho từng kiện mủ bành (33.33 kg hoặc 35 kg). Công nhân tại dây chuyền dùng điện thoại quét mã QR xác nhận hoàn thành công đoạn, cập nhật tỷ lệ sản xuất theo thời gian thực (kiểm soát chặt chẽ tỷ lệ cân đối nguyên liệu - thành phẩm trong dải 100% - 110%).", { indent: 400 }),
          createPara("4. Số hóa quản lý chất lượng phòng thí nghiệm (KCS/Lab): Cập nhật tự động kết quả kiểm nghiệm các chỉ tiêu cơ lý (Po, Pri, hàm lượng tro, tạp chất, chất bay hơi, độ nhớt Mooney, hàm lượng Nitơ...) theo từng mã lô; tự động phân cấp thứ hạng sản phẩm (SVR 3L, SVR 10, SVR 20, SVR CV60, RSS...) và phát hành Phiếu kiểm nghiệm điện tử đính kèm QR.", { indent: 400 }),
          createPara("5. Số hóa kho thành phẩm và quản lý xuất hàng container: Thiết lập sơ đồ trực quan vị trí lưu kho; kiểm soát việc đóng hàng vào container bằng thao tác quét mã QR từng kiện mủ, đối soát chính xác 100% chủng loại và phân hạng, tự động hoàn thành phiếu xuất và trừ kho tức thì.", { indent: 400 }),
          createPara("6. Xây dựng phân hệ Bản đồ số GIS tích hợp dữ liệu lô vườn: Số hóa toàn bộ bản đồ không gian địa lý ranh giới các lô vườn cao su (diện tích, năm trồng, giống mủ, mặt cạo, sản lượng, đa giác tọa độ GPS polygon chuẩn WGS84 EPSG:4326), chứng minh nguồn gốc đất không phá rừng sau mốc 31/12/2020.", { indent: 400 }),
          createPara("7. Phát triển thuật toán truy xuất ngược đa tầng và thuật toán làm sạch hình học: Truy xuất tức thì từ Mã QR Kiện mủ -> Lô thành phẩm -> Ngăn mủ ủ -> Chuyến xe vận chuyển -> Lô vườn cao su (Tọa độ GPS); phát triển thuật toán Geometric Cleaning loại bỏ mảnh vụn hình học và lỗi tự cắt góc để tương thích 100% Cổng thẩm định Châu Âu.", { indent: 400 }),
          createPara("8. Tự động kết xuất trọn bộ hồ sơ thẩm tra EUDR DDS: Tự động sinh tệp nén .ZIP gồm 3 bản báo cáo DDS chuẩn quốc tế (DDS1, DDS2, DDS3), tệp GeoJSON đã xử lý và bảng CSV đối chiếu lô vườn bằng 1 cú nhấp chuột.", { indent: 400 }),
          createPara("9. Thiết lập Cổng khách hàng (Customer Portal) bảo mật bằng Public Token cô lập và tối ưu giao diện song ngữ Việt - Khmer thân thiện với người lao động.", { indent: 400 }),

          createHeading2("3. Đối tượng và phạm vi nghiên cứu"),
          createPara(
            "• Đối tượng nghiên cứu: Toàn bộ chuỗi cung ứng mủ cao su tự nhiên từ nông trường thu hoạch, đội xe vận chuyển, trạm cân, ngăn ủ nguyên liệu, dây chuyền xông sấy chế biến, phòng kiểm nghiệm chất lượng, kho thành phẩm đến container xuất khẩu; Quy định (EU) 2023/1115 (EUDR); Tiêu chuẩn kỹ thuật cao su TCVN 3769:2016; chuẩn dữ liệu không gian địa lý GeoJSON WGS84 và công nghệ mã QR Code động.",
            { indent: 400 }
          ),
          createPara(
            "• Phạm vi không gian: Áp dụng trên toàn bộ diện tích vườn cây cao su và khuôn viên Nhà máy Chế biến Cao su thuộc Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom tại tỉnh Kampong Thom, Vương quốc Campuchia; kết nối trực tuyến với các cảng xuất khẩu và khách hàng tại Châu Âu.",
            { indent: 400 }
          ),
          createPara(
            "• Phạm vi thời gian: Nghiên cứu, xây dựng cơ sở dữ liệu GIS từ tháng 01/2026, thử nghiệm quét mã QR trên dây chuyền từ tháng 02/2026, vận hành chính thức trên 100% các đơn hàng xuất khẩu từ tháng 03/2026 đến nay.",
            { indent: 400 }
          ),
          createPara(
            "• Nhóm đối tượng áp dụng: Cán bộ nông trường, lái xe vận tải, nhân viên trạm cân, thủ kho mủ nguyên liệu, công nhân vận hành lò sấy - đóng bành, nhân viên kiểm nghiệm KCS, thủ kho thành phẩm, bộ phận xuất nhập khẩu và các đối tác khách hàng mua mủ quốc tế.",
            { indent: 400 }
          ),

          createHeading2("4. Phương pháp nghiên cứu"),
          createPara("1. Phương pháp khảo sát thực địa và trích xuất dữ liệu GIS: Đo đạc ranh giới thực tế, số hóa bản đồ giải thửa vườn cây cao su năm 2026 thành tệp chuẩn GeoJSON; đối chiếu lịch sử năm trồng các lô cao su để xác thực mốc thời gian không mất rừng (trước 31/12/2020) theo dữ liệu viễn thám và hồ sơ lâm bạ.", { indent: 400 }),
          createPara("2. Phương pháp phân tích mô hình chuỗi hành trình sản phẩm (Chain of Custody - CoC): Áp dụng các nguyên tắc tách biệt nguồn gốc nghiêm ngặt của tiêu chuẩn PEFC ST 2002-1:2024 (PEFC EUDR DDS), bảo đảm không có sự pha trộn nguyên liệu không rõ nguồn gốc vào chuỗi sản xuất.", { indent: 400 }),
          createPara("3. Phương pháp lập trình và thuật toán xử lý hình học không gian: Tích hợp thư viện Leaflet, Turf.js và polygon-clipping để xử lý đa giác không gian, tính toán diện tích, tính tâm đa giác (Centroid) và tự động sửa các lỗi hình học polygon theo đúng định dạng Cổng thẩm định EU TRACES.", { indent: 400 }),
          createPara("4. Phương pháp thử nghiệm thực nghiệm tại hiện trường (Stress Testing): Cho công nhân vận hành quét thử nghiệm hàng ngàn lượt tem QR trên kiện mủ trong môi trường nhà máy có bụi, nhiệt độ cao và mạng Internet chập chờn để tối ưu hóa thuật toán nén ảnh QR và tốc độ phản hồi.", { indent: 400 }),

          createHeading2("5. Điểm mới của sáng kiến"),
          createPara(
            "Sáng kiến mang lại những điểm mới mang tính đột phá công nghệ và nghiệp vụ vượt trội so với các cách làm truyền thống:",
            { indent: 400 }
          ),
          createPara(
            "• Thuật toán truy xuất ngược tức thì dưới 30 giây: Đây là giải pháp đầu tiên trong các đơn vị cao su tại Campuchia thực hiện được chuỗi liên kết quan hệ 5 tầng xuyên suốt: Mã QR Kiện mủ -> Mã Lô thành phẩm -> Mã Ngăn ủ mủ -> Mã Chuyến xe trạm cân -> Mã Lô vườn cao su (Tọa độ polygon GPS). Chỉ cần quét mã QR trên 1 kiện mủ bất kỳ là có thể truy xuất ngược chính xác đến tận cây cao su được cạo mủ tại nông trường.",
            { indent: 400 }
          ),
          createPara(
            "• Tự động hóa trọn gói hồ sơ EUDR DDS chỉ bằng 1 cú nhấp chuột: Thay vì phải mất 2 - 3 ngày làm việc để tổng hợp hồ sơ giấy và bảng biểu tọa độ thủ công, hệ thống tự động trích xuất gói nén .ZIP gồm đầy đủ 3 bản báo cáo DDS chuẩn mực (PDF), tệp GeoJSON đã làm sạch hình học và CSV đối chiếu, sẵn sàng 100% nộp lên Cổng thẩm định EU TRACES.",
            { indent: 400 }
          ),
          createPara(
            "• Thuật toán làm sạch hình học không gian (Geometric Cleaning Algorithm): Tự động phát hiện và loại bỏ các mảnh vụn đa giác siêu nhỏ sinh ra do sai số ghép ranh giới, tự động sửa lỗi tự cắt góc (Self-intersection), xuất tệp nhật ký làm sạch song ngữ minh bạch, bảo đảm tệp GeoJSON không bao giờ bị Cổng EU từ chối.",
            { indent: 400 }
          ),
          createPara(
            "• Kiểm soát cân đối nguyên liệu - thành phẩm thời gian thực (100% - 110%): Hệ thống tự động đối soát khối lượng mủ quy khô đầu vào và sản lượng mủ thành phẩm đầu ra của từng ngăn lưu, ngăn chặn triệt để tình trạng thất thoát hoặc khai khống sản lượng.",
            { indent: 400 }
          ),
          createPara(
            "• Cổng khách hàng (Customer Portal) bảo mật bằng Public Token: Mỗi đơn hàng xuất khẩu được cấp một mã Token độc lập. Khách hàng Châu Âu chỉ cần quét mã QR trên hồ sơ là truy cập trực tiếp trang thông tin riêng của đơn hàng đó, tải trọn bộ hồ sơ thẩm định mà hoàn toàn không thể xem dữ liệu nội bộ của nhà máy hay các đối tác khác.",
            { indent: 400 }
          ),
          createPara(
            "• Giao diện cảm ứng song ngữ Việt - Khmer: Tối ưu hóa đặc thù cho công nhân địa phương tại Campuchia, nút bấm lớn, màu sắc phân biệt rõ ràng, dễ sử dụng chỉ sau 15 phút đào tạo hướng dẫn.",
            { indent: 400 }
          ),

          createHeading1("PHẦN II: NỘI DUNG SÁNG KIẾN"),

          createHeading2("1. Cơ sở lý luận và cơ sở thực tiễn"),
          createHeading3("1.1. Nền tảng pháp lý quốc tế và tiêu chuẩn kỹ thuật liên quan:"),
          createPara(
            "Sáng kiến được xây dựng dựa trên sự tuân thủ nghiêm ngặt các khung pháp lý quốc tế và tiêu chuẩn chất lượng ngành cao su:",
            { indent: 400 }
          ),
          createPara(
            "• Quy định (EU) 2023/1115 của Nghị viện và Hội đồng Châu Âu (EUDR): Có hiệu lực từ ngày 29/06/2023, bắt buộc các nhà điều hành thương mại phải thực hiện trách nhiệm giải trình thẩm tra (Due Diligence). Khoản 9 Điều 2 quy định chi tiết về dữ liệu định vị địa lý: Các lô đất có diện tích từ 4 ha trở lên bắt buộc phải cung cấp đa giác (Polygon) xác định ranh giới khép kín với hệ tọa độ chuẩn WGS84 có tối thiểu 6 chữ số thập phân.",
            { indent: 400 }
          ),
          createPara(
            "• Tiêu chuẩn PEFC ST 2002-1:2024: Các yêu cầu đối với việc triển khai Hệ thống thẩm định chi tiết PEFC EUDR (PEFC EUDR DDS), hướng dẫn phương pháp thu thập dữ liệu chuỗi hành trình sản phẩm mủ cao su không gây mất rừng.",
            { indent: 400 }
          ),
          createPara(
            "• Tiêu chuẩn Quốc gia TCVN 3769:2016 về Cao su thiên nhiên định chuẩn kỹ thuật (SVR): Quy định các chỉ tiêu chất lượng cơ lý hóa đối với các hạng mủ SVR CV60, SVR CV50, SVR L, SVR 3L, SVR 5, SVR 10, SVR 20 và SVR hỗn hợp.",
            { indent: 400 }
          ),
          createPara(
            "• Luật Lâm nghiệp, Luật Đất đai Vương quốc Campuchia và Đề án phát triển bền vững của Tập đoàn Công nghiệp Cao su Việt Nam (VRG).",
            { indent: 400 }
          ),

          createHeading3("1.2. Thực trạng chuỗi cung ứng và công tác truy xuất trước khi áp dụng sáng kiến:"),
          createPara(
            "Trước năm 2026, toàn bộ chuỗi cung ứng từ vườn cây đến thành phẩm xuất khẩu của Nhà máy Chế biến được ghi chép thủ công trên 6 đến 8 cuốn sổ giấy độc lập. Thực trạng này bộc lộ những hạn chế, tồn tại nghiêm trọng:",
            { indent: 400 }
          ),
          createPara("1. Chuỗi thông tin bị đứt gãy: Xe chở mủ từ nông trường về trạm cân được ghi trên phiếu cân giấy; khi đổ mủ vào ngăn lưu thì thủ kho ghi vào sổ ngăn; khi chuyển mủ vào dây chuyền sấy thì công nhân ghi vào sổ theo dõi ca; khi đóng bành dán nhãn giấy in sẵn số lô chung; khi kiểm nghiệm KCS ghi vào sổ phòng Lab; khi nhập kho và xuất container thủ kho ghi vào sổ kho. Do các khâu ghi chép độc lập, dữ liệu không có sự liên kết tự động bằng khóa định danh điện tử.", { indent: 400 }),
          createPara("2. Thời gian truy xuất hồ sơ quá lâu và không thể kết xuất bản đồ số: Mỗi khi khách hàng yêu cầu chứng minh nguồn gốc mủ hoặc phục vụ thẩm tra EUDR, nhà máy mất từ 4 đến 8 giờ, thậm chí 2 đến 4 ngày để lật tìm hàng ngàn trang sổ sách cũ. Nguy cơ nhầm lẫn rất cao và hoàn toàn không thể trích xuất được tệp tọa độ không gian địa lý (GeoJSON) để đồng bộ lên Cổng thẩm định EU.", { indent: 400 }),
          createPara("3. Thất thoát và sai lệch tỷ lệ thu hồi: Khối lượng mủ quy khô tiếp nhận tại trạm cân và khối lượng thành phẩm sấy thực tế không được đối soát tức thì. Nếu công nhân làm rơi vãi, hao hụt trong quá trình chế biến hoặc tỷ lệ thu hồi sụt giảm dưới 100%, ban giám đốc chỉ phát hiện ra vào kỳ kiểm kê cuối tháng.", { indent: 400 }),
          createPara("4. Rủi ro nhầm lẫn trong đóng hàng xuất khẩu: Đóng container bằng cách đếm kiện thủ công dẫn đến rủi ro bốc nhầm pallet khác thứ hạng hoặc khác lô, làm ảnh hưởng nghiêm trọng đến uy tín thương hiệu của công ty.", { indent: 400 }),

          createHeading2("2. Các giải pháp, biện pháp đã thực hiện"),
          createPara(
            "Nhóm tác giả đã nghiên cứu và triển khai đồng bộ hệ sinh thái công nghệ gồm 6 giải pháp kỹ thuật cốt lõi:",
            { indent: 400 }
          ),

          createHeading3("2.1. Chuẩn hóa chuỗi cung ứng mủ khép kín 6 công đoạn trên nền tảng số:"),
          createPara(
            "Hệ thống số hóa toàn bộ chuỗi tác nghiệp sản xuất thành một chuỗi quan hệ dữ liệu liên tục và khép kín:",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 1: Điều xe & Tiếp nhận nguyên liệu tại trạm cân:\n  Mỗi chuyến xe vận chuyển mủ từ nông trường về nhà máy được cấp một mã số định danh điện tử (Dispatch Code). Phiếu tiếp nhận điện tử liên kết trực tiếp biển số xe, tên tài xế, đội xe và mã lô vườn cao su thu hoạch. Cân điện tử tự động ghi nhận trọng lượng cân xe (tải trọng thô và bì), nhập kết quả kiểm tra DRC nhanh và tự động tính toán khối lượng mủ quy khô (Dry Rubber Content) nạp thẳng vào ngăn lưu trữ chỉ định mà không qua nhập liệu thủ công.",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 2: Quản lý Kho nguyên liệu thông minh (Ngăn ủ mủ):\n  Ứng dụng thuật toán quản lý vòng đời ngăn lưu trữ tự động hóa theo mốc thời gian:\n  + Trạng thái 'Đang nhận': Khi ngăn mới bắt đầu tiếp nhận mủ từ các chuyến xe.\n  + Trạng thái 'Đóng': Khi ngăn đã tiếp nhận đủ nguyên liệu theo định mức, hệ thống tự động khóa không cho đổ thêm mủ mới để tránh xáo trộn thời gian ủ.\n  + Trạng thái 'Chờ sản xuất': Sau khi ngăn đóng và trải qua đủ 21 ngày lưu ủ (bảo đảm mủ đông kết ổn định các chỉ tiêu cơ lý hóa theo tiêu chuẩn công nghệ), hệ thống tự động chuyển trạng thái cho phép nạp vào dây chuyền sấy.\n  + Trạng thái 'Đang sản xuất': Tự động chuyển khi phân xưởng bắt đầu quét mã kiện thành phẩm chọn ngăn mủ đó.",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 3: Dây chuyền chế biến & In tem mã QR động cho từng kiện mủ:\n  Hệ thống tự động sinh mã lô sản xuất (Lot Code) và mã pallet chuẩn hóa. Mỗi kiện mủ bành (33.33 kg hoặc 35 kg) ra khỏi máy ép bành đều được in một tem nhãn dán mã QR Code động riêng biệt. Công nhân vận hành tại dây chuyền sử dụng điện thoại thông minh quét mã QR kiện mủ để xác nhận hoàn thành công đoạn. Hệ thống cập nhật sản lượng thực tế và đối soát tỷ lệ cân đối nguyên liệu - thành phẩm theo thời gian thực (Real-time). Nếu tỷ lệ thu hồi nằm ngoài khoảng an toàn 100% – 110%, hệ thống lập tức phát cảnh báo ngăn chặn sai lệch định mức.",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 4: Quản lý kiểm nghiệm chất lượng phòng thí nghiệm (KCS/Lab):\n  Cán bộ kiểm nghiệm phòng Lab cập nhật kết quả phân tích mẫu các chỉ tiêu lý hóa (Po, Pri, hàm lượng tro, tạp chất, bay hơi, độ nhớt Mooney, Nitơ...) trực tiếp lên hệ thống theo từng mã lô. Hệ thống tự động đối chiếu với tiêu chuẩn TCVN 3769:2016 để phân cấp thứ hạng sản phẩm (SVR 3L, SVR 10, SVR 20, SVR CV60...) và phát hành Phiếu kiểm nghiệm điện tử có mã QR. Chỉ những lô đạt tiêu chuẩn mới được hiển thị tại phân hệ xuất hàng.",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 5: Quản lý lưu kho và Đóng hàng container bằng quét mã QR:\n  Thiết lập sơ đồ mặt bằng kho thành phẩm trực quan theo vị trí dãy/ô. Khi đóng hàng vào container xuất khẩu, công nhân dùng điện thoại quét mã QR từng kiện mủ. Hệ thống kiểm tra đối soát tức thì: Kiện mủ có đúng lô được chỉ định cho đơn hàng này hay không? Có đúng thứ hạng chất lượng khách hàng yêu cầu hay không? Nếu phát hiện sai sót, hệ thống phát tín hiệu cảnh báo đỏ và chặn đóng hàng. Khi quét đủ số lượng, phiếu xuất kho tự động hoàn tất và trừ tồn kho thời gian thực.",
            { indent: 400 }
          ),
          createPara(
            "• Công đoạn 6: Quản trị đơn hàng xuất khẩu và Phân bổ lô hàng:\n  Liên kết mã đơn hàng xuất khẩu (Export Order Code) với số hợp đồng, số hóa đơn, thông tin khách hàng, số container và danh sách các lô mủ đã được đóng hàng.",
            { indent: 400 }
          ),

          createHeading3("2.2. Xây dựng phân hệ Bản đồ số GIS tích hợp dữ liệu thuộc tính lô vườn cao su:"),
          createPara(
            "Nhóm tác giả đã xây dựng hoàn chỉnh lớp bản đồ không gian địa lý (GIS/Leaflet) phủ kín toàn bộ diện tích vườn cây của công ty:",
            { indent: 400 }
          ),
          createPara(
            "• Số hóa đa giác ranh giới lô vườn (Polygon): Toàn bộ các lô cao su được đo đạc và số hóa ranh giới khép kín theo hệ quy chiếu tọa độ chuẩn quốc tế WGS84 (EPSG:4326). Mỗi lô đất có một đa giác polygon độc lập kèm tọa độ tâm (Centroid Lat/Lon).",
            { indent: 400 }
          ),
          createPara(
            "• Cơ sở dữ liệu thuộc tính chi tiết: Tích hợp đầy đủ các trường thông tin lâm bạ và canh tác: Mã lô vườn (Mã lô 2026), Tên lô, Nông trường, Đội sản xuất, Diện tích chuẩn xác (ha), Giống cây trồng, Năm trồng (chứng minh trước mốc 31/12/2020), Năm mở cạo, Mặt cạo và sản lượng thu hoạch.",
            { indent: 400 }
          ),

          createHeading3("2.3. Phát triển thuật toán truy xuất ngược đa tầng (Multi-tier Traceability):"),
          createPara(
            "Trái tim của hệ thống là thuật toán truy xuất ngược tức thì được tối ưu hóa cơ sở dữ liệu quan hệ:",
            { indent: 400 }
          ),
          createPara(
            "Khi người dùng hoặc khách hàng quét mã QR trên 1 kiện mủ thành phẩm, hệ thống kích hoạt chuỗi truy vấn đa tầng ngược dòng:\n" +
            "  1. Từ Mã QR Kiện mủ -> Xác định Mã Lô thành phẩm và Ngày sản xuất.\n" +
            "  2. Từ Mã Lô thành phẩm -> Xác định Mã Ngăn ủ mủ nguyên liệu tương ứng.\n" +
            "  3. Từ Mã Ngăn ủ mủ -> Truy ngược toàn bộ các Mã Chuyến xe trạm cân đã nạp mủ vào ngăn đó trong chu kỳ nhận mủ.\n" +
            "  4. Từ Mã Chuyến xe -> Xác định chính xác Mã Lô vườn cao su đã thu hoạch mủ.\n" +
            "  5. Từ Mã Lô vườn -> Trích xuất trực tiếp Tọa độ đa giác GPS Polygon, Bản đồ số GIS, Diện tích, Năm trồng (trước 2020) và Chứng chỉ rừng tương ứng.\n" +
            "Toàn bộ chuỗi truy xuất 5 tầng này được hệ thống xử lý hoàn tất trong thời gian chưa đầy 30 giây.",
            { indent: 400 }
          ),

          createHeading3("2.4. Thuật toán làm sạch hình học không gian (Geometric Cleaning Algorithm):"),
          createPara(
            "Khi xuất dữ liệu không gian địa lý nộp lên Cổng thẩm định Châu Âu, hệ thống thường gặp lỗi do các đa giác polygon bị lỗi tự cắt góc (Self-intersection), đảo ngược hướng tọa độ (Clockwise/Counter-clockwise) hoặc sinh ra các mảnh vụn đa giác siêu nhỏ (Slivers) do sai số ghép ranh giới. Cổng EU TRACES sẽ tự động từ chối nếu phát hiện các lỗi này.",
            { indent: 400 }
          ),
          createPara(
            "Nhóm tác giả đã phát triển thuật toán 'Geometric Cleaning' tự động xử lý trước khi xuất dữ liệu:\n" +
            "  • Tự động kiểm tra và sửa lỗi tự cắt góc bằng kỹ thuật Buffer-zero và Polygon-clipping.\n" +
            "  • Tự động phát hiện và loại bỏ các mảnh vụn hình học có diện tích dưới ngưỡng kỹ thuật (Dropped sliver areas).\n" +
            "  • Chuẩn hóa hướng xoay của tọa độ đa giác theo đúng quy định OGC Simple Features.\n" +
            "  • Xuất kèm tệp nhật ký làm sạch hình học song ngữ (Cleaning Log CSV) ghi rõ số mảnh xuất, diện tích mảnh vụn đã bỏ và các lỗi đã sửa, bảo đảm tính minh bạch tuyệt đối đối với kiểm toán viên quốc tế.",
            { indent: 400 }
          ),

          createHeading3("2.5. Tự động hóa kết xuất trọn bộ hồ sơ thẩm tra Due Diligence Statement (DDS):"),
          createPara(
            "Ứng dụng tích hợp mô-đun kết xuất tự động trọn gói hồ sơ EUDR DDS bằng công nghệ jsPDF và JSZip. Chỉ với 1 cú nhấp chuột tại trang quản lý đơn hàng xuất khẩu, hệ thống tự động sinh một tệp nén .ZIP tiêu chuẩn mang tên mã đơn hàng, chứa đầy đủ các tài liệu sau:",
            { indent: 400 }
          ),
          createPara(
            "1. Tệp DDS1 (Due Diligence Statement - PDF): Báo cáo giải trình thẩm định toàn diện, phân tích rủi ro mất rừng, thông tin nhà sản xuất, bên mua, mã HS code cao su, chứng chỉ PEFC/FSC và nhúng mã QR tra cứu trực tuyến.",
            { indent: 400 }
          ),
          createPara(
            "2. Tệp DDS2 (Shipment Lot Declaration - PDF): Bảng khai báo chi tiết từng lô mủ đóng trong container, trọng lượng quy đổi (tấn), loại pallet, ngày khai thác mủ tại vườn cây, ngày sản xuất tại nhà máy và tên nhà máy chế biến.",
            { indent: 400 }
          ),
          createPara(
            "3. Tệp DDS3 (Production & Deforestation Analysis - PDF): Báo cáo phân tích chuyên sâu về không gây mất rừng, cam kết mốc thời gian trước 31/12/2020 và tính hợp pháp của đất vườn cây.",
            { indent: 400 }
          ),
          createPara(
            "4. Tệp GeoJSON chuẩn hóa: Chứa toàn bộ các đa giác polygon của các lô vườn cấu thành nên đơn hàng xuất khẩu, đã được xử lý làm sạch hình học, tương thích 100% với định dạng của Cổng thẩm định Châu Âu.",
            { indent: 400 }
          ),
          createPara(
            "5. Tệp CSV đối chiếu lô vườn và CSV nhật ký làm sạch: Bảng tổng hợp đối chiếu số thứ tự, mã lô, nông trường, đội, diện tích và năm trồng phục vụ rà soát nhanh.",
            { indent: 400 }
          ),

          createHeading3("2.6. Cổng khách hàng (Customer Portal) bảo mật và Giao diện song ngữ Việt - Khmer:"),
          createPara(
            "• Cơ chế Public Token cô lập bảo mật: Mỗi đơn hàng xuất khẩu được cấp một mã Token mã hóa ngẫu nhiên (Public Token). Khi khách hàng Châu Âu quét mã QR in trên kiện mủ hoặc hồ sơ DDS, hệ thống dẫn thẳng tới trang tra cứu công khai độc lập (`/eudr-order?token=...`). Khách hàng có thể xem bản đồ số, tra cứu xuất xứ và tải trọn bộ hồ sơ DDS của đúng đơn hàng của mình mà hoàn toàn không cần tài khoản đăng nhập, tuyệt đối không truy cập được dữ liệu nội bộ nhà máy hay các đơn hàng khác.",
            { indent: 400 }
          ),
          createPara(
            "• Giao diện tối ưu hóa song ngữ Việt - Khmer: Các màn hình thao tác của công nhân tại dây chuyền (quét nhận mủ, quét sấy mủ, quét đóng container) đều được thiết kế song ngữ tiếng Việt kèm tiếng Khmer bản địa, giao diện nút bấm to bản, màu sắc tương phản rõ ràng, tối ưu hóa cho màn hình cảm ứng điện thoại thông minh giá rẻ của công nhân.",
            { indent: 400 }
          ),

          createHeading2("3. Hiệu quả của sáng kiến"),
          createHeading3("3.1. Hiệu quả về mặt chuyên môn, kỹ thuật và quản lý:"),
          createPara(
            "• Rút ngắn thời gian truy xuất từ nhiều ngày xuống dưới 30 giây: Trước đây mất từ 4 đến 8 giờ (đơn hàng lớn mất 2 – 4 ngày) để tìm sổ sách, nay chỉ cần 1 thao tác quét mã QR hoặc nhập mã lô là có ngay toàn bộ lý lịch lô mủ và bản đồ lô vườn.",
            { indent: 400 }
          ),
          createPara(
            "• Đảm bảo 100% tính tuân thủ quy định EUDR của Liên minh Châu Âu: Toàn bộ các lô hàng xuất khẩu sang Châu Âu của công ty đều có đầy đủ gói thẩm tra DDS và tệp polygon GeoJSON chuẩn hóa, bảo đảm không có bất kỳ đơn hàng nào bị ách tắc hoặc từ chối tại các cảng nhập khẩu Châu Âu.",
            { indent: 400 }
          ),
          createPara(
            "• Kiểm soát hao hụt và cân đối nguyên liệu - thành phẩm thời gian thực: Giữ vững tỷ lệ thu hồi sản phẩm trong khoảng tối ưu 100% – 110%, phát hiện và xử lý ngay trong ngày các bất thường về kỹ thuật chế biến hoặc hao hụt nguyên liệu.",
            { indent: 400 }
          ),
          createPara(
            "• Triệt tiêu lỗi nhầm lẫn khi đóng hàng container: Tỷ lệ nhầm lẫn chủng loại mủ hoặc nhầm lô hàng khi đóng container giảm từ 1.5% trước đây về mức 0% tuyệt đối.",
            { indent: 400 }
          ),

          createHeading3("3.2. Hiệu quả kinh tế và xã hội:"),
          createPara(
            "• Bảo vệ và giữ vững thị trường xuất khẩu chiến lược Châu Âu: Giúp công ty duy trì xuất khẩu hàng ngàn tấn cao su sang thị trường EU mỗi năm với giá bán cao hơn từ 50 đến 100 USD/tấn so với các thị trường thông thường, bảo vệ doanh thu hàng triệu USD cho doanh nghiệp.",
            { indent: 400 }
          ),
          createPara(
            "• Tiết kiệm chi phí đầu tư phần mềm chuỗi cung ứng: Nếu thuê tư vấn bên ngoài xây dựng hệ thống GIS và phần mềm truy xuất nguồn gốc chuyên dụng, chi phí mua sắm từ 300 đến 500 triệu VNĐ cùng phí bảo trì từ 50 đến 80 triệu VNĐ/năm. Sáng kiến tự nghiên cứu nội bộ đã tiết kiệm toàn bộ chi phí bản quyền ban đầu.",
            { indent: 400 }
          ),
          createPara(
            "• Tiết kiệm chi phí làm hồ sơ thẩm định DDS thuê ngoài: Nhiều doanh nghiệp xuất khẩu cao su phải chi trả từ 15.000 đến 25.000 USD/năm để thuê các đơn vị dịch vụ đo đạc và lập hồ sơ DDS. Hệ thống tự động của sáng kiến đã tiết kiệm hoàn toàn khoản chi phí này.",
            { indent: 400 }
          ),
          createPara(
            "• Giá trị xã hội và môi trường: Khẳng định cam kết mạnh mẽ của Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom và Tập đoàn VRG về phát triển cao su bền vững, không phá rừng, bảo vệ hệ sinh thái rừng nhiệt đới tại Campuchia và nâng cao vị thế uy tín của ngành cao su Việt Nam trên trường quốc tế.",
            { indent: 400 }
          ),

          createHeading3("3.3. Bảng số liệu minh chứng so sánh kết quả Trước và Sau khi áp dụng sáng kiến:"),
          createPara(
            "Bảng tổng hợp đối chiếu định lượng các chỉ tiêu vận hành thực tế tại Nhà máy Chế biến Cao su Phước Hòa Kampong Thom:",
            { indent: 400, italics: true }
          ),

          buildComparisonTableReport2(),

          createPara("", { spaceAfter: 200 }),

          createHeading2("4. Khả năng áp dụng và mở rộng của sáng kiến"),
          createPara(
            "• Khả năng nhân rộng nội bộ: Sáng kiến đã được áp dụng và vận hành trơn tru trên 100% các đơn hàng xuất khẩu và toàn bộ diện tích vườn cây của Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom.",
            { indent: 400 }
          ),
          createPara(
            "• Khả năng chuyển giao cho các đơn vị thành viên của Tập đoàn VRG: Mô hình chuỗi cung ứng khép kín, giải pháp in tem mã QR động trên kiện mủ và phân hệ kết xuất hồ sơ EUDR DDS tự động hoàn toàn có thể đóng gói, chuyển giao và nhân rộng rất thuận lợi cho các Công ty cao su khác thuộc VRG tại Campuchia (Bà Rịa Kampong Thom, Tân Biên Kampong Thom, Chư Sê Kampong Thom, Đồng Phú Kratie, Dầu Tiếng Kratie...) và các nhà máy chế biến cao su xuất khẩu tại Việt Nam, góp phần đưa toàn bộ ngành cao su Việt Nam tiên phong vượt qua rào cản xanh EUDR.",
            { indent: 400 }
          ),

          createHeading1("PHẦN III: KẾT LUẬN VÀ KIẾN NGHỊ"),

          createHeading2("1. Kết luận"),
          createPara(
            "Sáng kiến \"Xây dựng hệ thống truy xuất nguồn gốc chuỗi cung ứng mủ cao su khép kín từ vườn cây đến thành phẩm xuất khẩu, đáp ứng quy định EUDR bằng công nghệ mã QR động và bản đồ số GIS trên nền tảng Rubber ERP\" là một bước tiến vượt bậc về công nghệ và quản trị chuỗi cung ứng của Nhà máy Chế biến Cao su Phước Hòa Kampong Thom.",
            { indent: 400 }
          ),
          createPara(
            "Bằng tinh thần tự lực sáng tạo kết hợp trí tuệ nhân tạo, nhóm tác giả đã làm chủ hoàn toàn công nghệ, giải quyết xuất sắc bài toán tuân thủ đạo luật chống phá rừng khắt khe nhất của Châu Âu, rút ngắn thời gian truy xuất từ nhiều ngày xuống dưới 30 giây và kiểm soát chặt chẽ tỷ lệ cân đối nguyên liệu - thành phẩm trong thời gian thực. Đề tài không chỉ mang lại hiệu quả kinh tế to lớn, bảo vệ doanh thu xuất khẩu hàng triệu USD mà còn nâng cao năng lực cạnh tranh và uy tín thương hiệu phát triển bền vững của Cao su Phước Hòa Kampong Thom.",
            { indent: 400 }
          ),

          createHeading2("2. Kiến nghị và đề xuất"),
          createPara(
            "Để tiếp tục phát huy tối đa hiệu quả của sáng kiến và chuẩn bị sẵn sàng cho các đợt kiểm tra thực địa của các phái đoàn thẩm định quốc tế, Nhóm tác giả kính đề xuất một số nội dung sau:",
            { indent: 400 }
          ),
          createPara(
            "1. Ban hành quy trình bắt buộc dán và quét mã QR kiện mủ thành phẩm: Ban hành quy định chuẩn hóa thao tác quét mã QR đối soát 100% đối với toàn bộ các lô mủ xuất xưởng và xuất khẩu container.",
            { indent: 400 }
          ),
          createPara(
            "2. Duy trì hạ tầng máy chủ và cập nhật định kỳ bản đồ GIS vườn cây: Hàng năm bố trí kinh phí cập nhật dữ liệu mở cạo, năng suất và ranh giới lô vườn mới (nếu có) trên hệ thống bản đồ số.",
            { indent: 400 }
          ),
          createPara(
            "3. Khen thưởng và nhân rộng mô hình: Kính đề nghị Hội đồng Khoa học Công nghệ Công ty công nhận Sáng kiến Cải tiến loại A cấp Công ty và đề xuất Tập đoàn Công nghiệp Cao su Việt Nam xét tặng Bằng khen, đồng thời tạo điều kiện tổ chức hội thảo chia sẻ kinh nghiệm cho các đơn vị thành viên VRG tại Campuchia.",
            { indent: 400 }
          ),

          createHeading1("PHẦN TÀI LIỆU THAM KHẢO VÀ PHỤ LỤC"),

          createHeading2("1. Danh mục tài liệu tham khảo"),
          createPara("1. Quy định (EU) 2023/1115 của Nghị viện và Hội đồng Châu Âu (European Union Deforestation Regulation - EUDR) ban hành ngày 31/05/2023.", { indent: 400 }),
          createPara("2. Tiêu chuẩn PEFC ST 2002-1:2024 – Hệ thống thẩm định chi tiết PEFC EUDR (PEFC EUDR DDS Requirements).", { indent: 400 }),
          createPara("3. Tiêu chuẩn Quốc gia TCVN 3769:2016 – Cao su thiên nhiên định chuẩn kỹ thuật (SVR) – Quy định kỹ thuật.", { indent: 400 }),
          createPara("4. Tiêu chuẩn dữ liệu không gian địa lý GeoJSON – RFC 7946 của Internet Engineering Task Force (IETF).", { indent: 400 }),
          createPara("5. Hướng dẫn kỹ thuật thẩm định dữ liệu không gian địa lý của Cổng thông tin Cấp phép Rừng và Lâm sản Châu Âu (EU Information System / TRACES).", { indent: 400 }),
          createPara("6. Bản đồ địa chính vườn cây cao su và hồ sơ quản lý đất đai Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom.", { indent: 400 }),

          createHeading2("2. Phụ lục minh họa kỹ thuật"),
          createHeading3("Phụ lục 1: Cấu trúc tệp dữ liệu không gian địa lý GeoJSON chuẩn hóa EUDR của đơn hàng"),
          createPara(
            "```json\n" +
            "{\n" +
            '  "type": "FeatureCollection",\n' +
            '  "features": [\n' +
            "    {\n" +
            '      "type": "Feature",\n' +
            '      "properties": {\n' +
            '        "Ma_lo_2026": "NT1-D02-L05",\n' +
            '        "Ten": "Lô 05 Đội 2 Nông trường 1",\n' +
            '        "Nong_truong": "Nông trường 1",\n' +
            '        "Doi_2026": "Đội 2",\n' +
            '        "Dtich_ha": 25.42,\n' +
            '        "Nam_trong": 2012,\n' +
            '        "Giong_cay": "PB260",\n' +
            '        "Deforestation_Free": "YES (Planted before 31/12/2020)"\n' +
            "      },\n" +
            '      "geometry": {\n' +
            '        "type": "Polygon",\n' +
            '        "coordinates": [[[105.123456, 12.654321], [105.128765, 12.654890], ... [105.123456, 12.654321]]]\n' +
            "      }\n" +
            "    }\n" +
            "  ]\n" +
            "}\n" +
            "```",
            { indent: 400 }
          ),

          createPara("", { spaceAfter: 200 }),
          createHeading3("Phụ lục 2: Mô hình cấu trúc gói tài nguyên thẩm định xuất khẩu EUDR (.ZIP)"),
          createPara(
            "• Gói nén ZIP chuẩn: [MÃ_ĐƠN_HÀNG]_EUDR_DDS_PACKAGE.zip bao gồm:\n" +
            "  + 01_[Mã_đơn]_DDS1_Due_Diligence_Statement.pdf (Kèm mã QR định danh trực tuyến)\n" +
            "  + 02_[Mã_đơn]_DDS2_Shipment_Lot_Declaration.pdf (Bảng khai chi tiết lô mủ, pallet, ngày cạo, ngày sấy)\n" +
            "  + 03_[Mã_đơn]_DDS3_Deforestation_Analysis.pdf (Báo cáo cam kết không phá rừng sau 31/12/2020)\n" +
            "  + 04_[Mã_đơn]_polygon_lo_vuon.geojson (Tệp tọa độ WGS84 đã làm sạch hình học)\n" +
            "  + 05_[Mã_đơn]_doi_chieu_lo.csv (Bảng đối chiếu danh sách lô vườn và diện tích)\n" +
            "  + 06_[Mã_đơn]_nhat_ky_lam_sach.csv (Nhật ký xử lý hình học song ngữ Việt - Anh)\n" +
            "• Đường dẫn tra cứu công khai cho khách hàng EU: https://qlsxkpt.vercel.app/eudr-order?token=[PUBLIC_TOKEN].",
            { indent: 400 }
          ),

          createPara("", { spaceAfter: 400 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell(
                    [
                      createPara("XÁC NHẬN CỦA LÃNH ĐẠO ĐƠN VỊ", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("GIÁM ĐỐC NHÀ MÁY", { bold: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký, ghi rõ họ tên và đóng dấu)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                  createCell(
                    [
                      createPara("Kampong Thom, ngày ..... tháng ..... năm 2026", { italics: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("ĐẠI DIỆN NHÓM TÁC GIẢ SÁNG KIẾN", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("CHỦ NHIỆM ĐỀ TÀI", { bold: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("Vương Nguyễn Phương Lâm", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                    ],
                    { widthPercent: 50 }
                  ),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 400 }),
          createPara("---------------------------------------------------------------------------------------------------------------------------------", { alignment: AlignmentType.CENTER }),
          createPara("PHẦN XÉT DUYỆT CỦA HỘI ĐỒNG KHOA HỌC CÔNG NGHỆ CÔNG TY", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 100,
          }),
          createPara("(Đánh giá, nhận xét và xếp loại sáng kiến cải tiến kỹ thuật cấp Công ty năm 2026)", {
            italics: true,
            alignment: AlignmentType.CENTER,
            size: 24,
            spaceAfter: 160,
          }),
          createPara("1. Ý kiến nhận xét của Hội đồng KHCN: ....................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................", { indent: 400, spaceAfter: 120 }),
          createPara("2. Kết luận và Xếp loại của Hội đồng: ....................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................", { indent: 400, spaceAfter: 200 }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell(
                    [
                      createPara("THƯ KÝ HỘI ĐỒNG", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký và ghi rõ họ tên)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                  createCell(
                    [
                      createPara("CHỦ TỊCH HỘI ĐỒNG KHCN", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký, ghi rõ họ tên và đóng dấu)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                ],
              }),
            ],
          }),
        ],
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "Báo cáo sáng kiến cải tiến Truy xuất nguồn gốc & EUDR - Trang ",
                    font: FONT_NAME,
                    size: 20,
                    italics: true,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: FONT_NAME,
                    size: 20,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Report 2 Word docx generated successfully at: ${outputPath}`);
}

async function main() {
  const outDocx = path.resolve("cung_cap_dl/BAO_CAO_SANG_KIEN_02_TRUY_XUAT_NGUON_GOC_EUDR.docx");
  await generateReport2Docx(outDocx);
}

main().catch(console.error);

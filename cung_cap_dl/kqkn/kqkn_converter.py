import os
import sys
import re
import math
import random
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP

# Đảm bảo mã hóa UTF-8 cho console Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Vui lòng cài đặt PyMuPDF: python -m pip install pymupdf")
    sys.exit(1)


def round_half_up_dec(d_val: Decimal, decimals: int) -> Decimal:
    """Làm tròn nửa lên (ROUND_HALF_UP) chuẩn mực sử dụng Decimal."""
    pattern = Decimal('1.' + '0' * decimals if decimals > 0 else '1')
    return d_val.quantize(pattern, rounding=ROUND_HALF_UP)


def to_excel_date_serial(d: date) -> int:
    """Tính số serial ngày của Excel (hệ 1900 với bug năm nhuận 1900 của Lotus 1-2-3)."""
    excel_epoch = date(1899, 12, 30)
    return (d - excel_epoch).days


def parse_decimal_vn(s: str, decimals: int) -> Decimal:
    """Chuyển chuỗi số dạng Việt Nam '0,027' sang Decimal chuẩn."""
    if not s or not str(s).strip():
        return Decimal('0')
    cleaned = str(s).strip().replace(',', '.')
    d = Decimal(cleaned)
    pattern = Decimal('1.' + '0' * decimals if decimals > 0 else '1')
    return d.quantize(pattern)


def parse_kqkn_pdf(pdf_input, original_filename: str = ""):
    """
    Đọc file PDF biểu KQKN (đường dẫn hoặc bytes) và trích xuất toàn bộ metadata và bảng dữ liệu các lô.
    """
    if isinstance(pdf_input, bytes):
        doc = fitz.open(stream=pdf_input, filetype="pdf")
        filename_hint = original_filename
    else:
        doc = fitz.open(pdf_input)
        filename_hint = os.path.basename(pdf_input)

    page = doc[0]
    txt = page.get_text('text')

    # Trích xuất ngày sản xuất
    m_sx = re.search(r'NGÀY SẢN XUẤT:\s*(\d{2}/\d{2}/\d{4})', txt)
    ngay_sx_str = m_sx.group(1) if m_sx else None

    # Trích xuất ngày kiểm nghiệm (từ phần chữ ký hoặc tên file)
    m_kn = re.search(r'ngày\s*(\d{2})\s*tháng\s*(\d{2})\s*năm\s*(\d{4})', txt)
    if m_kn:
        ngay_kn_str = f"{m_kn.group(1)}/{m_kn.group(2)}/{m_kn.group(3)}"
    else:
        m_file = re.search(r'(\d{2})[-/](\d{2})[-/](\d{4})', filename_hint)
        if m_file:
            ngay_kn_str = f"{m_file.group(1)}/{m_file.group(2)}/{m_file.group(3)}"
        else:
            ngay_kn_str = datetime.now().strftime("%d/%m/%Y")

    # Trích xuất bảng
    tabs = page.find_tables()
    if not tabs.tables:
        raise ValueError(f"Không tìm thấy bảng trong file PDF: {pdf_path}")

    table_data = tabs[0].extract()
    lots = []
    year_suffix = ngay_kn_str.split('/')[-1][-2:] if ngay_kn_str else "26"

    for r in table_data:
        if not r[0] or not str(r[0]).strip().isdigit():
            continue
        pkn = str(r[0]).strip()
        lo_nm_raw = str(r[1]).strip().replace('\n', '')
        if '/' in lo_nm_raw:
            lo_nm_full = lo_nm_raw
        else:
            lo_nm_full = f"{lo_nm_raw}/{year_suffix}"

        hang_dk = str(r[2]).strip() if r[2] else ""
        dat_hang = str(r[25]).strip() if len(r) > 25 and r[25] else hang_dk

        lot_entry = {
            'pkn': pkn,
            'lo_nm': lo_nm_raw,
            'lo_nm_full': lo_nm_full,
            'hang_dk': hang_dk,
            'dat_hang': dat_hang,
            'tc_x': parse_decimal_vn(r[3], 3),
            'tc_3sd': parse_decimal_vn(r[4], 3),
            'tc_x_plus_3sd': parse_decimal_vn(r[5], 3),
            'tro_x': parse_decimal_vn(r[6], 3),
            'tro_3sd': parse_decimal_vn(r[7], 3),
            'tro_x_plus_3sd': parse_decimal_vn(r[8], 3),
            'bh_x': parse_decimal_vn(r[9], 2),
            'bh_xmax': parse_decimal_vn(r[10], 2),
            'ni_x': parse_decimal_vn(r[11], 2),
            'ni_xmax': parse_decimal_vn(r[12], 2),
            'po_xmin': parse_decimal_vn(r[13], 1),
            'po_x': parse_decimal_vn(r[14], 1),
            'po_xmax': parse_decimal_vn(r[15], 1),
            'pri_xmin': parse_decimal_vn(r[16], 1),
            'pri_x': parse_decimal_vn(r[17], 1),
            'pri_xmax': parse_decimal_vn(r[18], 1),
            'ml_xmin': parse_decimal_vn(r[22], 1),
            'ml_x': parse_decimal_vn(r[23], 1),
            'ml_xmax': parse_decimal_vn(r[24], 1),
        }
        lots.append(lot_entry)

    doc.close()
    return {
        'ngay_sx': ngay_sx_str,
        'ngay_kn': ngay_kn_str,
        'lots': lots,
        'pdf_path': filename_hint
    }


def solve_tc_tro(target_mean: Decimal, target_3sd: Decimal, n: int, max_iter=40000):
    """
    Tái tạo n mẫu cho Tạp chất (TC) hoặc Tro (TRO):
    - Đơn vị 3 số lẻ (bước 0.001)
    - Phải khớp trung bình cộng X và 3sd (ddof=1)
    """
    scale = 1000
    tm = int(target_mean * scale)
    t3sd = int(target_3sd * scale)
    target_sum = int(target_mean * n * scale)
    pattern3 = Decimal('0.001')

    if t3sd == 0:
        return [target_mean] * n

    spread = max(1, int((t3sd / 3.0) * 1.6))
    for _ in range(max_iter):
        vals = [tm + random.randint(-spread, spread) for _ in range(n)]
        vals = [max(0, v) for v in vals]
        diff = target_sum - sum(vals)
        for _ in range(abs(diff)):
            idx = random.randint(0, n - 1)
            if diff > 0:
                vals[idx] += 1
            else:
                if vals[idx] > 0:
                    vals[idx] -= 1

        d_sum = sum(vals)
        mean_d = (Decimal(d_sum) / Decimal(n * scale)).quantize(pattern3, rounding=ROUND_HALF_UP)
        if mean_d != target_mean:
            continue

        mean_f = d_sum / n
        var_f = sum((v - mean_f) ** 2 for v in vals) / (n - 1)
        sd_f = math.sqrt(var_f) / scale
        sd3_d = (Decimal(str(sd_f * 3))).quantize(pattern3, rounding=ROUND_HALF_UP)
        if sd3_d == target_3sd:
            vals.sort()
            return [(Decimal(v) / Decimal(scale)).quantize(pattern3) for v in vals]

    raise RuntimeError(f"Không tìm được nghiệm cho TC/TRO (X={target_mean}, 3sd={target_3sd}, n={n})")


def solve_bh_ni(target_mean: Decimal, target_xmax: Decimal, n: int):
    """
    Tái tạo n mẫu cho Bay hơi (BH) hoặc Nitơ (NI):
    - Đơn vị 2 số lẻ (bước 0.01)
    - Phải khớp X và Xmax
    - Giữ độ rộng trong lô hẹp (<= 0.02)
    """
    mult = 100
    i_max = int(target_xmax * mult)
    pattern2 = Decimal('0.01')

    if target_xmax == target_mean:
        return [target_xmax] * n

    # Thử độ rộng <= 0.02
    for k0 in range(n):
        for k1 in range(n - k0):
            k2 = n - k0 - k1
            if k2 < 1:
                continue
            vals = [i_max - 2] * k0 + [i_max - 1] * k1 + [i_max] * k2
            avg_d = (Decimal(sum(vals)) / Decimal(n * mult)).quantize(pattern2, rounding=ROUND_HALF_UP)
            if avg_d == target_mean:
                return [(Decimal(v) / Decimal(mult)).quantize(pattern2) for v in vals]

    # Mở rộng độ rộng <= 0.03 nếu cần thiết
    for k0 in range(n):
        for k1 in range(n - k0):
            for k2 in range(n - k0 - k1):
                k3 = n - k0 - k1 - k2
                if k3 < 1:
                    continue
                vals = [i_max - 3] * k0 + [i_max - 2] * k1 + [i_max - 1] * k2 + [i_max] * k3
                avg_d = (Decimal(sum(vals)) / Decimal(n * mult)).quantize(pattern2, rounding=ROUND_HALF_UP)
                if avg_d == target_mean:
                    return [(Decimal(v) / Decimal(mult)).quantize(pattern2) for v in vals]

    raise RuntimeError(f"Không tìm được nghiệm cho BH/NI (X={target_mean}, Xmax={target_xmax}, n={n})")


def solve_min_mean_max(xmin: Decimal, target_mean: Decimal, xmax: Decimal, n: int, step: Decimal, max_iter=30000):
    """
    Tái tạo n mẫu cho P0, PRI, ML:
    - Khớp chính xác Xmin, Xmax và X (trung bình làm tròn 1 số lẻ)
    - Tuân thủ bước nhảy máy đo (0.5 hoặc 0.1)
    - Sử dụng Decimal hoàn toàn, loại bỏ 100% sai số dấu phẩy động
    """
    pattern1 = Decimal('0.1')
    mult = int(Decimal('1') / step)  # 2 nếu step=0.5, 10 nếu step=0.1
    i_min = int(xmin * mult)
    i_max = int(xmax * mult)

    if i_min == i_max:
        return [xmin] * n

    for _ in range(max_iter):
        mid = [random.randint(i_min, i_max) for _ in range(n - 2)]
        vals = [i_min] + mid + [i_max]
        tot = sum(vals)
        avg_d = (Decimal(tot) / Decimal(n * mult)).quantize(pattern1, rounding=ROUND_HALF_UP)
        if avg_d == target_mean:
            vals.sort()
            return [(Decimal(v) / Decimal(mult)).quantize(pattern1) for v in vals]

    raise RuntimeError(f"Không tìm được nghiệm cho (Xmin={xmin}, X={target_mean}, Xmax={xmax}, step={step}, n={n})")


def determine_machine_step(xmin: Decimal, xmax: Decimal) -> Decimal:
    """
    Quy tắc bước nhảy máy đo:
    - Nếu cả Xmin và Xmax đều chia hết cho 0.5 -> bước 0.5
    - Nếu có giá trị lẻ 0.1 -> bước 0.1
    """
    def is_half(val: Decimal) -> bool:
        return (val * 2) % 1 == 0

    if is_half(xmin) and is_half(xmax):
        return Decimal('0.5')
    return Decimal('0.1')


def reconstruct_lot_samples(lot: dict, n: int):
    """Sinh toàn bộ các mẫu chi tiết cho 1 lô dạng Decimal."""
    tc_samples = solve_tc_tro(lot['tc_x'], lot['tc_3sd'], n)
    tro_samples = solve_tc_tro(lot['tro_x'], lot['tro_3sd'], n)
    bh_samples = solve_bh_ni(lot['bh_x'], lot['bh_xmax'], n)
    ni_samples = solve_bh_ni(lot['ni_x'], lot['ni_xmax'], n)

    step_po = determine_machine_step(lot['po_xmin'], lot['po_xmax'])
    po_samples = solve_min_mean_max(lot['po_xmin'], lot['po_x'], lot['po_xmax'], n, step_po)

    pri_samples = solve_min_mean_max(lot['pri_xmin'], lot['pri_x'], lot['pri_xmax'], n, Decimal('0.1'))

    step_ml = determine_machine_step(lot['ml_xmin'], lot['ml_xmax'])
    ml_samples = solve_min_mean_max(lot['ml_xmin'], lot['ml_x'], lot['ml_xmax'], n, step_ml)

    return {
        'tc': tc_samples,
        'tro': tro_samples,
        'bh': bh_samples,
        'ni': ni_samples,
        'po': po_samples,
        'step_po': step_po,
        'pri': pri_samples,
        'ml': ml_samples,
        'step_ml': step_ml,
        'mau': [None] * n
    }


def verify_lot_samples(lot: dict, samples: dict, n: int):
    """
    Kiểm tra độc lập toàn bộ các mẫu sinh ra so với số liệu gốc trên biểu bằng Decimal.
    """
    errors = []
    p3 = Decimal('0.001')
    p2 = Decimal('0.01')
    p1 = Decimal('0.1')

    # TC
    tc = samples['tc']
    m_tc = (sum(tc) / Decimal(n)).quantize(p3, rounding=ROUND_HALF_UP)
    mean_tc_float = float(sum(tc) / Decimal(n))
    var_tc = sum((float(x) - mean_tc_float) ** 2 for x in tc) / (n - 1)
    sd3_tc = (Decimal(str(3.0 * math.sqrt(var_tc)))).quantize(p3, rounding=ROUND_HALF_UP)
    if m_tc != lot['tc_x']:
        errors.append(f"TC mean: tính {m_tc} != gốc {lot['tc_x']}")
    if sd3_tc != lot['tc_3sd']:
        errors.append(f"TC 3sd: tính {sd3_tc} != gốc {lot['tc_3sd']}")

    # TRO
    tro = samples['tro']
    m_tro = (sum(tro) / Decimal(n)).quantize(p3, rounding=ROUND_HALF_UP)
    mean_tro_float = float(sum(tro) / Decimal(n))
    var_tro = sum((float(x) - mean_tro_float) ** 2 for x in tro) / (n - 1)
    sd3_tro = (Decimal(str(3.0 * math.sqrt(var_tro)))).quantize(p3, rounding=ROUND_HALF_UP)
    if m_tro != lot['tro_x']:
        errors.append(f"TRO mean: tính {m_tro} != gốc {lot['tro_x']}")
    if sd3_tro != lot['tro_3sd']:
        errors.append(f"TRO 3sd: tính {sd3_tro} != gốc {lot['tro_3sd']}")

    # BH
    bh = samples['bh']
    m_bh = (sum(bh) / Decimal(n)).quantize(p2, rounding=ROUND_HALF_UP)
    max_bh = max(bh)
    if m_bh != lot['bh_x']:
        errors.append(f"BH mean: tính {m_bh} != gốc {lot['bh_x']}")
    if max_bh != lot['bh_xmax']:
        errors.append(f"BH max: tính {max_bh} != gốc {lot['bh_xmax']}")

    # NI
    ni = samples['ni']
    m_ni = (sum(ni) / Decimal(n)).quantize(p2, rounding=ROUND_HALF_UP)
    max_ni = max(ni)
    if m_ni != lot['ni_x']:
        errors.append(f"NI mean: tính {m_ni} != gốc {lot['ni_x']}")
    if max_ni != lot['ni_xmax']:
        errors.append(f"NI max: tính {max_ni} != gốc {lot['ni_xmax']}")

    # PO
    po = samples['po']
    min_po = min(po)
    m_po = (sum(po) / Decimal(n)).quantize(p1, rounding=ROUND_HALF_UP)
    max_po = max(po)
    if min_po != lot['po_xmin']:
        errors.append(f"PO min: tính {min_po} != gốc {lot['po_xmin']}")
    if m_po != lot['po_x']:
        errors.append(f"PO mean: tính {m_po} != gốc {lot['po_x']}")
    if max_po != lot['po_xmax']:
        errors.append(f"PO max: tính {max_po} != gốc {lot['po_xmax']}")

    step_po = samples['step_po']
    for v in po:
        if (v / step_po) % 1 != 0:
            errors.append(f"PO mẫu {v} sai bước nhảy {step_po}")

    # PRI
    pri = samples['pri']
    min_pri = min(pri)
    m_pri = (sum(pri) / Decimal(n)).quantize(p1, rounding=ROUND_HALF_UP)
    max_pri = max(pri)
    if min_pri != lot['pri_xmin']:
        errors.append(f"PRI min: tính {min_pri} != gốc {lot['pri_xmin']}")
    if m_pri != lot['pri_x']:
        errors.append(f"PRI mean: tính {m_pri} != gốc {lot['pri_x']}")
    if max_pri != lot['pri_xmax']:
        errors.append(f"PRI max: tính {max_pri} != gốc {lot['pri_xmax']}")

    # ML
    ml = samples['ml']
    min_ml = min(ml)
    m_ml = (sum(ml) / Decimal(n)).quantize(p1, rounding=ROUND_HALF_UP)
    max_ml = max(ml)
    if min_ml != lot['ml_xmin']:
        errors.append(f"ML min: tính {min_ml} != gốc {lot['ml_xmin']}")
    if m_ml != lot['ml_x']:
        errors.append(f"ML mean: tính {m_ml} != gốc {lot['ml_x']}")
    if max_ml != lot['ml_xmax']:
        errors.append(f"ML max: tính {max_ml} != gốc {lot['ml_xmax']}")

    step_ml = samples['step_ml']
    for v in ml:
        if (v / step_ml) % 1 != 0:
            errors.append(f"ML mẫu {v} sai bước nhảy {step_ml}")

    return len(errors) == 0, errors


def col_idx_to_letter(col_idx: int) -> str:
    """Chuyển số thứ tự cột 1-based sang chữ cái Excel (1 -> A, 27 -> AA)."""
    result = ""
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result = chr(65 + remainder) + result
    return result


def export_to_excel(template_source, output_target, parsed_data: dict, lot_samples: list, n: int,
                    tieu_chuan: str = "TCCS 112:2022", chung_loai: str = "10", loai_kn: str = "thuong"):
    """
    Tạo file Excel nhập liệu dựa trên file mẫu (.xlsx) bằng cách cập nhật sheet1.xml.
    Đảm bảo định dạng chuẩn, không bị sai số dấu phẩy động XML.
    Hỗ trợ cả đường dẫn file hoặc buffer in-memory BytesIO.
    """
    dt_kn = datetime.strptime(parsed_data['ngay_kn'], "%d/%m/%Y").date()
    dt_sx = datetime.strptime(parsed_data['ngay_sx'], "%d/%m/%Y").date() if parsed_data['ngay_sx'] else dt_kn

    serial_kn = to_excel_date_serial(dt_kn)
    serial_sx = to_excel_date_serial(dt_sx)

    # Đọc cấu trúc template (hỗ trợ cả path và bytes)
    zin = zipfile.ZipFile(template_source, 'r')
    xml_content = zin.read('xl/worksheets/sheet1.xml').decode('utf-8')
    all_files = {name: zin.read(name) for name in zin.namelist()}
    zin.close()

    # Phân tích sheet1.xml
    ET.register_namespace('', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    tree = ET.fromstring(xml_content)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

    sheet_data = tree.find('m:sheetData', ns)
    if sheet_data is None:
        raise ValueError("Không tìm thấy sheetData trong template")

    # Cập nhật Row 2 (Ngày KN, Ngày SX, Chủng loại, Loại KN, Tiêu chuẩn, Số mẫu)
    r2 = sheet_data.find("m:row[@r='2']", ns)
    if r2 is not None:
        for c in r2.findall('m:c', ns):
            ref = c.attrib.get('r', '')
            if ref == 'A2':
                v = c.find('m:v', ns)
                if v is not None:
                    v.text = str(serial_kn)
            elif ref == 'B2':
                v = c.find('m:v', ns)
                if v is not None:
                    v.text = str(serial_sx)
            elif ref == 'C2':
                v = c.find('m:v', ns)
                if v is not None:
                    v.text = str(chung_loai)
            elif ref == 'D2':
                t_node = c.find('.//m:t', ns)
                if t_node is not None:
                    t_node.text = str(loai_kn)
            elif ref == 'E2':
                t_node = c.find('.//m:t', ns)
                if t_node is not None:
                    t_node.text = str(tieu_chuan)
            elif ref == 'F2':
                v = c.find('m:v', ns)
                if v is not None:
                    v.text = str(n)

    # Xóa các dòng từ dòng 4 trở đi trong template
    for r in list(sheet_data.findall('m:row', ns)):
        if int(r.attrib.get('r', 0)) >= 4:
            sheet_data.remove(r)

    # Thêm các dòng dữ liệu mới
    # Thứ tự các nhóm cột theo quy chuẩn:
    # LO_NM, TC_M1..Mn, TRO_M1..Mn, BH_M1..Mn, NI_M1..Mn, PO_M1..Mn, PRI_M1..Mn, ML_M1..Mn, MAU_M1..Mn
    for idx, (lot, s) in enumerate(zip(parsed_data['lots'], lot_samples)):
        row_num = 4 + idx
        row_elem = ET.SubElement(sheet_data, 'row', {'r': str(row_num)})

        col_counter = 1

        # Cột LO_NM (dạng inlineStr)
        c_elem = ET.SubElement(row_elem, 'c', {'r': f"{col_idx_to_letter(col_counter)}{row_num}", 't': 'inlineStr'})
        is_elem = ET.SubElement(c_elem, 'is')
        t_elem = ET.SubElement(is_elem, 't')
        t_elem.text = lot['lo_nm_full']
        col_counter += 1

        # Các chỉ tiêu số
        groups = [
            (s['tc'], 3),
            (s['tro'], 3),
            (s['bh'], 2),
            (s['ni'], 2),
            (s['po'], 1),
            (s['pri'], 1),
            (s['ml'], 1)
        ]

        for values, decimals in groups:
            for val in values:
                col_letter = col_idx_to_letter(col_counter)
                c_elem = ET.SubElement(row_elem, 'c', {'r': f"{col_letter}{row_num}"})
                v_elem = ET.SubElement(c_elem, 'v')
                # Định dạng số chính xác không dư số lẻ
                d_val = Decimal(str(val))
                s_val = f"{d_val:f}"
                v_elem.text = s_val.rstrip('0').rstrip('.') if '.' in s_val else s_val
                col_counter += 1

        # Cột MAU (để trống nhưng vẫn tạo cell theo chuẩn hoặc để trống)
        for _ in range(n):
            col_counter += 1

    # Cập nhật lại dimension (1 cột LO_NM + 8 nhóm chỉ tiêu x n mẫu)
    max_col_letter = col_idx_to_letter(1 + 8 * n)
    max_row = 3 + len(parsed_data['lots'])
    dim_elem = tree.find('m:dimension', ns)
    if dim_elem is not None:
        dim_elem.attrib['ref'] = f"A1:{max_col_letter}{max_row}"

    # Chuyển đổi ngược thành XML string
    new_sheet1_xml = ET.tostring(tree, encoding='utf-8', xml_declaration=True)

    # Ghi lại file zip
    with zipfile.ZipFile(output_target, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in all_files.items():
            if name == 'xl/worksheets/sheet1.xml':
                zout.writestr(name, new_sheet1_xml)
            else:
                zout.writestr(name, data)


def convert_kqkn_data(pdf_input, n_samples: int = 6, tieu_chuan: str = "TCCS 112:2022",
                      chung_loai: str = "10", loai_kn: str = "thuong", original_filename: str = ""):
    """
    Hàm xử lý nghiệp vụ đầy đủ: Nhận file/bytes PDF -> Tái tạo mẫu -> Trả về kết quả Excel bytes & báo cáo chi tiết.
    """
    import io
    parsed = parse_kqkn_pdf(pdf_input, original_filename)
    total_lots = len(parsed['lots'])
    if total_lots == 0:
        raise ValueError("Không tìm thấy dữ liệu lô trong file PDF")

    template_name = f"Nhap_lieu_ban_dau_CSR10_12-07-2026_{n_samples}mau.xlsx"
    base_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(base_dir, template_name)
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Không tìm thấy template: {template_path}")

    dt_kn = datetime.strptime(parsed['ngay_kn'], "%d/%m/%Y")
    date_formatted = dt_kn.strftime("%d-%m-%Y")
    out_filename = f"Nhap_lieu_ban_dau_CSR10_{date_formatted}_{n_samples}mau.xlsx"

    lot_samples = []
    report_step_po = {}
    report_step_ml = {}
    report_rh_lots = []
    anomalies = []
    lots_summary = []

    for lot in parsed['lots']:
        samples = reconstruct_lot_samples(lot, n_samples)
        passed, errors = verify_lot_samples(lot, samples, n_samples)
        if not passed:
            raise RuntimeError(f"Xác minh thất bại tại lô {lot['lo_nm_full']}: {', '.join(errors)}")

        lot_samples.append(samples)
        report_step_po[lot['lo_nm_full']] = samples['step_po']
        report_step_ml[lot['lo_nm_full']] = samples['step_ml']

        if lot['dat_hang'] == 'RHCSR10':
            reasons = []
            if lot['ml_xmin'] < 73 or lot['ml_xmax'] > 93:
                reasons.append(f"ML ngoài 73-93 ({lot['ml_xmin']}-{lot['ml_xmax']})")
            if (lot['pri_xmax'] - lot['pri_xmin']) > Decimal('10.0'):
                reasons.append(f"Độ rộng PRI > 10 ({lot['pri_xmax'] - lot['pri_xmin']})")
            if (lot['po_xmax'] - lot['po_xmin']) > Decimal('8.0'):
                reasons.append(f"Độ rộng PO > 8 ({lot['po_xmax'] - lot['po_xmin']})")
            report_rh_lots.append((lot['lo_nm_full'], ", ".join(reasons) if reasons else "Khác"))

        if lot['tro_3sd'] > Decimal('0.1'):
            anomalies.append(f"Lô {lot['lo_nm_full']} có 3sd Tro cao bất thường: {lot['tro_3sd']}")

        lots_summary.append({
            'pkn': lot['pkn'],
            'lo_nm': lot['lo_nm'],
            'lo_nm_full': lot['lo_nm_full'],
            'hang_dk': lot['hang_dk'],
            'dat_hang': lot['dat_hang'],
            'tc_x': str(lot['tc_x']),
            'tc_3sd': str(lot['tc_3sd']),
            'tro_x': str(lot['tro_x']),
            'tro_3sd': str(lot['tro_3sd']),
            'bh_x': str(lot['bh_x']),
            'bh_xmax': str(lot['bh_xmax']),
            'ni_x': str(lot['ni_x']),
            'ni_xmax': str(lot['ni_xmax']),
            'po_min': str(lot['po_xmin']),
            'po_x': str(lot['po_x']),
            'po_max': str(lot['po_xmax']),
            'po_step': str(samples['step_po']),
            'pri_min': str(lot['pri_xmin']),
            'pri_x': str(lot['pri_x']),
            'pri_max': str(lot['pri_xmax']),
            'ml_min': str(lot['ml_xmin']),
            'ml_x': str(lot['ml_x']),
            'ml_max': str(lot['ml_xmax']),
            'ml_step': str(samples['step_ml']),
        })

    out_buffer = io.BytesIO()
    export_to_excel(template_path, out_buffer, parsed, lot_samples, n_samples, tieu_chuan, chung_loai, loai_kn)
    excel_bytes = out_buffer.getvalue()

    po_05 = [k for k, v in report_step_po.items() if Decimal(str(v)) == Decimal('0.5')]
    po_01 = [k for k, v in report_step_po.items() if Decimal(str(v)) == Decimal('0.1')]
    ml_05 = [k for k, v in report_step_ml.items() if Decimal(str(v)) == Decimal('0.5')]
    ml_01 = [k for k, v in report_step_ml.items() if Decimal(str(v)) == Decimal('0.1')]

    return {
        'success': True,
        'filename': out_filename,
        'excel_bytes': excel_bytes,
        'parsed': {
            'ngay_sx': parsed['ngay_sx'],
            'ngay_kn': parsed['ngay_kn'],
            'total_lots': total_lots
        },
        'lots': lots_summary,
        'report': {
            'total_lots': total_lots,
            'lot_range': f"{parsed['lots'][0]['lo_nm_full']} -> {parsed['lots'][-1]['lo_nm_full']}",
            'ngay_sx': parsed['ngay_sx'],
            'ngay_kn': parsed['ngay_kn'],
            'tieu_chuan': tieu_chuan,
            'n_samples': n_samples,
            'step_po': {'po_05': po_05, 'po_01': po_01},
            'step_ml': {'ml_05': ml_05, 'ml_01': ml_01},
            'rh_lots': report_rh_lots,
            'anomalies': anomalies
        }
    }


def process_kqkn_file(pdf_path: str, n_samples: int = 6):
    """
    Quy trình xử lý hoàn chỉnh từ file PDF đến file Excel nhập liệu.
    """
    print(f"\n=======================================================")
    print(f"BẮT ĐẦU XỬ LÝ: {os.path.basename(pdf_path)} (Số mẫu: {n_samples})")
    print(f"=======================================================")

    parsed = parse_kqkn_pdf(pdf_path)
    total_lots = len(parsed['lots'])
    print(f"- Ngày sản xuất : {parsed['ngay_sx']}")
    print(f"- Ngày kiểm nghiệm: {parsed['ngay_kn']}")
    print(f"- Tổng số lô     : {total_lots} lô")

    # Chọn template
    template_name = f"Nhap_lieu_ban_dau_CSR10_12-07-2026_{n_samples}mau.xlsx"
    if not os.path.exists(template_name):
        raise FileNotFoundError(f"Không tìm thấy template: {template_name}")

    # Tên file xuất
    dt_kn = datetime.strptime(parsed['ngay_kn'], "%d/%m/%Y")
    date_formatted = dt_kn.strftime("%d-%m-%Y")
    out_filename = f"Nhap_lieu_ban_dau_CSR10_{date_formatted}_{n_samples}mau.xlsx"

    # Tái tạo và kiểm tra
    lot_samples = []
    all_passed = True
    report_step_po = {}
    report_step_ml = {}
    report_rh_lots = []
    anomalies = []

    for lot in parsed['lots']:
        # Sinh mẫu
        samples = reconstruct_lot_samples(lot, n_samples)
        # Kiểm tra xác minh 100%
        passed, errors = verify_lot_samples(lot, samples, n_samples)
        if not passed:
            all_passed = False
            print(f"[LỖI] Lô {lot['lo_nm_full']}:")
            for err in errors:
                print(f"   - {err}")
        lot_samples.append(samples)

        # Thu thập thông tin báo cáo
        report_step_po[lot['lo_nm_full']] = samples['step_po']
        report_step_ml[lot['lo_nm_full']] = samples['step_ml']

        if lot['dat_hang'] == 'RHCSR10':
            # Tìm lý do xếp RHCSR10
            reasons = []
            if lot['ml_xmin'] < 73 or lot['ml_xmax'] > 93:
                reasons.append(f"ML ngoài 73-93 ({lot['ml_xmin']}-{lot['ml_xmax']})")
            if (lot['pri_xmax'] - lot['pri_xmin']) > Decimal('10.0'):
                reasons.append(f"Độ rộng PRI > 10 ({lot['pri_xmax'] - lot['pri_xmin']})")
            if (lot['po_xmax'] - lot['po_xmin']) > Decimal('8.0'):
                reasons.append(f"Độ rộng PO > 8 ({lot['po_xmax'] - lot['po_xmin']})")
            report_rh_lots.append((lot['lo_nm_full'], ", ".join(reasons) if reasons else "Khác"))

        # Kiểm tra bất thường tro/TC
        if lot['tro_3sd'] > Decimal('0.1'):
            anomalies.append(f"Lô {lot['lo_nm_full']} có 3sd Tro cao bất thường: {lot['tro_3sd']}")

    if not all_passed:
        raise RuntimeError("Xác minh thống kê thất bại! Không xuất file.")

    # Xuất ra Excel
    export_to_excel(template_name, out_filename, parsed, lot_samples, n_samples)
    print(f"-> ĐÃ XUẤT FILE THÀNH CÔNG: {out_filename}")

    # In báo cáo theo Mục 8
    print("\n----------------- BÁO CÁO TỔNG HỢP -----------------")
    print(f"1. Tổng số lô: {total_lots} lô")
    print(f"   - Dải mã lô: {parsed['lots'][0]['lo_nm_full']} -> {parsed['lots'][-1]['lo_nm_full']}")
    print(f"   - Ngày SX: {parsed['ngay_sx']} | Ngày KN: {parsed['ngay_kn']}")

    print("2. Phân loại máy đo:")
    po_05 = [k for k, v in report_step_po.items() if v == Decimal('0.5')]
    po_01 = [k for k, v in report_step_po.items() if v == Decimal('0.1')]
    ml_05 = [k for k, v in report_step_ml.items() if v == Decimal('0.5')]
    ml_01 = [k for k, v in report_step_ml.items() if v == Decimal('0.1')]
    print(f"   - P0 bước 0.5 ({len(po_05)} lô): {', '.join(po_05) if po_05 else 'Không có'}")
    print(f"   - P0 bước 0.1 ({len(po_01)} lô): {', '.join(po_01) if po_01 else 'Không có'}")
    print(f"   - ML bước 0.5 ({len(ml_05)} lô): {', '.join(ml_05) if ml_05 else 'Không có'}")
    print(f"   - ML bước 0.1 ({len(ml_01)} lô): {', '.join(ml_01) if ml_01 else 'Không có'}")

    print("3. Các lô xếp hạng RHCSR10:")
    if report_rh_lots:
        for lo, reason in report_rh_lots:
            print(f"   - {lo}: Lý do {reason}")
    else:
        print("   - Không có lô nào bị xếp RHCSR10 (toàn bộ đạt chuẩn CSR10).")

    print("4. Bất thường nghi ngờ trên biểu gốc:")
    if anomalies:
        for ano in anomalies:
            print(f"   - {ano}")
    else:
        print("   - Không phát hiện bất thường lớn trên biểu gốc.")
    print("----------------------------------------------------\n")

    return out_filename


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Chuyển đổi biểu KQKN sang file Excel nhập liệu.")
    parser.add_argument("pdf", nargs="?", default="KQKN NGAY 03-10-2026.pdf", help="Đường dẫn file PDF")
    parser.add_argument("--samples", "-n", type=int, default=6, choices=[6, 10], help="Số mẫu (6 hoặc 10)")
    args = parser.parse_args()

    process_kqkn_file(args.pdf, args.samples)

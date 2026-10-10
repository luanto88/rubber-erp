#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Bộ công cụ bóc tách biểu kết quả kiểm nghiệm (KQKN) PDF và tái tạo mẫu chi tiết
phục vụ hệ thống Rubber ERP.
Hỗ trợ:
- Tự động nhận diện Chủng loại (Hạng ĐK) của từng lô từ biểu PDF
- Hỗ trợ số mẫu linh hoạt: 6 mẫu (thường), 10 mẫu (tùy chọn), 14 mẫu (ngặt)
- Hỗ trợ tiêu chuẩn TCCS 112:2022 và TCVN 3769:2016
- Xác minh thống kê khớp 100% bằng Decimal (ROUND_HALF_UP)
"""

import os
import sys
import re
import json
import math
import random
import base64
import io
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP

# Đảm bảo UTF-8 cho Windows console
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({'success': False, 'error': 'Chưa cài đặt PyMuPDF (pymupdf)'}, ensure_ascii=False))
    sys.exit(1)


def round_half_up_dec(d_val: Decimal, decimals: int) -> Decimal:
    pattern = Decimal('1.' + '0' * decimals if decimals > 0 else '1')
    return d_val.quantize(pattern, rounding=ROUND_HALF_UP)


def to_excel_date_serial(d: date) -> int:
    excel_epoch = date(1899, 12, 30)
    return (d - excel_epoch).days


def parse_decimal_vn(s: str, decimals: int) -> Decimal:
    if not s or not str(s).strip():
        return Decimal('0')
    cleaned = str(s).strip().replace(',', '.')
    d = Decimal(cleaned)
    pattern = Decimal('1.' + '0' * decimals if decimals > 0 else '1')
    return d.quantize(pattern)


def col_idx_to_letter(col_idx: int) -> str:
    result = ""
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result = chr(65 + remainder) + result
    return result


def extract_hang_dk_info(hang_raw: str):
    """
    Chuẩn hóa Hạng ĐK từ cột biểu PDF:
    CSR10 -> chung_loai="10", loai_csr="CSR10"
    CSR20 -> chung_loai="20", loai_csr="CSR20"
    CSRL  -> chung_loai="L",  loai_csr="CSRL"
    CSR3L -> chung_loai="3L", loai_csr="CSR3L"
    CSR5  -> chung_loai="5",  loai_csr="CSR5"
    CSRCV50 -> chung_loai="CV50", loai_csr="CSRCV50"
    CSRCV60 -> chung_loai="CV60", loai_csr="CSRCV60"
    """
    h = str(hang_raw or "").strip().upper()
    if not h:
        return "10", "CSR10"

    # Chuyển SVR thành CSR nếu có
    if h.startswith("SVR"):
        h = "CSR" + h[3:]

    cl = h.replace("CSR", "")
    if not cl:
        cl = "10"
    loai_csr = "CSR" + cl
    return cl, loai_csr


def parse_kqkn_pdf_stream(pdf_bytes, filename_hint: str = ""):
    """
    Trích xuất toàn bộ bảng số liệu từ file PDF biểu KQKN.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    txt = page.get_text('text')

    # Trích xuất ngày sản xuất
    m_sx = re.search(r'NGÀY SẢN XUẤT:\s*(\d{2}/\d{2}/\d{4})', txt)
    ngay_sx_str = m_sx.group(1) if m_sx else None

    # Trích xuất ngày kiểm nghiệm (từ phần ký hoặc tên file)
    m_kn = re.search(r'ngày\s*(\d{2})\s*tháng\s*(\d{2})\s*năm\s*(\d{4})', txt)
    if m_kn:
        ngay_kn_str = f"{m_kn.group(1)}/{m_kn.group(2)}/{m_kn.group(3)}"
    else:
        m_file = re.search(r'(\d{2})[-/](\d{2})[-/](\d{4})', filename_hint)
        if m_file:
            ngay_kn_str = f"{m_file.group(1)}/{m_file.group(2)}/{m_file.group(3)}"
        else:
            ngay_kn_str = datetime.now().strftime("%d/%m/%Y")

    tabs = page.find_tables()
    if not tabs.tables:
        doc.close()
        raise ValueError("Không tìm thấy bảng số liệu trong file PDF biểu KQKN")

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

        hang_dk = str(r[2]).strip() if len(r) > 2 and r[2] else "CSR10"
        cl, loai_csr = extract_hang_dk_info(hang_dk)

        dat_hang = str(r[25]).strip() if len(r) > 25 and r[25] else hang_dk

        lot_entry = {
            'pkn': int(pkn),
            'lo_nm': lo_nm_raw,
            'lo_nm_full': lo_nm_full,
            'hang_dk': hang_dk,
            'chung_loai': cl,
            'loai_csr': loai_csr,
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
            'ml_xmin': parse_decimal_vn(r[22], 1) if len(r) > 22 else Decimal('0'),
            'ml_x': parse_decimal_vn(r[23], 1) if len(r) > 23 else Decimal('0'),
            'ml_xmax': parse_decimal_vn(r[24], 1) if len(r) > 24 else Decimal('0'),
        }
        lots.append(lot_entry)

    doc.close()
    return {
        'ngay_sx': ngay_sx_str,
        'ngay_kn': ngay_kn_str,
        'lots': lots,
        'filename': filename_hint
    }


def solve_tc_tro(target_mean: Decimal, target_3sd: Decimal, n: int, max_iter=60000):
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

    # Dự phòng thuật toán tinh chỉnh sai số
    raise RuntimeError(f"Không tìm được nghiệm cho TC/TRO (X={target_mean}, 3sd={target_3sd}, n={n})")


def solve_bh_ni(target_mean: Decimal, target_xmax: Decimal, n: int):
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

    # Thử độ rộng <= 0.03
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

    # Tìm ngẫu nhiên cho trường hợp n lớn hơn (ví dụ n=14)
    target_sum = int(target_mean * n * mult)
    for _ in range(30000):
        mid = [random.randint(i_max - 5, i_max) for _ in range(n - 1)]
        vals = mid + [i_max]
        if sum(vals) == target_sum:
            avg_d = (Decimal(sum(vals)) / Decimal(n * mult)).quantize(pattern2, rounding=ROUND_HALF_UP)
            if avg_d == target_mean:
                vals.sort()
                return [(Decimal(v) / Decimal(mult)).quantize(pattern2) for v in vals]

    raise RuntimeError(f"Không tìm được nghiệm cho BH/NI (X={target_mean}, Xmax={target_xmax}, n={n})")


def determine_machine_step(xmin: Decimal, xmax: Decimal) -> Decimal:
    def is_half(val: Decimal) -> bool:
        return (val * 2) % 1 == 0

    if is_half(xmin) and is_half(xmax):
        return Decimal('0.5')
    return Decimal('0.1')


def solve_min_mean_max(xmin: Decimal, target_mean: Decimal, xmax: Decimal, n: int, step: Decimal, max_iter=45000):
    pattern1 = Decimal('0.1')
    mult = int(Decimal('1') / step)
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


def reconstruct_lot_samples(lot: dict, n: int):
    tc_samples = solve_tc_tro(lot['tc_x'], lot['tc_3sd'], n)
    tro_samples = solve_tc_tro(lot['tro_x'], lot['tro_3sd'], n)
    bh_samples = solve_bh_ni(lot['bh_x'], lot['bh_xmax'], n)
    ni_samples = solve_bh_ni(lot['ni_x'], lot['ni_xmax'], n)

    step_po = determine_machine_step(lot['po_xmin'], lot['po_xmax'])
    po_samples = solve_min_mean_max(lot['po_xmin'], lot['po_x'], lot['po_xmax'], n, step_po)

    pri_samples = solve_min_mean_max(lot['pri_xmin'], lot['pri_x'], lot['pri_xmax'], n, Decimal('0.1'))

    # Mooney ML (chỉ tái tạo nếu có số liệu ML)
    if lot['ml_x'] > 0:
        step_ml = determine_machine_step(lot['ml_xmin'], lot['ml_xmax'])
        ml_samples = solve_min_mean_max(lot['ml_xmin'], lot['ml_x'], lot['ml_xmax'], n, step_ml)
    else:
        step_ml = Decimal('0.5')
        ml_samples = [Decimal('0')] * n

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
    if lot['ml_x'] > 0:
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

    return len(errors) == 0, errors


def generate_excel_bytes(parsed_data: dict, lot_samples: list, n: int, tieu_chuan: str = "TCCS 112:2022"):
    """
    Tạo file Excel (.xlsx) chuẩn không phụ thuộc template ngoài, hỗ trợ 6, 10, 14 mẫu.
    Sử dụng zipfile và XML SpreadsheetML chuẩn.
    """
    dt_kn = datetime.strptime(parsed_data['ngay_kn'], "%d/%m/%Y").date()
    dt_sx = datetime.strptime(parsed_data['ngay_sx'], "%d/%m/%Y").date() if parsed_data['ngay_sx'] else dt_kn

    serial_kn = to_excel_date_serial(dt_kn)
    serial_sx = to_excel_date_serial(dt_sx)
    loai_kn_str = "ngat" if n >= 14 else "thuong"

    # Xây dựng danh sách cột Header dòng 3
    # LO_NM, TC_M1..Mn, TRO_M1..Mn, BH_M1..Mn, NI_M1..Mn, PO_M1..Mn, PRI_M1..Mn, ML_M1..Mn, MAU_M1..Mn
    headers = ["LO_NM"]
    for prefix in ["TC", "TRO", "BH", "NI", "PO", "PRI", "ML", "MAU"]:
        for m in range(1, n + 1):
            headers.append(f"{prefix}_M{m}")

    total_cols = len(headers)
    max_col_letter = col_idx_to_letter(total_cols)
    max_row = 3 + len(parsed_data['lots'])

    # Tạo sheet1.xml
    root = ET.Element('worksheet', {
        'xmlns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    })
    ET.SubElement(root, 'dimension', {'ref': f'A1:{max_col_letter}{max_row}'})
    sheet_views = ET.SubElement(root, 'sheetViews')
    ET.SubElement(sheet_views, 'sheetView', {'tabSelected': '1', 'workbookViewId': '0'})
    sheet_data = ET.SubElement(root, 'sheetData')

    # Row 1: Header metadata
    r1 = ET.SubElement(sheet_data, 'row', {'r': '1'})
    r1_cols = ["NGAY_KN", "NGAY_SX", "CHUNG_LOAI", "LOAI_KN", "TIEU_CHUAN", "SO_MAU"]
    for c_idx, val in enumerate(r1_cols, 1):
        c = ET.SubElement(r1, 'c', {'r': f'{col_idx_to_letter(c_idx)}1', 't': 'inlineStr'})
        is_el = ET.SubElement(c, 'is')
        t_el = ET.SubElement(is_el, 't')
        t_el.text = val

    # Row 2: Giá trị metadata
    r2 = ET.SubElement(sheet_data, 'row', {'r': '2'})
    c_kn = ET.SubElement(r2, 'c', {'r': 'A2', 's': '1'})
    v_kn = ET.SubElement(c_kn, 'v')
    v_kn.text = str(serial_kn)

    c_sx = ET.SubElement(r2, 'c', {'r': 'B2', 's': '1'})
    v_sx = ET.SubElement(c_sx, 'v')
    v_sx.text = str(serial_sx)

    first_cl = parsed_data['lots'][0]['chung_loai'] if parsed_data['lots'] else "10"
    c_cl = ET.SubElement(r2, 'c', {'r': 'C2', 't': 'inlineStr'})
    is_cl = ET.SubElement(c_cl, 'is')
    t_cl = ET.SubElement(is_cl, 't')
    t_cl.text = str(first_cl)

    c_lkn = ET.SubElement(r2, 'c', {'r': 'D2', 't': 'inlineStr'})
    is_lkn = ET.SubElement(c_lkn, 'is')
    t_lkn = ET.SubElement(is_lkn, 't')
    t_lkn.text = loai_kn_str

    c_tc = ET.SubElement(r2, 'c', {'r': 'E2', 't': 'inlineStr'})
    is_tc = ET.SubElement(c_tc, 'is')
    t_tc = ET.SubElement(is_tc, 't')
    t_tc.text = str(tieu_chuan)

    c_n = ET.SubElement(r2, 'c', {'r': 'F2'})
    v_n = ET.SubElement(c_n, 'v')
    v_n.text = str(n)

    # Row 3: Tiêu đề cột
    r3 = ET.SubElement(sheet_data, 'row', {'r': '3'})
    for c_idx, h_text in enumerate(headers, 1):
        c = ET.SubElement(r3, 'c', {'r': f'{col_idx_to_letter(c_idx)}3', 't': 'inlineStr'})
        is_el = ET.SubElement(c, 'is')
        t_el = ET.SubElement(is_el, 't')
        t_el.text = h_text

    # Data Rows (từ Row 4)
    for idx, (lot, s) in enumerate(zip(parsed_data['lots'], lot_samples)):
        row_num = 4 + idx
        r_el = ET.SubElement(sheet_data, 'row', {'r': str(row_num)})

        col_counter = 1
        # Cột LO_NM
        c_lo = ET.SubElement(r_el, 'c', {'r': f'{col_idx_to_letter(col_counter)}{row_num}', 't': 'inlineStr'})
        is_lo = ET.SubElement(c_lo, 'is')
        t_lo = ET.SubElement(is_lo, 't')
        t_lo.text = lot['lo_nm_full']
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

        for values, _ in groups:
            for val in values:
                col_letter = col_idx_to_letter(col_counter)
                c_val = ET.SubElement(r_el, 'c', {'r': f'{col_letter}{row_num}'})
                v_val = ET.SubElement(c_val, 'v')
                d_val = Decimal(str(val))
                s_val = f"{d_val:f}"
                v_val.text = s_val.rstrip('0').rstrip('.') if '.' in s_val else s_val
                col_counter += 1

        # Cột MAU
        for _ in range(n):
            col_counter += 1

    sheet1_xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)

    # Tối thiểu các file cấu trúc openxml
    content_types_xml = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''

    rels_xml = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

    workbook_xml = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>'''

    workbook_rels = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

    styles_xml = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="1">
    <font><name val="Calibri"/><sz val="11"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>'''

    out_buf = io.BytesIO()
    with zipfile.ZipFile(out_buf, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types_xml)
        z.writestr('_rels/.rels', rels_xml)
        z.writestr('xl/workbook.xml', workbook_xml)
        z.writestr('xl/_rels/workbook.xml.rels', workbook_rels)
        z.writestr('xl/styles.xml', styles_xml)
        z.writestr('xl/worksheets/sheet1.xml', sheet1_xml)

    return out_buf.getvalue()


def process_kqkn_data(pdf_bytes, n_samples: int = 6, tieu_chuan: str = "TCCS 112:2022", filename_hint: str = ""):
    parsed = parse_kqkn_pdf_stream(pdf_bytes, filename_hint)
    total_lots = len(parsed['lots'])
    if total_lots == 0:
        raise ValueError("Không tìm thấy dữ liệu lô trong file PDF")

    lot_samples = []
    lots_summary = []
    report_step_po = {}
    report_step_ml = {}
    report_rh_lots = []
    anomalies = []

    for lot in parsed['lots']:
        samples = reconstruct_lot_samples(lot, n_samples)
        passed, errors = verify_lot_samples(lot, samples, n_samples)
        if not passed:
            raise RuntimeError(f"Xác minh thất bại tại lô {lot['lo_nm_full']}: {', '.join(errors)}")

        lot_samples.append(samples)
        report_step_po[lot['lo_nm_full']] = str(samples['step_po'])
        report_step_ml[lot['lo_nm_full']] = str(samples['step_ml'])

        if lot['dat_hang'] == 'RHCSR10' or 'RH' in lot['dat_hang']:
            reasons = []
            if lot['ml_x'] > 0 and (lot['ml_xmin'] < 73 or lot['ml_xmax'] > 93):
                reasons.append(f"ML ngoài 73-93 ({lot['ml_xmin']}-{lot['ml_xmax']})")
            if (lot['pri_xmax'] - lot['pri_xmin']) > Decimal('10.0'):
                reasons.append(f"Độ rộng PRI > 10 ({lot['pri_xmax'] - lot['pri_xmin']})")
            if (lot['po_xmax'] - lot['po_xmin']) > Decimal('8.0'):
                reasons.append(f"Độ rộng PO > 8 ({lot['po_xmax'] - lot['po_xmin']})")
            report_rh_lots.append((lot['lo_nm_full'], ", ".join(reasons) if reasons else "Vượt chỉ tiêu"))

        if lot['tro_3sd'] > Decimal('0.1'):
            anomalies.append(f"Lô {lot['lo_nm_full']} có 3sd Tro cao bất thường: {lot['tro_3sd']}")

        lots_summary.append({
            'pkn': lot['pkn'],
            'lo_nm': lot['lo_nm'],
            'lo_nm_full': lot['lo_nm_full'],
            'hang_dk': lot['hang_dk'],
            'chung_loai': lot['chung_loai'],
            'loai_csr': lot['loai_csr'],
            'dat_hang': lot['dat_hang'],
            # Thống kê gốc
            'tc_x': float(lot['tc_x']),
            'tc_3sd': float(lot['tc_3sd']),
            'tro_x': float(lot['tro_x']),
            'tro_3sd': float(lot['tro_3sd']),
            'bh_x': float(lot['bh_x']),
            'bh_xmax': float(lot['bh_xmax']),
            'ni_x': float(lot['ni_x']),
            'ni_xmax': float(lot['ni_xmax']),
            'po_xmin': float(lot['po_xmin']),
            'po_x': float(lot['po_x']),
            'po_xmax': float(lot['po_xmax']),
            'po_step': str(samples['step_po']),
            'pri_xmin': float(lot['pri_xmin']),
            'pri_x': float(lot['pri_x']),
            'pri_xmax': float(lot['pri_xmax']),
            'ml_xmin': float(lot['ml_xmin']),
            'ml_x': float(lot['ml_x']),
            'ml_xmax': float(lot['ml_xmax']),
            'ml_step': str(samples['step_ml']),
            # Mẫu chi tiết
            'samples': {
                'tap_chat': [float(x) for x in samples['tc']],
                'tro': [float(x) for x in samples['tro']],
                'bay_hoi': [float(x) for x in samples['bh']],
                'nito': [float(x) for x in samples['ni']],
                'po': [float(x) for x in samples['po']],
                'pri': [float(x) for x in samples['pri']],
                'mooney': [float(x) for x in samples['ml']] if lot['ml_x'] > 0 else [],
                'mau_sac': []
            }
        })

    excel_bytes = generate_excel_bytes(parsed, lot_samples, n_samples, tieu_chuan)
    excel_b64 = base64.b64encode(excel_bytes).decode('utf-8')

    dt_kn = datetime.strptime(parsed['ngay_kn'], "%d/%m/%Y")
    date_formatted = dt_kn.strftime("%d-%m-%Y")
    out_filename = f"Nhap_lieu_ban_dau_{date_formatted}_{n_samples}mau.xlsx"

    po_05 = [k for k, v in report_step_po.items() if v == '0.5']
    po_01 = [k for k, v in report_step_po.items() if v == '0.1']
    ml_05 = [k for k, v in report_step_ml.items() if v == '0.5']
    ml_01 = [k for k, v in report_step_ml.items() if v == '0.1']

    return {
        'success': True,
        'filename': out_filename,
        'ngay_sx': parsed['ngay_sx'],
        'ngay_kn': parsed['ngay_kn'],
        'total_lots': total_lots,
        'lots': lots_summary,
        'excel_base64': excel_b64,
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


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Thiếu đối số đường dẫn file hoặc input'}, ensure_ascii=False))
        sys.exit(1)

    file_or_cmd = sys.argv[1]
    n_samples = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    tieu_chuan = str(sys.argv[3]) if len(sys.argv) > 3 else "TCCS 112:2022"

    try:
        if file_or_cmd == "--stdin-base64":
            raw_b64 = sys.stdin.read().strip()
            pdf_bytes = base64.b64decode(raw_b64)
            filename_hint = sys.argv[4] if len(sys.argv) > 4 else "KQKN.pdf"
        elif os.path.exists(file_or_cmd):
            with open(file_or_cmd, 'rb') as f:
                pdf_bytes = f.read()
            filename_hint = os.path.basename(file_or_cmd)
        else:
            raise FileNotFoundError(f"File không tồn tại: {file_or_cmd}")

        result = process_kqkn_data(pdf_bytes, n_samples=n_samples, tieu_chuan=tieu_chuan, filename_hint=filename_hint)
        payload = json.dumps(result, ensure_ascii=False)
        print(f"__KQKN_JSON_START__{payload}__KQKN_JSON_END__")
    except Exception as e:
        err_payload = json.dumps({'success': False, 'error': str(e)}, ensure_ascii=False)
        print(f"__KQKN_JSON_START__{err_payload}__KQKN_JSON_END__")
        sys.exit(1)


if __name__ == '__main__':
    main()

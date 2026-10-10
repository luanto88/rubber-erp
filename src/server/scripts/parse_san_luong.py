#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Bộ công cụ bóc tách báo cáo sản lượng trạm cân / phòng Quản lý chất lượng (PDF & Excel)
phục vụ phân hệ Hỗ trợ Kỹ thuật Sản lượng (Output Converter Engine) trong Rubber ERP.

Đầu ra JSON được bọc giữa 2 marker:
__OUTPUT_JSON_START__{...}__OUTPUT_JSON_END__
"""

import sys
import os
import re
import json
import base64
import io
import math
from datetime import datetime

# Đảm bảo UTF-8 cho Windows console
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None


def to_num(v):
    if v is None or v == "":
        return 0.0
    try:
        cleaned = str(v).replace(",", "").strip()
        n = float(cleaned)
        return round(n, 2)
    except Exception:
        return 0.0


def parse_vehicle_code(raw):
    s = str(raw or "").strip().upper()
    s = re.sub(r"^0+(\d)", r"\1", s)
    m = re.match(r"^(\d+[A-Z]+)(\d)$", s)
    if not m:
        return {"base_xe": s, "chuyen": 1, "chuyen_tu_ten": False}
    return {"base_xe": m.group(1), "chuyen": int(m.group(2)), "chuyen_tu_ten": True}


def parse_date_from_text(text):
    if not text:
        return None
    m = re.search(r"(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})", str(text))
    if not m:
        return None
    d, mth, y = m.group(1), m.group(2), m.group(3)
    return f"{y}-{mth.zfill(2)}-{d.zfill(2)}"


def parse_pdf_stream(pdf_bytes):
    if fitz is None:
        return {"success": False, "error": "Thư viện PyMuPDF (fitz) chưa được cài đặt trên hệ thống."}

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    results = []
    detected_date = None
    all_text = ""

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text("text")
        all_text += "\n" + text

        # Tìm ngày nếu chưa có
        if not detected_date:
            d = parse_date_from_text(text)
            if d:
                detected_date = d

        # Trích xuất bảng nếu có
        tabs = page.find_tables()
        if tabs and len(tabs.tables) > 0:
            for tab in tabs.tables:
                df_rows = tab.extract()
                current_doi = 1
                # Kiểm tra context trang để lấy Đội
                m_doi = re.search(r"ĐỘI\s*(\d+)", text, re.I)
                if m_doi:
                    current_doi = int(m_doi.group(1))

                for r in df_rows:
                    if not r or len(r) < 3:
                        continue
                    c0 = str(r[0] or "").strip()
                    c1 = str(r[1] or "").strip()
                    if c0.isdigit() and c1:
                        # Dòng dữ liệu xe
                        vh = parse_vehicle_code(c1)
                        # Tìm các số trong dòng
                        nums = [to_num(x) for x in r[2:] if to_num(x) > 0]
                        results.append({
                            "row_index": len(results) + 1,
                            "ngay": detected_date or "",
                            "doi": current_doi,
                            "raw_xe": c1,
                            "base_xe": vh["base_xe"],
                            "chuyen": vh["chuyen"],
                            "chuyen_tu_ten": vh["chuyen_tu_ten"],
                            "ghi_chu": "",
                            "mn_tuoi": 0.0, "mn_drc": 0.0, "mn_kho": 0.0,
                            "ct_tuoi": 0.0, "ct_drc": 0.0, "ct_kho": 0.0,
                            "dct_tuoi": nums[0] if len(nums) > 0 else 0.0,
                            "dct_drc": nums[1] if len(nums) > 1 else 0.0,
                            "dct_kho": nums[2] if len(nums) > 2 else 0.0,
                            "dkt_tuoi": 0.0, "dkt_drc": 0.0, "dkt_kho": 0.0,
                            "dt_tuoi": nums[3] if len(nums) > 3 else 0.0,
                            "dt_drc": nums[4] if len(nums) > 4 else 0.0,
                            "dt_kho": nums[5] if len(nums) > 5 else 0.0,
                            "tong_kho": nums[-1] if len(nums) > 0 else 0.0
                        })

    doc.close()
    return {
        "success": True,
        "format": "pdf",
        "detectedDate": detected_date,
        "results": results,
        "totalRows": len(results)
    }


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--stdin-base64":
        raw_b64 = sys.stdin.read().strip()
        file_bytes = base64.b64decode(raw_b64)
    elif len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        with open(sys.argv[1], "rb") as f:
            file_bytes = f.read()
    else:
        file_bytes = sys.stdin.buffer.read()

    # Nhận diện định dạng
    if file_bytes.startswith(b"%PDF"):
        res = parse_pdf_stream(file_bytes)
    else:
        # Nếu là file zip/xlsx, trả về thông báo để API route dùng parser Node.js siêu tốc
        res = {
            "success": True,
            "format": "xlsx",
            "message": "Excel workbook detected. Managed natively via high-speed engine."
        }

    # Bọc kết quả trong cặp marker cô lập chuẩn AGENTS.md
    json_out = json.dumps(res, ensure_ascii=False)
    print(f"__OUTPUT_JSON_START__{json_out}__OUTPUT_JSON_END__")


if __name__ == "__main__":
    main()

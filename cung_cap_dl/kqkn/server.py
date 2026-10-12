#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Máy chủ Web cục bộ phục vụ ứng dụng chuyển đổi biểu KQKN sang file Excel nhập liệu.
Sử dụng hoàn toàn thư viện chuẩn của Python (không cần cài thêm Flask hay FastAPI).
"""

import os
import sys
import json
import base64
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import webbrowser
import threading

# Đảm bảo UTF-8 cho Windows console
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from kqkn_converter import convert_kqkn_data, parse_kqkn_pdf

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class KQKNRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        # Thiết lập CORS headers để cho phép gọi API linh hoạt
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path in ('/', '/index.html'):
            self.serve_file('index.html', 'text/html; charset=utf-8')
        elif path.startswith('/lib/'):
            filename = os.path.basename(path)
            file_path = os.path.join(BASE_DIR, 'lib', filename)
            if os.path.exists(file_path):
                content_type = 'application/javascript' if filename.endswith('.js') else 'application/octet-stream'
                self.serve_file(file_path, content_type)
            else:
                self.send_error(404, "File not found")
        elif path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'message': 'KQKN Service is running'}).encode('utf-8'))
        else:
            # Cho phép tải các file mẫu hoặc file tĩnh trong thư mục
            safe_filename = os.path.basename(path)
            candidate_path = os.path.join(BASE_DIR, safe_filename)
            if os.path.exists(candidate_path) and os.path.isfile(candidate_path):
                ext = os.path.splitext(candidate_path)[1].lower()
                ctype = 'text/plain'
                if ext == '.html': ctype = 'text/html; charset=utf-8'
                elif ext == '.css': ctype = 'text/css; charset=utf-8'
                elif ext == '.js': ctype = 'application/javascript'
                elif ext == '.xlsx': ctype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                elif ext == '.pdf': ctype = 'application/pdf'
                self.serve_file(candidate_path, ctype)
            else:
                self.send_error(404, "Not Found")

    def do_POST(self):
        if self.path == '/api/convert':
            self.handle_convert()
        elif self.path == '/api/preview':
            self.handle_preview()
        else:
            self.send_error(404, "Endpoint not found")

    def serve_file(self, file_path, content_type):
        full_path = file_path if os.path.isabs(file_path) else os.path.join(BASE_DIR, file_path)
        if not os.path.exists(full_path):
            self.send_error(404, f"File {file_path} không tồn tại")
            return
        try:
            with open(full_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Lỗi đọc file: {str(e)}")

    def handle_preview(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            pdf_b64 = data.get('pdf_base64', '')
            original_filename = data.get('filename', '')
            pdf_bytes = base64.b64decode(pdf_b64)

            parsed = parse_kqkn_pdf(pdf_bytes, original_filename)
            lots_meta = [{
                'pkn': l['pkn'],
                'lo_nm': l['lo_nm'],
                'lo_nm_full': l['lo_nm_full'],
                'hang_dk': l['hang_dk'],
                'dat_hang': l['dat_hang'],
                'tc_x': str(l['tc_x']),
                'tro_x': str(l['tro_x']),
                'po_x': str(l['po_x']),
                'pri_x': str(l['pri_x']),
                'ml_x': str(l['ml_x']),
            } for l in parsed['lots']]

            res = {
                'success': True,
                'ngay_sx': parsed['ngay_sx'],
                'ngay_kn': parsed['ngay_kn'],
                'total_lots': len(parsed['lots']),
                'lots': lots_meta
            }
            self.send_json_response(200, res)
        except Exception as e:
            self.send_json_response(400, {'success': False, 'error': str(e)})

    def handle_convert(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            pdf_b64 = data.get('pdf_base64', '')
            original_filename = data.get('filename', 'KQKN.pdf')
            n_samples = int(data.get('n_samples', 6))
            tieu_chuan = str(data.get('tieu_chuan', 'TCCS 112:2022'))
            chung_loai = str(data.get('chung_loai', '10'))
            loai_kn = str(data.get('loai_kn', 'thuong'))

            if not pdf_b64:
                raise ValueError("Chưa cung cấp dữ liệu PDF")

            pdf_bytes = base64.b64decode(pdf_b64)

            # Thực thi chuyển đổi & kiểm tra thống kê 100%
            result = convert_kqkn_data(
                pdf_input=pdf_bytes,
                n_samples=n_samples,
                tieu_chuan=tieu_chuan,
                chung_loai=chung_loai,
                loai_kn=loai_kn,
                original_filename=original_filename
            )

            # Mã hóa file Excel kết quả sang Base64
            excel_b64 = base64.b64encode(result['excel_bytes']).decode('utf-8')

            resp = {
                'success': True,
                'filename': result['filename'],
                'excel_base64': excel_b64,
                'parsed': result['parsed'],
                'lots': result['lots'],
                'report': result['report']
            }
            self.send_json_response(200, resp)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json_response(500, {'success': False, 'error': str(e)})

    def send_json_response(self, code, obj):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        # Rút gọn log console cho gọn gàng
        sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} {args[1]} -> {args[2]}\n")


def run_server(port=PORT):
    server_address = ('', port)
    httpd = HTTPServer(server_address, KQKNRequestHandler)
    print("=" * 60)
    print(f" HỆ THỐNG CHUYỂN ĐỔI KQKN CAO SU CSR ĐANG CHẠY")
    print(f" -> Truy cập giao diện: http://localhost:{port}")
    print("=" * 60)
    print("Nhấn Ctrl + C để dừng máy chủ.\n")
    httpd.serve_forever()


if __name__ == '__main__':
    run_server(PORT)

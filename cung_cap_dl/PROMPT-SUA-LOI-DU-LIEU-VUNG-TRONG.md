# PROMPT — SỬA TẬN GỐC DỮ LIỆU VÙNG TRỒNG CHO EUDR

> Chép toàn bộ nội dung dưới đây vào session mới (Claude Code hoặc chat
> thường), đính kèm file GeoJSON hiện tại của dự án.

---

## BỐI CẢNH

Tôi quản lý dữ liệu vùng trồng cao su tại Kampong Thom, Campuchia, phục
vụ khai báo EUDR (Quy định EU 2023/1115). Hệ thống của tôi tự sinh file
GeoJSON mỗi khi tạo đơn hàng xuất.

Khách hàng (Hàn Quốc) tải file lên hệ thống của họ và liên tục báo lỗi.
Mỗi lần tôi phải sửa file thủ công trước khi gửi. Tôi muốn sửa dứt điểm
ở nguồn.

**Các lỗi khách hàng đã báo, theo thứ tự xuất hiện:**

1. `Geojson file has not properties. 'producerCountry' is required.`
2. `[EUDR-GEO-ERROR] 생산지 346: 구멍이 있는 다각형은 허용되지 않습니다.`
   (Vùng sản xuất thứ 346: không cho phép đa giác có lỗ)
3. `[EUDR-GEO-ERROR] 생산지 362: Ring Self-intersection`
   (Vùng sản xuất thứ 362: vòng ranh giới tự cắt)

Số trong thông báo là **thứ tự feature trong file**, không phải mã lô.

---

## PHẦN A — SỬA HÌNH HỌC TRONG PHẦN MỀM BẢN ĐỒ

### A.1. Ba lô có ranh giới tự cắt

Mở từng lô, phóng to đến tọa độ nêu dưới, tìm chỗ đường ranh giới cắt
qua chính nó, xóa hoặc kéo lại đỉnh gây lỗi.

| Mã lô | Tọa độ điểm tự cắt |
|---|---|
| `5.14PH.03.14.400` | 105.506955, 12.607731 |
| `5.14PH.03.10.085` | 105.497432, 12.597656 |
| `5.14PH.01.09.020` | 105.488740, 12.604568 |

Sau khi sửa, diện tích thay đổi không đáng kể (dưới 0,01 ha).

### A.2. Hai lô có vòng trong (lỗ)

Xóa vòng bên trong, chỉ giữ ranh giới ngoài.

| Mã lô | Diện tích vòng trong |
|---|---|
| `5.14PH.01.09.023` | 0,904 ha |
| `5.14PH.01.10.078` | 1,206 ha |

Lưu ý: nếu phần rỗng là ao hoặc khu vực không trồng thật, việc xóa sẽ
làm diện tích tăng lên. Hệ thống EU dù sao cũng bỏ qua vòng trong nên
xóa là phù hợp, nhưng cần ghi nhận thay đổi này vào hồ sơ.

### A.3. Kiểm tra bằng QGIS

- `Vector > Geometry Tools > Check Validity` để xác nhận đã sạch
- `Fix Geometries` nếu muốn xử lý hàng loạt

---

## PHẦN B — SỬA BẢN GHI LỖI TRONG CƠ SỞ DỮ LIỆU

Bản ghi `ID = 393`, hiện đang sai ở bốn chỗ:

| Trường | Giá trị hiện tại | Ghi chú |
|---|---|---|
| `Ma_lo_2026` | `V5T` | Đây là tên lô, không phải mã lô. Trường `Ma_lo` ghi `5.14PK.N3.12.393` |
| `Dtich2026_ha` | `0` | Hình học thực tế khoảng 27,29 ha |
| `Nong_truong` | trống | Cần điền |
| `Dtich_ko_tai_canh` | `578.48` | Bất thường, các lô khác đều là 0 |

---

## PHẦN C — RÀ SOÁT DIỆN TÍCH

35 lô có diện tích tính từ hình học lệch trên 10% so với `Dtich2026_ha`.
Đây là rủi ro khi khách hoặc cơ quan chức năng đối chiếu hai con số.

Mười lô lệch nặng nhất:

| Mã lô | NT | Khai báo (ha) | Hình học (ha) | Chênh |
|---|---|---|---|---|
| `5.14PH.04.12.304` | NT 1 | 14,89 | 4,35 | −10,54 |
| `5.14PH.05.11.229` | NT 2 | 17,26 | 7,30 | −9,96 |
| `5.14PH.01.09.023` | NT 1 | 21,30 | 12,45 | −8,85 |
| `5.14PH.06.10.102` | NT 2 | 21,41 | 13,27 | −8,14 |
| `5.14PH.03.11.124` | NT 1 | 21,64 | 14,01 | −7,63 |
| `5.14PH.04.12.257` | NT 1 | 17,81 | 11,71 | −6,10 |
| `5.14PH.01.10.116` | NT 1 | 6,72 | 12,50 | +5,78 |
| `5.14PH.07.11.195` | NT 2 | 13,89 | 8,51 | −5,38 |
| `5.14PH.01.09.017` | NT 1 | 19,50 | 14,24 | −5,26 |
| `5.14PH.03.10.066` | NT 1 | 13,81 | 8,94 | −4,87 |

Yêu cầu: viết script liệt kê đầy đủ 35 lô ra file Excel để tôi giao bộ
phận bản đồ đi rà thực địa.

---

## PHẦN D — SỬA LOGIC XUẤT FILE GEOJSON CỦA ỨNG DỤNG

### D.1. Bổ sung trường bắt buộc

Mỗi feature phải có trong `properties`:

```json
"ProducerName": "PHUOC HOA KAMPONG THOM PROCESSING FACTORY",
"ProducerCountry": "KH",
"ProductionPlace": "<Ma_lo_2026>",
"Area": <Dtich2026_ha>,
"external_id": "<Ma_lo_2026>"
```

Ghi chú: hệ thống khách hàng báo lỗi với tên `producerCountry` viết
thường chữ đầu, trong khi chuẩn EU dùng `ProducerCountry` viết hoa. Để
an toàn, xuất **cả hai cách viết** — thuộc tính thừa sẽ bị bỏ qua.

**Chỉ THÊM trường mới.** Giữ nguyên toàn bộ các trường nội bộ hiện có
(`Ma_lo_2026`, `Nong_truong`, `Giong`, `Nam_trong`...) để không phá vỡ
hệ thống truy xuất nguồn gốc.

### D.2. Quy tắc hình học

- Mỗi feature chỉ được có **một vòng duy nhất** (ranh giới ngoài). Nếu
  hình học có vòng trong, loại bỏ khi xuất file EUDR.
- Không xuất feature có diện tích bằng 0 hoặc dưới 0,01 ha.

### D.3. Thứ tự feature cố định

Sắp xếp theo `Ma_lo_2026` tăng dần. Thứ tự phải tái lập được giữa các
lần xuất, vì công cụ phân tích Whisp gán `plotId` theo thứ tự này.

Xuất kèm file CSV đối chiếu: số thứ tự, mã lô, nông trường, đội, diện
tích, năm trồng.

### D.4. Cổng kiểm tra trước khi xuất

Trước khi trả file về, kiểm tra từng đa giác. Nếu có lỗi, **hiện cảnh
báo kèm mã lô và không xuất file**:

- Vòng khép kín (điểm đầu trùng điểm cuối)
- Không tự cắt
- Không có vòng trong
- Diện tích lớn hơn 0
- Tọa độ WGS84, kinh độ trước, trong khoảng 102–110 E và 8–24 N
- Độ chính xác 6 số thập phân
- Mã lô không rỗng, không trùng lặp trong cùng file

Cảnh báo riêng (không chặn xuất) khi diện tích hình học lệch trên 10%
so với `Dtich2026_ha`.

Thư viện gợi ý: **Shapely** (Python) hoặc **Turf.js** (JavaScript).

### D.5. Thông tin phiên bản

Thêm trường `export_date` vào mỗi feature hoặc vào cấp
FeatureCollection, để về sau đối chiếu kết quả phân tích với đúng phiên
bản dữ liệu.

---

## PHẦN E — VIỆC CẦN LÀM TRONG SESSION NÀY

1. Đọc file GeoJSON tôi đính kèm, xác nhận lại 5 lỗi hình học và bản
   ghi ID 393 có còn hay không
2. Xuất danh sách đầy đủ 35 lô lệch diện tích ra file Excel
3. Viết script kiểm tra hình học (Phần D.4) để tôi tích hợp vào ứng dụng
4. Viết đoạn mã bổ sung trường TRACES (Phần D.1) phù hợp với công nghệ
   ứng dụng của tôi — tôi sẽ cho biết đang dùng gì

Nếu cần thêm thông tin gì, hỏi tôi trước khi bắt đầu.


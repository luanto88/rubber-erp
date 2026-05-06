import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const baseDir = path.join(process.cwd(), "cung_cap_dl", "kho_bao_tri");
const warehouseFile = path.join(baseDir, "ds_kho.xlsx");
const itemsFile = path.join(baseDir, "danh_muc_vat_tu.xlsx");
const movementsFile = path.join(baseDir, "nhap_xuat_ton.xlsx");

const outputItemsFile = path.join(baseDir, "danh_muc_vat_tu.cleaned.xlsx");
const outputMovementsFile = path.join(baseDir, "nhap_xuat_ton.cleaned.xlsx");
const outputReportFile = path.join(baseDir, "warehouse_cleaning_report.json");

function readSheetRows(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  return {
    workbook,
    sheetName: name,
    rows: XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }),
  };
}

function writeRowsToWorkbook(sourceWorkbook, sheetName, rows, outputPath) {
  const nextWorkbook = XLSX.utils.book_new();
  for (const name of sourceWorkbook.SheetNames) {
    if (name === sheetName) {
      const cleanedSheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(nextWorkbook, cleanedSheet, name);
      continue;
    }

    XLSX.utils.book_append_sheet(nextWorkbook, sourceWorkbook.Sheets[name], name);
  }

  XLSX.writeFile(nextWorkbook, outputPath);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s+/g, ", ")
    .trim();
}

function buildWarehouseMaps(warehouseRows) {
  const byName = new Map();
  const byCode = new Map();

  for (const row of warehouseRows) {
    const code = normalizeText(row.ma_kho);
    const name = normalizeText(row.ten_kho);
    if (!code || !name) continue;
    byName.set(name.toLowerCase(), { code, name });
    byCode.set(code.toLowerCase(), { code, name });
  }

  return { byName, byCode };
}

function normalizeWarehouseList(rawValue, warehouseNames) {
  const text = normalizeText(rawValue);
  if (!text) return [];

  const lowerText = text.toLowerCase();
  if (
    lowerText.includes("bao ho lao dong") ||
    lowerText.includes("bảo hộ lao động") ||
    lowerText.includes("ảo hộ lao động") ||
    lowerText.includes("lao động")
  ) {
    return ["Kho bảo hộ lao động"];
  }

  const directParts = text
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const resolved = [];
  for (const part of directParts) {
    const lowerPart = part.toLowerCase();
    const exact = warehouseNames.find((name) => name.toLowerCase() === lowerPart);
    if (exact) {
      resolved.push(exact);
      continue;
    }

    const included = warehouseNames.filter((name) => lowerPart.includes(name.toLowerCase()));
    if (included.length > 0) {
      resolved.push(...included);
      continue;
    }

    if (
      lowerPart.includes("bao ho lao dong") ||
      lowerPart.includes("bảo hộ lao động") ||
      lowerPart.includes("ảo hộ lao động") ||
      lowerPart.includes("lao động")
    ) {
      resolved.push("Kho bảo hộ lao động");
    }
  }

  if (resolved.length > 0) {
    return unique(resolved);
  }

  const fallbackMatches = warehouseNames.filter((name) => text.toLowerCase().includes(name.toLowerCase()));
  return unique(fallbackMatches);
}

function normalizeMovementWarehouse(rawValue, warehouseByName) {
  const text = normalizeText(rawValue);
  if (!text) {
    return {
      warehouse_code: "",
      warehouse_name: "",
      source_value: text,
      normalized: false,
    };
  }

  const manualMap = new Map([
    ["kho a", "Kho vật tư"],
    ["ka", "Kho vật tư"],
    ["kho b", "Kho hóa chất"],
    ["kb", "Kho hóa chất"],
  ]);

  const lowerText = text.toLowerCase();
  const mappedName = manualMap.get(lowerText) || warehouseByName.get(lowerText)?.name || text;
  const warehouse = warehouseByName.get(mappedName.toLowerCase());

  return {
    warehouse_code: warehouse?.code || "",
    warehouse_name: warehouse?.name || mappedName,
    source_value: text,
    normalized: text !== (warehouse?.name || mappedName),
  };
}

const { workbook: warehouseWorkbook, rows: warehouseRows } = readSheetRows(warehouseFile);
const { workbook: itemsWorkbook, sheetName: itemsSheetName, rows: itemRows } = readSheetRows(itemsFile);
const { workbook: movementWorkbook, sheetName: movementSheetName, rows: movementRows } = readSheetRows(
  movementsFile,
  "nhap_xuat_ton",
);

const { byName: warehouseByName } = buildWarehouseMaps(warehouseRows);
const warehouseNames = warehouseRows
  .map((row) => normalizeText(row.ten_kho))
  .filter(Boolean);

const itemChanges = [];
const cleanedItemRows = itemRows.map((row) => {
  const normalizedWarehouses = normalizeWarehouseList(row.kho_chua, warehouseNames);
  const nextKhoChua = normalizedWarehouses.join(", ");
  if (normalizeText(row.kho_chua) !== nextKhoChua) {
    itemChanges.push({
      ma_vat_tu: row.ma_vat_tu,
      ten_vat_tu: row.ten_vat_tu,
      kho_chua_cu: row.kho_chua,
      kho_chua_moi: nextKhoChua,
    });
  }

  return {
    ...row,
    kho_chua: nextKhoChua,
    kho_chua_codes: normalizedWarehouses
      .map((name) => warehouseByName.get(name.toLowerCase())?.code || "")
      .filter(Boolean)
      .join(", "),
  };
});

const movementChanges = [];
const cleanedMovementRows = movementRows.map((row) => {
  const normalizedWarehouse = normalizeMovementWarehouse(row.kho, warehouseByName);
  if (
    normalizedWarehouse.normalized ||
    normalizeText(row.kho_ma || "") !== normalizedWarehouse.warehouse_code
  ) {
    movementChanges.push({
      ma_nx: row.ma_nx,
      ma_vt: row.ma_vt,
      kho_cu: row.kho,
      kho_moi: normalizedWarehouse.warehouse_name,
      kho_ma: normalizedWarehouse.warehouse_code,
    });
  }

  return {
    ...row,
    kho: normalizedWarehouse.warehouse_name,
    kho_ma: normalizedWarehouse.warehouse_code,
  };
});

writeRowsToWorkbook(itemsWorkbook, itemsSheetName, cleanedItemRows, outputItemsFile);
writeRowsToWorkbook(movementWorkbook, movementSheetName, cleanedMovementRows, outputMovementsFile);

const report = {
  generated_at: new Date().toISOString(),
  assumptions: {
    KA: "Kho vật tư",
    KB: "Kho hóa chất",
    hsd_and_lot_priority: "Đa số áp dụng cho hóa chất",
  },
  warehouses: warehouseRows.map((row) => ({
    ma_kho: row.ma_kho,
    ten_kho: row.ten_kho,
    thu_kho: row.thu_kho,
  })),
  item_cleanup: {
    total_rows: cleanedItemRows.length,
    changed_rows: itemChanges.length,
    unique_kho_chua_after: unique(cleanedItemRows.map((row) => row.kho_chua).filter(Boolean)).sort(),
    changes: itemChanges,
  },
  movement_cleanup: {
    total_rows: cleanedMovementRows.length,
    changed_rows: movementChanges.length,
    unique_kho_after: unique(cleanedMovementRows.map((row) => row.kho).filter(Boolean)).sort(),
    changes: movementChanges,
  },
};

fs.writeFileSync(outputReportFile, JSON.stringify(report, null, 2), "utf8");

console.log(`Created: ${path.relative(process.cwd(), outputItemsFile)}`);
console.log(`Created: ${path.relative(process.cwd(), outputMovementsFile)}`);
console.log(`Created: ${path.relative(process.cwd(), outputReportFile)}`);
console.log(`Item rows changed: ${itemChanges.length}/${cleanedItemRows.length}`);
console.log(`Movement rows changed: ${movementChanges.length}/${cleanedMovementRows.length}`);

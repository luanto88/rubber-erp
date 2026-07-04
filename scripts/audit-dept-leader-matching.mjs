import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Đối chiếu logic thực tế của src/app/api/documents/dept-leader/route.ts với dữ liệu
// thật trong DB, để biết mỗi (nhà máy, phòng ban) hiện trả về 0/1/nhiều "lãnh đạo",
// và liệu chuc_vu/chuc_vu_chinh_quyen thật có khớp LEADER_KEYWORDS hay không.
// Read-only — chỉ SELECT, không ghi gì vào DB.

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

function parseArgs(argv) {
  let factory = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") { json = true; continue; }
    if (arg.startsWith("--factory=")) { factory = arg.slice("--factory=".length).trim(); continue; }
  }
  return { factory, json };
}

// Copy nguyên văn từ src/app/api/documents/dept-leader/route.ts — giữ đồng bộ nếu route đổi.
const LEADER_KEYWORDS = ["trưởng phòng", "phó phòng", "giám đốc"];

// Từ khóa "gần giống lãnh đạo" nhưng không khớp keyword chính thức — để phát hiện cách
// gọi chức danh khác đi trong thực tế (vd "Tổ trưởng", "Phụ trách phòng"...).
const NEAR_MISS_KEYWORDS = ["trưởng", "phó", "giám", "quản lý", "phụ trách", "tổ trưởng", "trưởng ban"];

// 9/10 mã phòng ban thực sự chọn được trong form Soạn thảo mới văn bản
// (src/app/dashboard/documents/_components/documents-types.ts — PHONG_BAN_VAN_BAN_OPTIONS).
// "DSX" tồn tại trong bảng departments nhưng không nằm trong danh sách này.
const PHONG_BAN_VAN_BAN_OPTIONS = new Set(["PHK", "KTNN", "QLCL", "KHXD", "TCKT", "TCHC", "TTBV", "NMCB", "CS"]);

function matchesAny(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function stripDiacritics(text) {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, (m) => (m === "đ" ? "d" : "D"));
}

const { factory: factoryFilter, json } = parseArgs(process.argv.slice(2));
const env = loadEnv(".env.local");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Dữ liệu global (không theo factory_id) ----

const { data: factoriesRaw, error: factoriesError } = await supabase
  .from("factories")
  .select("id, code, name")
  .order("name", { ascending: true });
if (factoriesError) throw factoriesError;

const factories = (factoriesRaw || []).filter((f) => {
  if (!factoryFilter) return true;
  return f.id === factoryFilter || (f.code || "").toLowerCase() === factoryFilter.toLowerCase();
});
if (factories.length === 0) {
  console.log(`Khong tim thay factory khop --factory=${factoryFilter}`);
  process.exit(1);
}

const { data: departmentsRaw, error: departmentsError } = await supabase
  .from("departments")
  .select("id, code, name, is_active, sort_order")
  .order("sort_order", { ascending: true });
if (departmentsError) throw departmentsError;
const departments = departmentsRaw || [];

const { data: explicitPermRows, error: explicitPermError } = await supabase
  .from("user_permissions")
  .select("user_id")
  .eq("permission_code", "documents.phe_duyet")
  .eq("granted", true);
if (explicitPermError) throw explicitPermError;
const explicitUserIds = new Set((explicitPermRows || []).map((r) => r.user_id));

const { data: rolePermRows, error: rolePermError } = await supabase
  .from("role_permissions")
  .select("role")
  .eq("permission_code", "documents.phe_duyet");
if (rolePermError) throw rolePermError;
const rolesWithPerm = new Set((rolePermRows || []).map((r) => r.role));

function hasApprovePermission(profile) {
  return explicitUserIds.has(profile.id) || (profile.role && rolesWithPerm.has(profile.role));
}

// ---- Per-factory report ----

const factoryReports = [];

for (const factory of factories) {
  const { data: profilesRaw, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, department, department_id")
    .eq("factory_id", factory.id)
    .eq("status", "active");
  if (profilesError) throw profilesError;
  const profiles = profilesRaw || [];

  const { data: staffRaw, error: staffError } = await supabase
    .from("maintenance_staff")
    .select("profile_id, chuc_vu, chuc_vu_chinh_quyen, active")
    .eq("factory_id", factory.id)
    .eq("active", true);
  if (staffError) throw staffError;
  const staffRows = staffRaw || [];

  const staffByProfileId = new Map();
  const duplicateStaffProfileIds = new Set();
  for (const s of staffRows) {
    if (!s.profile_id) continue;
    if (staffByProfileId.has(s.profile_id)) duplicateStaffProfileIds.add(s.profile_id);
    staffByProfileId.set(s.profile_id, s); // dòng cuối thắng — giống Map trong route
  }

  const activeProfileIds = new Set(profiles.map((p) => p.id));
  const orphanStaffRows = staffRows.filter((s) => !s.profile_id || !activeProfileIds.has(s.profile_id));

  const deptSections = [];
  const profileDeptHits = new Map(); // profile.id -> [dept.code, ...] để phát hiện match nhiều phòng ban
  const matchedDeptCodes = new Set();
  const unmatchedProfiles = [];

  for (const dept of departments) {
    const deptUpper = dept.code.toUpperCase();
    const deptProfiles = profiles.filter((p) => {
      if (dept.id && p.department_id === dept.id) return true;
      if (dept.name && p.department === dept.name) return true;
      if (p.department && p.department.toUpperCase() === deptUpper) return true;
      return false;
    });
    if (deptProfiles.length === 0) continue;

    for (const p of deptProfiles) {
      matchedDeptCodes.add(dept.code);
      const list = profileDeptHits.get(p.id) || [];
      list.push(dept.code);
      profileDeptHits.set(p.id, list);
    }

    const candidates = [];
    const droppedByPermission = [];
    const nearMiss = [];
    const unaccentedNearMiss = [];
    const noStaffRecord = [];

    for (const p of deptProfiles) {
      const staff = staffByProfileId.get(p.id);
      if (!staff) {
        noStaffRecord.push(p);
        continue;
      }
      const chinhQuyenMatch = matchesAny(staff.chuc_vu_chinh_quyen, LEADER_KEYWORDS);
      const chucVuMatch = matchesAny(staff.chuc_vu, LEADER_KEYWORDS);
      if (chinhQuyenMatch || chucVuMatch) {
        const matchedField = chinhQuyenMatch ? "chuc_vu_chinh_quyen" : "chuc_vu";
        const matchedValue = chinhQuyenMatch ? staff.chuc_vu_chinh_quyen : staff.chuc_vu;
        const entry = { profile: p, matchedField, matchedValue, staff };
        if (hasApprovePermission(p)) {
          candidates.push(entry);
        } else {
          droppedByPermission.push(entry);
        }
        continue;
      }
      const nearMissChinhQuyen = matchesAny(staff.chuc_vu_chinh_quyen, NEAR_MISS_KEYWORDS);
      const nearMissChucVu = matchesAny(staff.chuc_vu, NEAR_MISS_KEYWORDS);
      if (nearMissChinhQuyen || nearMissChucVu) {
        nearMiss.push({ profile: p, staff });
        continue;
      }
      const unaccentChinhQuyen = matchesAny(stripDiacritics(staff.chuc_vu_chinh_quyen), NEAR_MISS_KEYWORDS.map(stripDiacritics));
      const unaccentChucVu = matchesAny(stripDiacritics(staff.chuc_vu), NEAR_MISS_KEYWORDS.map(stripDiacritics));
      if (unaccentChinhQuyen || unaccentChucVu) {
        unaccentedNearMiss.push({ profile: p, staff });
      }
    }

    deptSections.push({
      dept,
      unreachableFromUi: !PHONG_BAN_VAN_BAN_OPTIONS.has(dept.code),
      activeProfileCount: deptProfiles.length,
      candidates,
      droppedByPermission,
      nearMiss,
      unaccentedNearMiss,
      noStaffRecord,
    });
  }

  for (const p of profiles) {
    if (!profileDeptHits.has(p.id)) unmatchedProfiles.push(p);
  }

  const multiDeptProfiles = [...profileDeptHits.entries()]
    .filter(([, codes]) => codes.length > 1)
    .map(([profileId, codes]) => ({ profile: profiles.find((p) => p.id === profileId), codes }));

  factoryReports.push({
    factory,
    deptSections,
    unmatchedProfiles,
    orphanStaffRows,
    duplicateStaffProfileIds: [...duplicateStaffProfileIds],
    multiDeptProfiles,
  });
}

// ---- Output ----

if (json) {
  console.log(JSON.stringify(factoryReports, null, 2));
  process.exit(0);
}

function profileLabel(p) {
  return `${p.full_name || p.username || "(no name)"} (${p.username || p.id})`;
}

let total0 = 0, total1 = 0, totalMulti = 0, totalNearMiss = 0, totalUnaccented = 0, totalDropped = 0;

for (const fr of factoryReports) {
  console.log("=".repeat(80));
  console.log(`FACTORY: ${fr.factory.name}  (id=${fr.factory.id}, code=${fr.factory.code || "-"})`);
  console.log("=".repeat(80));

  for (const section of fr.deptSections) {
    const { dept, unreachableFromUi, activeProfileCount, candidates, droppedByPermission, nearMiss, unaccentedNearMiss, noStaffRecord } = section;
    const tag = unreachableFromUi ? "  [KHONG CHON DUOC TU FORM SOAN THAO MOI]" : "";
    console.log(`\n[${dept.code}] ${dept.name}${tag} — active profiles trong phong ban: ${activeProfileCount}`);

    if (candidates.length === 0) {
      console.log("  API candidates: (khong co)");
      console.log("  KET QUA: 0 candidate -> UI hien banner do, chan luu");
      total0 += 1;
    } else {
      console.log("  API candidates (nhung gi /api/documents/dept-leader tra ve hien tai):");
      for (const c of candidates) {
        console.log(`    v ${profileLabel(c.profile)} — matched ${c.matchedField}: "${c.matchedValue}"`);
      }
      if (candidates.length === 1) {
        console.log("  KET QUA: 1 candidate -> UI tu dong gan + badge xanh");
        total1 += 1;
      } else {
        console.log(`  KET QUA: ${candidates.length} candidates -> UI hien dropdown`);
        totalMulti += 1;
      }
    }

    if (droppedByPermission.length > 0) {
      console.log("  Bi loai boi permission gate (khop tu khoa nhung thieu documents.phe_duyet):");
      for (const d of droppedByPermission) {
        console.log(`    x ${profileLabel(d.profile)} — ${d.matchedField}: "${d.matchedValue}" (role=${d.profile.role || "-"})`);
      }
      totalDropped += droppedByPermission.length;
    }

    if (nearMiss.length > 0) {
      console.log("  Near-miss — chuc danh giong lanh dao nhung khong khop tu khoa chinh thuc:");
      for (const n of nearMiss) {
        const val = n.staff.chuc_vu_chinh_quyen || n.staff.chuc_vu || "";
        console.log(`    ~ ${profileLabel(n.profile)} — "${val}"`);
      }
      totalNearMiss += nearMiss.length;
    }

    if (unaccentedNearMiss.length > 0) {
      console.log("  Possible unaccented match — chi khop sau khi bo dau:");
      for (const n of unaccentedNearMiss) {
        const val = n.staff.chuc_vu_chinh_quyen || n.staff.chuc_vu || "";
        console.log(`    ? ${profileLabel(n.profile)} — "${val}"`);
      }
      totalUnaccented += unaccentedNearMiss.length;
    }

    if (noStaffRecord.length > 0) {
      console.log(`  Profile khong co ban ghi maintenance_staff: ${noStaffRecord.map(profileLabel).join(", ")}`);
    }
  }

  if (fr.unmatchedProfiles.length > 0) {
    console.log("\n  --- Profile active khong khop bat ky phong ban nao (department/department_id sai/thieu) ---");
    for (const p of fr.unmatchedProfiles) {
      console.log(`    - ${profileLabel(p)}: department="${p.department || ""}", department_id=${p.department_id || "null"}`);
    }
  }

  if (fr.orphanStaffRows.length > 0) {
    console.log("\n  --- maintenance_staff active nhung profile_id thieu/khong active trong factory nay ---");
    for (const s of fr.orphanStaffRows) {
      console.log(`    - profile_id=${s.profile_id || "null"}, chuc_vu="${s.chuc_vu || ""}", chuc_vu_chinh_quyen="${s.chuc_vu_chinh_quyen || ""}"`);
    }
  }

  if (fr.duplicateStaffProfileIds.length > 0) {
    console.log("\n  --- CANH BAO: nhieu dong maintenance_staff cung profile_id (Map trong route se lay dong cuoi, khong dam bao thu tu) ---");
    for (const id of fr.duplicateStaffProfileIds) console.log(`    - profile_id=${id}`);
  }

  if (fr.multiDeptProfiles.length > 0) {
    console.log("\n  --- CANH BAO: profile khop nhieu hon 1 phong ban (department vs department_id khong nhat quan) ---");
    for (const m of fr.multiDeptProfiles) {
      console.log(`    - ${profileLabel(m.profile)}: ${m.codes.join(", ")}`);
    }
  }

  console.log("");
}

console.log("=".repeat(80));
console.log("GLOBAL SUMMARY");
console.log("=".repeat(80));
console.log(`  Phong ban/nha may co 0 candidate  : ${total0}`);
console.log(`  Phong ban/nha may co 1 candidate  : ${total1}`);
console.log(`  Phong ban/nha may co nhieu candidate: ${totalMulti}`);
console.log(`  Near-miss (chua bo dau)           : ${totalNearMiss}`);
console.log(`  Possible unaccented match         : ${totalUnaccented}`);
console.log(`  Bi loai boi permission gate       : ${totalDropped}`);

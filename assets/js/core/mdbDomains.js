// "도메인 보기": 캐릭터, 서포트 카드, 스킬처럼 사람이 생각하는 단위로 흩어진 테이블을 한 화면에 모읍니다.
//
// 코드로 하나씩 짜지 않고, assets/data/mdb-map.json의 domains 설정(선언)을 이 파일이 해석합니다.
// 한 구역(section)은 "시작 행에서 출발해 테이블을 따라가는" 단계(steps)의 나열입니다.
//   { table: "card_data", match: "chara_id" }                      -> card_data에서 chara_id == 시작 행의 id
//   { table: "race", match: "id", from: "race_id" }                -> race에서 id == 시작 행의 race_id
// 단계를 이으면 두 번 이상 건너뛰는 연결(스킬 -> 습득 가능 세트 -> 카드)도 같은 방식으로 표현됩니다.
// 단계에 붙일 수 있는 옵션:
//   where: { 컬럼: 값 }   그 컬럼이 값과 같은 행만 남김 (예: 힌트 테이블에서 hint_gain_type == 0인 스킬 힌트만)
//   excludeRoot: true      시작 행 자신은 뺌 (같은 그룹의 "다른" 스킬을 찾을 때)
// 구역에 붙일 수 있는 옵션:
//   minus: "구역id"        앞선 그 구역에 이미 나온 행은 뺌 (같은 카드가 "정확히 일치"와 "같은 그룹"에 두 번 나오지 않게)
//   hideEmpty: true        결과가 없으면 구역을 아예 숨김
// 새 도메인을 더하려면 JSON만 고치면 됩니다. (화면 코드는 건드리지 않습니다.)
//
// 이 파일도 화면(DOM)을 모릅니다.

const SECTION_ROW_LIMIT = 300;

/** 이 DB에 시작 테이블이 있는 도메인만 돌려줍니다. (게임 버전에 따라 테이블이 없을 수 있습니다.) */
export function availableDomains(catalog) {
  return (catalog.map.domains ?? []).filter((domain) => catalog.db.table(domain.table));
}

function unique(values) {
  return [...new Set(values)];
}

function columnNames(db, table) {
  return db.table(table).columns.map((c) => c.name);
}

/** 컬럼 이름 목록을 실제 DB에 맞춥니다. (없는 컬럼은 조용히 뺍니다. "@name"은 이름 열 표시입니다.) */
function resolveColumns(db, table, wanted) {
  const have = new Set(columnNames(db, table));
  const names = wanted ?? columnNames(db, table);
  return names.filter((name) => name === "@name" || have.has(name));
}

/** 행 하나를 선택된 컬럼의 값 배열로 만듭니다. "@name"은 text_data에서 찾은 이름입니다. */
function pick(catalog, table, columns, row) {
  const db = catalog.db;
  return columns.map((name) => {
    if (name === "@name") {
      const id = row.values[db.columnIndex(table, "id")];
      return typeof id === "number" ? catalog.nameOf(table, id) : null;
    }
    return row.values[db.columnIndex(table, name)];
  });
}

/**
 * 도메인 목록 화면용: 시작 테이블의 모든 행을 한 번에 읽어 id와 이름을 붙입니다.
 * @returns {Promise<{ columns: string[], entries: { rowid:number, id:number, name:string|null, cells:any[] }[] }>}
 */
export async function loadEntityList(catalog, domain, { onProgress } = {}) {
  const db = catalog.db;
  const { rows, rowids } = await db.readTable(domain.table, { onProgress });
  const idIndex = db.columnIndex(domain.table, "id");
  const columns = resolveColumns(db, domain.table, domain.listColumns);
  const entries = rows.map((values, i) => {
    const id = values[idIndex];
    const row = { rowid: rowids[i], values };
    return { rowid: rowids[i], id, name: catalog.nameOf(domain.table, id), cells: pick(catalog, domain.table, columns, row) };
  });
  return { columns, entries };
}

/** 행이 where 조건(컬럼 == 값)을 모두 만족하는지. 컬럼이 없으면 만족하지 않는 것으로 봅니다. */
function passesWhere(db, table, row, where) {
  return Object.entries(where).every(([column, value]) => {
    const index = db.columnIndex(table, column);
    return index >= 0 && row.values[index] === value;
  });
}

function dedupeByRowid(rows) {
  const seen = new Set();
  return rows.filter((row) => !seen.has(row.rowid) && seen.add(row.rowid));
}

function runSection(catalog, domain, rootRow, section, done) {
  const db = catalog.db;
  if (section.self) return { table: domain.table, rows: [rootRow], total: 1, link: null };

  let table = domain.table;
  let current = [rootRow];
  let total = current.length;
  let link = null;
  for (const step of section.steps) {
    if (!db.table(step.table)) return null; // 이 버전에 없는 테이블이면 구역을 통째로 건너뜁니다.
    const fromIndex = db.columnIndex(table, step.from ?? "id");
    if (fromIndex < 0 || db.columnIndex(step.table, step.match) < 0) return null;
    // 0이나 음수는 "없음"을 뜻하는 자리표시자(예: 연결된 세트 없음)라서 따라가지 않습니다.
    const keys = unique(current.map((row) => row.values[fromIndex]).filter((v) => typeof v === "number" && v > 0));
    let next = [];
    let cutOff = 0; // 개수 한도로 잘려 화면에 못 싣는 행 수
    for (const key of keys) {
      const found = catalog.rowsWhere(step.table, step.match, key, SECTION_ROW_LIMIT);
      let rows = found.rows;
      if (step.where) rows = rows.filter((row) => passesWhere(db, step.table, row, step.where));
      if (step.excludeRoot && step.table === domain.table) rows = rows.filter((row) => row.rowid !== rootRow.rowid);
      // 한도로 잘린 나머지는 조건을 확인할 수 없으므로 그대로 "더 있음"으로 셉니다.
      cutOff += found.total - found.rows.length;
      next.push(...rows);
    }
    next = dedupeByRowid(next); // 같은 행이 여러 경로로 닿아도 한 번만 보여 줍니다.
    total = next.length + cutOff;
    // 한 단계짜리 구역만 "테이블에서 전체 보기" 링크를 만들 수 있습니다(필터 한 개로 표현되므로). where가 있으면 필터 하나로 표현 못 합니다.
    if (section.steps.length === 1 && keys.length === 1 && !step.where && !step.excludeRoot) link = { table: step.table, column: step.match, value: keys[0] };
    current = next.slice(0, SECTION_ROW_LIMIT);
    table = step.table;
  }

  if (section.minus) {
    const earlier = done.get(section.minus);
    if (earlier && earlier.table === table) {
      const taken = new Set(earlier.rows.map((row) => row.rowid));
      const before = current.length;
      current = current.filter((row) => !taken.has(row.rowid));
      total = Math.max(current.length, total - (before - current.length));
    }
  }
  return { table, rows: current, total, link };
}

/**
 * 도메인 상세 화면용: 한 행에서 출발해 모든 구역을 풀어 줍니다.
 * @returns 화면이 그대로 그릴 수 있는 객체
 */
export function buildEntity(catalog, domain, rowid) {
  const db = catalog.db;
  const values = db.getRow(domain.table, rowid);
  if (!values) return null;
  const rootRow = { rowid, values };
  const id = values[db.columnIndex(domain.table, "id")];
  const factColumns = resolveColumns(db, domain.table, domain.facts);

  const sections = [];
  const done = new Map(); // 구역 id -> 결과 (minus가 앞선 구역을 참조합니다)
  for (const section of domain.sections ?? []) {
    const result = runSection(catalog, domain, rootRow, section, done);
    if (!result) continue;
    done.set(section.id, result);
    if (section.hideEmpty && result.rows.length === 0) continue;
    const columns = resolveColumns(db, result.table, section.columns);
    sections.push({
      id: section.id,
      table: result.table,
      layout: section.layout ?? "table",
      hideZero: Boolean(section.hideZero),
      columns,
      rows: result.rows.map((row) => ({ rowid: row.rowid, cells: pick(catalog, result.table, columns, row) })),
      total: result.total,
      truncated: result.total > result.rows.length,
      link: result.link,
    });
  }

  return {
    domain: domain.id,
    table: domain.table,
    rowid,
    id,
    name: catalog.nameOf(domain.table, id),
    facts: factColumns.map((name) => ({ column: name, value: values[db.columnIndex(domain.table, name)] })),
    texts: catalog.textsFor(domain.table, id),
    sections,
  };
}

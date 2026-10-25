// 두 버전의 master.mdb를 비교해 "무엇이 추가/삭제/변경됐는지" 테이블별로 알려 줍니다.
//
// 비교 방식(속도와 정확성의 절충):
//   - 행의 "키"는 기본키(PK)로 정합니다. PK가 rowid 별칭(id 등)이면 rowid가 곧 키라 본문을 읽을 필요도 없습니다.
//     text_data처럼 복합키면 키 컬럼만 해석합니다. PK가 아예 없는 테이블은 행 내용 해시로 짝을 맞춥니다.
//   - 같은 키의 두 행은 먼저 "원본 바이트의 해시"로 빠르게 비교하고, 해시가 다를 때만 실제 값을 해석해
//     다시 비교합니다. (두 파일을 만든 도구가 같은 값을 다르게 인코딩했을 때 가짜 변경을 막기 위해서입니다.)
//   - 컬럼이 늘거나 줄어든 테이블은 두 쪽에 모두 있는 컬럼만 값으로 비교하고, 스키마 변경으로 따로 표시합니다.
//
// 이 파일도 화면(DOM)을 모릅니다.

const YIELD = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 바이트열의 53비트 해시(cyrb53). 충돌은 "해시가 같으면 같다고 믿는" 빠른 경로에서만 영향을 주며, 확률은 무시할 수준입니다. */
function hashBytes(bytes) {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 값 하나를 종류가 구분되는 글자로 만듭니다. (정수 1과 글자 "1"을 같게 보지 않기 위해) */
function tag(value) {
  if (value === null || value === undefined) return "N";
  if (value instanceof Uint8Array) return "b" + Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
  if (typeof value === "string") return "t" + value;
  return "n" + String(value);
}

export function sameValue(a, b) {
  return tag(a) === tag(b);
}

const keyOf = (values) => values.map(tag).join("\u0001");

function diffTable(oldDb, newDb, name) {
  const to = oldDb.table(name);
  const tn = newDb.table(name);
  const oldNames = to.columns.map((c) => c.name);
  const newNames = tn.columns.map((c) => c.name);
  const schema = {
    added: newNames.filter((n) => !oldNames.includes(n)),
    removed: oldNames.filter((n) => !newNames.includes(n)),
    typeChanged: newNames.filter((n) => oldNames.includes(n) && to.columns[oldNames.indexOf(n)].type !== tn.columns[newNames.indexOf(n)].type),
  };
  schema.changed = schema.added.length + schema.removed.length + schema.typeChanged.length > 0;
  const sameLayout = !schema.changed && oldNames.join("\u0001") === newNames.join("\u0001");

  const result = { name, schema, keyColumns: [], added: [], removed: [], changed: [], oldCount: 0, newCount: 0 };

  // 두 쪽에 모두 있는 컬럼만 값으로 비교합니다 (스키마가 같으면 전부).
  const common = newNames.filter((n) => oldNames.includes(n));
  const oldIdx = common.map((n) => oldNames.indexOf(n));
  const newIdx = common.map((n) => newNames.indexOf(n));
  const commonKey = tn.pk.map((i) => newNames[i]).filter((n) => common.includes(n));
  const keyIsRowid = tn.rowidAlias >= 0 && commonKey.length === 1 && commonKey[0] === newNames[tn.rowidAlias] && oldNames[to.rowidAlias] === commonKey[0];
  result.keyColumns = commonKey;

  // decodePayload는 컬럼을 번호 오름차순으로만 돌려줍니다. 두 DB는 컬럼 순서가 다를 수 있으므로,
  // 요청한 순서(= 두 쪽에 공통인 컬럼 순서)로 다시 맞춰 주어야 같은 자리끼리 비교됩니다.
  const commonValues = (db, idxs, rowid, payload) => {
    const sorted = [...idxs].sort((a, b) => a - b);
    const values = db.decodePayload(name, payload, rowid, sorted);
    return idxs.map((i) => values[sorted.indexOf(i)]);
  };

  // 기본키 값으로 키를 만드는 함수. rowid 별칭이면 rowid가 곧 키라 본문을 읽지 않습니다.
  const keyFn = (db, names) => {
    if (keyIsRowid) return (rowid) => rowid;
    const idx = commonKey.map((n) => names.indexOf(n));
    return (rowid, payload) => keyOf(commonValues(db, idx, rowid, payload));
  };

  // --- 기본키가 없으면: 내용 해시로 짝을 맞춥니다. (변경은 "삭제 + 추가"로 나타납니다.)
  if (commonKey.length === 0) {
    const pool = new Map();
    const sig = (db, idxs, rowid, payload) => (sameLayout ? hashBytes(payload) : keyOf(commonValues(db, idxs, rowid, payload)));
    oldDb.forEachPayload(name, (rowid, payload) => {
      result.oldCount++;
      const s = sig(oldDb, oldIdx, rowid, payload);
      const list = pool.get(s);
      if (list) list.push(rowid);
      else pool.set(s, [rowid]);
    });
    newDb.forEachPayload(name, (rowid, payload) => {
      result.newCount++;
      const list = pool.get(sig(newDb, newIdx, rowid, payload));
      if (list && list.length) list.pop();
      else result.added.push(rowid);
    });
    for (const list of pool.values()) result.removed.push(...list);
    return result;
  }

  // --- 기본키가 있으면: 키로 짝을 맞춰 추가/삭제/변경을 가립니다.
  const oldKey = keyFn(oldDb, oldNames);
  const newKey = keyFn(newDb, newNames);
  const oldRows = new Map();
  oldDb.forEachPayload(name, (rowid, payload) => {
    result.oldCount++;
    oldRows.set(oldKey(rowid, payload), { rowid, hash: sameLayout ? hashBytes(payload) : null, payload });
  });
  newDb.forEachPayload(name, (rowid, payload) => {
    result.newCount++;
    const key = newKey(rowid, payload);
    const before = oldRows.get(key);
    if (!before) {
      result.added.push(rowid);
      return;
    }
    oldRows.delete(key);
    if (sameLayout && before.hash === hashBytes(payload)) return; // 바이트가 같으면 같은 행
    // 해시가 달라도 값이 같을 수 있어(인코딩 차이) 실제 값으로 한 번 더 확인합니다.
    const a = commonValues(oldDb, oldIdx, before.rowid, before.payload);
    const b = commonValues(newDb, newIdx, rowid, payload);
    if (keyOf(a) !== keyOf(b)) result.changed.push({ oldRowid: before.rowid, newRowid: rowid });
  });
  for (const row of oldRows.values()) result.removed.push(row.rowid);
  return result;
}

/**
 * 두 데이터베이스를 비교합니다.
 * @param {import("./sqlite.js").SqliteDb} oldDb 이전 버전
 * @param {import("./sqlite.js").SqliteDb} newDb 새 버전
 * @param {{ onProgress?: (done:number,total:number,name:string)=>void, shouldCancel?: ()=>boolean }} [options]
 */
export async function diffDatabases(oldDb, newDb, { onProgress, shouldCancel } = {}) {
  const oldSet = new Set(oldDb.tableNames);
  const newSet = new Set(newDb.tableNames);
  const addedTables = [...newSet].filter((n) => !oldSet.has(n)).sort();
  const removedTables = [...oldSet].filter((n) => !newSet.has(n)).sort();
  const common = [...newSet].filter((n) => oldSet.has(n)).sort();

  const tables = [];
  for (let i = 0; i < common.length; i++) {
    if (shouldCancel?.()) break;
    onProgress?.(i, common.length, common[i]);
    let entry;
    try {
      entry = diffTable(oldDb, newDb, common[i]);
      entry.total = entry.added.length + entry.removed.length + entry.changed.length;
      entry.status = entry.total > 0 || entry.schema.changed ? "changed" : "same";
    } catch (error) {
      // WITHOUT ROWID 같은 지원하지 않는 테이블 하나가 전체 비교를 멈추지 않게 합니다.
      entry = { name: common[i], status: "error", error: error.message, added: [], removed: [], changed: [], total: 0, schema: { changed: false } };
    }
    tables.push(entry);
    await YIELD();
  }
  onProgress?.(common.length, common.length, "");
  return { addedTables, removedTables, tables };
}

/** 바뀐 행 하나에서 "어느 컬럼이 어떻게 바뀌었는지"를 꺼냅니다. (상세 화면에서 필요할 때만 호출) */
export function rowChanges(oldDb, newDb, name, oldRowid, newRowid) {
  const to = oldDb.table(name);
  const tn = newDb.table(name);
  const before = oldDb.getRow(name, oldRowid);
  const after = newDb.getRow(name, newRowid);
  const out = [];
  tn.columns.forEach((column, i) => {
    const j = to.columns.findIndex((c) => c.name === column.name);
    if (j < 0) return;
    if (!sameValue(before[j], after[i])) out.push({ column: column.name, before: before[j], after: after[i] });
  });
  return out;
}

// master.mdb의 "숫자 코드"를 사람이 읽을 수 있게 풀어 주는 계층입니다.
//
// master.mdb는 외래키가 하나도 선언되어 있지 않고(전부 이름 관례), 이름은 본 테이블이 아니라
// text_data(category, index)에 따로 들어 있습니다. 그래서 이 파일은 두 가지를 합니다.
//   1) assets/data/mdb-map.json: 사람이 확인해 확정한 사전(어느 테이블의 id가 어느 text_data 카테고리와
//      짝인지, 어느 컬럼이 어느 테이블의 id를 가리키는지)을 읽어 쓴다.
//   2) 사전에 없는 부분은 "추정"으로만 보여 준다(번호가 우연히 겹칠 수 있으므로 확정처럼 다루지 않는다).
//
// 이 파일도 화면(DOM)을 모릅니다. tests/mdb-cli.mjs로 Node에서 그대로 돌릴 수 있습니다.

const EPOCH_MIN = 946684800; // 2000-01-01
const EPOCH_MAX = 4102444800; // 2100-01-01
const JST_OFFSET_SECONDS = 9 * 3600;
const YIELD = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 게임 텍스트 안의 줄바꿈 표기를 실제 줄바꿈으로 바꿉니다.
 * master.mdb의 글자에는 진짜 줄바꿈 문자가 하나도 없고, 줄바꿈 자리에 "백슬래시 + n" 두 글자가 그대로 들어 있습니다
 * (text_data 21,233행, race_jikkyo 메시지 2,865행). 백슬래시가 둘 붙은 형태(13행)도 같은 자리에 쓰여서 함께 바꿉니다.
 * 그 밖의 글자(<color=...> 같은 서식 표기 포함)는 건드리지 않습니다.
 * 화면 표시와 "풀이해서 저장"에만 쓰고, 표의 원본 값(CSV/JSON 기본 저장, 버전 비교)은 그대로 둡니다.
 */
export function gameText(text) {
  return text.includes("\\") ? text.replace(/\\{1,2}n/g, "\n") : text;
}

/** 유닉스 시간(초)을 "YYYY-MM-DD HH:mm" (JST, UTC+9)로 바꿉니다. 게임 서버 기준 시각이 일본 시간이라 고정했습니다. */
export function formatEpoch(seconds) {
  return new Date((seconds + JST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 어느 컬럼이 "유닉스 시간"인지 알아냅니다. 이름에 date/time이 들어가고, 0이 아닌 값 대부분이
 * 2000~2100년 범위의 초 단위 값일 때만 시간으로 봅니다. (이름만 믿으면 float_ability_time_1 같은 컬럼이 오인됩니다.)
 * @param {{name:string}[]} columns
 * @param {any[][]} rows columns와 같은 순서의 값
 * @returns {Set<number>} 시간 컬럼의 번호
 */
export function detectEpochColumns(columns, rows) {
  const found = new Set();
  columns.forEach((column, c) => {
    if (!/date|time/i.test(column.name)) return;
    let seen = 0;
    let inRange = 0;
    for (let r = 0; r < rows.length && seen < 200; r++) {
      const value = rows[r][c];
      if (typeof value !== "number" || value === 0) continue;
      seen++;
      if (value >= EPOCH_MIN && value <= EPOCH_MAX) inRange++;
    }
    if (seen > 0 && inRange / seen >= 0.9) found.add(c);
  });
  return found;
}

export class MdbCatalog {
  /**
   * @param {import("./sqlite.js").SqliteDb} db
   * @param {object} map assets/data/mdb-map.json 내용 (없어도 동작하지만 이름/링크가 거의 안 나옵니다)
   * @param {Record<string, Record<string,string>>} [userLabels] 사용자가 직접 붙인 값 라벨: { "테이블.컬럼": { "값": "뜻" } }
   */
  constructor(db, map = {}, userLabels = {}) {
    this.db = db;
    this.map = map;
    this.userLabels = userLabels;
    /** @type {Map<number, Map<number,string>>} category -> (index -> text) */
    this.texts = new Map();
    this.textRows = [];
    this._owner = new Map(); // category -> { table, role }
    for (const [table, entry] of Object.entries(map.tables ?? {})) {
      for (const [category, role] of Object.entries(entry.texts ?? {})) this._owner.set(Number(category), { table, role });
    }
    this._nameCats = new Map();
    this._existsCache = new Map();
    this._idSets = new Map();
    this._columnIndexes = new Map();
    this._refCounts = new Map();
    this._coverage = new Map();
  }

  /** text_data를 메모리에 올립니다. (9만 행, 약 0.3초) 이 뒤로 이름 조회는 전부 메모리에서 합니다. */
  async load({ onProgress } = {}) {
    const db = this.db;
    if (!db.table("text_data")) return;
    const cols = ["category", "index", "text"].map((name) => db.columnIndex("text_data", name));
    if (cols.includes(-1)) return;
    const { rows } = await db.readTable("text_data", { columns: cols, onProgress });
    // readTable은 컬럼 번호 오름차순으로 돌려주므로, 이름으로 다시 자리를 찾습니다.
    const order = [...cols].sort((a, b) => a - b);
    const at = (name) => order.indexOf(db.columnIndex("text_data", name));
    const [ic, ii, it] = [at("category"), at("index"), at("text")];
    for (const row of rows) {
      let bucket = this.texts.get(row[ic]);
      if (!bucket) this.texts.set(row[ic], (bucket = new Map()));
      // 이름/설명/검색에 쓰이는 텍스트는 처음부터 줄바꿈을 풀어 둡니다. (표의 원본 값은 db에서 따로 읽으므로 그대로입니다.)
      const text = gameText(row[it]);
      bucket.set(row[ii], text);
      this.textRows.push([row[ic], row[ii], text]);
    }
  }

  get hasTexts() {
    return this.texts.size > 0;
  }

  textOf(category, index) {
    return this.texts.get(category)?.get(index) ?? null;
  }

  // ---------- 이름 ----------

  /** 사전에 확정된 (카테고리, 역할) 목록. */
  rolesOf(table) {
    return Object.entries(this.map.tables?.[table]?.texts ?? {}).map(([category, role]) => ({ category: Number(category), role }));
  }

  // 이름 역할의 카테고리를 테이블별로 한 번만 찾아 둡니다. (10만 행을 필터링할 때 nameOf가 수십만 번 불립니다.)
  _nameCategory(table) {
    let found = this._nameCats.get(table);
    if (found === undefined) {
      found = this.rolesOf(table).find((r) => r.role === "name")?.category ?? null;
      this._nameCats.set(table, found);
    }
    return found;
  }

  /** 테이블 행의 이름(role "name"). 사전에 없으면 null. */
  nameOf(table, id) {
    const category = this._nameCategory(table);
    return category === null ? null : this.textOf(category, id);
  }

  hasName(table) {
    return this._nameCategory(table) !== null;
  }

  categoryOwner(category) {
    return this._owner.get(category) ?? null;
  }

  // ---------- 참조(외래키 역할) ----------

  /**
   * 컬럼이 어느 테이블의 id를 가리키는지. 사전(refs)에 있고 그 사용처가 제외 목록(except)에 없을 때만 돌려줍니다.
   * skill_id1, skill_id2처럼 뒤에 번호가 붙은 컬럼은 번호를 뗀 이름으로도 찾습니다.
   * 이름만으로 추측해 연결하지 않는 이유: chara_id 같은 흔한 이름도 일부 테이블에서는 다른 뜻으로 쓰이고,
   * item_id는 item_category에 따라 가리키는 대상이 달라서 잘못된 링크가 더 해롭기 때문입니다.
   */
  refTarget(table, column) {
    const refs = this.map.refs;
    if (!refs) return null;
    const entry = refs[column] ?? refs[column.replace(/_?\d+$/, "")];
    if (!entry) return null;
    if (entry.only && !entry.only.includes(table)) return null;
    if (entry.except?.includes(table)) return null;
    if (!this.db.table(entry.table)) return null;
    if (entry.table === table && column === "id") return null;
    return entry.table;
  }

  /** 테이블의 id 컬럼 번호 (없으면 -1). */
  idColumn(table) {
    return this.db.columnIndex(table, "id");
  }

  _columnIndex(table, columnName) {
    const key = `${table}.${columnName}`;
    let index = this._columnIndexes.get(key);
    if (!index) {
      const c = this.db.columnIndex(table, columnName);
      index = new Map();
      if (c >= 0) {
        const { rowids, values } = this.db.scanColumn(table, c);
        values.forEach((value, i) => {
          const list = index.get(value);
          if (list) list.push(rowids[i]);
          else index.set(value, [rowids[i]]);
        });
      }
      this._columnIndexes.set(key, index);
    }
    return index;
  }

  /** 컬럼 값이 value인 행들을 찾습니다. rowid 별칭 컬럼이면 B-tree 탐색 한 번으로 끝납니다. */
  rowsWhere(table, columnName, value, limit = 500) {
    const t = this.db.table(table);
    if (!t) return { rows: [], total: 0 };
    const c = this.db.columnIndex(table, columnName);
    if (c < 0 || typeof value !== "number") return { rows: [], total: 0 };
    if (c === t.rowidAlias) {
      const values = this.db.getRow(table, value);
      return values ? { rows: [{ rowid: value, values }], total: 1 } : { rows: [], total: 0 };
    }
    const rowids = this._columnIndex(table, columnName).get(value) ?? [];
    return { rows: rowids.slice(0, limit).map((rowid) => ({ rowid, values: this.db.getRow(table, rowid) })), total: rowids.length };
  }

  /** id로 한 행 찾기. 없으면 null. */
  rowById(table, id) {
    const found = this.rowsWhere(table, "id", id, 1).rows[0];
    return found ?? null;
  }

  hasId(table, id) {
    const key = `${table}:${id}`;
    let known = this._existsCache.get(key);
    if (known === undefined) {
      known = this.rowById(table, id) !== null;
      this._existsCache.set(key, known);
    }
    return known;
  }

  /** 테이블 id 전체 집합 (text_data 카테고리와 겹침을 재는 데 씁니다). */
  idSet(table) {
    let set = this._idSets.get(table);
    if (!set) {
      const t = this.db.table(table);
      const c = this.idColumn(table);
      if (!t || c < 0) set = new Set();
      else set = new Set(c === t.rowidAlias ? this.db.rowids(table) : this.db.scanColumn(table, c).values);
      this._idSets.set(table, set);
    }
    return set;
  }

  // ---------- 값 해석 ----------

  labelFor(table, column, value) {
    const key = `${table}.${column}`;
    return this.userLabels[key]?.[String(value)] ?? this.map.labels?.[key]?.[String(value)] ?? null;
  }

  /**
   * 셀 하나를 화면/내보내기용으로 풀어 줍니다.
   * @param {{ epoch?: Set<string> }} [ctx] epoch: 시간으로 보여 줄 컬럼 이름들
   * @returns {{ kind: "null"|"plain"|"time"|"label"|"ref"|"blob", text: string, name?: string, ref?: {table:string,id:number}, label?: string }}
   */
  valueInfo(table, column, value, ctx = {}) {
    if (value === null || value === undefined) return { kind: "null", text: "" };
    if (value instanceof Uint8Array) return { kind: "blob", text: `<blob ${value.length}B>` };
    if (typeof value === "string") return { kind: "plain", text: gameText(value) };
    const text = String(value);
    if (typeof value === "number") {
      if (ctx.epoch?.has(column) && value >= EPOCH_MIN && value <= EPOCH_MAX) return { kind: "time", text: formatEpoch(value), raw: text };
      const label = this.labelFor(table, column, value);
      if (label) return { kind: "label", text, label };
      const target = this.refTarget(table, column);
      if (target && value > 0 && this.hasId(target, value)) {
        return { kind: "ref", text, ref: { table: target, id: value }, name: this.nameOf(target, value) ?? undefined };
      }
    }
    return { kind: "plain", text };
  }

  /** 필터/내보내기에서 쓰는 한 줄 글자: 값 + (이름|라벨). */
  displayText(table, column, value, ctx) {
    const info = this.valueInfo(table, column, value, ctx);
    return [info.text, info.name, info.label].filter(Boolean).join(" ");
  }

  // ---------- text_data 연결 ----------

  /**
   * 카테고리와 테이블 id가 얼마나 겹치는지.
   *   category: 카테고리 번호 중 테이블 id에 있는 비율 (1에 가까울수록 "이 테이블의 텍스트"일 가능성)
   *   table:    테이블 id 중 카테고리에 있는 비율 (작은 카테고리가 큰 테이블에 우연히 다 들어가는 경우를 거릅니다)
   *   size:     카테고리의 번호 개수
   */
  coverage(table, category) {
    const key = `${table}:${category}`;
    let value = this._coverage.get(key);
    if (value === undefined) {
      const bucket = this.texts.get(category);
      const ids = this.idSet(table);
      let hit = 0;
      if (bucket) for (const index of bucket.keys()) if (ids.has(index)) hit++;
      value = { category: bucket?.size ? hit / bucket.size : 0, table: ids.size ? hit / ids.size : 0, size: bucket?.size ?? 0 };
      this._coverage.set(key, value);
    }
    return value;
  }

  /**
   * 사전 밖 카테고리가 이 테이블의 텍스트일 가능성의 등급.
   *   "strong": 카테고리 번호가 모두 이 테이블 id에 있고, 테이블 행의 절반 이상이 텍스트를 가짐
   *   "weak":   번호는 모두 이 테이블 id에 있지만 일부 행만 텍스트를 가짐(예: 새 캐릭터에만 있는 프로필 항목).
   *             맞는 경우가 많지만 같은 조건으로 엉뚱한 테이블(배너, 챔피언스 등)에 걸리는 경우도 있어 확정처럼 다루지 않습니다.
   *             번호가 적은 카테고리는 우연히 겹치기 쉬워서 20개 이상일 때만 봅니다.
   *   null:     해당 없음
   */
  _tier(table, category) {
    const c = this.coverage(table, category);
    if (c.category < 0.95) return null;
    if (c.table >= 0.5) return "strong";
    return c.size >= 20 && c.table >= 0.1 ? "weak" : null;
  }

  /**
   * 행 하나(table, id)와 같은 번호를 가진 text_data를 네 묶음으로 나눕니다.
   *   curated: 사전에 확정된 것(역할 이름 포함)
   *   auto:    사전엔 없지만 번호 집합이 이 테이블 id와 크게 겹치는 카테고리(추정)
   *   weak:    번호는 모두 이 테이블 id에 있지만 일부 행만 텍스트를 가진 카테고리(약한 추정, _tier 참고)
   *   other:   번호만 우연히 같은 카테고리(다른 테이블의 텍스트일 가능성이 큼)
   */
  textsFor(table, id) {
    const curated = [];
    const auto = [];
    const weak = [];
    const other = [];
    const known = new Set(this.rolesOf(table).map((r) => r.category));
    for (const { category, role } of this.rolesOf(table)) {
      const text = this.textOf(category, id);
      if (text !== null) curated.push({ category, role, text });
    }
    const canMatch = this.idColumn(table) >= 0;
    for (const [category, bucket] of this.texts) {
      if (known.has(category) || !bucket.has(id)) continue;
      const entry = { category, text: bucket.get(id) };
      const tier = canMatch ? this._tier(table, category) : null;
      if (tier === "strong") auto.push(entry);
      else if (tier === "weak") weak.push({ ...entry, coverage: this.coverage(table, category).table });
      else other.push(entry);
    }
    return { curated, auto, weak, other };
  }

  /** 텍스트 검색. 검색어가 숫자면 그 번호(index)를 가진 텍스트도 함께 찾습니다. */
  searchTexts(query, { category = null, limit = 200 } = {}) {
    const needle = query.trim().toLowerCase();
    if (!needle) return { total: 0, hits: [] };
    const asNumber = /^\d+$/.test(needle) ? Number(needle) : null;
    const hits = [];
    let total = 0;
    for (const [cat, index, text] of this.textRows) {
      if (category !== null && cat !== category) continue;
      if (text.toLowerCase().includes(needle) || index === asNumber) {
        total++;
        if (hits.length < limit) hits.push({ category: cat, index, text });
      }
    }
    return { total, hits };
  }

  /**
   * 사전에 없는 카테고리의 주인 테이블 후보. 모든 id 테이블을 훑으므로 한 번만 계산하고 진행률을 알려 줍니다.
   * 강한 후보(strong)가 있으면 그것만, 없으면 약한 후보(weak: 일부 행만 텍스트를 가진 경우)를 돌려줍니다.
   * @returns {Promise<{ table: string, coverage: number, rows: number, weak: boolean }[]>}
   */
  async candidateOwners(category, { onProgress } = {}) {
    const names = this.db.tableNames.filter((name) => this.idColumn(name) >= 0);
    const strong = [];
    const weak = [];
    for (let i = 0; i < names.length; i++) {
      const ids = this.idSet(names[i]);
      const tier = ids.size ? this._tier(names[i], category) : null;
      if (tier) {
        const entry = { table: names[i], coverage: this.coverage(names[i], category).table, rows: ids.size, weak: tier === "weak" };
        (tier === "strong" ? strong : weak).push(entry);
      }
      if (i % 40 === 39) {
        onProgress?.(i + 1, names.length);
        await YIELD();
      }
    }
    // 행 수가 카테고리 크기에 가까운 테이블을 앞에 둡니다. (작은 카테고리는 큰 테이블에 우연히 다 들어갑니다.)
    const size = this.texts.get(category)?.size ?? 1;
    const closeness = (a, b) => Math.abs(a.rows - size) - Math.abs(b.rows - size);
    return (strong.length ? strong : weak).sort(closeness);
  }

  // ---------- 역참조 ----------

  /** targetTable의 id를 가리키는 (테이블, 컬럼) 쌍. 사전의 refs를 모든 컬럼에 적용해 얻습니다. */
  refSources(targetTable) {
    const out = [];
    for (const name of this.db.tableNames) {
      this.db.table(name).columns.forEach((column, index) => {
        if (this.refTarget(name, column.name) === targetTable && !(name === targetTable && column.name === "id")) {
          out.push({ table: name, column: column.name, index });
        }
      });
    }
    return out;
  }

  _countsFor(table, index) {
    const key = `${table}:${index}`;
    let counts = this._refCounts.get(key);
    if (!counts) {
      counts = new Map();
      for (const value of this.db.scanColumn(table, index).values) if (typeof value === "number") counts.set(value, (counts.get(value) ?? 0) + 1);
      this._refCounts.set(key, counts);
    }
    return counts;
  }

  /**
   * "이 행을 가리키는 곳"을 찾습니다. 첫 호출은 관련 테이블의 해당 컬럼을 모두 훑어 몇 초 걸릴 수 있고(진행률 제공),
   * 같은 대상 테이블에 대한 두 번째 호출부터는 캐시로 즉시 끝납니다.
   * @returns {Promise<{table:string, column:string, count:number}[]>} 개수가 많은 순
   */
  async findReferences(targetTable, id, { onProgress } = {}) {
    const sources = this.refSources(targetTable);
    const found = [];
    for (let i = 0; i < sources.length; i++) {
      const { table, column, index } = sources[i];
      const count = this._countsFor(table, index).get(id) ?? 0;
      if (count > 0) found.push({ table, column, count });
      onProgress?.(i + 1, sources.length);
      if (i % 4 === 3) await YIELD();
    }
    return found.sort((a, b) => b.count - a.count || a.table.localeCompare(b.table));
  }
}

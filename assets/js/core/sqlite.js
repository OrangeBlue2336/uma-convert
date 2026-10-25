// SQLite 3 파일(우마무스메의 master.mdb)을 읽기 전용으로 해석합니다.
//
// 왜 직접 만들었나: 이 프로젝트는 의존성(npm, WASM)을 들이지 않는 것이 원칙이라 sql.js 같은 라이브러리를
// 쓸 수 없습니다. 대신 master.mdb가 쓰는 범위(일반 rowid 테이블, UTF-8, WAL 아님)만 정확히 읽는
// 작은 해석기를 둡니다. 쓸 수 있는 것: 테이블 목록/스키마, 행 수, 행 전체 읽기, rowid로 한 행 찾기.
// 못 하는 것: SQL 실행, 인덱스 이용, WITHOUT ROWID 테이블, UTF-16 파일 (만나면 안내 오류).
//
// 이 파일은 화면(DOM)을 모릅니다. tests/mdb-cli.mjs가 Node에서 똑같이 돌려 Python sqlite3와 비교합니다.

import { ConvertError } from "./errors.js";

const MAGIC = "SQLite format 3\0";
const utf8 = new TextDecoder("utf-8");

// ---------- 바이트 읽기 도우미 ----------

// 가변 길이 정수(varint). 읽은 길이는 VLEN에 남겨 객체를 새로 만들지 않습니다(행 수십만 개를 읽기 때문).
// 9번째 바이트는 8비트를 모두 씁니다. 2^53을 넘는 값은 정밀도를 잃지만 크기/rowid/직렬 형식에는 충분합니다.
let VLEN = 0;
function readVarint(buf, pos) {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const byte = buf[pos + i];
    value = value * 128 + (byte & 0x7f);
    if (byte < 0x80) {
      VLEN = i + 1;
      return value;
    }
  }
  VLEN = 9;
  return value * 256 + buf[pos + 8];
}

function corrupt(detail) {
  return new ConvertError(`SQLite 파일이 손상되었거나 지원하지 않는 구조입니다: ${detail}`, "error.sqlite.corrupt", { detail });
}

/** 파일 머리글만 보고 SQLite 파일인지 판별합니다. (.mdb라는 이름은 믿지 않습니다.) */
export function isSqlite(bytes) {
  if (bytes.length < 100) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

// 직렬 형식(serial type)별 값 크기. 12 이상은 짝수=BLOB, 홀수=TEXT이고 길이는 (N-12)/2의 내림입니다.
function serialSize(type) {
  if (type < 12) return type === 5 ? 6 : type === 6 || type === 7 ? 8 : type >= 1 && type <= 4 ? type : 0;
  return Math.floor((type - 12) / 2);
}

function readValue(buf, pos, type) {
  switch (type) {
    case 0: return null;
    case 1: return (buf[pos] << 24) >> 24;
    case 2: return ((buf[pos] << 8) | buf[pos + 1]) << 16 >> 16;
    case 3: return ((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) << 8 >> 8;
    case 4: return (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    case 5: {
      const hi = ((buf[pos] << 8) | buf[pos + 1]) << 16 >> 16;
      // >>> 0은 + 보다 우선순위가 낮아서, 아래 하위 32비트를 반드시 괄호로 감싸 부호 없는 값으로 만든 뒤 더합니다.
      return hi * 4294967296 + (((buf[pos + 2] << 24) | (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5]) >>> 0);
    }
    case 6: {
      const hi = (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
      const lo = ((buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7]) >>> 0;
      // 2^53 안이면 보통 숫자로, 넘으면 정밀도를 잃지 않도록 BigInt로 돌려줍니다.
      if (hi >= -2097152 && hi < 2097152) return hi * 4294967296 + lo;
      return (BigInt(hi) << 32n) | BigInt(lo);
    }
    case 7: return new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0);
    case 8: return 0;
    case 9: return 1;
    default: {
      if (type < 12) throw corrupt(`알 수 없는 직렬 형식 ${type}`);
      const size = Math.floor((type - 12) / 2);
      const slice = buf.subarray(pos, pos + size);
      return type % 2 === 0 ? slice : utf8.decode(slice);
    }
  }
}

// ---------- CREATE TABLE 해석 ----------

function unquote(token) {
  const q = token[0];
  if (q === "'" || q === '"' || q === "`") return token.slice(1, -1).replaceAll(q + q, q);
  if (q === "[") return token.slice(1, -1);
  return token;
}

/** 최상위 쉼표로만 나눕니다. 괄호와 따옴표 안의 쉼표는 무시합니다. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") quote = "]";
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const IDENT = String.raw`'(?:[^']|'')*'|"(?:[^"]|"")*"|` + "`(?:[^`]|``)*`" + String.raw`|\[[^\]]*\]|[^\s,()]+`;
const CONSTRAINT_WORDS = /^(NOT|NULL|PRIMARY|DEFAULT|UNIQUE|CHECK|REFERENCES|COLLATE|GENERATED|AS|CONSTRAINT)$/i;

/**
 * CREATE TABLE 문에서 컬럼(이름, 선언 타입, 기본값), 기본키, rowid 별칭을 뽑습니다.
 * rowid 별칭: 기본키가 컬럼 하나이고 선언 타입이 정확히 INTEGER이면 그 컬럼은 레코드에 NULL로 저장되고
 * 실제 값은 rowid입니다. 이걸 놓치면 id 열이 전부 비어 보입니다.
 */
export function parseCreateTable(sql) {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < open) throw corrupt("CREATE TABLE 문을 해석하지 못했습니다");
  const tail = sql.slice(close + 1);
  const columns = [];
  let tablePk = null;

  for (const part of splitTopLevel(sql.slice(open + 1, close))) {
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(part)) {
      const match = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part);
      if (match) tablePk = splitTopLevel(match[1]).map((name) => unquote(name.trim().split(/\s+/)[0]));
      continue;
    }
    const nameMatch = new RegExp(`^(${IDENT})\\s*`).exec(part);
    if (!nameMatch) continue;
    const rest = part.slice(nameMatch[0].length);
    const typeWords = [];
    for (const word of rest.split(/\s+/).filter(Boolean)) {
      if (CONSTRAINT_WORDS.test(word)) break;
      typeWords.push(word);
    }
    const defaultMatch = /\bDEFAULT\s+('(?:[^']|'')*'|-?\d+(?:\.\d+)?|NULL)/i.exec(rest);
    let defaultValue = null;
    if (defaultMatch) {
      const raw = defaultMatch[1];
      defaultValue = raw[0] === "'" ? raw.slice(1, -1).replaceAll("''", "'") : /^null$/i.test(raw) ? null : Number(raw);
    }
    columns.push({
      name: unquote(nameMatch[1]),
      type: typeWords.join(" ").toUpperCase(),
      pk: /\bPRIMARY\s+KEY\b/i.test(rest),
      default: defaultValue,
    });
  }

  if (tablePk) for (const col of columns) col.pk = tablePk.includes(col.name);
  const pk = columns.flatMap((col, index) => (col.pk ? [index] : []));
  // 기본키 순서는 선언 순서가 아니라 PRIMARY KEY(...) 안의 순서가 맞습니다.
  if (tablePk) pk.sort((a, b) => tablePk.indexOf(columns[a].name) - tablePk.indexOf(columns[b].name));
  const rowidAlias = pk.length === 1 && columns[pk[0]].type === "INTEGER" ? pk[0] : -1;
  return { columns, pk, rowidAlias, withoutRowid: /WITHOUT\s+ROWID/i.test(tail) };
}

// ---------- 데이터베이스 ----------

const YIELD = () => new Promise((resolve) => setTimeout(resolve, 0));

export class SqliteDb {
  /** @param {Uint8Array | ArrayBuffer} input 파일 전체 */
  constructor(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isSqlite(bytes)) {
      const head = Array.from(bytes.subarray(0, 16), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
      throw new ConvertError(`SQLite 파일이 아닙니다. 파일 머리글: "${head}". 암호화되었거나 다른 종류의 파일일 수 있습니다.`, "error.sqlite.notSqlite", { head });
    }
    this.bytes = bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pageSize = view.getUint16(16);
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) throw corrupt(`페이지 크기 ${pageSize}`);
    const encoding = view.getUint32(56);
    if (encoding > 1) throw new ConvertError("UTF-16으로 저장된 SQLite 파일은 지원하지 않습니다.", "error.sqlite.encoding");
    this.pageSize = pageSize;
    this.usable = pageSize - bytes[20]; // 페이지 끝의 예약 영역을 뺀 실제 사용 크기
    // 머리글의 페이지 수는 오래된 값일 수 있어 파일 크기로 셉니다.
    this.pageCount = Math.floor(bytes.length / pageSize);
    // 로컬 페이로드 한도. 이 값을 넘는 행은 일부가 "오버플로 페이지"에 이어집니다. (SQLite 파일 형식 문서 참고)
    this.maxLocal = this.usable - 35;
    this.minLocal = Math.floor(((this.usable - 12) * 32) / 255) - 23;

    this.tables = new Map();
    this._leafCache = new Map();
    this._loadSchema();
  }

  // ----- 페이지 수준 -----

  _page(no) {
    if (no < 1 || no > this.pageCount) throw corrupt(`페이지 번호 ${no} 범위 밖`);
    return (no - 1) * this.pageSize;
  }

  /** 페이지의 B-tree 머리글: 종류, 셀 수, 셀 포인터 배열 시작 위치. */
  _header(no) {
    const start = this._page(no);
    const base = start + (no === 1 ? 100 : 0);
    const type = this.bytes[base];
    const cells = (this.bytes[base + 3] << 8) | this.bytes[base + 4];
    const interior = type === 0x05 || type === 0x02;
    return { start, base, type, cells, pointers: base + (interior ? 12 : 8) };
  }

  _cellOffset(h, i) {
    const at = h.pointers + i * 2;
    return h.start + ((this.bytes[at] << 8) | this.bytes[at + 1]);
  }

  _u32(pos) {
    const b = this.bytes;
    return ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
  }

  /** 테이블 B-tree의 리프 페이지 번호를 rowid 순서대로 모읍니다. (본문은 읽지 않아 빠릅니다.) */
  _leafPages(root) {
    const cached = this._leafCache.get(root);
    if (cached) return cached;
    const leaves = [];
    const walk = (no, depth) => {
      if (depth > 40) throw corrupt("B-tree가 너무 깊습니다");
      const h = this._header(no);
      if (h.type === 0x0d) {
        leaves.push(no);
      } else if (h.type === 0x05) {
        for (let i = 0; i < h.cells; i++) walk(this._u32(this._cellOffset(h, i)), depth + 1);
        walk(this._u32(h.base + 8), depth + 1);
      } else {
        throw corrupt(`테이블 페이지가 아닙니다(종류 0x${h.type.toString(16)})`);
      }
    };
    walk(root, 0);
    this._leafCache.set(root, leaves);
    return leaves;
  }

  /** 리프 셀 하나의 페이로드를 꺼냅니다. 오버플로가 있으면 이어 붙여 하나의 배열로 돌려줍니다. */
  _readCell(h, i) {
    let pos = this._cellOffset(h, i);
    const total = readVarint(this.bytes, pos);
    pos += VLEN;
    const rowid = readVarint(this.bytes, pos);
    pos += VLEN;
    let local = total;
    if (total > this.maxLocal) {
      const k = this.minLocal + ((total - this.minLocal) % (this.usable - 4));
      local = k <= this.maxLocal ? k : this.minLocal;
    }
    if (local === total) return { rowid, payload: this.bytes.subarray(pos, pos + total) };

    const payload = new Uint8Array(total);
    payload.set(this.bytes.subarray(pos, pos + local));
    let filled = local;
    let next = this._u32(pos + local);
    while (filled < total) {
      if (next === 0) throw corrupt("오버플로 페이지 사슬이 중간에 끝났습니다");
      const at = this._page(next);
      const chunk = Math.min(this.usable - 4, total - filled);
      payload.set(this.bytes.subarray(at + 4, at + 4 + chunk), filled);
      filled += chunk;
      next = this._u32(at);
    }
    return { rowid, payload };
  }

  // ----- 레코드 해석 -----

  /**
   * 레코드 하나를 값 배열로 바꿉니다.
   * @param wanted 오름차순 컬럼 번호 배열. null이면 전부. 원하는 컬럼까지만 읽고 멈춥니다.
   */
  _decode(table, payload, rowid, wanted) {
    const columns = table.columns;
    const headerEnd = readVarint(payload, 0);
    let hp = VLEN;
    let dp = headerEnd;
    const out = [];
    const target = wanted ? wanted.length : columns.length;
    let w = 0;
    for (let c = 0; c < columns.length && out.length < target; c++) {
      const want = !wanted || wanted[w] === c;
      let value = null;
      if (hp < headerEnd) {
        const type = readVarint(payload, hp);
        hp += VLEN;
        const size = serialSize(type);
        if (want) {
          if (dp + size > payload.length) throw corrupt("레코드가 잘렸습니다");
          value = readValue(payload, dp, type);
        }
        dp += size;
      } else if (want) {
        // ALTER TABLE ADD COLUMN으로 늘어난 컬럼은 옛 행에 값이 없고, 스키마의 DEFAULT를 대신 씁니다.
        value = columns[c].default;
      }
      if (want) {
        out.push(c === table.rowidAlias ? rowid : value);
        w++;
      }
    }
    return out;
  }

  // ----- 스키마 -----

  _loadSchema() {
    const master = { columns: ["type", "name", "tbl_name", "rootpage", "sql"].map((name) => ({ name, default: null })), rowidAlias: -1 };
    for (const page of this._leafPages(1)) {
      const h = this._header(page);
      for (let i = 0; i < h.cells; i++) {
        const { rowid, payload } = this._readCell(h, i);
        const [type, name, , rootpage, sql] = this._decode(master, payload, rowid, null);
        if (type !== "table" || !sql) continue;
        const parsed = parseCreateTable(sql);
        this.tables.set(name, { name, rootPage: rootpage, sql, internal: name.startsWith("sqlite_"), ...parsed });
      }
    }
  }

  /** 사용자 테이블 이름 목록 (sqlite_ 내부 테이블 제외, 이름순). */
  get tableNames() {
    return [...this.tables.values()].filter((t) => !t.internal).map((t) => t.name).sort();
  }

  table(name) {
    return this.tables.get(name);
  }

  columnIndex(tableName, columnName) {
    return this.tables.get(tableName)?.columns.findIndex((col) => col.name === columnName) ?? -1;
  }

  _need(name) {
    const table = this.tables.get(name);
    if (!table) throw new ConvertError(`테이블 "${name}"이(가) 없습니다.`, "error.sqlite.noTable", { name });
    if (table.withoutRowid) throw new ConvertError(`테이블 "${name}"은(는) WITHOUT ROWID라 지원하지 않습니다.`, "error.sqlite.withoutRowid", { name });
    return table;
  }

  // ----- 읽기 -----

  /** 행 수. 리프 페이지의 셀 수만 더하므로 본문을 해석하지 않아 매우 빠릅니다. */
  countRows(name) {
    let count = 0;
    for (const page of this._leafPages(this._need(name).rootPage)) count += this._header(page).cells;
    return count;
  }

  /** 리프 셀을 순서대로 훑습니다: fn(rowid, payload). 해석 없이 바이트만 필요한 비교(diff)용입니다. */
  forEachPayload(name, fn) {
    for (const page of this._leafPages(this._need(name).rootPage)) {
      const h = this._header(page);
      for (let i = 0; i < h.cells; i++) {
        const cell = this._readCell(h, i);
        fn(cell.rowid, cell.payload);
      }
    }
  }

  /** payload 하나를 값 배열로 해석합니다. forEachPayload와 짝입니다. */
  decodePayload(name, payload, rowid, columns = null) {
    return this._decode(this._need(name), payload, rowid, columns && [...columns].sort((a, b) => a - b));
  }

  /**
   * 테이블의 행을 읽습니다. 20,000행쯤마다 화면이 멈추지 않도록 잠깐 양보합니다.
   * @param {{ columns?: number[], onProgress?: (done:number,total:number)=>void }} [options]
   *   columns: 필요한 컬럼 번호(없으면 전부). 결과의 각 행은 오름차순으로 정렬된 이 컬럼들의 값입니다.
   * @returns {Promise<{ columns: number[], rowids: number[], rows: any[][] }>}
   */
  async readTable(name, options = {}) {
    const table = this._need(name);
    const wanted = options.columns ? [...new Set(options.columns)].sort((a, b) => a - b) : null;
    const columns = wanted ?? table.columns.map((_, i) => i);
    const pages = this._leafPages(table.rootPage);
    const total = this.countRows(name);
    const rowids = [];
    const rows = [];
    let sinceYield = 0;
    for (const page of pages) {
      const h = this._header(page);
      for (let i = 0; i < h.cells; i++) {
        const { rowid, payload } = this._readCell(h, i);
        rowids.push(rowid);
        rows.push(this._decode(table, payload, rowid, wanted));
      }
      sinceYield += h.cells;
      if (sinceYield >= 20000) {
        sinceYield = 0;
        options.onProgress?.(rows.length, total);
        await YIELD();
      }
    }
    options.onProgress?.(rows.length, total);
    return { columns, rowids, rows };
  }

  /**
   * 컬럼 하나만 동기식으로 읽습니다. id 집합이나 "이 값을 쓰는 행 수" 같은 보조 색인을 만들 때 씁니다.
   * 원하는 컬럼까지만 해석하고 멈추기 때문에 모든 컬럼을 읽는 readTable보다 훨씬 빠릅니다.
   * @returns {{ rowids: number[], values: any[] }}
   */
  scanColumn(name, columnIndex) {
    const table = this._need(name);
    const wanted = [columnIndex];
    const rowids = [];
    const values = [];
    for (const page of this._leafPages(table.rootPage)) {
      const h = this._header(page);
      for (let i = 0; i < h.cells; i++) {
        const { rowid, payload } = this._readCell(h, i);
        rowids.push(rowid);
        values.push(this._decode(table, payload, rowid, wanted)[0]);
      }
    }
    return { rowids, values };
  }

  /** 모든 rowid만 (본문 해석 없이). rowid 별칭 id 테이블의 id 목록을 거의 공짜로 얻습니다. */
  rowids(name) {
    const out = [];
    for (const page of this._leafPages(this._need(name).rootPage)) {
      const h = this._header(page);
      for (let i = 0; i < h.cells; i++) {
        let pos = this._cellOffset(h, i);
        readVarint(this.bytes, pos);
        pos += VLEN;
        out.push(readVarint(this.bytes, pos));
      }
    }
    return out;
  }

  /** rowid로 한 행을 B-tree 탐색으로 바로 찾습니다. 없으면 null. */
  getRow(name, rowid, columns = null) {
    const table = this._need(name);
    let no = table.rootPage;
    for (let depth = 0; depth < 40; depth++) {
      const h = this._header(no);
      if (h.type === 0x05) {
        // 안쪽 페이지의 키는 "왼쪽 하위 트리의 가장 큰 rowid"입니다. 이진 탐색으로 처음으로 키 >= rowid인 셀을 고릅니다.
        let lo = 0;
        let hi = h.cells;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const pos = this._cellOffset(h, mid) + 4;
          if (readVarint(this.bytes, pos) >= rowid) hi = mid;
          else lo = mid + 1;
        }
        no = lo < h.cells ? this._u32(this._cellOffset(h, lo)) : this._u32(h.base + 8);
      } else if (h.type === 0x0d) {
        let lo = 0;
        let hi = h.cells - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          let pos = this._cellOffset(h, mid);
          readVarint(this.bytes, pos);
          pos += VLEN;
          const key = readVarint(this.bytes, pos);
          if (key === rowid) {
            const cell = this._readCell(h, mid);
            return this._decode(table, cell.payload, cell.rowid, columns && [...columns].sort((a, b) => a - b));
          }
          if (key < rowid) lo = mid + 1;
          else hi = mid - 1;
        }
        return null;
      } else {
        throw corrupt(`테이블 페이지가 아닙니다(종류 0x${h.type.toString(16)})`);
      }
    }
    throw corrupt("B-tree가 너무 깊습니다");
  }
}

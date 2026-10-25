// 웹페이지 없이 master.mdb 코어(core/sqlite.js, core/mdb*.js)만 실행해 보는 명령줄 도구입니다. (Node.js 18 이상)
//
//   node tests/mdb-cli.mjs info   <master.mdb>                       테이블 목록과 행 수
//   node tests/mdb-cli.mjs dump   <master.mdb> <테이블> [JSON 파일]   테이블을 JSON으로 저장(없으면 앞 5행 출력)
//   node tests/mdb-cli.mjs verify <master.mdb>                       모든 테이블의 "행 수<TAB>내용 해시"를 출력
//   node tests/mdb-cli.mjs search <master.mdb> <검색어>               text_data 검색 + 이 항목이 속한 테이블/행
//   node tests/mdb-cli.mjs domain <master.mdb> <도메인> <id>          도메인 보기의 구역별 결과 (예: skill 202711)
//   node tests/mdb-cli.mjs diff   <이전.mdb> <새.mdb>                 두 버전 비교 요약
//
// verify 출력은 AGENTS.md의 "회귀 검증 방법"에 있는 파이썬 스크립트 결과와 줄 단위로 같아야 합니다.
// 웹에서 결과가 이상할 때 같은 코어를 직접 돌려 보면 원인이 화면인지 해석인지 구분할 수 있습니다.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { SqliteDb } from "../assets/js/core/sqlite.js";
import { MdbCatalog } from "../assets/js/core/mdbMeaning.js";
import { diffDatabases } from "../assets/js/core/mdbDiff.js";
import { availableDomains, buildEntity } from "../assets/js/core/mdbDomains.js";

const [command, ...args] = process.argv.slice(2);

async function openDb(path) {
  return new SqliteDb(new Uint8Array(await readFile(path)));
}

async function openCatalog(path) {
  const db = await openDb(path);
  const map = JSON.parse(await readFile(new URL("../assets/data/mdb-map.json", import.meta.url), "utf8"));
  const catalog = new MdbCatalog(db, map);
  await catalog.load();
  return catalog;
}

// 값을 타입 표시와 함께 글자로 만듭니다. 파이썬 쪽도 똑같이 만들어야 해시가 맞습니다.
function canonical(value) {
  if (value === null) return "N";
  if (value instanceof Uint8Array) return "b" + Buffer.from(value).toString("hex");
  if (typeof value === "bigint") return "i" + value.toString();
  if (typeof value === "number") return Number.isInteger(value) ? "i" + value : "f" + value;
  return "t" + value;
}

const printable = (value) => (value instanceof Uint8Array ? `<blob ${value.length}B>` : typeof value === "bigint" ? value.toString() : value);

if (command === "info") {
  const db = await openDb(args[0]);
  console.log(`페이지 ${db.pageSize}B × ${db.pageCount}, 테이블 ${db.tableNames.length}개`);
  for (const name of db.tableNames) console.log(`${db.countRows(name)}\t${name}`);
} else if (command === "dump") {
  const db = await openDb(args[0]);
  const { rows } = await db.readTable(args[1]);
  const names = db.table(args[1]).columns.map((c) => c.name);
  const objects = rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], printable(v)])));
  if (args[2]) {
    await writeFile(args[2], JSON.stringify(objects));
    console.log(`${objects.length}행을 ${args[2]}에 저장했습니다.`);
  } else {
    for (const row of objects.slice(0, 5)) console.log(JSON.stringify(row));
  }
} else if (command === "verify") {
  const db = await openDb(args[0]);
  for (const name of db.tableNames) {
    const { rows } = await db.readTable(name);
    const hash = createHash("sha256");
    for (const row of rows) hash.update(row.map(canonical).join("\x1f") + "\n");
    console.log(`${name}\t${rows.length}\t${hash.digest("hex")}`);
  }
} else if (command === "search") {
  const catalog = await openCatalog(args[0]);
  const { total, hits } = catalog.searchTexts(args[1], { limit: 15 });
  console.log(`text_data에서 ${total}건`);
  for (const hit of hits) {
    const owner = catalog.categoryOwner(hit.category);
    console.log(`[${hit.category}/${hit.index}] ${hit.text.replace(/\n/g, " ↵ ").slice(0, 60)}  ${owner ? `→ ${owner.table}#${hit.index} (${owner.role})` : "(소유 테이블 미확정)"}`);
  }
} else if (command === "domain") {
  const catalog = await openCatalog(args[0]);
  const domain = availableDomains(catalog).find((d) => d.id === args[1]);
  if (!domain) {
    console.error(`도메인 "${args[1]}"이(가) 없습니다. 사용 가능: ${availableDomains(catalog).map((d) => d.id).join(", ")}`);
    process.exit(1);
  }
  const found = catalog.rowById(domain.table, Number(args[2]));
  if (!found) {
    console.error(`${domain.table}에 id ${args[2]}이(가) 없습니다.`);
    process.exit(1);
  }
  const entity = buildEntity(catalog, domain, found.rowid);
  console.log(`${domain.id} ${entity.id} · ${entity.name ?? "(이름 없음)"}`);
  console.log(`텍스트: 확정 ${entity.texts.curated.length}, 추정 ${entity.texts.auto.length}, 약한 추정 ${entity.texts.weak.length}`);
  for (const section of entity.sections) {
    console.log(`\n[${section.id}] ${section.table} ${section.rows.length}행${section.truncated ? ` (전체 ${section.total})` : ""}`);
    for (const row of section.rows.slice(0, 12)) console.log("  " + row.cells.map((v) => (v === null ? "" : String(v).replace(/\n/g, " ↵ "))).join(" | "));
  }
} else if (command === "diff") {
  const [oldDb, newDb] = [await openDb(args[0]), await openDb(args[1])];
  const result = await diffDatabases(oldDb, newDb, {});
  console.log(`추가 테이블 ${result.addedTables.length}, 삭제 테이블 ${result.removedTables.length}, 바뀐 테이블 ${result.tables.filter((t) => t.status === "changed").length}`);
  for (const t of result.tables.filter((t) => t.status === "changed").sort((a, b) => b.total - a.total).slice(0, 25)) {
    console.log(`${t.name}\t+${t.added.length} -${t.removed.length} ~${t.changed.length}${t.schema.changed ? "  (스키마 변경)" : ""}`);
  }
} else {
  console.error("사용법: node tests/mdb-cli.mjs <info|dump|verify|search|domain|diff> ... (파일 머리말 주석 참고)");
  process.exit(1);
}

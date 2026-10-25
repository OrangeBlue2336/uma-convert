// master.mdb 탐색기 페이지: 파일 열기와 각 화면(테이블, 검색, 도메인, 버전 비교, 행 상세)을 하나로 연결합니다.
// 실제 해석은 core/(sqlite.js, mdbMeaning.js, mdbDomains.js, mdbDiff.js)가, 화면 조각은 이 폴더의 파일들이 맡습니다.
// 파일은 이 컴퓨터(브라우저) 안에서만 처리되고 어디로도 전송되지 않습니다.

import { SqliteDb } from "../core/sqlite.js";
import { MdbCatalog } from "../core/mdbMeaning.js";
import { ConvertError } from "../core/errors.js";
import { createTabs } from "../ui/tabs.js";
import { initI18n, t } from "../i18n/index.js";
import { loadUserLabels } from "./labels.js";
import { createDrawer } from "./drawer.js";
import { createTableView } from "./tableView.js";
import { createSearchView } from "./searchView.js";
import { createDomainView } from "./domainView.js";
import { createDiffView } from "./diffView.js";

await initI18n();

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("file-input");
const statusEl = $("status");
const summaryEl = $("open-summary");

/** 화면 조각들이 함께 쓰는 상태와 이동 함수 모음 */
const app = {
  db: null,
  catalog: null,
  map: {},
  fileName: "",
  userLabels: loadUserLabels(),
  tabs: createTabs(),
  labelDialog: $("label-dialog"),
  errorText(error) {
    if (error instanceof ConvertError) return t(error.key ?? "", error.values ?? {}, error.message);
    console.error(error);
    return t("mdb.error.unexpected", { message: error?.message ?? String(error) });
  },
  /** (테이블, id)의 행을 상세 서랍으로 엽니다. 다른 화면의 링크가 모두 이 함수를 씁니다. */
  openId(table, id) {
    const found = app.catalog.rowById(table, id);
    if (found) app.drawer.show(table, found.rowid);
  },
  openTable: (name, options) => tableView.openTable(name, options),
  openDomain: (domainId, rowid) => domainView.select(domainId, rowid),
};

app.drawer = createDrawer(app);
const tableView = createTableView(app);
const searchView = createSearchView(app);
const domainView = createDomainView(app);
const diffView = createDiffView(app);

// 사람이 확정한 매핑 사전. 못 불러와도 표 탐색은 되지만 이름/링크 풀이가 빠지므로 알려 줍니다.
let mapMissing = false;
try {
  const response = await fetch(new URL("../../data/mdb-map.json", import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  app.map = await response.json();
} catch (error) {
  console.warn("매핑 사전을 불러오지 못했습니다.", error);
  mapMissing = true;
}

for (const id of ["tab-tables", "tab-search", "tab-domains", "tab-diff"]) app.tabs.setEnabled(id, false);

let opening = 0;

async function openFile(file, note = "") {
  const mine = ++opening;
  statusEl.classList.remove("is-error");
  summaryEl.replaceChildren();
  statusEl.textContent = t("mdb.open.reading", { name: file.name });
  try {
    const db = new SqliteDb(new Uint8Array(await file.arrayBuffer()));
    const catalog = new MdbCatalog(db, app.map, app.userLabels);
    statusEl.textContent = t("mdb.open.loadingTexts");
    await catalog.load();
    if (mine !== opening) return; // 읽는 도중 다른 파일을 열었으면 이 결과는 버립니다.

    app.db = db;
    app.catalog = catalog;
    app.fileName = file.name;
    app.drawer.close();
    tableView.reset();
    tableView.buildList();
    searchView.reset();
    domainView.reset();
    diffView.reset();
    for (const id of ["tab-tables", "tab-search", "tab-domains", "tab-diff"]) app.tabs.setEnabled(id, true);

    statusEl.textContent = note;
    const facts = [
      t("mdb.open.factFile", { name: file.name, size: (file.size / 1048576).toFixed(1) }),
      t("mdb.open.factTables", { n: db.tableNames.length }),
      catalog.hasTexts ? t("mdb.open.factTexts", { n: catalog.textRows.length.toLocaleString(), categories: catalog.texts.size }) : t("mdb.open.noTexts"),
    ];
    for (const text of facts) {
      const li = document.createElement("li");
      li.textContent = text;
      summaryEl.append(li);
    }
    if (mapMissing) {
      const li = document.createElement("li");
      li.textContent = t("mdb.open.mapMissing");
      summaryEl.append(li);
    }
    app.tabs.show("tab-tables");
  } catch (error) {
    if (mine !== opening) return;
    statusEl.classList.add("is-error");
    statusEl.textContent = app.errorText(error);
  }
}

// ---------- 끌어놓기 / 파일 선택 ----------

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // 같은 파일을 다시 골라도 동작하도록 비웁니다.
  if (file) openFile(file);
});

const hasFiles = (event) => event.dataTransfer?.types?.includes("Files");

// 페이지 어디에 놓아도 열리게 하고, 실수로 파일이 브라우저에서 열리는 것을 막습니다.
window.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropzone.classList.remove("is-over");
  const files = event.dataTransfer.files;
  if (files.length > 0) openFile(files[0], files.length > 1 ? t("common.firstFile") : "");
});

let dragDepth = 0;
dropzone.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  dragDepth++;
  dropzone.classList.add("is-over");
});
dropzone.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove("is-over");
});
dropzone.addEventListener("drop", () => {
  dragDepth = 0;
});

// 테이블 탐색기: 왼쪽에 테이블 목록, 오른쪽에 표(필터, 정렬, 페이지, 열 숨기기, 내보내기)를 보여 줍니다.
//
// 테이블을 열면 전체 행을 한 번에 메모리로 읽습니다(가장 큰 테이블도 약 10만 행, 0.2초 안팎).
// 필터와 정렬은 그 메모리 위에서 하므로 입력할 때마다 파일을 다시 읽지 않습니다.

import { el, button } from "../ui/dom.js";
import { saveBlob, safeFileName } from "../ui/download.js";
import { toCsv } from "../encode/csv.js";
import { detectEpochColumns, formatEpoch, gameText } from "../core/mdbMeaning.js";
import { cellNode } from "./cell.js";
import { openLabelEditor, LABEL_MAX_VALUES } from "./labels.js";
import { t } from "../i18n/index.js";

const NAME_KEY = "@name";

export function createTableView(app) {
  const $ = (id) => document.getElementById(id);
  const listEl = $("table-list");
  const listFilter = $("table-filter");
  const statusEl = $("table-status");
  const viewer = $("table-viewer");
  const titleEl = $("table-title");
  const infoEl = $("table-info");
  const headEl = $("grid-head");
  const bodyEl = $("grid-body");
  const pagerEl = $("pager");
  const pageSizeEl = $("page-size");
  const globalFilter = $("global-filter");
  const colMenu = $("col-menu-list");
  const exportDisplay = $("export-display");

  let counts = new Map();
  /** @type {null | object} 지금 열린 테이블의 모든 상태 */
  let view = null;
  let loadToken = 0;
  let debounce = 0;

  // ---------- 테이블 목록 ----------

  function buildList() {
    counts = new Map(app.db.tableNames.map((name) => [name, app.db.countRows(name)]));
    renderList();
  }

  function renderList() {
    const query = listFilter.value.trim().toLowerCase();
    const items = app.db.tableNames.filter((name) => name.toLowerCase().includes(query));
    listEl.replaceChildren(
      ...items.map((name) => {
        const item = el("li");
        const open = button("", () => openTable(name), "mdb-table-item");
        open.append(el("span", "mdb-table-name", name), el("span", "mdb-table-count", counts.get(name).toLocaleString()));
        if (view?.name === name) open.setAttribute("aria-current", "true");
        // 이름 풀이가 있는 테이블은 표시해 둡니다(도메인 보기/검색의 대상이 되기 때문).
        if (app.catalog.hasName(name)) open.classList.add("has-name");
        item.append(open);
        return item;
      }),
    );
    $("table-list-count").textContent = t("mdb.tables.count", { shown: items.length, total: counts.size });
  }

  listFilter.addEventListener("input", renderList);

  // ---------- 열기 ----------

  /**
   * @param {{ focusRowid?: number, filters?: Record<string,string> }} [options]
   *   focusRowid: 열자마자 이 행이 보이는 페이지로 이동해 강조합니다.
   *   filters: { 컬럼이름: "=값" } 형태의 열 필터를 미리 걸어 둡니다("이 값을 가리키는 행 보기" 용도).
   */
  async function openTable(name, { focusRowid = null, filters = null } = {}) {
    const token = ++loadToken;
    app.tabs.show("tab-tables");
    statusEl.classList.remove("is-error");
    statusEl.textContent = t("mdb.tables.loading", { name });
    let data;
    try {
      data = await app.db.readTable(name, {
        onProgress: (done, total) => {
          statusEl.textContent = t("mdb.tables.loadingProgress", { name, done: done.toLocaleString(), total: total.toLocaleString() });
        },
      });
    } catch (error) {
      statusEl.classList.add("is-error");
      statusEl.textContent = app.errorText(error);
      return;
    }
    if (token !== loadToken) return; // 읽는 도중 다른 테이블을 눌렀으면 이 결과는 버립니다.
    statusEl.textContent = "";

    const table = app.db.table(name);
    const columns = table.columns;
    const epochIdx = detectEpochColumns(columns, data.rows);
    const idIndex = app.catalog.idColumn(name);
    const hasName = app.catalog.hasName(name) && idIndex >= 0;
    const targets = columns.map((column) => app.catalog.refTarget(name, column.name));
    view = {
      name,
      table,
      columns,
      rows: data.rows,
      rowids: data.rowids,
      epoch: new Set([...epochIdx].map((i) => columns[i].name)),
      targets,
      idIndex,
      hasName,
      keys: [...(hasName ? [NAME_KEY] : []), ...columns.map((_, i) => String(i))],
      hidden: new Set(),
      filters: new Map(),
      global: "",
      sort: null,
      order: [],
      page: 0,
      pageSize: Number(pageSizeEl.value),
      focusRowid,
      distinct: columns.map((column, i) => labelValues(column, i, i === idIndex || targets[i] !== null, data.rows, epochIdx)),
    };
    if (filters) for (const [column, text] of Object.entries(filters)) {
      const index = columns.findIndex((c) => c.name === column);
      if (index >= 0) view.filters.set(String(index), text);
    }
    globalFilter.value = "";

    viewer.hidden = false;
    renderList();
    titleEl.textContent = name;
    buildHead();
    buildColumnMenu();
    recompute();
    if (focusRowid !== null) focusRow(focusRowid);
    renderBody();
  }

  /** 값 라벨을 붙일 수 있는 컬럼이면 값 목록(오름차순)을, 아니면 null. */
  function labelValues(column, index, isKeyLike, rows, epochIdx) {
    // id, 기본키, 시간, 다른 테이블을 가리키는 컬럼에는 라벨 대신 이름/날짜/링크 풀이가 맞습니다.
    if (isKeyLike || column.pk || epochIdx.has(index)) return null;
    const seen = new Set();
    for (const row of rows) {
      const value = row[index];
      if (typeof value !== "number") return null;
      seen.add(value);
      if (seen.size > LABEL_MAX_VALUES) return null;
    }
    return seen.size ? [...seen].sort((a, b) => a - b) : null;
  }

  // ---------- 필터와 정렬 ----------

  const nameAt = (i) => app.catalog.nameOf(view.name, view.rows[i][view.idIndex]) ?? "";

  /** 필터가 비교하는 글자: 값 자체 + (이름 | 라벨 | 날짜). */
  function searchText(c, value) {
    if (value === null) return "";
    // 화면에는 줄바꿈으로 보이는 글자이므로, 필터도 줄바꿈 표기(백슬래시+n)가 아니라 보이는 글자 기준으로 맞춥니다.
    let text = typeof value === "string" ? gameText(value) : String(value);
    if (typeof value === "number") {
      const column = view.columns[c].name;
      if (view.epoch.has(column)) text += " " + formatEpoch(value);
      const label = app.catalog.labelFor(view.name, column, value);
      if (label) text += " " + label;
      const target = view.targets[c];
      if (target && value > 0) text += " " + (app.catalog.nameOf(target, value) ?? "");
    }
    return text.toLowerCase();
  }

  function rawAt(key, i) {
    return key === NAME_KEY ? nameAt(i) : view.rows[i][Number(key)];
  }

  /** 열 필터 문법: =값(정확히) >숫자 <숫자 !글자(제외) 글자(포함). */
  function predicate(key, raw) {
    const text = raw.trim();
    if (!text) return null;
    const value = (i) => rawAt(key, i);
    const display = (i) => (key === NAME_KEY ? nameAt(i).toLowerCase() : searchText(Number(key), value(i)));
    if (text[0] === "=") {
      const want = text.slice(1).trim().toLowerCase();
      return (i) => {
        const v = value(i);
        return (v !== null && String(v).toLowerCase() === want) || (key === NAME_KEY && nameAt(i).toLowerCase() === want);
      };
    }
    if ((text[0] === ">" || text[0] === "<") && text.slice(1).trim() !== "" && !Number.isNaN(Number(text.slice(1)))) {
      const n = Number(text.slice(1));
      return (i) => {
        const v = value(i);
        return typeof v === "number" && (text[0] === ">" ? v > n : v < n);
      };
    }
    if (text[0] === "!") {
      const needle = text.slice(1).trim().toLowerCase();
      return (i) => !display(i).includes(needle);
    }
    const needle = text.toLowerCase();
    return (i) => display(i).includes(needle);
  }

  function compare(a, b) {
    // 빈 값은 방향과 상관없이 맨 뒤로 보냅니다.
    if (a === null || a === "") return b === null || b === "" ? 0 : 1;
    if (b === null || b === "") return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "bigint" || typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
    return String(a).localeCompare(String(b));
  }

  function recompute() {
    const tests = [...view.filters].map(([key, text]) => predicate(key, text)).filter(Boolean);
    const needle = view.global.trim().toLowerCase();
    const out = [];
    for (let i = 0; i < view.rows.length; i++) {
      if (tests.length && !tests.every((test) => test(i))) continue;
      if (needle) {
        let hit = view.hasName && nameAt(i).toLowerCase().includes(needle);
        for (let c = 0; !hit && c < view.columns.length; c++) hit = searchText(c, view.rows[i][c]).includes(needle);
        if (!hit) continue;
      }
      out.push(i);
    }
    if (view.sort) {
      const { key, dir } = view.sort;
      out.sort((a, b) => {
        const x = rawAt(key, a);
        const y = rawAt(key, b);
        const empty = (v) => v === null || v === "";
        if (empty(x) || empty(y)) return compare(x, y);
        return compare(x, y) * dir;
      });
    }
    view.order = out;
    view.page = Math.min(view.page, Math.max(0, Math.ceil(out.length / view.pageSize) - 1));
  }

  function focusRow(rowid) {
    const index = view.rowids.indexOf(rowid);
    const position = view.order.indexOf(index);
    if (position >= 0) view.page = Math.floor(position / view.pageSize);
  }

  // ---------- 그리기 ----------

  const visibleKeys = () => view.keys.filter((key) => !view.hidden.has(key));
  const keyLabel = (key) => (key === NAME_KEY ? t("mdb.tables.nameColumn") : view.columns[Number(key)].name);

  function buildHead() {
    const keys = visibleKeys();
    const headRow = el("tr");
    const filterRow = el("tr", "mdb-filter-row");
    for (const key of keys) {
      const th = el("th");
      th.dataset.key = key;
      const sortButton = button("", () => toggleSort(key), "mdb-sort");
      sortButton.append(el("span", "mdb-col-name", keyLabel(key)), el("span", "mdb-sort-mark"));
      th.append(sortButton);
      const c = key === NAME_KEY ? -1 : Number(key);
      if (c >= 0) {
        const column = view.columns[c];
        th.title = `${column.name} ${column.type}${column.pk ? " · PK" : ""}`;
        if (view.distinct[c]) {
          th.append(button("⚙", () => {
            openLabelEditor(app, view.name, column.name, view.distinct[c], () => {
              buildHead();
              renderBody();
            });
          }, "mdb-gear"));
          th.lastChild.title = t("mdb.tables.editLabels");
        }
      }
      headRow.append(th);

      const filterCell = el("th");
      const input = el("input");
      input.type = "search";
      input.placeholder = t("mdb.tables.filterPlaceholder");
      input.value = view.filters.get(key) ?? "";
      input.setAttribute("aria-label", t("mdb.tables.filterOf", { column: keyLabel(key) }));
      input.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (input.value.trim()) view.filters.set(key, input.value);
          else view.filters.delete(key);
          view.page = 0;
          recompute();
          renderBody();
        }, 150);
      });
      filterCell.append(input);
      filterRow.append(filterCell);
    }
    headEl.replaceChildren(headRow, filterRow);
    updateSortMarks();
  }

  function updateSortMarks() {
    headEl.querySelectorAll("th[data-key]").forEach((th) => {
      const active = view.sort?.key === th.dataset.key;
      th.querySelector(".mdb-sort-mark").textContent = active ? (view.sort.dir === 1 ? "▲" : "▼") : "";
      th.setAttribute("aria-sort", active ? (view.sort.dir === 1 ? "ascending" : "descending") : "none");
    });
  }

  function toggleSort(key) {
    // 오름차순 -> 내림차순 -> 원래 순서(정렬 해제)
    if (view.sort?.key !== key) view.sort = { key, dir: 1 };
    else if (view.sort.dir === 1) view.sort = { key, dir: -1 };
    else view.sort = null;
    updateSortMarks();
    recompute();
    renderBody();
  }

  function renderBody() {
    const keys = visibleKeys();
    const start = view.page * view.pageSize;
    const pageIndexes = view.order.slice(start, start + view.pageSize);
    const idCtx = { epoch: view.epoch };
    const fragment = document.createDocumentFragment();
    for (const i of pageIndexes) {
      const row = view.rows[i];
      const tr = el("tr");
      tr.dataset.rowid = String(view.rowids[i]);
      tr.dataset.table = view.name;
      if (view.focusRowid === view.rowids[i]) tr.classList.add("is-focus");
      tr.addEventListener("click", () => app.drawer.show(view.name, view.rowids[i]));
      for (const key of keys) {
        const td = el("td");
        if (key === NAME_KEY) {
          td.append(el("span", "mdb-name", nameAt(i)));
        } else {
          const value = row[Number(key)];
          if (typeof value === "number") td.classList.add("mdb-num");
          td.append(cellNode(app, view.name, view.columns[Number(key)].name, value, idCtx));
        }
        tr.append(td);
      }
      fragment.append(tr);
    }
    bodyEl.replaceChildren(fragment);
    bodyEl.querySelector("tr.is-focus")?.scrollIntoView({ block: "center" });
    renderPager();
  }

  function renderPager() {
    const total = view.order.length;
    const pages = Math.max(1, Math.ceil(total / view.pageSize));
    const filtered = total !== view.rows.length;
    infoEl.textContent = filtered
      ? t("mdb.tables.infoFiltered", { shown: total.toLocaleString(), total: view.rows.length.toLocaleString(), cols: view.columns.length })
      : t("mdb.tables.info", { total: view.rows.length.toLocaleString(), cols: view.columns.length });
    const go = (page) => {
      view.page = Math.min(Math.max(0, page), pages - 1);
      view.focusRowid = null;
      renderBody();
    };
    pagerEl.replaceChildren(
      button("«", () => go(0), "btn"),
      button("‹", () => go(view.page - 1), "btn"),
      el("span", "mdb-pager-text", t("mdb.tables.page", { page: view.page + 1, pages })),
      button("›", () => go(view.page + 1), "btn"),
      button("»", () => go(pages - 1), "btn"),
    );
    pagerEl.children[0].disabled = pagerEl.children[1].disabled = view.page === 0;
    pagerEl.children[3].disabled = pagerEl.children[4].disabled = view.page >= pages - 1;
  }

  pageSizeEl.addEventListener("change", () => {
    if (!view) return;
    view.pageSize = Number(pageSizeEl.value);
    view.page = 0;
    recompute();
    renderBody();
  });

  globalFilter.addEventListener("input", () => {
    if (!view) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      view.global = globalFilter.value;
      view.page = 0;
      recompute();
      renderBody();
    }, 150);
  });

  // ---------- 열 보이기/숨기기 ----------

  function buildColumnMenu() {
    colMenu.replaceChildren();
    for (const key of view.keys) {
      const label = el("label", "mdb-check");
      const box = el("input");
      box.type = "checkbox";
      box.checked = !view.hidden.has(key);
      box.addEventListener("change", () => {
        if (box.checked) view.hidden.delete(key);
        else view.hidden.add(key);
        buildHead();
        renderBody();
      });
      label.append(box, keyLabel(key));
      colMenu.append(label);
    }
  }

  const setAllColumns = (visible) => {
    if (!view) return;
    view.hidden = visible ? new Set() : new Set(view.keys.slice(1));
    buildColumnMenu();
    buildHead();
    renderBody();
  };
  $("col-all").addEventListener("click", () => setAllColumns(true));
  $("col-none").addEventListener("click", () => setAllColumns(false));

  // ---------- 내보내기 ----------

  function exportRows() {
    const keys = visibleKeys();
    const resolved = exportDisplay.checked;
    const headers = keys.map(keyLabel);
    const rows = view.order.map((i) =>
      keys.map((key) => {
        if (key === NAME_KEY) return nameAt(i);
        const c = Number(key);
        const value = view.rows[i][c];
        return resolved ? app.catalog.displayText(view.name, view.columns[c].name, value, { epoch: view.epoch }) : value;
      }),
    );
    return { headers, rows };
  }

  $("btn-csv").addEventListener("click", () => {
    if (!view) return;
    const { headers, rows } = exportRows();
    saveBlob(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }), `${safeFileName(view.name)}.csv`);
  });

  $("btn-json").addEventListener("click", () => {
    if (!view) return;
    const { headers, rows } = exportRows();
    // JSON은 BigInt와 바이트열을 직접 표현하지 못하므로 글자로 바꿉니다.
    const replacer = (_, value) =>
      typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("") : value;
    const objects = rows.map((row) => Object.fromEntries(row.map((value, i) => [headers[i], value])));
    saveBlob(new Blob([JSON.stringify(objects, replacer)], { type: "application/json" }), `${safeFileName(view.name)}.json`);
  });

  /** 새 파일을 열 때: 이전 테이블 상태를 버립니다. */
  function reset() {
    loadToken++;
    view = null;
    viewer.hidden = true;
    statusEl.textContent = "";
    listFilter.value = "";
  }

  return { buildList, openTable, reset };
}

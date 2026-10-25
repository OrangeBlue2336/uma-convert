// 버전 비교: 지금 연 master.mdb와 다른 버전을 비교해 추가/삭제/변경된 것을 보여 줍니다.
//
// 지금 연 파일을 "새 버전", 여기서 올린 파일을 "이전 버전"으로 보고, [서로 바꾸기]로 방향을 뒤집을 수 있습니다.
// 비교 자체는 core/mdbDiff.js가 하고(약 2초), 이 파일은 결과를 사람이 읽기 좋게 그립니다.
// 이름 풀이는 각 행이 속한 쪽의 DB로 합니다(삭제된 행은 이전 버전, 추가/변경된 행은 새 버전).

import { el, button } from "../ui/dom.js";
import { SqliteDb } from "../core/sqlite.js";
import { MdbCatalog } from "../core/mdbMeaning.js";
import { diffDatabases, rowChanges } from "../core/mdbDiff.js";
import { availableDomains } from "../core/mdbDomains.js";
import { cellNode } from "./cell.js";
import { t } from "../i18n/index.js";

const ROW_LIMIT = 200;
const NAME_PREVIEW = 40;

export function createDiffView(app) {
  const $ = (id) => document.getElementById(id);
  const dropzone = $("diff-dropzone");
  const fileInput = $("diff-input");
  const statusEl = $("diff-status");
  const progress = $("diff-progress");
  const resultEl = $("diff-result");
  const summaryEl = $("diff-summary");
  const entitiesEl = $("diff-entities");
  const listEl = $("diff-table-list");
  const detailEl = $("diff-detail");
  const onlyChanged = $("diff-only-changed");
  const swapButton = $("diff-swap");

  /** @type {null | { other: SqliteDb, otherCatalog: MdbCatalog, otherName: string, result: object, swapped: boolean }} */
  let state = null;
  let selected = null;
  let tab = "added";
  let running = 0;

  // 이전/새 쪽의 DB와 이름 풀이기. swapped면 지금 연 파일이 "이전"입니다.
  const sides = () => {
    const mine = { db: app.db, catalog: app.catalog, name: app.fileName };
    const other = { db: state.other, catalog: state.otherCatalog, name: state.otherName };
    return state.swapped ? { oldSide: mine, newSide: other } : { oldSide: other, newSide: mine };
  };

  function reset() {
    running++;
    state = null;
    selected = null;
    resultEl.hidden = true;
    statusEl.classList.remove("is-error");
    statusEl.textContent = "";
    progress.hidden = true;
    entitiesEl.replaceChildren();
    listEl.replaceChildren();
    detailEl.replaceChildren();
  }

  async function openFile(file) {
    const mine = ++running;
    statusEl.classList.remove("is-error");
    resultEl.hidden = true;
    progress.hidden = false;
    progress.removeAttribute("value");
    statusEl.textContent = t("mdb.diff.reading", { name: file.name });
    try {
      const other = new SqliteDb(new Uint8Array(await file.arrayBuffer()));
      const otherCatalog = new MdbCatalog(other, app.map, app.userLabels);
      statusEl.textContent = t("mdb.diff.loadingTexts");
      await otherCatalog.load();
      if (mine !== running) return;
      state = { other, otherCatalog, otherName: file.name, result: null, swapped: false };
      await compute(mine);
    } catch (error) {
      if (mine !== running) return;
      progress.hidden = true;
      statusEl.classList.add("is-error");
      statusEl.textContent = app.errorText(error);
    }
  }

  async function compute(mine) {
    const { oldSide, newSide } = sides();
    progress.hidden = false;
    progress.max = 1;
    progress.value = 0;
    const result = await diffDatabases(oldSide.db, newSide.db, {
      shouldCancel: () => mine !== running,
      onProgress: (done, total, name) => {
        progress.value = total ? done / total : 1;
        statusEl.textContent = t("mdb.diff.running", { done, total, name });
      },
    });
    if (mine !== running) return;
    progress.hidden = true;
    statusEl.textContent = "";
    state.result = result;
    selected = null;
    render();
  }

  // ---------- 그리기 ----------

  const count = (entry, kind) => entry[kind].length;

  function render() {
    const { result } = state;
    const { oldSide, newSide } = sides();
    resultEl.hidden = false;

    const changedTables = result.tables.filter((x) => x.status === "changed");
    const totals = changedTables.reduce((sum, x) => ({ added: sum.added + count(x, "added"), removed: sum.removed + count(x, "removed"), changed: sum.changed + count(x, "changed") }), { added: 0, removed: 0, changed: 0 });
    summaryEl.replaceChildren(
      el("p", "", t("mdb.diff.files", { oldName: oldSide.name, newName: newSide.name })),
      el("p", "mdb-diff-totals", t("mdb.diff.totals", { tables: changedTables.length, added: totals.added.toLocaleString(), removed: totals.removed.toLocaleString(), changed: totals.changed.toLocaleString(), addedTables: result.addedTables.length, removedTables: result.removedTables.length })),
    );
    const errors = result.tables.filter((x) => x.status === "error");
    if (errors.length) summaryEl.append(el("p", "notice", t("mdb.diff.errors", { n: errors.length, names: errors.map((x) => x.name).join(", ") })));
    if (result.addedTables.length) summaryEl.append(el("p", "", `${t("mdb.diff.addedTables")}: ${result.addedTables.join(", ")}`));
    if (result.removedTables.length) summaryEl.append(el("p", "", `${t("mdb.diff.removedTables")}: ${result.removedTables.join(", ")}`));

    renderEntities();
    renderList();
    if (selected) renderDetail();
    else detailEl.replaceChildren(el("p", "hint", t("mdb.diff.pick")));
  }

  /** 도메인 시작 테이블(스킬, 카드 등)에서 새로 생기거나 사라진 항목의 이름을 모아 보여 줍니다. 업데이트를 훑어볼 때 가장 먼저 보고 싶은 부분입니다. */
  function renderEntities() {
    const { oldSide, newSide } = sides();
    const blocks = [];
    for (const domain of availableDomains(newSide.catalog)) {
      const entry = state.result.tables.find((x) => x.name === domain.table);
      if (!entry || entry.status !== "changed") continue;
      const idOf = (db, rowid) => db.getRow(domain.table, rowid)?.[db.columnIndex(domain.table, "id")];
      const label = (side, rowid) => {
        const id = idOf(side.db, rowid);
        return `${side.catalog.nameOf(domain.table, id) ?? "—"} (${id})`;
      };
      const addedLabels = entry.added.slice(0, NAME_PREVIEW).map((rowid) => label(newSide, rowid));
      const removedLabels = oldSide.db.table(domain.table) ? entry.removed.slice(0, NAME_PREVIEW).map((rowid) => label(oldSide, rowid)) : [];
      if (!addedLabels.length && !removedLabels.length) continue;
      const block = el("div", "mdb-entity-diff");
      block.append(el("h4", "", t(`mdb.domain.${domain.id}.title`, {}, domain.id)));
      if (addedLabels.length) block.append(el("p", "mdb-added", `+ ${entry.added.length.toLocaleString()} · ${addedLabels.join(", ")}${entry.added.length > addedLabels.length ? " …" : ""}`));
      if (removedLabels.length) block.append(el("p", "mdb-removed", `− ${entry.removed.length.toLocaleString()} · ${removedLabels.join(", ")}${entry.removed.length > removedLabels.length ? " …" : ""}`));
      blocks.push(block);
    }
    entitiesEl.replaceChildren();
    if (blocks.length) entitiesEl.append(el("h3", "", t("mdb.diff.entities")), ...blocks);
  }

  function renderList() {
    const tables = state.result.tables.filter((x) => (onlyChanged.checked ? x.status !== "same" : true));
    tables.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const head = el("tr");
    for (const key of ["table", "added", "removed", "changed"]) head.append(el("th", "", t(`mdb.diff.col.${key}`)));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");
    for (const entry of tables) {
      const tr = el("tr", entry.name === selected ? "is-selected" : "");
      tr.addEventListener("click", () => {
        selected = entry.name;
        tab = count(entry, "added") ? "added" : count(entry, "changed") ? "changed" : "removed";
        listEl.querySelectorAll("tr.is-selected").forEach((r) => r.classList.remove("is-selected"));
        tr.classList.add("is-selected");
        renderDetail();
      });
      const name = el("td", "", entry.name);
      if (entry.schema?.changed) name.append(el("span", "mdb-badge", t("mdb.diff.schemaChanged")));
      tr.append(name, el("td", "mdb-num mdb-added", count(entry, "added") || ""), el("td", "mdb-num mdb-removed", count(entry, "removed") || ""), el("td", "mdb-num mdb-changed", count(entry, "changed") || ""));
      body.append(tr);
    }
    const table = el("table", "mdb-grid mdb-mini");
    table.append(thead, body);
    listEl.replaceChildren(table);
  }

  function rowsTable(side, tableName, rowids) {
    const db = side.db;
    const columns = db.table(tableName).columns;
    const ctx = { catalog: side.catalog, openId: () => {} };
    const head = el("tr");
    for (const column of columns) head.append(el("th", "", column.name));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");
    for (const rowid of rowids.slice(0, ROW_LIMIT)) {
      const values = db.getRow(tableName, rowid);
      if (!values) continue;
      const tr = el("tr");
      columns.forEach((column, i) => {
        const td = el("td");
        if (typeof values[i] === "number") td.classList.add("mdb-num");
        td.append(cellNode(ctx, tableName, column.name, values[i], { links: false, epoch: new Set(columns.filter((c) => /date|time/i.test(c.name)).map((c) => c.name)) }));
        // text_data는 카테고리 번호만으로는 무슨 텍스트인지 알 수 없어서, 사전에 있으면 주인 테이블을 곁들입니다.
        if (tableName === "text_data" && column.name === "category") {
          const owner = side.catalog.categoryOwner(values[i]);
          if (owner) td.append(el("span", "mdb-refname", `${owner.table} / ${owner.role}`));
        }
        tr.append(td);
      });
      body.append(tr);
    }
    const table = el("table", "mdb-grid mdb-mini");
    table.append(thead, body);
    const scroller = el("div", "mdb-scroll");
    scroller.append(table);
    return scroller;
  }

  function changedList(entry) {
    const { oldSide, newSide } = sides();
    const list = el("div", "mdb-changes");
    const nameColumns = newSide.db.table(entry.name).pk.map((i) => newSide.db.table(entry.name).columns[i].name);
    for (const pair of entry.changed.slice(0, ROW_LIMIT)) {
      const item = el("div", "mdb-change");
      const after = newSide.db.getRow(entry.name, pair.newRowid);
      const columns = newSide.db.table(entry.name).columns;
      const key = nameColumns.length ? nameColumns.map((c) => `${c}=${after[columns.findIndex((x) => x.name === c)]}`).join(", ") : `rowid ${pair.newRowid}`;
      const idIndex = columns.findIndex((c) => c.name === "id");
      const label = idIndex >= 0 ? newSide.catalog.nameOf(entry.name, after[idIndex]) : null;
      item.append(el("div", "mdb-change-key", label ? `${key} · ${label}` : key));
      for (const change of rowChanges(oldSide.db, newSide.db, entry.name, pair.oldRowid, pair.newRowid)) {
        const line = el("div", "mdb-change-line");
        line.append(el("span", "mdb-change-col", change.column));
        const before = el("span", "mdb-removed");
        before.append(cellNode({ catalog: oldSide.catalog }, entry.name, change.column, change.before, { links: false }));
        const afterNode = el("span", "mdb-added");
        afterNode.append(cellNode({ catalog: newSide.catalog }, entry.name, change.column, change.after, { links: false }));
        line.append(before, el("span", "mdb-arrow", "→"), afterNode);
        item.append(line);
      }
      list.append(item);
    }
    return list;
  }

  function renderDetail() {
    const entry = state.result.tables.find((x) => x.name === selected);
    if (!entry) return;
    const { oldSide, newSide } = sides();
    const out = [el("h3", "", entry.name)];
    if (entry.status === "error") {
      out.push(el("p", "status is-error", entry.error));
      detailEl.replaceChildren(...out);
      return;
    }
    if (entry.schema.changed) {
      const parts = [];
      if (entry.schema.added.length) parts.push(`+ ${entry.schema.added.join(", ")}`);
      if (entry.schema.removed.length) parts.push(`− ${entry.schema.removed.join(", ")}`);
      if (entry.schema.typeChanged.length) parts.push(`${t("mdb.diff.typeChanged")}: ${entry.schema.typeChanged.join(", ")}`);
      out.push(el("p", "notice", `${t("mdb.diff.schemaChanged")} · ${parts.join(" · ")}`));
    }
    out.push(el("p", "hint", t("mdb.diff.rowCounts", { oldCount: entry.oldCount.toLocaleString(), newCount: entry.newCount.toLocaleString(), keys: entry.keyColumns.length ? entry.keyColumns.join(", ") : t("mdb.diff.noKey") })));

    const tabs = el("div", "mdb-seg-group");
    for (const kind of ["added", "removed", "changed"]) {
      const b = button(`${t(`mdb.diff.tab.${kind}`)} ${count(entry, kind).toLocaleString()}`, () => {
        tab = kind;
        renderDetail();
      }, "mdb-seg");
      b.setAttribute("aria-pressed", String(tab === kind));
      b.disabled = count(entry, kind) === 0;
      tabs.append(b);
    }
    out.push(tabs);

    const total = count(entry, tab);
    if (total > ROW_LIMIT) out.push(el("p", "hint", t("mdb.diff.limited", { shown: ROW_LIMIT, total: total.toLocaleString() })));
    if (tab === "added" && total) out.push(rowsTable(newSide, entry.name, entry.added));
    else if (tab === "removed" && total) out.push(rowsTable(oldSide, entry.name, entry.removed));
    else if (tab === "changed" && total) out.push(changedList(entry));
    detailEl.replaceChildren(...out);
  }

  // ---------- 이벤트 ----------

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) openFile(file);
  });

  let dragDepth = 0;
  const hasFiles = (event) => event.dataTransfer?.types?.includes("Files");
  dropzone.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    dragDepth++;
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("is-over");
  });
  dropzone.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  dropzone.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation(); // 페이지 전체의 "파일 열기" 끌어놓기와 겹치지 않게 합니다.
    dragDepth = 0;
    dropzone.classList.remove("is-over");
    const file = event.dataTransfer.files[0];
    if (file) openFile(file);
  });

  onlyChanged.addEventListener("change", () => state?.result && renderList());
  swapButton.addEventListener("click", async () => {
    if (!state) return;
    state.swapped = !state.swapped;
    const mine = ++running;
    resultEl.hidden = true;
    await compute(mine);
  });

  return { reset };
}

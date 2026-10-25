// 도메인 보기: 캐릭터, 카드, 서포트 카드, 스킬, 레이스, 미션을 "사람이 생각하는 단위"로 한 화면에 모아 보여 줍니다.
// 어떤 테이블을 어떻게 이을지는 assets/data/mdb-map.json의 domains가 정하고(core/mdbDomains.js가 해석),
// 이 파일은 그 결과를 그리기만 합니다. 새 도메인은 JSON만 고치면 목록에 나타납니다.

import { el, button } from "../ui/dom.js";
import { availableDomains, loadEntityList, buildEntity } from "../core/mdbDomains.js";
import { cellNode } from "./cell.js";
import { t } from "../i18n/index.js";

const LIST_LIMIT = 300;
const NAME_KEY = "@name";
const DATE_LIKE = /date|time/i;

export function createDomainView(app) {
  const $ = (id) => document.getElementById(id);
  const nav = $("domain-nav");
  const searchInput = $("domain-search");
  const listEl = $("domain-list");
  const listStatus = $("domain-list-status");
  const detail = $("domain-detail");

  let domains = [];
  let current = null;
  let selectedRowid = null;
  let lists = new Map(); // 도메인 id -> { columns, entries } (한 번 읽으면 다시 읽지 않음)
  let token = 0;

  const domainTitle = (domain) => t(`mdb.domain.${domain.id}.title`, {}, domain.id);
  const columnLabel = (name) => (name === NAME_KEY ? t("mdb.tables.nameColumn") : name);

  function reset() {
    token++;
    lists = new Map();
    current = null;
    selectedRowid = null;
    domains = availableDomains(app.catalog);
    searchInput.value = "";
    listEl.replaceChildren();
    listStatus.textContent = "";
    detail.replaceChildren(el("p", "hint", t("mdb.domains.pick")));
    nav.replaceChildren(
      ...domains.map((domain) => {
        const b = button(domainTitle(domain), () => select(domain.id), "mdb-seg");
        b.dataset.domain = domain.id;
        return b;
      }),
    );
    if (!domains.length) nav.append(el("p", "hint", t("mdb.domains.none")));
  }

  /** 도메인을 고르고(필요하면 rowid의 항목까지 열고) 목록을 그립니다. */
  async function select(domainId, rowid = null) {
    const domain = domains.find((d) => d.id === domainId);
    if (!domain) return;
    const mine = ++token;
    app.tabs.show("tab-domains");
    // 다른 도메인으로 바꾸거나 다른 화면에서 특정 항목으로 점프해 올 때는 이전 검색어를 비웁니다.
    // 남겨 두면 새 목록이 0건으로 보이거나, 점프해 온 항목이 목록에서 빠져 있습니다.
    if (current?.id !== domainId || rowid !== null) searchInput.value = "";
    current = domain;
    selectedRowid = rowid;
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.domain === domainId)));
    // 새 목록을 읽는 동안 이전 도메인의 목록이 남아 있으면, 그 행을 눌렀을 때 다른 도메인에서 엉뚱한 행을 찾게 됩니다.
    listEl.replaceChildren();
    detail.replaceChildren();
    if (!lists.has(domainId)) {
      listStatus.textContent = t("mdb.domains.loading");
      const list = await loadEntityList(app.catalog, domain, {
        onProgress: (done, total) => {
          listStatus.textContent = t("mdb.tables.loadingProgress", { name: domain.table, done: done.toLocaleString(), total: total.toLocaleString() });
        },
      });
      if (mine !== token) return; // 읽는 사이 다른 도메인/파일로 바뀌었으면 버립니다.
      lists.set(domainId, list);
    }
    renderList();
    if (rowid !== null) showEntity(rowid);
    else detail.replaceChildren(el("p", "hint", t("mdb.domains.pickEntity")));
  }

  function renderList() {
    const list = lists.get(current.id);
    const needle = searchInput.value.trim().toLowerCase();
    const matches = needle
      ? list.entries.filter((e) => String(e.id).includes(needle) || (e.name ?? "").toLowerCase().includes(needle))
      : list.entries;
    const shown = matches.slice(0, LIST_LIMIT);
    listStatus.textContent = matches.length > shown.length
      ? t("mdb.domains.listLimited", { total: matches.length.toLocaleString(), shown: shown.length })
      : t("mdb.domains.listCount", { total: matches.length.toLocaleString() });

    const epoch = new Set(list.columns.filter((c) => DATE_LIKE.test(c)));
    const head = el("tr");
    for (const column of list.columns) head.append(el("th", "", columnLabel(column)));
    const body = el("tbody");
    for (const entry of shown) {
      const tr = el("tr", entry.rowid === selectedRowid ? "is-selected" : "");
      tr.dataset.rowid = String(entry.rowid);
      tr.addEventListener("click", () => {
        selectedRowid = entry.rowid;
        listEl.querySelectorAll("tr.is-selected").forEach((r) => r.classList.remove("is-selected"));
        tr.classList.add("is-selected");
        showEntity(entry.rowid);
      });
      list.columns.forEach((column, i) => {
        const td = el("td");
        if (column === NAME_KEY) td.append(el("span", "mdb-name", entry.cells[i] ?? ""));
        else td.append(cellNode(app, current.table, column, entry.cells[i], { epoch }));
        tr.append(td);
      });
      body.append(tr);
    }
    const table = el("table", "mdb-grid mdb-mini");
    const thead = el("thead");
    thead.append(head);
    table.append(thead, body);
    listEl.replaceChildren(table);
    listEl.querySelector("tr.is-selected")?.scrollIntoView({ block: "nearest" });
  }

  searchInput.addEventListener("input", () => current && lists.has(current.id) && renderList());

  // ---------- 상세 ----------

  function renderSection(section) {
    const wrap = el("section", "mdb-block");
    const heading = el("h3", "", t(`mdb.domain.${current.id}.section.${section.id}`, {}, section.id));
    heading.append(el("span", "mdb-count", section.truncated ? t("mdb.domains.sectionLimited", { total: section.total, shown: section.rows.length }) : t("mdb.rows", { n: section.total })));
    wrap.append(heading);
    const note = t(`mdb.domain.${current.id}.sectionHint.${section.id}`, {}, "");
    if (note) wrap.append(el("p", "hint", note));
    if (!section.rows.length) {
      wrap.append(el("p", "hint", t("mdb.domains.sectionEmpty")));
      return wrap;
    }
    const epoch = new Set(section.columns.filter((c) => DATE_LIKE.test(c)));

    if (section.layout === "vertical") {
      for (const row of section.rows) {
        const dl = el("dl", "mdb-fields");
        section.columns.forEach((column, i) => {
          const value = row.cells[i];
          if (section.hideZero && (value === null || value === 0 || value === "")) return;
          const dd = el("dd");
          dd.append(column === NAME_KEY ? el("span", "mdb-name", value ?? "") : cellNode(app, section.table, column, value, { epoch, full: true }));
          dl.append(el("dt", "", columnLabel(column)), dd);
        });
        wrap.append(dl);
      }
    } else {
      const head = el("tr");
      for (const column of section.columns) head.append(el("th", "", columnLabel(column)));
      const thead = el("thead");
      thead.append(head);
      const body = el("tbody");
      for (const row of section.rows) {
        const tr = el("tr");
        tr.dataset.rowid = String(row.rowid);
        tr.dataset.table = section.table;
        tr.addEventListener("click", () => app.drawer.show(section.table, row.rowid));
        section.columns.forEach((column, i) => {
          const td = el("td");
          const value = row.cells[i];
          if (column === NAME_KEY) td.append(el("span", "mdb-name", value ?? ""));
          else {
            if (typeof value === "number") td.classList.add("mdb-num");
            td.append(cellNode(app, section.table, column, value, { epoch }));
          }
          tr.append(td);
        });
        body.append(tr);
      }
      const table = el("table", "mdb-grid mdb-mini");
      table.append(thead, body);
      const scroller = el("div", "mdb-scroll");
      scroller.append(table);
      wrap.append(scroller);
    }
    if (section.link) {
      wrap.append(button(t("mdb.domains.viewAll", { table: section.link.table }), () => {
        app.openTable(section.link.table, { filters: { [section.link.column]: `=${section.link.value}` } });
      }, "btn"));
    }
    return wrap;
  }

  function showEntity(rowid) {
    const entity = buildEntity(app.catalog, current, rowid);
    if (!entity) {
      detail.replaceChildren(el("p", "hint", t("mdb.drawer.missing")));
      return;
    }
    const out = [];
    const header = el("div", "mdb-entity-head");
    const titles = el("div");
    titles.append(el("h2", "", entity.name ?? `${entity.table} · ${entity.id}`), el("p", "hint", `${entity.table} · id ${entity.id}`));
    const actions = el("div", "mdb-drawer-actions");
    actions.append(
      button(t("mdb.domains.openRow"), () => app.drawer.show(entity.table, rowid), "btn"),
      button(t("mdb.drawer.openTable"), () => app.openTable(entity.table, { focusRowid: rowid }), "btn"),
    );
    header.append(titles, actions);
    out.push(header);

    const facts = entity.facts.filter((f) => f.value !== null && f.value !== undefined);
    if (facts.length) {
      const epoch = new Set(facts.map((f) => f.column).filter((c) => DATE_LIKE.test(c)));
      const dl = el("dl", "mdb-fields mdb-facts");
      for (const fact of facts) {
        const dd = el("dd");
        dd.append(cellNode(app, entity.table, fact.column, fact.value, { epoch, full: true }));
        dl.append(el("dt", "", fact.column), dd);
      }
      out.push(dl);
    }

    const { curated, auto, weak } = entity.texts;
    if (curated.length || auto.length || weak.length) {
      const block = el("section", "mdb-block");
      block.append(el("h3", "", t("mdb.drawer.texts")));
      const dl = el("dl", "mdb-fields");
      for (const item of curated) dl.append(el("dt", "", t(`mdb.role.${item.role}`, {}, item.role)), el("dd", "mdb-multiline", item.text));
      block.append(dl);
      if (auto.length) {
        const details = el("details", "mdb-details");
        details.append(el("summary", "", t("mdb.domains.textsAuto", { n: auto.length })));
        const adl = el("dl", "mdb-fields");
        for (const item of auto) adl.append(el("dt", "", `${t("mdb.drawer.category")} ${item.category}`), el("dd", "mdb-multiline", item.text));
        details.append(adl);
        block.append(details);
      }
      if (weak.length) {
        // 일부 행만 텍스트를 가진 카테고리(예: 새 캐릭터에만 있는 프로필 항목). 사전에 등록하면 위 확정 목록으로 올라갑니다.
        const details = el("details", "mdb-details");
        details.append(el("summary", "", t("mdb.domains.textsWeak", { n: weak.length })));
        details.append(el("p", "hint", t("mdb.drawer.textsWeakHint")));
        const wdl = el("dl", "mdb-fields");
        for (const item of weak) wdl.append(el("dt", "", `${t("mdb.drawer.category")} ${item.category} · ${Math.round(item.coverage * 100)}%`), el("dd", "mdb-multiline", item.text));
        details.append(wdl);
        block.append(details);
      }
      out.push(block);
    }

    for (const section of entity.sections) out.push(renderSection(section));
    detail.replaceChildren(...out);
    detail.scrollTop = 0;
  }

  return { reset, select };
}

// 행 상세 서랍: 어느 화면에서든 행을 누르면 오른쪽에 열립니다.
// 컬럼별 값(참조는 링크), 같은 번호의 text_data, "이 행을 가리키는 곳"을 보여 줍니다.
// 링크를 따라가면 서랍 안에서 계속 이동하고, 뒤로 가기 버튼으로 돌아옵니다.

import { el, button } from "../ui/dom.js";
import { detectEpochColumns } from "../core/mdbMeaning.js";
import { availableDomains } from "../core/mdbDomains.js";
import { cellNode } from "./cell.js";
import { t } from "../i18n/index.js";

export function createDrawer(app) {
  const root = document.getElementById("drawer");
  const body = document.getElementById("drawer-body");
  const titleEl = document.getElementById("drawer-title");
  const subEl = document.getElementById("drawer-sub");
  const backButton = document.getElementById("drawer-back");
  const stack = [];
  let hideEmpty = true;
  let token = 0;

  document.getElementById("drawer-close").addEventListener("click", close);
  backButton.addEventListener("click", () => {
    stack.pop(); // 지금 보던 행을 기록에서 빼고, 그 앞 행을 (기록을 늘리지 않고) 다시 보여 줍니다.
    const previous = stack[stack.length - 1];
    if (previous) show(previous.table, previous.rowid, false);
    else close();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]")) close();
  });

  function close() {
    root.hidden = true;
    stack.length = 0;
    document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
  }

  function roleLabel(role) {
    return t(`mdb.role.${role}`, {}, role);
  }

  function textSection(table, id) {
    const { curated, auto, weak, other } = app.catalog.textsFor(table, id);
    if (!curated.length && !auto.length && !weak.length && !other.length) return null;
    const section = el("section", "mdb-block");
    section.append(el("h3", "", t("mdb.drawer.texts")));
    section.append(el("p", "hint", t("mdb.drawer.textsHint")));

    const addRows = (items, labelOf) => {
      const dl = el("dl", "mdb-fields");
      for (const item of items) {
        dl.append(el("dt", "", labelOf(item)), el("dd", "mdb-multiline", item.text));
      }
      return dl;
    };
    if (curated.length) section.append(addRows(curated, (x) => `${roleLabel(x.role)} · ${x.category}`));
    if (auto.length) {
      section.append(el("h4", "", t("mdb.drawer.textsAuto")));
      section.append(addRows(auto, (x) => `${t("mdb.drawer.category")} ${x.category}`));
    }
    if (weak.length) {
      // 번호는 모두 이 테이블 id에 있지만 일부 행만 텍스트를 가진 카테고리. 맞는 경우가 많아도 확정은 아니라서 접어 둡니다.
      const details = el("details", "mdb-details");
      details.append(el("summary", "", t("mdb.drawer.textsWeak", { n: weak.length })));
      details.append(el("p", "hint", t("mdb.drawer.textsWeakHint")));
      details.append(addRows(weak, (x) => `${t("mdb.drawer.category")} ${x.category} · ${Math.round(x.coverage * 100)}%`));
      section.append(details);
    }
    if (other.length) {
      const details = el("details", "mdb-details");
      details.append(el("summary", "", t("mdb.drawer.textsOther", { n: other.length })));
      details.append(el("p", "hint", t("mdb.drawer.textsOtherHint")));
      details.append(addRows(other, (x) => `${t("mdb.drawer.category")} ${x.category}`));
      section.append(details);
    }
    return section;
  }

  function referenceSection(table, id) {
    if (!app.catalog.refSources(table).length) return null;
    const section = el("section", "mdb-block");
    section.append(el("h3", "", t("mdb.drawer.refs")));
    const out = el("div", "mdb-refs-out");
    const status = el("p", "status");
    const run = button(t("mdb.drawer.refsFind"), async () => {
      run.disabled = true;
      const mine = token;
      status.textContent = t("mdb.drawer.refsRunning");
      const found = await app.catalog.findReferences(table, id, {
        onProgress: (done, total) => {
          status.textContent = t("mdb.drawer.refsProgress", { done, total });
        },
      });
      if (mine !== token) return; // 그 사이 다른 행으로 이동했으면 결과를 버립니다.
      status.textContent = found.length ? t("mdb.drawer.refsFound", { n: found.length }) : t("mdb.drawer.refsNone");
      out.replaceChildren(
        ...found.map((hit) =>
          button(`${hit.table}.${hit.column} · ${t("mdb.rows", { n: hit.count })}`, () => {
            app.openTable(hit.table, { filters: { [hit.column]: `=${id}` } });
          }, "mdb-chip"),
        ),
      );
    }, "btn");
    section.append(el("p", "hint", t("mdb.drawer.refsHint")), run, status, out);
    return section;
  }

  /** @param {boolean} [remember] false면 이동 기록에 남기지 않습니다(같은 행을 다시 그릴 때). */
  function show(table, rowid, remember = true) {
    token++;
    const db = app.db;
    const values = db.getRow(table, rowid);
    if (remember) stack.push({ table, rowid });
    root.hidden = false;
    backButton.hidden = stack.length < 2;
    body.replaceChildren();
    body.scrollTop = 0;
    if (!values) {
      titleEl.textContent = table;
      subEl.textContent = t("mdb.drawer.missing");
      return;
    }

    const columns = db.table(table).columns;
    const idIndex = db.columnIndex(table, "id");
    const id = idIndex >= 0 ? values[idIndex] : null;
    const name = typeof id === "number" ? app.catalog.nameOf(table, id) : null;
    titleEl.textContent = `${table} · ${id ?? `rowid ${rowid}`}`;
    subEl.textContent = name ?? "";

    // 이 행이 그려진 표의 선택 표시를 맞춥니다.
    document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
    document.querySelectorAll(`tr[data-rowid="${rowid}"][data-table="${table}"]`).forEach((row) => row.classList.add("is-selected"));

    const actions = el("div", "mdb-drawer-actions");
    actions.append(button(t("mdb.drawer.openTable"), () => app.openTable(table, { focusRowid: rowid }), "btn"));
    for (const domain of availableDomains(app.catalog).filter((d) => d.table === table)) {
      actions.append(button(t("mdb.drawer.openDomain", { name: t(`mdb.domain.${domain.id}.title`, {}, domain.id) }), () => app.openDomain(domain.id, rowid), "btn"));
    }
    body.append(actions);

    const toggle = el("label", "mdb-check");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = hideEmpty;
    checkbox.addEventListener("change", () => {
      hideEmpty = checkbox.checked;
      show(table, rowid, false);
    });
    toggle.append(checkbox, t("mdb.drawer.hideEmpty"));
    body.append(toggle);

    const epoch = new Set([...detectEpochColumns(columns, [values])].map((i) => columns[i].name));
    const dl = el("dl", "mdb-fields");
    columns.forEach((column, i) => {
      const value = values[i];
      if (hideEmpty && (value === null || value === 0 || value === "")) return;
      const dt = el("dt", "", column.name);
      if (column.pk) dt.classList.add("is-pk");
      const dd = el("dd");
      dd.append(cellNode(app, table, column.name, value, { epoch, full: true }));
      dl.append(dt, dd);
    });
    body.append(dl);

    if (typeof id === "number") {
      const texts = textSection(table, id);
      if (texts) body.append(texts);
      const refs = referenceSection(table, id);
      if (refs) body.append(refs);
    }
  }

  return { show, close };
}

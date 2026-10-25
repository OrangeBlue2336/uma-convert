// 텍스트 검색: text_data 전체에서 글자(또는 번호)를 찾고, 그 텍스트가 속한 테이블의 행으로 바로 이동합니다.
//
// "스페셜 위크"를 검색하면 이름이 들어 있는 곳이 줄줄이 나오고, 각 줄의 [열기]가 그 이름을 가진 행(캐릭터, 카드 등)을 엽니다.
// 사전에 없는 카테고리는 주인 테이블을 단정하지 않고, 번호가 맞물리는 "후보"만 찾아 보여 줍니다.

import { el, button } from "../ui/dom.js";
import { t } from "../i18n/index.js";

const LIMIT = 200;

/** needle이 들어 있는 부분을 <mark>로 감쌉니다. (대소문자 무시, 글자는 항상 텍스트 노드로 넣습니다.) */
function highlight(text, needle) {
  const lower = text.toLowerCase();
  const fragment = document.createDocumentFragment();
  // 소문자로 바꾸면 길이가 달라지는 글자(일부 유니코드)가 있으면 위치가 어긋나므로 강조만 포기합니다.
  if (!needle || lower.length !== text.length) {
    fragment.append(text);
    return fragment;
  }
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    fragment.append(text.slice(from, at));
    fragment.append(el("mark", "", text.slice(at, at + needle.length)));
    from = at + needle.length;
  }
  fragment.append(text.slice(from));
  return fragment;
}

export function createSearchView(app) {
  const $ = (id) => document.getElementById(id);
  const input = $("search-input");
  const categorySelect = $("search-category");
  const statusEl = $("search-status");
  const results = $("search-results");
  let debounce = 0;
  const candidateCache = new Map();

  function reset() {
    candidateCache.clear();
    input.value = "";
    results.replaceChildren();
    statusEl.textContent = "";
    categorySelect.replaceChildren(new Option(t("mdb.search.allCategories"), ""));
    const categories = [...app.catalog.texts.keys()].sort((a, b) => a - b);
    for (const category of categories) {
      const owner = app.catalog.categoryOwner(category);
      const label = owner ? `${category} · ${owner.table} (${t(`mdb.role.${owner.role}`, {}, owner.role)})` : String(category);
      categorySelect.append(new Option(`${label} · ${app.catalog.texts.get(category).size}`, String(category)));
    }
  }

  function ownerCell(hit) {
    const cell = el("td", "mdb-owner");
    const owner = app.catalog.categoryOwner(hit.category);
    if (owner) {
      cell.append(button(`${t("mdb.search.open")} · ${owner.table}`, () => app.openId(owner.table, hit.index), "mdb-chip"));
      return cell;
    }
    // 사전에 없는 카테고리: 번호가 맞물리는 테이블 후보를 필요할 때만 계산합니다(모든 테이블의 id를 훑으므로).
    const show = (candidates) => {
      cell.replaceChildren();
      if (!candidates.length) cell.append(el("span", "mdb-null", t("mdb.search.noCandidate")));
      for (const candidate of candidates.slice(0, 3)) {
        // 약한 후보(일부 행만 텍스트를 가진 경우)는 점선 칩과 비율로 구분해, 확정처럼 보이지 않게 합니다.
        const label = candidate.weak ? `${candidate.table}? · ${Math.round(candidate.coverage * 100)}%` : `${candidate.table}?`;
        const chip = button(label, () => app.openId(candidate.table, hit.index), candidate.weak ? "mdb-chip is-weak" : "mdb-chip");
        if (candidate.weak) chip.title = t("mdb.search.weakTitle", { percent: Math.round(candidate.coverage * 100) });
        cell.append(chip);
      }
    };
    if (candidateCache.has(hit.category)) {
      show(candidateCache.get(hit.category));
    } else {
      const find = button(t("mdb.search.findOwner"), async () => {
        find.disabled = true;
        find.textContent = t("mdb.search.finding");
        const candidates = await app.catalog.candidateOwners(hit.category);
        candidateCache.set(hit.category, candidates);
        show(candidates);
      }, "mdb-chip");
      cell.append(find);
    }
    return cell;
  }

  function run() {
    const query = input.value.trim();
    results.replaceChildren();
    if (!query) {
      statusEl.textContent = "";
      return;
    }
    const category = categorySelect.value === "" ? null : Number(categorySelect.value);
    const { total, hits } = app.catalog.searchTexts(query, { category, limit: LIMIT });
    statusEl.textContent = total === 0 ? t("mdb.search.none") : total > hits.length ? t("mdb.search.limited", { total: total.toLocaleString(), shown: hits.length }) : t("mdb.search.count", { total: total.toLocaleString() });

    const needle = query.toLowerCase();
    const thead = el("thead");
    const headRow = el("tr");
    for (const key of ["category", "index", "text", "owner"]) headRow.append(el("th", "", t(`mdb.search.col.${key}`)));
    thead.append(headRow);
    const tbody = el("tbody");
    for (const hit of hits) {
      const tr = el("tr");
      const owner = app.catalog.categoryOwner(hit.category);
      const categoryCell = el("td", "", String(hit.category));
      if (owner) categoryCell.title = `${owner.table} / ${owner.role}`;
      const textCell = el("td", "mdb-multiline");
      textCell.append(highlight(hit.text, needle));
      tr.append(categoryCell, el("td", "mdb-num", String(hit.index)), textCell, ownerCell(hit));
      tbody.append(tr);
    }
    const table = el("table", "mdb-grid");
    table.append(thead, tbody);
    results.append(table);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 200);
  });
  categorySelect.addEventListener("change", run);
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  return { reset };
}

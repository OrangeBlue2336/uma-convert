// 셀 하나를 화면 조각으로 만듭니다. 표, 상세 서랍, 도메인 보기, 버전 비교가 모두 같은 규칙으로 값을 풀어 보이도록 한곳에 둡니다.
//
// 참조 값은 눌러서 대상 행으로 갈 수 있는 버튼으로, 시간은 날짜로, 값 라벨이 있으면 뜻과 함께 보여 줍니다.
// 모든 글자는 textContent로만 넣습니다(게임 데이터 안의 "<" 같은 글자가 화면을 깨지 않도록).

import { el, button } from "../ui/dom.js";

const MAX_CHARS = 80;

/**
 * @param {{ catalog: import("../core/mdbMeaning.js").MdbCatalog, openId: (table:string,id:number)=>void }} ctx
 *        catalog: 어느 DB로 풀지(버전 비교에서는 이전/새 DB가 각각 다릅니다)
 * @param {{ epoch?: Set<string>, full?: boolean, links?: boolean }} [options]
 *        full: 긴 글자를 자르지 않고 줄바꿈도 살립니다.
 *        links: false면 참조를 버튼이 아닌 글자로만 보여 줍니다(지금 열린 파일이 아닌 DB를 풀 때, 눌러도 갈 곳이 없으므로).
 */
export function cellNode(ctx, table, column, value, options = {}) {
  const info = ctx.catalog.valueInfo(table, column, value, { epoch: options.epoch });
  if (info.kind === "null") return el("span", "mdb-null", "∅");

  if (info.kind === "ref") {
    const wrap = el("span", "mdb-refcell");
    wrap.title = `${info.ref.table} #${info.ref.id}`;
    if (options.links === false) {
      wrap.append(el("span", "", info.text));
    } else {
      wrap.append(
        button(info.text, (event) => {
          event.stopPropagation(); // 행 클릭(상세 열기)과 겹치지 않게
          ctx.openId(info.ref.table, info.ref.id);
        }, "mdb-ref"),
      );
    }
    if (info.name) wrap.append(el("span", "mdb-refname", info.name));
    return wrap;
  }

  if (info.kind === "time") {
    const span = el("span", "mdb-time", info.text);
    span.title = `${info.raw} (JST)`;
    return span;
  }

  if (info.kind === "label") return el("span", "mdb-labeled", `${info.text} · ${info.label}`);

  let text = info.text;
  const span = el("span", info.kind === "blob" ? "mdb-blob" : "");
  if (!options.full) {
    const oneLine = text.replace(/\s*\n\s*/g, " ↵ ");
    if (oneLine.length > MAX_CHARS || oneLine !== text) span.title = text;
    text = oneLine.length > MAX_CHARS ? oneLine.slice(0, MAX_CHARS) + "…" : oneLine;
  } else {
    span.classList.add("mdb-multiline");
  }
  span.textContent = text;
  return span;
}

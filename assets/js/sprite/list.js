// 오른쪽 조각 목록: 미리보기, 이름, 크기, 개별 저장 버튼, 이름 검색.

const THUMB = 44; // CSS 크기(px). 선명하게 보이도록 canvas는 2배로 그립니다.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawThumb(target, source, sprite) {
  const scale = Math.min(THUMB * 2 / sprite.width, THUMB * 2 / sprite.height, 1);
  const w = Math.max(1, Math.round(sprite.width * scale));
  const h = Math.max(1, Math.round(sprite.height * scale));
  target.width = THUMB * 2;
  target.height = THUMB * 2;
  const ctx = target.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sprite.x, sprite.y, sprite.width, sprite.height, (THUMB * 2 - w) / 2, (THUMB * 2 - h) / 2, w, h);
}

/**
 * @param {object} options
 * @param {HTMLElement} options.listEl
 * @param {HTMLElement} options.countEl
 * @param {HTMLInputElement} options.searchEl
 * @param {(index: number) => void} options.onSelect  행을 눌렀을 때
 * @param {(index: number, button: HTMLButtonElement) => void} options.onSave  저장 버튼을 눌렀을 때
 */
export function createSpriteList({ listEl, countEl, searchEl, onSelect, onSave }) {
  let sprites = [];
  let rows = [];

  function updateCount() {
    const shown = rows.filter((row) => !row.hidden).length;
    countEl.textContent = shown === sprites.length ? `${sprites.length}개` : `${shown} / ${sprites.length}개`;
  }

  function applyFilter() {
    const query = searchEl.value.trim().toLowerCase();
    rows.forEach((row, i) => {
      row.hidden = query !== "" && !sprites[i].name.toLowerCase().includes(query);
    });
    updateCount();
  }

  searchEl.addEventListener("input", applyFilter);

  function load(spriteList, sourceCanvas) {
    sprites = spriteList;
    searchEl.value = "";
    listEl.replaceChildren();

    if (sprites.length === 0) {
      listEl.append(el("li", "empty-note", "이 텍스처에는 조각 정보가 없습니다."));
      rows = [];
      countEl.textContent = "";
      return;
    }

    rows = sprites.map((sprite, index) => {
      const row = el("li", "sprite-row");

      const select = el("button", "sprite-select");
      select.type = "button";
      const thumb = el("span", "sprite-thumb");
      const canvas = document.createElement("canvas");
      drawThumb(canvas, sourceCanvas, sprite);
      thumb.append(canvas);
      const text = el("span", "sprite-text");
      text.append(el("span", "sprite-name", sprite.name), el("span", "sprite-size", `${sprite.width} × ${sprite.height} px`));
      select.append(thumb, text);
      select.addEventListener("click", () => onSelect(index));

      const save = el("button", "btn small", "저장");
      save.type = "button";
      save.setAttribute("aria-label", `${sprite.name} 저장`);
      save.addEventListener("click", () => onSave(index, save));

      row.append(select, save);
      return row;
    });

    listEl.append(...rows);
    updateCount();
  }

  function select(index, { scroll = false } = {}) {
    rows.forEach((row, i) => row.classList.toggle("is-selected", i === index));
    if (scroll && rows[index]) {
      rows[index].hidden = false; // 검색으로 가려져 있었다면 보이게 함
      updateCount();
      rows[index].scrollIntoView({ block: "nearest" });
    }
  }

  return { load, select };
}

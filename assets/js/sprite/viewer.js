// 텍스처 이미지를 보여주고, 그 위에 조각 영역을 클릭할 수 있게 겹쳐 그립니다.
// 이미지는 canvas, 조각 영역은 같은 좌표계(이미지 픽셀)의 SVG 사각형입니다.

const SVG_NS = "http://www.w3.org/2000/svg";

export function createViewer({ scrollEl, stageEl, onSelect }) {
  let texture = null;
  let sprites = [];
  let canvas = null;
  let svg = null;
  let rects = [];
  let zoom = "fit"; // "fit" 또는 배율(숫자)

  function applyZoom() {
    if (!texture) return;
    stageEl.style.width = zoom === "fit" ? "100%" : `${texture.width * zoom}px`;
  }

  /**
   * @param {{ width: number, height: number }} tex
   * @param {Uint8Array} rgba
   * @param {{ name: string, x: number, y: number, width: number, height: number }[]} spriteList
   */
  function load(tex, rgba, spriteList) {
    texture = tex;
    sprites = spriteList;

    canvas = document.createElement("canvas");
    canvas.width = tex.width;
    canvas.height = tex.height;
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    canvas.getContext("2d").putImageData(new ImageData(pixels, tex.width, tex.height), 0, 0);

    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${tex.width} ${tex.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    rects = sprites.map((sprite, index) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", sprite.x);
      rect.setAttribute("y", sprite.y);
      rect.setAttribute("width", sprite.width);
      rect.setAttribute("height", sprite.height);
      rect.dataset.index = index;
      const title = document.createElementNS(SVG_NS, "title"); // 마우스를 올리면 이름이 뜹니다.
      title.textContent = sprite.name;
      rect.append(title);
      return rect;
    });
    svg.append(...rects);
    svg.addEventListener("click", (event) => {
      const rect = event.target.closest("rect");
      if (rect) onSelect(Number(rect.dataset.index));
    });

    stageEl.replaceChildren(canvas, svg);
    scrollEl.scrollTo(0, 0);
    applyZoom();
  }

  /** 선택 표시. scroll이 true면 그 조각이 화면 가운데 오도록 이동합니다. */
  function select(index, { scroll = false } = {}) {
    rects.forEach((rect, i) => rect.classList.toggle("is-selected", i === index));
    const sprite = sprites[index];
    if (!sprite) return;

    rects[index].parentNode.append(rects[index]); // 겹친 조각 위로 올려 테두리가 가려지지 않게 함

    if (scroll) {
      const scale = stageEl.clientWidth / texture.width;
      scrollEl.scrollTo({
        left: (sprite.x + sprite.width / 2) * scale - scrollEl.clientWidth / 2,
        top: (sprite.y + sprite.height / 2) * scale - scrollEl.clientHeight / 2,
      });
    }
  }

  return {
    load,
    select,
    /** 목록 미리보기 그림을 그릴 때 원본으로 쓰는 canvas */
    get canvas() {
      return canvas;
    },
    setBounds(visible) {
      stageEl.classList.toggle("show-bounds", visible);
    },
    setZoom(value) {
      zoom = value === "fit" ? "fit" : Number(value);
      applyZoom();
    },
  };
}

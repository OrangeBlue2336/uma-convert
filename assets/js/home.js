// tools.js의 목록을 읽어 메인 페이지의 타일을 만듭니다.

import { tools } from "./tools.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ioRow(list, label, value) {
  if (!value) return;
  list.append(el("dt", "", label), el("dd", "", value));
}

function createTile(tool) {
  const soon = tool.status === "soon";
  const item = el("li", soon ? "tool is-soon" : "tool");

  // 준비 중이면 링크가 아니라 일반 상자로 만들어 이동하지 않게 합니다.
  const box = soon ? el("div", "tool-link") : el("a", "tool-link");
  if (!soon) box.href = tool.href;

  const art = el("div", "tool-art");
  const img = el("img");
  img.src = tool.image;
  img.alt = "";
  art.append(img);
  if (soon) art.append(el("span", "tool-status", "준비 중"));

  const body = el("div", "tool-body");
  body.append(el("h2", "tool-title", tool.title), el("p", "tool-desc", tool.desc));

  if (tool.input || tool.output) {
    const io = el("dl", "tool-io");
    ioRow(io, "대응 파일", tool.input);
    ioRow(io, "결과", tool.output);
    body.append(io);
  }

  box.append(art, body);
  item.append(box);
  return item;
}

document.getElementById("tool-list").append(...tools.map(createTile));

// 스프라이트 변환기 페이지: 파일 열기, 결과 보기, 저장을 하나로 연결합니다.
// 실제 변환은 core/, 파일 만들기는 encode/, 화면 조각은 이 폴더의 viewer.js / list.js가 맡습니다.

import { convertBundle } from "../core/convert.js";
import { ConvertError } from "../core/errors.js";
import { cropSprite } from "../core/sprites.js";
import { encodePNG } from "../encode/png.js";
import { createZip } from "../encode/zip.js";
import { createTabs } from "../ui/tabs.js";
import { saveBlob, safeFileName, uniqueNames } from "../ui/download.js";
import { createViewer } from "./viewer.js";
import { createSpriteList } from "./list.js";
import { CORRECTION_PRESETS, resizeRGBA } from "./correction.js";

const $ = (id) => document.getElementById(id);

const dropzone = $("dropzone");
const fileInput = $("file-input");
const statusEl = $("status");
const resultTitle = $("result-title");
const resultInfo = $("result-info");
const textureSelect = $("texture-select");
const pngButton = $("btn-png");
const zipButton = $("btn-zip");
const selectionInfo = $("selection-info");
const fixSupportButton = $("btn-fix-support");
const fixHonorButton = $("btn-fix-honor");
const correctionResult = $("correction-result");
const correctionTitle = $("correction-result-title");
const correctionSize = $("correction-result-size");
const correctionPreview = $("correction-result-preview");
const correctionSaveButton = $("correction-result-save");

const tabs = createTabs();

/** 지금 화면에 보이는 결과 */
let current = null; // { texture, rgba }
let loaded = null; // { textures } 파일에서 읽은 전체 텍스처 목록
let selectedIndex = null; // 지금까지 눌러서 고른 조각 번호. 안 골랐으면 null

const viewer = createViewer({
  scrollEl: $("viewer-scroll"),
  stageEl: $("stage"),
  onSelect: (index) => selectSprite(index, { scrollList: true }),
});

const list = createSpriteList({
  listEl: $("sprite-list"),
  countEl: $("sprite-count"),
  searchEl: $("sprite-search"),
  onSelect: (index) => selectSprite(index, { scrollViewer: true }),
  onSave: saveOneSprite,
});

// ---------- 상태 문구 ----------

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

function describeError(error) {
  if (error instanceof ConvertError) return error.message;
  console.error(error);
  return `변환 중 문제가 생겼습니다: ${error.message}`;
}

// ---------- 파일 열기 ----------

async function openFile(file, extraNote = "") {
  setStatus(`${file.name} 변환 중...`);
  await nextFrame(); // 문구가 먼저 화면에 그려지도록 한 박자 쉽니다.

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { textures } = convertBundle(bytes);
    const first = prepare(textures[0]); // 여기서 실패하면 기존 결과는 그대로 둡니다.

    loaded = { textures };
    fillTextureSelect(textures);
    showTexture(first);

    tabs.setEnabled("tab-result", true);
    tabs.show("tab-result");
    setStatus(extraNote);
  } catch (error) {
    setStatus(describeError(error), true);
    tabs.show("tab-open");
  }
}

/** 텍스처를 실제 픽셀로 복원합니다. */
function prepare(texture) {
  return { texture, rgba: texture.decode() };
}

// ---------- 결과 표시 ----------

function fillTextureSelect(textures) {
  textureSelect.replaceChildren(
    ...textures.map((texture, index) => new Option(texture.name, String(index)))
  );
  textureSelect.hidden = textures.length < 2;
}

function showTexture(next) {
  current = next;
  const { texture, rgba } = next;

  resultTitle.textContent = texture.name;
  resultInfo.textContent = `${texture.width} × ${texture.height} px, ${texture.formatName}, 조각 ${texture.sprites.length}개`;
  zipButton.hidden = texture.sprites.length === 0;
  zipButton.textContent = `조각 ${texture.sprites.length}개 ZIP 저장`;

  viewer.load(texture, rgba, texture.sprites);
  list.load(texture.sprites, viewer.canvas);
  resetSelectionInfo();
}

function resetSelectionInfo() {
  selectedIndex = null;
  hideCorrectionResult();
  selectionInfo.classList.remove("is-error");
  selectionInfo.textContent = current.texture.sprites.length
    ? "조각을 누르면 이름과 크기가 여기에 나옵니다."
    : "";
}

function selectSprite(index, { scrollList = false, scrollViewer = false } = {}) {
  selectedIndex = index;
  const sprite = current.texture.sprites[index];
  viewer.select(index, { scroll: scrollViewer });
  list.select(index, { scroll: scrollList });

  selectionInfo.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = sprite.name;
  selectionInfo.append(name, ` ${sprite.width} × ${sprite.height} px, 위치 (${sprite.x}, ${sprite.y})`);
}

textureSelect.addEventListener("change", () => {
  const previous = current;
  try {
    showTexture(prepare(loaded.textures[Number(textureSelect.value)]));
  } catch (error) {
    // 지원하지 않는 형식이면 이전 텍스처를 그대로 두고 이유만 알려줍니다.
    textureSelect.value = String(loaded.textures.indexOf(previous.texture));
    selectionInfo.textContent = describeError(error);
    selectionInfo.classList.add("is-error");
  }
});

$("toggle-bounds").addEventListener("change", (event) => viewer.setBounds(event.target.checked));

for (const button of document.querySelectorAll("[data-zoom]")) {
  button.addEventListener("click", () => {
    viewer.setZoom(button.dataset.zoom);
    for (const other of document.querySelectorAll("[data-zoom]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
}

// ---------- 크기 보정 ----------
// 서포트 카드, 칭호처럼 게임 데이터 안에서부터 비율이 눌려 저장된 조각을 정해진 크기로 강제로
// 맞춥니다. 대상은 지금 누른 조각 -> (없으면) 조각이 하나뿐인 텍스처 -> (그것도 없으면, 즉 이
// 텍스처에 조각 정보가 아예 없으면) 텍스처 전체 이미지 순서로 고릅니다.

/** 지금 보정에 쓸 이미지(이름 + 픽셀 + 크기)를 고릅니다. 여러 조각 중 하나를 못 골랐으면 null. */
function pickCorrectionSource() {
  const { texture, rgba } = current;

  if (selectedIndex !== null && texture.sprites[selectedIndex]) {
    const sprite = texture.sprites[selectedIndex];
    return { name: sprite.name, ...cropSprite(rgba, texture.width, sprite) };
  }
  if (texture.sprites.length === 1) {
    const sprite = texture.sprites[0];
    return { name: sprite.name, ...cropSprite(rgba, texture.width, sprite) };
  }
  if (texture.sprites.length === 0) {
    return { name: texture.name, rgba, width: texture.width, height: texture.height };
  }
  return null; // 조각이 여러 개인데 아직 하나도 안 골랐음
}

function hideCorrectionResult() {
  correctionResult.hidden = true;
  correctionPreview.replaceChildren();
}

function applyCorrection(presetKey) {
  const preset = CORRECTION_PRESETS[presetKey];
  const source = pickCorrectionSource();
  if (!source) {
    window.alert("조각이 여러 개 있습니다. 먼저 보정할 조각을 하나 눌러 고른 뒤 다시 눌러 주세요.");
    return;
  }

  const resized = resizeRGBA(source.rgba, source.width, source.height, preset.width, preset.height);

  correctionTitle.textContent = `${preset.label} 크기 보정 결과 — ${source.name}`;
  correctionSize.textContent = `${source.width} × ${source.height} px → ${resized.width} × ${resized.height} px`;
  correctionPreview.replaceChildren(resized.canvas);
  correctionResult.hidden = false;
  correctionResult.scrollIntoView({ behavior: "smooth", block: "nearest" });

  correctionSaveButton.onclick = () =>
    withBusy(correctionSaveButton, "생성 중...", async () => {
      const png = await encodePNG(resized.rgba, resized.width, resized.height);
      saveBlob(pngBlob(png), `${safeFileName(source.name)}_${resized.width}x${resized.height}.png`);
    });
}

fixSupportButton.addEventListener("click", () => applyCorrection("supportCard"));
fixHonorButton.addEventListener("click", () => applyCorrection("honor"));

// ---------- 저장 ----------

/** 저장 작업 동안 버튼을 잠그고 문구를 바꿨다가 되돌립니다. */
async function withBusy(button, busyLabel, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await task((text) => (button.textContent = text));
  } catch (error) {
    window.alert(describeError(error));
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const pngBlob = (bytes) => new Blob([bytes], { type: "image/png" });

pngButton.addEventListener("click", () =>
  withBusy(pngButton, "생성 중...", async () => {
    const { texture, rgba } = current;
    const png = await encodePNG(rgba, texture.width, texture.height);
    saveBlob(pngBlob(png), `${safeFileName(texture.name)}.png`);
  })
);

zipButton.addEventListener("click", () =>
  withBusy(zipButton, "묶는 중...", async (setLabel) => {
    const { texture, rgba } = current;
    const names = uniqueNames(texture.sprites.map((s) => s.name));
    const entries = [];

    for (let i = 0; i < texture.sprites.length; i++) {
      setLabel(`묶는 중 ${i + 1} / ${texture.sprites.length}`);
      const crop = cropSprite(rgba, texture.width, texture.sprites[i]);
      entries.push({ name: `${names[i]}.png`, data: await encodePNG(crop.rgba, crop.width, crop.height) });
    }
    saveBlob(createZip(entries), `${safeFileName(texture.name)}_sprites.zip`);
  })
);

async function saveOneSprite(index, button) {
  await withBusy(button, "...", async () => {
    const { texture, rgba } = current;
    const sprite = texture.sprites[index];
    const crop = cropSprite(rgba, texture.width, sprite);
    const png = await encodePNG(crop.rgba, crop.width, crop.height);
    saveBlob(pngBlob(png), `${safeFileName(sprite.name)}.png`);
  });
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
  if (files.length > 0) {
    openFile(files[0], files.length > 1 ? "여러 파일 중 첫 번째 파일만 열었습니다." : "");
  }
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

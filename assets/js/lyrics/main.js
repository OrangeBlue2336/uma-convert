// 가사 변환기 화면: 파일을 읽고, 사람이 읽을 수 있는 TXT 미리보기와 저장을 연결합니다.

import { convertLyricsBundle, lyricsToText } from "../core/lyrics.js";
import { ConvertError } from "../core/errors.js";
import { saveBlob, safeFileName } from "../ui/download.js";
import { createTabs } from "../ui/tabs.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("file-input");
const statusEl = $("status");
const resultTitle = $("result-title");
const resultInfo = $("result-info");
const preview = $("lyrics-preview");
const saveButton = $("btn-txt");
const tabs = createTabs();

let current = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function describeError(error) {
  if (error instanceof ConvertError) return error.message;
  console.error(error);
  return `변환 중 문제가 생겼습니다: ${error.message}`;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

async function openFile(file, extraNote = "") {
  setStatus(`${file.name} 읽는 중...`);
  await nextFrame();
  try {
    const converted = convertLyricsBundle(new Uint8Array(await file.arrayBuffer()));
    current = { ...converted, text: lyricsToText(converted.rows) };
    resultTitle.textContent = converted.name;
    resultInfo.textContent = `가사 ${converted.rows.length}줄 · ${file.name}에서 읽음`;
    preview.textContent = current.text;
    tabs.setEnabled("tab-result", true);
    tabs.show("tab-result");
    setStatus(extraNote);
  } catch (error) {
    setStatus(describeError(error), true);
    tabs.show("tab-open");
  }
}

saveButton.addEventListener("click", () => {
  if (!current) return;
  const text = new Blob([current.text], { type: "text/plain;charset=utf-8" });
  saveBlob(text, `${safeFileName(current.name)}.txt`);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (file) openFile(file);
});

const hasFiles = (event) => event.dataTransfer?.types?.includes("Files");
window.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropzone.classList.remove("is-over");
  const files = event.dataTransfer.files;
  if (files.length) openFile(files[0], files.length > 1 ? "여러 파일 중 첫 번째 파일만 열었습니다." : "");
});

let dragDepth = 0;
dropzone.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  dragDepth++;
  dropzone.classList.add("is-over");
});
dropzone.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.classList.remove("is-over");
});
dropzone.addEventListener("drop", () => { dragDepth = 0; });

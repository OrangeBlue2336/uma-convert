// USM 변환기 화면: 파일을 읽고, 결과를 보여주고, ZIP으로 저장한 뒤 "다음 단계" 가이드를 띄웁니다.
// 실제 변환은 core/usm.js가 맡고, 이 파일은 화면 배선만 합니다.

import { buildNextSteps, buildUsmReadme, convertUsm } from "../core/usm.js";
import { ConvertError } from "../core/errors.js";
import { createZip } from "../encode/zip.js";
import { saveBlob, safeFileName } from "../ui/download.js";
import { createTabs } from "../ui/tabs.js";
import { wireCopyButton } from "../ui/clipboard.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("file-input");
const statusEl = $("status");
const resultTitle = $("result-title");
const resultInfo = $("result-info");
const keyNote = $("key-note");
const keyToggleButton = $("btn-key-toggle");
const summaryEl = $("usm-summary");
const alphaNote = $("alpha-note");
const zipButton = $("btn-zip");
const stepList = $("step-list");
const tabs = createTabs();

/** 지금 화면에 보이는 결과. bytes를 남겨 두어 키 설정을 바꿔 다시 변환할 수 있게 합니다. */
let current = null; // { bytes, fileName, result }

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- 파일 열기 ----------

async function openFile(file, extraNote = "") {
  setStatus(`${file.name} 여는 중...`);
  await nextFrame();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = convertUsm(bytes);
    current = { bytes, fileName: file.name, result };
    render();
    tabs.setEnabled("tab-result", true);
    tabs.show("tab-result");
    setStatus(extraNote);
  } catch (error) {
    setStatus(describeError(error), true);
    tabs.show("tab-open");
  }
}

/** 결과 화면과 ZIP에 함께 넣을 정보들을 갱신합니다. */
function render() {
  const { result } = current;
  const multiVideo = result.videoTracks.length > 1;

  resultTitle.textContent = result.sourceName;
  const parts = [`영상 ${result.videoTracks.length}개`, `오디오 ${result.audioTracks.length}개`];
  if (result.hasAlpha) parts.push("알파 스트림 있음(제외됨)");
  resultInfo.textContent = `${parts.join(" · ")} · ${current.fileName}에서 읽음`;

  renderKeyNote();
  renderSummary(result, multiVideo);
  alphaNote.hidden = !result.hasAlpha;
  renderNextSteps(result);
}

function renderKeyNote() {
  const { result } = current;
  const hasAdx = result.audioTracks.some((t) => t.format.ext === "adx");
  if (result.keyApplied) {
    keyNote.textContent = hasAdx
      ? "알려진 키로 영상과 ADX 오디오를 복호화했습니다."
      : "알려진 키로 영상을 복호화했습니다.";
    keyToggleButton.textContent = "키 없이 다시 변환";
    keyToggleButton.hidden = false;
  } else {
    keyNote.textContent = hasAdx
      ? "키를 적용하지 않고 원본 바이트를 그대로 꺼냈습니다. 영상이나 ADX 오디오가 깨져 보이면 파일을 다시 열어 보세요."
      : "키를 적용하지 않고 원본 바이트를 그대로 꺼냈습니다. 영상이 깨져 보이면 파일을 다시 열어 보세요.";
    keyToggleButton.hidden = true;
  }
}

function formatVideoInfo(info) {
  if (!info) return "";
  const bits = [`${info.width}×${info.height}`];
  if (info.framerate_n) {
    const rate = info.framerate_n / (info.framerate_d || 1);
    bits.push(Number.isInteger(rate) ? `${rate}fps` : `${rate.toFixed(3)}fps`);
  }
  if (info.total_frames) bits.push(`${info.total_frames}프레임`);
  return bits.join(", ");
}

function formatAudioInfo(track) {
  const bits = [track.format.label ?? "형식 미확인"];
  const info = track.info;
  if (info?.sampling_rate) bits.push(`${info.sampling_rate}Hz`);
  if (info?.num_channels) bits.push(`${info.num_channels}채널`);
  return bits.join(", ");
}

function audioFileName(track) {
  return `audio_${track.type}.${track.format.ext}`;
}

function renderSummary(result, multiVideo) {
  const rows = [];
  for (const track of result.videoTracks) {
    const name = multiVideo ? `video_${track.type}.h264` : "video.h264";
    rows.push({ name, size: track.bytes.length, detail: formatVideoInfo(track.info) });
  }
  for (const track of result.audioTracks) {
    rows.push({
      name: audioFileName(track),
      size: track.bytes.length,
      detail: formatAudioInfo(track),
    });
  }

  summaryEl.replaceChildren(
    ...rows.map((row) => {
      const li = el("li", "usm-summary-row");
      li.append(el("span", "usm-summary-name", row.name));
      const meta = [`${row.size.toLocaleString()} 바이트`];
      if (row.detail) meta.push(row.detail);
      li.append(el("span", "usm-summary-meta", meta.join(" · ")));
      return li;
    }),
  );
}

// ---------- 다음 단계 ----------

function renderNextSteps(result) {
  const steps = buildNextSteps(result);
  stepList.replaceChildren(
    ...steps.map((step) => {
      const li = el("li", "step-card");
      li.append(el("h3", "step-title", step.title));
      if (step.body) li.append(el("p", "step-body", step.body));
      for (const cmd of step.commands ?? []) {
        const row = el("div", "code-block");
        row.append(el("span", "code-label", cmd.label));
        const pre = el("pre");
        pre.append(el("code", null, cmd.text));
        const copyButton = el("button", "btn small", "복사");
        copyButton.type = "button";
        wireCopyButton(copyButton, cmd.text);
        const line = el("div", "code-line");
        line.append(pre, copyButton);
        row.append(line);
        li.append(row);
      }
      return li;
    }),
  );
}

// ---------- 키 사용 여부 다시 시도 ----------

keyToggleButton.addEventListener("click", () => {
  if (!current) return;
  try {
    const forceKey = !current.result.keyApplied;
    current.result = convertUsm(current.bytes, { forceKey });
    render();
    setStatus("");
  } catch (error) {
    setStatus(describeError(error), true);
  }
});

// ---------- ZIP 저장 ----------

zipButton.addEventListener("click", async () => {
  if (!current) return;
  const label = zipButton.textContent;
  zipButton.disabled = true;
  zipButton.textContent = "묶는 중...";
  try {
    const { result } = current;
    const multiVideo = result.videoTracks.length > 1;
    const entries = [];
    for (const track of result.videoTracks) {
      entries.push({ name: multiVideo ? `video_${track.type}.h264` : "video.h264", data: track.bytes });
    }
    for (const track of result.audioTracks) {
      entries.push({ name: audioFileName(track), data: track.bytes });
    }
    entries.push({ name: "README.txt", data: new TextEncoder().encode(buildUsmReadme(result)) });

    saveBlob(createZip(entries), `${safeFileName(result.sourceName)}.zip`);

    tabs.setEnabled("tab-next", true);
    tabs.show("tab-next");
  } catch (error) {
    window.alert(describeError(error));
  } finally {
    zipButton.disabled = false;
    zipButton.textContent = label;
  }
});

// ---------- 끌어놓기 / 파일 선택 ----------

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
dropzone.addEventListener("drop", () => {
  dragDepth = 0;
});

// 사용자가 직접 붙이는 "값 라벨" (예: running_style 값 1 = 도주).
//
// 숫자 코드의 뜻은 게임 데이터 안에 없고, 이 도구가 임의로 추측해서 채우면 틀린 정보를 사실처럼 보이게 됩니다.
// 그래서 기본값은 비워 두고, 사용자가 확인한 뜻만 브라우저(localStorage)에 저장합니다. JSON으로 내보내고 불러올 수 있어
// 한 번 정리한 사전을 다른 컴퓨터나 새 게임 버전에서도 쓸 수 있습니다.

import { el, button } from "../ui/dom.js";
import { saveBlob } from "../ui/download.js";
import { t } from "../i18n/index.js";

const KEY = "uma-convert-mdb-labels";

export function loadUserLabels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // 저장소가 막혀 있거나 값이 깨져 있어도 도구는 그대로 동작해야 합니다.
  }
}

export function saveUserLabels(labels) {
  try {
    localStorage.setItem(KEY, JSON.stringify(labels));
    return true;
  } catch {
    return false;
  }
}

/** 컬럼에 라벨을 붙일 수 있는지: 값 종류가 40개 이하인 숫자 컬럼만 (그 이상은 라벨보다 참조/이름이 맞는 경우입니다). */
export const LABEL_MAX_VALUES = 40;

/**
 * @param {{ userLabels: object, dialog: HTMLDialogElement }} app
 * @param {() => void} onChanged 저장 후 화면을 다시 그리는 함수
 */
export function openLabelEditor(app, table, column, values, onChanged) {
  const key = `${table}.${column}`;
  const current = app.userLabels[key] ?? {};
  const dialog = app.labelDialog;
  dialog.replaceChildren();

  const form = el("div", "mdb-label-form");
  form.append(el("h3", "", t("mdb.labels.title", { column: key })));
  form.append(el("p", "hint", t("mdb.labels.hint")));

  const inputs = new Map();
  const list = el("div", "mdb-label-rows");
  for (const value of values) {
    const row = el("label", "mdb-label-row");
    row.append(el("span", "mdb-label-value", String(value)));
    const input = el("input");
    input.type = "text";
    input.value = current[String(value)] ?? "";
    input.placeholder = t("mdb.labels.placeholder");
    inputs.set(String(value), input);
    row.append(input);
    list.append(row);
  }
  form.append(list);

  const actions = el("div", "mdb-label-actions");
  actions.append(
    button(t("mdb.labels.save"), () => {
      const next = {};
      for (const [value, input] of inputs) if (input.value.trim()) next[value] = input.value.trim();
      if (Object.keys(next).length) app.userLabels[key] = next;
      else delete app.userLabels[key];
      saveUserLabels(app.userLabels);
      dialog.close();
      onChanged();
    }, "btn primary"),
    button(t("mdb.labels.cancel"), () => dialog.close(), "btn"),
    button(t("mdb.labels.export"), () => {
      saveBlob(new Blob([JSON.stringify(app.userLabels, null, 2)], { type: "application/json" }), "mdb-labels.json");
    }, "btn"),
  );

  // 불러오기는 기존 라벨에 합칩니다(같은 컬럼이면 덮어씀). 내용이 이상한 파일은 조용히 무시하지 않고 알려 줍니다.
  const importLabel = el("label", "btn");
  importLabel.append(t("mdb.labels.import"));
  const importInput = el("input");
  importInput.type = "file";
  importInput.accept = ".json,application/json";
  importInput.hidden = true;
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      Object.assign(app.userLabels, parsed);
      saveUserLabels(app.userLabels);
      dialog.close();
      onChanged();
    } catch {
      alert(t("mdb.labels.importError"));
    }
  });
  importLabel.append(importInput);
  actions.append(importLabel);
  form.append(actions);

  dialog.append(form);
  dialog.showModal();
}

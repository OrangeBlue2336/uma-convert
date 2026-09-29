// 페이지는 한 벌만 유지하고, 화면 문구만 사전으로 바꿉니다.
// 새 변환기는 HTML에 data-i18n 키를 붙이고 사전에 키를 더한 뒤 이 모듈을 import하면 됩니다.

const SUPPORTED = new Set(["ko", "en"]);
const FALLBACK_LANGUAGE = "ko";
let dictionary = {};
let language = FALLBACK_LANGUAGE;

function selectedLanguage() {
  const fromQuery = new URLSearchParams(location.search).get("lang");
  const fromStorage = localStorage.getItem("uma-convert-language");
  return SUPPORTED.has(fromQuery) ? fromQuery : SUPPORTED.has(fromStorage) ? fromStorage : FALLBACK_LANGUAGE;
}

function format(message, values) {
  return message.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}

/** 현재 언어의 문구를 가져옵니다. 누락된 키는 fallback을 보여 주므로 새 페이지도 안전합니다. */
export function t(key, values = {}, fallback = key) {
  const message = key.split(".").reduce((part, name) => part?.[name], dictionary);
  return format(typeof message === "string" ? message : fallback, values);
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function applyDocumentText() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n, {}, element.textContent);
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    for (const attribute of element.dataset.i18nAttr.split(/\s+/)) {
      const key = element.dataset[`i18n${attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}`];
      if (key) element.setAttribute(attribute, t(key, {}, element.getAttribute(attribute) ?? ""));
    }
  });
  document.title = t(document.documentElement.dataset.i18nTitle, {}, document.title);
}

function wireLanguageSwitcher() {
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
    button.addEventListener("click", () => {
      const next = button.dataset.language;
      if (!SUPPORTED.has(next) || next === language) return;
      localStorage.setItem("uma-convert-language", next);
      const url = new URL(location.href);
      url.searchParams.set("lang", next);
      location.assign(url);
    });
  });
}

/** 사전을 불러오고 정적 HTML, 제목, 언어 버튼을 한 번에 초기화합니다. */
export async function initI18n() {
  language = selectedLanguage();
  try {
    const scope = document.documentElement.dataset.i18nScope ?? "home";
    const responses = await Promise.all(["common", scope].map(async (part) => {
      const response = await fetch(new URL(`./${language}/${part}.json`, import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }));
    dictionary = responses.reduce(merge, {});
  } catch (error) {
    console.warn("언어 사전을 불러오지 못해 HTML 기본 문구를 사용합니다.", error);
  }
  applyDocumentText();
  wireLanguageSwitcher();
  return language;
}

export function currentLanguage() {
  return language;
}

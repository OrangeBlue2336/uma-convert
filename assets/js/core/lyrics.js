// 라이브 가사 번들의 TextAsset을 읽어, 화면과 저장 기능이 함께 쓸 수 있는 행으로 만듭니다.
// UnityFS/SerializedFile 해석은 기존 코어를 그대로 이용하므로 이 파일도 DOM에 의존하지 않습니다.

import { ConvertError } from "./errors.js";
import { parseSerializedFile } from "./serialized.js";
import { parseBundle } from "./unityfs.js";

const CLASS_TEXT_ASSET = 49;
const HEADER = "time,lyrics";

function parseLyricsValue(value, lineNumber) {
  // 쉼표가 든 가사는 CSV 관례대로 큰따옴표로 감싸져 있습니다.
  // 표시용 가사에는 그 바깥 따옴표가 필요 없고, [COMMA]는 원본 제작 과정의 이스케이프 표기입니다.
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new ConvertError(`${lineNumber}번째 가사의 큰따옴표가 닫히지 않았습니다.`);
    }
    value = value.slice(1, -1).replaceAll('""', '"');
  }
  return value.replaceAll("[COMMA]", ",");
}

/** 밀리초를 사람이 읽는 분:초.밀리초 표기로 바꿉니다. */
export function formatLyricsTime(timeMs) {
  const milliseconds = String(timeMs % 1000).padStart(3, "0");
  const totalSeconds = Math.floor(timeMs / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${seconds}.${milliseconds}`;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${seconds}.${milliseconds}`;
}

/** 가사 행을 줄마다 시간과 함께 보이는 평문으로 만듭니다. */
export function lyricsToText(rows) {
  return rows.map(({ timeMs, lyrics }) => `${formatLyricsTime(timeMs)}${lyrics ? `  ${lyrics}` : ""}`).join("\n");
}

function parseLyricsScript(script) {
  const lines = script.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== HEADER) {
    throw new ConvertError("가사 TextAsset의 첫 줄이 time,lyrics 형식이 아닙니다.");
  }

  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;
    const comma = line.indexOf(",");
    const timeText = comma < 0 ? "" : line.slice(0, comma);
    if (!/^\d+$/.test(timeText)) {
      throw new ConvertError(`${lineNumber}번째 줄의 시간 값이 밀리초 정수가 아닙니다.`);
    }
    return {
      timeMs: Number(timeText),
      lyrics: parseLyricsValue(line.slice(comma + 1), lineNumber),
    };
  });
}

/**
 * @param {Uint8Array} bytes UnityFS 가사 파일 전체
 * @returns {{ name: string, rows: { timeMs: number, lyrics: string }[] }}
 */
export function convertLyricsBundle(bytes) {
  const bundle = parseBundle(bytes);
  const candidates = [];

  for (const file of bundle.files) {
    let serialized;
    try {
      serialized = parseSerializedFile(file.data);
    } catch {
      continue;
    }
    for (const object of serialized.objects) {
      if (object.classId !== CLASS_TEXT_ASSET) continue;
      const asset = serialized.read(object);
      if (typeof asset.m_Script === "string" && asset.m_Script.replace(/^\uFEFF/, "").startsWith(HEADER)) {
        candidates.push({ name: asset.m_Name, script: asset.m_Script });
      }
    }
  }

  if (candidates.length === 0) {
    throw new ConvertError("time,lyrics 형식의 가사를 이 Unity 번들에서 찾지 못했습니다.");
  }
  if (candidates.length > 1) {
    throw new ConvertError("가사 TextAsset이 여러 개라 어느 것을 변환할지 정할 수 없습니다.");
  }

  const { name, script } = candidates[0];
  return { name, rows: parseLyricsScript(script) };
}

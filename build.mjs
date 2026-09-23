// 여러 페이지에 똑같이 들어가야 하는 조각(지금은 파비콘·폰트·base.css 링크)을
// 한 곳(_partials/)에서만 관리하고, 실제 페이지 파일에 그대로 채워 넣는 도구입니다.
//
// 사용법 (커밋하기 전에 한 번 실행):
//   node build.mjs
//
// 동작 방식:
//   페이지 파일 안에 아래처럼 "관리되는 블록"이 있으면
//
//     <!-- BUILD:START head-common.html -->
//     ...예전 내용...
//     <!-- BUILD:END -->
//
//   _partials/head-common.html의 내용으로 그 사이만 새로 채워 넣습니다. 그 밖의 내용(제목,
//   설명, 본문 등)은 절대 건드리지 않습니다.
//
//   조각 파일 안의 {{ROOT}}는 그 페이지에서 저장소 최상위로 돌아가는 상대 경로로 바뀝니다.
//   최상위 index.html이면 빈 문자열, 한 단계 아래(sprite/index.html)면 "../"가 됩니다.
//
// 이 스크립트는 결과물을 별도 폴더가 아니라 원래 파일 자리에 그대로 덮어씁니다. 즉 이 저장소에는
// "원본"과 "결과물"이 따로 없고, 커밋하는 파일이 곧 그대로 배포되는 파일입니다.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const PARTIALS_DIR = join(ROOT_DIR, "_partials");
const SKIP_DIRS = new Set([".git", "_partials", "node_modules"]);

const BLOCK_RE = /(<!-- BUILD:START ([^\s>]+) -->\n)([\s\S]*?)([ \t]*<!-- BUILD:END -->)/g;

/** repo 안의 .html 파일을 전부 찾습니다 (_partials 폴더는 제외). */
function findHtmlFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...findHtmlFiles(full));
    } else if (extname(name) === ".html") {
      found.push(full);
    }
  }
  return found;
}

/** file이 있는 폴더에서 저장소 최상위로 돌아가는 상대 경로. 최상위면 "". */
function rootPrefix(file) {
  const rel = relative(dirname(file), ROOT_DIR);
  return rel === "" ? "" : rel.replace(/\\/g, "/") + "/";
}

function loadPartial(name) {
  try {
    return readFileSync(join(PARTIALS_DIR, name), "utf8");
  } catch {
    throw new Error(`_partials/${name} 파일을 찾을 수 없습니다.`);
  }
}

let changedFiles = 0;
let uncheckedFiles = 0;
let blockCount = 0;

for (const file of findHtmlFiles(ROOT_DIR)) {
  const original = readFileSync(file, "utf8");
  const root = rootPrefix(file);
  let blocksInFile = 0;

  // 정규식 하나를 파일마다 새로 만들어, 전역(g) 플래그의 lastIndex가 파일 사이에서 꼬이지 않게 합니다.
  const next = original.replace(new RegExp(BLOCK_RE), (whole, startLine, partialName, _oldBody, endLine) => {
    blocksInFile++;
    const rendered = loadPartial(partialName).replaceAll("{{ROOT}}", root);
    const body = rendered.endsWith("\n") ? rendered : rendered + "\n";
    return startLine + body + endLine;
  });

  blockCount += blocksInFile;
  if (blocksInFile === 0) {
    uncheckedFiles++;
  } else if (next !== original) {
    writeFileSync(file, next);
    changedFiles++;
    console.log(`업데이트: ${relative(ROOT_DIR, file)}`);
  }
}

console.log(
  `끝. 관리되는 블록 ${blockCount}개, 갱신된 파일 ${changedFiles}개` +
    (uncheckedFiles ? `, 블록이 없어 그대로 둔 파일 ${uncheckedFiles}개.` : ".")
);

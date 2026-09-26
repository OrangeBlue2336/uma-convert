// 웹페이지 없이 USM 코어만 실행해 보는 명령줄 도구입니다. (Node.js 18 이상)
//
//   node tests/usm-cli.mjs <.usm 파일> [출력 폴더] [--no-key]
//
// video*.h264, audio_*.(adx|hca|bin), README.txt를 출력 폴더에 저장합니다. 오디오 확장자는 실제
// 내용(헤더 시그니처)으로 자동 판별합니다. 기본적으로 항상 알려진 키를
// 적용합니다(화면과 동일). 키 없이 원본 그대로 꺼내 보고 싶을 때만 --no-key를 붙이세요. 웹앱과 같은
// 코어를 쓰므로, 웹에서 결과가 이상할 때 여기서 먼저 재현해 보면 원인이 화면인지 변환인지 구분할 수 있습니다.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { buildUsmReadme, convertUsm } from "../assets/js/core/usm.js";

const args = process.argv.slice(2);
const noKeyIndex = args.indexOf("--no-key");
const forceKey = noKeyIndex === -1;
const [input, outDir = "out"] = args.filter((_, i) => i !== noKeyIndex);

if (!input) {
  console.error("사용법: node tests/usm-cli.mjs <.usm 파일> [출력 폴더] [--no-key]");
  process.exit(1);
}

const bytes = new Uint8Array(await readFile(input));
const result = convertUsm(bytes, { forceKey });

console.log(`${basename(input)}  원본 이름: ${result.sourceName}`);
console.log(
  `영상 트랙 ${result.videoTracks.length}개, 오디오 트랙 ${result.audioTracks.length}개, 알파 있음: ${result.hasAlpha}`,
);
console.log(`키 적용: ${result.keyApplied}`);

await mkdir(outDir, { recursive: true });

const multiVideo = result.videoTracks.length > 1;
for (const track of result.videoTracks) {
  const name = multiVideo ? `video_${track.type}.h264` : "video.h264";
  await writeFile(join(outDir, name), track.bytes);
  console.log(`- ${name}  ${track.bytes.length.toLocaleString()} 바이트`);
}

for (const track of result.audioTracks) {
  const name = `audio_${track.type}.${track.format.ext}`;
  await writeFile(join(outDir, name), track.bytes);
  console.log(`- ${name}  ${track.bytes.length.toLocaleString()} 바이트 (${track.format.label ?? "형식 미확인"})`);
}

await writeFile(join(outDir, "README.txt"), buildUsmReadme(result), "utf-8");
console.log(`- README.txt`);

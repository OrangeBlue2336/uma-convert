// 웹페이지 없이 코어만 실행해 보는 명령줄 도구입니다. (Node.js 18 이상)
//
//   node tests/convert-cli.mjs <번들 파일> [출력 폴더]
//
// 시트 PNG와 조각 PNG들을 출력 폴더에 저장합니다. 웹앱과 같은 코어를 쓰므로,
// 웹앱 결과가 이상할 때 여기서 먼저 재현해 보면 원인이 화면인지 변환인지 구분할 수 있습니다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { convertBundle } from "../assets/js/core/convert.js";
import { cropSprite } from "../assets/js/core/sprites.js";
import { encodePNG } from "../assets/js/encode/png.js";

const [input, outDir = "out"] = process.argv.slice(2);
if (!input) {
  console.error("사용법: node tests/convert-cli.mjs <번들 파일> [출력 폴더]");
  process.exit(1);
}

const bytes = new Uint8Array(await readFile(input));
const { unityVersion, textures } = convertBundle(bytes);
console.log(`${basename(input)}  Unity ${unityVersion}  텍스처 ${textures.length}개`);

await mkdir(join(outDir, "sprites"), { recursive: true });

for (const texture of textures) {
  console.log(`- ${texture.name}  ${texture.width}x${texture.height}  ${texture.formatName}  조각 ${texture.sprites.length}개`);

  const started = performance.now();
  const rgba = texture.decode();
  console.log(`  디코딩 ${Math.round(performance.now() - started)}ms`);

  const png = await encodePNG(rgba, texture.width, texture.height);
  await writeFile(join(outDir, `${texture.name}.png`), png);
  console.log(`  PNG ${(png.length / 1024).toFixed(0)}KB, 총 ${Math.round(performance.now() - started)}ms`);

  for (const sprite of texture.sprites) {
    const crop = cropSprite(rgba, texture.width, sprite);
    await writeFile(join(outDir, "sprites", `${sprite.name}.png`), await encodePNG(crop.rgba, crop.width, crop.height));
  }
}

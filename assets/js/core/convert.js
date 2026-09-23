// 코어의 진입점입니다. 파일 바이트를 받아 "텍스처 목록과 스프라이트 목록"을 돌려줍니다.
// 화면(DOM)에 의존하지 않아서 브라우저와 Node.js 양쪽에서 똑같이 동작합니다.

import { parseBundle } from "./unityfs.js";
import { parseSerializedFile } from "./serialized.js";
import { listTextures } from "./texture.js";
import { listSprites } from "./sprites.js";
import { ConvertError } from "./errors.js";

const NODE_FLAG_SERIALIZED = 0x4;

/**
 * @param {Uint8Array} bytes 업로드된 파일 전체
 * @returns {{
 *   unityVersion: string,
 *   textures: {
 *     name: string, width: number, height: number, formatName: string,
 *     sprites: { name: string, x: number, y: number, width: number, height: number }[],
 *     decode: () => Uint8Array
 *   }[]
 * }}
 */
export function convertBundle(bytes) {
  const bundle = parseBundle(bytes);

  const resources = new Map(bundle.files.map((f) => [f.path.slice(f.path.lastIndexOf("/") + 1), f]));
  const assetFiles = bundle.files.filter((f) => f.flags & NODE_FLAG_SERIALIZED);
  if (assetFiles.length === 0) throw new ConvertError("번들 안에 에셋 데이터가 없습니다.");

  const textures = [];
  for (const file of assetFiles) {
    const serialized = parseSerializedFile(file.data);
    for (const texture of listTextures(serialized, resources)) {
      texture.sprites = listSprites(serialized, texture);
      textures.push(texture);
    }
  }

  if (textures.length === 0) {
    throw new ConvertError("이 번들에는 텍스처(Texture2D)가 없습니다. 텍스처 파일이 맞는지 확인해 주세요.");
  }

  return { unityVersion: bundle.unityVersion, textures };
}

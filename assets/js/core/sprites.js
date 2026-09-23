// 텍스처 한 장에 들어 있는 스프라이트(조각)의 위치를 읽고, 그 영역을 잘라냅니다.
//
// Unity의 스프라이트 좌표(m_Rect)는 이미지의 "왼쪽 아래"가 기준입니다.
// 이 프로젝트의 나머지 코드는 화면과 같은 "왼쪽 위" 기준이라, 여기서 한 번만 변환합니다.
//
// m_Rect는 작가가 잡은 조각 전체 영역(정수 좌표)이고, m_RD.textureRect는 투명한 가장자리를
// 깎아낸 소수 좌표 영역입니다. 조각을 원래 그대로 저장하려고 m_Rect를 사용합니다.

import { CLASS_SPRITE } from "./serialized.js";

/**
 * @param {ReturnType<import("./serialized.js").parseSerializedFile>} serialized
 * @param {{ pathId: bigint, width: number, height: number }} texture
 * @returns {{ name: string, x: number, y: number, width: number, height: number }[]}
 */
export function listSprites(serialized, texture) {
  const sprites = [];

  for (const object of serialized.objects) {
    if (object.classId !== CLASS_SPRITE) continue;
    const s = serialized.read(object);

    if (s.m_RD?.texture?.m_PathID !== texture.pathId) continue;

    const rect = s.m_Rect;
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const x = Math.round(rect.x);
    const y = texture.height - Math.round(rect.y) - height; // 왼쪽 아래 기준 -> 왼쪽 위 기준

    // 이미지 밖으로 나간 부분은 잘라냅니다.
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(texture.width, x + width);
    const bottom = Math.min(texture.height, y + height);
    if (right <= left || bottom <= top) continue;

    sprites.push({ name: s.m_Name, x: left, y: top, width: right - left, height: bottom - top });
  }

  return sprites.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/**
 * 텍스처 전체 픽셀에서 조각 영역만 잘라 새 RGBA 배열로 돌려줍니다.
 * @param {Uint8Array} rgba 텍스처 전체 (위쪽 줄부터)
 * @param {number} textureWidth
 */
export function cropSprite(rgba, textureWidth, sprite) {
  const { x, y, width, height } = sprite;
  const out = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * textureWidth + x) * 4;
    out.set(rgba.subarray(from, from + rowBytes), row * rowBytes);
  }
  return { rgba: out, width, height };
}

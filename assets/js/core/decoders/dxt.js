// DXT1(BC1)과 DXT5(BC3) 압축 이미지를 RGBA로 풉니다.
// 이미지를 4x4 픽셀 블록으로 나눠, 블록마다 색 2개와 보간 규칙만 저장하는 방식입니다.

/** 색 블록(8바이트)을 풀어 16개 픽셀의 RGBA를 out에 씁니다. */
function decodeColorBlock(src, at, palette, fourColorOnly) {
  const c0 = src[at] | (src[at + 1] << 8);
  const c1 = src[at + 2] | (src[at + 3] << 8);

  // RGB565 -> RGB888
  const r0 = ((c0 >> 11) & 31), g0 = ((c0 >> 5) & 63), b0 = (c0 & 31);
  const r1 = ((c1 >> 11) & 31), g1 = ((c1 >> 5) & 63), b1 = (c1 & 31);
  const R0 = (r0 << 3) | (r0 >> 2), G0 = (g0 << 2) | (g0 >> 4), B0 = (b0 << 3) | (b0 >> 2);
  const R1 = (r1 << 3) | (r1 >> 2), G1 = (g1 << 2) | (g1 >> 4), B1 = (b1 << 3) | (b1 >> 2);

  palette[0] = R0; palette[1] = G0; palette[2] = B0; palette[3] = 255;
  palette[4] = R1; palette[5] = G1; palette[6] = B1; palette[7] = 255;

  if (fourColorOnly || c0 > c1) {
    palette[8] = ((2 * R0 + R1) / 3) | 0;
    palette[9] = ((2 * G0 + G1) / 3) | 0;
    palette[10] = ((2 * B0 + B1) / 3) | 0;
    palette[11] = 255;
    palette[12] = ((R0 + 2 * R1) / 3) | 0;
    palette[13] = ((G0 + 2 * G1) / 3) | 0;
    palette[14] = ((B0 + 2 * B1) / 3) | 0;
    palette[15] = 255;
  } else {
    // 3색 + 투명(DXT1 전용)
    palette[8] = (R0 + R1) >> 1;
    palette[9] = (G0 + G1) >> 1;
    palette[10] = (B0 + B1) >> 1;
    palette[11] = 255;
    palette[12] = 0; palette[13] = 0; palette[14] = 0; palette[15] = 0;
  }
}

/** DXT5의 알파 블록(8바이트)에서 알파 팔레트 8개를 만듭니다. */
function buildAlphaPalette(src, at, alphas) {
  const a0 = src[at];
  const a1 = src[at + 1];
  alphas[0] = a0;
  alphas[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) alphas[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
  } else {
    for (let i = 1; i <= 4; i++) alphas[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
    alphas[6] = 0;
    alphas[7] = 255;
  }
}

function decode(src, width, height, hasAlphaBlock) {
  const out = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const blockBytes = hasAlphaBlock ? 16 : 8;
  const needed = blocksX * blocksY * blockBytes;
  if (src.length < needed) {
    throw new RangeError(`이미지 데이터가 부족합니다 (${src.length} / ${needed} 바이트).`);
  }

  const palette = new Uint8Array(16);
  const alphas = new Uint8Array(8);
  let at = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // 알파 인덱스는 48비트(16픽셀 x 3비트)라서 24비트씩 둘로 나눠 읽습니다.
      let alphaLow = 0;
      let alphaHigh = 0;
      if (hasAlphaBlock) {
        buildAlphaPalette(src, at, alphas);
        alphaLow = src[at + 2] | (src[at + 3] << 8) | (src[at + 4] << 16);
        alphaHigh = src[at + 5] | (src[at + 6] << 8) | (src[at + 7] << 16);
        at += 8;
      }

      decodeColorBlock(src, at, palette, hasAlphaBlock);
      const indices = src[at + 4] | (src[at + 5] << 8) | (src[at + 6] << 16) | (src[at + 7] << 24);
      at += 8;

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) continue;
          const i = py * 4 + px;
          const p = ((indices >>> (i * 2)) & 3) * 4;
          const o = (y * width + x) * 4;
          out[o] = palette[p];
          out[o + 1] = palette[p + 1];
          out[o + 2] = palette[p + 2];
          if (hasAlphaBlock) {
            const a = i < 8 ? (alphaLow >> (i * 3)) & 7 : (alphaHigh >> ((i - 8) * 3)) & 7;
            out[o + 3] = alphas[a];
          } else {
            out[o + 3] = palette[p + 3];
          }
        }
      }
    }
  }
  return out;
}

export const decodeDXT1 = (src, w, h) => decode(src, w, h, false);
export const decodeDXT5 = (src, w, h) => decode(src, w, h, true);

/** 이미지 한 장(밉맵 0단계)이 차지하는 바이트 수 */
export const dxtSize = (w, h, blockBytes) => Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;

// RGBA 픽셀을 PNG 파일로 만듭니다.
//
// 브라우저 canvas의 toBlob()을 쓰면 반투명 픽셀의 색이 미세하게 바뀌므로(내부에서 알파를 곱해 저장),
// 원본 픽셀을 그대로 보존하기 위해 PNG를 직접 만듭니다. 압축(deflate)만 브라우저 기능을 사용합니다.

import { crc32 } from "./crc32.js";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const BYTES_PER_PIXEL = 4;

/** zlib 형식으로 압축 (PNG의 IDAT가 요구하는 형식) */
async function deflate(bytes) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("이 브라우저는 PNG 압축 기능(CompressionStream)을 지원하지 않습니다. 최신 브라우저를 사용해 주세요.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 줄마다 압축이 가장 잘 되는 필터(None / Sub / Up / Paeth)를 골라 적용합니다.
 * 필터 결과의 절댓값 합이 가장 작은 것을 고르는 일반적인 방법입니다.
 */
function applyFilters(rgba, width, height) {
  const stride = width * BYTES_PER_PIXEL;
  const out = new Uint8Array((stride + 1) * height);
  const zeros = new Uint8Array(stride);
  const trial = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const bpp = BYTES_PER_PIXEL;
  const score = (v) => (v < 128 ? v : 256 - v);

  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : zeros;

    // 0: None
    let bestFilter = 0;
    let bestSum = 0;
    for (let i = 0; i < stride; i++) bestSum += score(row[i]);

    if (bestSum > 0) {
      // 1: Sub
      let sum = 0;
      let buf = trial[1];
      for (let i = 0; i < stride; i++) {
        const v = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 255;
        buf[i] = v;
        sum += score(v);
      }
      if (sum < bestSum) { bestSum = sum; bestFilter = 1; }

      // 2: Up
      sum = 0;
      buf = trial[2];
      for (let i = 0; i < stride; i++) {
        const v = (row[i] - prev[i]) & 255;
        buf[i] = v;
        sum += score(v);
      }
      if (sum < bestSum) { bestSum = sum; bestFilter = 2; }

      // 3: Paeth
      sum = 0;
      buf = trial[3];
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        const v = (row[i] - predictor) & 255;
        buf[i] = v;
        sum += score(v);
      }
      if (sum < bestSum) { bestSum = sum; bestFilter = 3; }
    }

    const o = y * (stride + 1);
    out[o] = bestFilter === 3 ? 4 : bestFilter; // PNG 필터 번호: Sub=1, Up=2, Paeth=4
    out.set(bestFilter === 0 ? row : trial[bestFilter], o + 1);
  }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * @param {Uint8Array} rgba width * height * 4 바이트
 * @returns {Promise<Uint8Array>} PNG 파일 내용
 */
export async function encodePNG(rgba, width, height) {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // 채널당 8비트
  header[9] = 6; // RGBA

  const idat = await deflate(applyFilters(rgba, width, height));
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", header), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];

  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

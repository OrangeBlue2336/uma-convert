// 압축하지 않은 텍스처 형식을 RGBA(바이트 순서 R,G,B,A)로 바꿉니다.

// 5/6비트 값을 8비트로 늘릴 때 소수점은 버립니다 (UnityPy와 같은 방식).
const expand5 = (v) => ((v * 255) / 31) | 0;
const expand6 = (v) => ((v * 255) / 63) | 0;
const expand4 = (v) => v * 17;

/** 픽셀당 바이트 수와 변환 함수를 받아 디코더를 만듭니다. */
function makeDecoder(bytesPerPixel, convert) {
  return (src, width, height) => {
    const count = width * height;
    if (src.length < count * bytesPerPixel) {
      throw new RangeError(`이미지 데이터가 부족합니다 (${src.length} / ${count * bytesPerPixel} 바이트).`);
    }
    const out = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) convert(src, i * bytesPerPixel, out, i * 4);
    return out;
  };
}

export const decodeRGBA32 = (src, w, h) => {
  const n = w * h * 4;
  if (src.length < n) throw new RangeError(`이미지 데이터가 부족합니다 (${src.length} / ${n} 바이트).`);
  return src.slice(0, n);
};

export const decodeARGB32 = makeDecoder(4, (s, i, o, j) => {
  o[j] = s[i + 1]; o[j + 1] = s[i + 2]; o[j + 2] = s[i + 3]; o[j + 3] = s[i];
});

export const decodeBGRA32 = makeDecoder(4, (s, i, o, j) => {
  o[j] = s[i + 2]; o[j + 1] = s[i + 1]; o[j + 2] = s[i]; o[j + 3] = s[i + 3];
});

export const decodeRGB24 = makeDecoder(3, (s, i, o, j) => {
  o[j] = s[i]; o[j + 1] = s[i + 1]; o[j + 2] = s[i + 2]; o[j + 3] = 255;
});

// 알파만 있는 텍스처: 색은 검정, 값은 투명도로 옮깁니다 (UnityPy와 같은 방식).
export const decodeAlpha8 = makeDecoder(1, (s, i, o, j) => {
  o[j] = 0; o[j + 1] = 0; o[j + 2] = 0; o[j + 3] = s[i];
});

export const decodeR8 = makeDecoder(1, (s, i, o, j) => {
  o[j] = s[i]; o[j + 1] = 0; o[j + 2] = 0; o[j + 3] = 255;
});

export const decodeRGB565 = makeDecoder(2, (s, i, o, j) => {
  const v = s[i] | (s[i + 1] << 8);
  o[j] = expand5((v >> 11) & 31);
  o[j + 1] = expand6((v >> 5) & 63);
  o[j + 2] = expand5(v & 31);
  o[j + 3] = 255;
});

export const decodeRGBA4444 = makeDecoder(2, (s, i, o, j) => {
  const v = s[i] | (s[i + 1] << 8);
  o[j] = expand4((v >> 12) & 15);
  o[j + 1] = expand4((v >> 8) & 15);
  o[j + 2] = expand4((v >> 4) & 15);
  o[j + 3] = expand4(v & 15);
});

export const decodeARGB4444 = makeDecoder(2, (s, i, o, j) => {
  const v = s[i] | (s[i + 1] << 8);
  o[j] = expand4((v >> 8) & 15);
  o[j + 1] = expand4((v >> 4) & 15);
  o[j + 2] = expand4(v & 15);
  o[j + 3] = expand4((v >> 12) & 15);
});

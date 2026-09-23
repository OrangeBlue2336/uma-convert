// LZ4 블록 압축 해제기입니다. Unity 번들의 LZ4 / LZ4HC 블록은 모두 이 형식입니다.

/**
 * @param {Uint8Array} src 압축된 데이터
 * @param {number} dstSize 압축을 풀었을 때의 크기 (번들 머리글에 적혀 있음)
 * @returns {Uint8Array}
 */
export function lz4Decompress(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let s = 0;
  let d = 0;

  while (s < src.length) {
    const token = src[s++];

    // 1) 그대로 복사할 글자(literal) 수
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let b;
      do {
        b = src[s++];
        literalLength += b;
      } while (b === 255);
    }
    if (s + literalLength > src.length || d + literalLength > dstSize) {
      throw new Error("LZ4 데이터가 손상되었습니다.");
    }
    dst.set(src.subarray(s, s + literalLength), d);
    s += literalLength;
    d += literalLength;

    // 마지막 조각은 literal만 있고 끝납니다.
    if (s >= src.length) break;

    // 2) 앞에서 이미 나온 데이터를 되풀이
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > d) {
      throw new Error("LZ4 데이터가 손상되었습니다.");
    }

    let matchLength = token & 15;
    if (matchLength === 15) {
      let b;
      do {
        b = src[s++];
        matchLength += b;
      } while (b === 255);
    }
    matchLength += 4;
    if (d + matchLength > dstSize) {
      throw new Error("LZ4 데이터가 손상되었습니다.");
    }

    // 겹치는 구간이 있을 수 있어서 한 바이트씩 복사합니다.
    let m = d - offset;
    for (let i = 0; i < matchLength; i++) dst[d++] = dst[m++];
  }

  if (d !== dstSize) {
    throw new Error("LZ4 압축 해제 크기가 맞지 않습니다.");
  }
  return dst;
}

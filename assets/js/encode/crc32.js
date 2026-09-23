// PNG와 ZIP 모두 CRC32 검사값이 필요합니다.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @param {number} [previous] 이어서 계산할 때 이전 결과
 */
export function crc32(bytes, previous = 0) {
  let c = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 바이트 배열을 순서대로 읽는 도우미입니다.
// Unity 번들 머리글은 big-endian, 안쪽 데이터는 파일마다 달라서 endian을 바꿀 수 있게 했습니다.

const utf8 = new TextDecoder("utf-8");

export class ByteReader {
  /**
   * @param {Uint8Array} bytes
   * @param {boolean} littleEndian
   */
  constructor(bytes, littleEndian = false) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = littleEndian;
    this.pos = 0;
  }

  get length() {
    return this.bytes.length;
  }

  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }

  u16() { const v = this.view.getUint16(this.pos, this.little); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, this.little); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, this.little); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, this.little); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, this.little); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, this.little); this.pos += 8; return v; }

  /** 64비트 정수를 BigInt로 읽습니다 (path id처럼 2^53을 넘는 값용). */
  i64Big() { const v = this.view.getBigInt64(this.pos, this.little); this.pos += 8; return v; }
  u64Big() { const v = this.view.getBigUint64(this.pos, this.little); this.pos += 8; return v; }

  /** 크기나 오프셋처럼 안전하게 Number로 다뤄도 되는 64비트 정수. */
  i64() { return Number(this.i64Big()); }
  u64() { return Number(this.u64Big()); }

  /** n바이트를 복사 없이 잘라 돌려줍니다. */
  slice(n) {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new RangeError("파일 끝을 넘어서 읽으려 했습니다.");
    }
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** 0으로 끝나는 문자열 */
  cstring() {
    let end = this.pos;
    while (end < this.bytes.length && this.bytes[end] !== 0) end++;
    const s = utf8.decode(this.bytes.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }

  /** 길이(4바이트) + 내용 */
  lengthPrefixedString() {
    const n = this.i32();
    return utf8.decode(this.slice(n));
  }

  align(n = 4) {
    const rem = this.pos % n;
    if (rem !== 0) this.pos += n - rem;
  }
}

export { utf8 };

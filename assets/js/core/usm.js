// CRI USM(.usm) 컨테이너를 열어 안에 든 H.264 영상과 HCA 오디오를 그대로(원본 바이트로) 꺼냅니다.
//
// 왜 여기서 MKV를 만들지 않는가 (plan.md의 선택지 A):
//   H.264 접근 단위를 MKV 트랙으로 묶으려면 컨테이너 저작 로직이 필요하고, HCA는 일반 플레이어가 재생하지
//   못해 PCM/FLAC 등으로 디코딩해야 합니다. 두 작업 모두 이 프로젝트가 지키는 "의존성 없음" 범위를 넘습니다.
//   그래서 이 모듈은 스트림을 정확히 분리해 꺼내는 데까지만 하고, 결합은 사용자의 vgmstream/ffmpeg에 맡깁니다.
//
// 청크 구조는 실제 샘플들(우마무스메에서 추출한 .usm)을 직접 바이트 단위로 분석해 검증했습니다:
// 청크를 그대로 이어 붙인 결과가 CRID의 @UTF 표에 적힌 원본 파일 크기(filesize)와 정확히 일치합니다.
// 다만 이건 청크 경계 파싱이 맞다는 증거일 뿐, XOR 복호화 자체가 맞는지와는 별개입니다(XOR은 길이를
// 바꾸지 않으므로 크기 일치만으로는 내용까지 검증되지 않습니다). XOR 복호화 공식
// (generateKeys/decryptVideoPacket/decryptAudioPacket)은 CRI USM이 널리 쓰는 것으로 알려진 공개 구현
// (WannaCRI, MIT 라이선스)을 그대로 옮긴 것이고, 키 값(DEFAULT_KEY_HI/LO)은 사용자가 crid_mod.exe로
// 실제 써 오던 키(-b 0000450D -a 608C479F)입니다.
//
// 키 적용 여부: 파일 내부 이름에 "_no_encrypted" 표시가 있어도 영상은 키 없이는 깨진 채로 나온다는
// 것이 실제 변환 테스트로 확인됐습니다. 그래서 파일 이름으로 자동 판단하지 않고 기본적으로 항상 키를
// 적용합니다. 오디오는 형식에 따라 다릅니다 — HCA는 키를 적용하면 오히려 무음이 되고, ADX는 반대로
// 키를 적용하지 않으면 디코더가 몇 프레임 만에 멈춥니다. 그래서 오디오 형식을 먼저 내용으로 판별한
// 뒤(detectAudioFormat) ADX일 때만 키를 적용합니다 (buildAudioTracks 참고). 확장자도 이 판별 결과를
// 그대로 쓰고, audio_codec 같은 USM 내부 숫자 필드는 게임/버전마다 뜻이 다른 것으로 보여 신뢰하지
// 않습니다.

import { ConvertError } from "./errors.js";

const CHUNK_SIGNATURES = new Set(["CRID", "@SFV", "@SFA", "@ALP", "@CUE"]);
const utf8 = new TextDecoder("utf-8");

function readCString(bytes, offset) {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return utf8.decode(bytes.subarray(offset, end));
}

// @UTF 표 안의 값 하나를 읽고, 다음 값을 읽을 위치(pos)를 함께 돌려줍니다.
function readTypedValue(table, tv, pos, type, stringsOffset, dataOffset) {
  switch (type) {
    case 0x00: return { value: table[pos], pos: pos + 1 };
    case 0x01: return { value: tv.getInt8(pos), pos: pos + 1 };
    case 0x02: return { value: tv.getUint16(pos, false), pos: pos + 2 };
    case 0x03: return { value: tv.getInt16(pos, false), pos: pos + 2 };
    case 0x04: return { value: tv.getUint32(pos, false), pos: pos + 4 };
    case 0x05: return { value: tv.getInt32(pos, false), pos: pos + 4 };
    case 0x06: return { value: Number(tv.getBigUint64(pos, false)), pos: pos + 8 };
    case 0x07: return { value: Number(tv.getBigInt64(pos, false)), pos: pos + 8 };
    case 0x08: return { value: tv.getFloat32(pos, false), pos: pos + 4 };
    case 0x09: return { value: tv.getFloat64(pos, false), pos: pos + 8 };
    case 0x0a: {
      const off = tv.getUint32(pos, false);
      return { value: readCString(table, stringsOffset + off), pos: pos + 4 };
    }
    case 0x0b: {
      const off = tv.getUint32(pos, false);
      const size = tv.getUint32(pos + 4, false);
      return { value: table.subarray(dataOffset + off, dataOffset + off + size), pos: pos + 8 };
    }
    default:
      throw new ConvertError(`알 수 없는 @UTF 필드 형식(${type})입니다. USM 형식이 예상과 다릅니다.`);
  }
}

/**
 * CRI 고유의 표 포맷(@UTF)을 읽어 행 배열로 돌려줍니다. Unity 번들의 typetree와는 전혀 다른,
 * USM/ACB 등 CRIWARE 포맷 전반이 공유하는 별도의 표 형식입니다.
 * @param {Uint8Array} bytes "@UTF"로 시작하는 바이트열
 * @returns {Record<string, any>[]}
 */
function parseUtfTable(bytes) {
  if (bytes.length < 8 || utf8.decode(bytes.subarray(0, 4)) !== "@UTF") {
    throw new ConvertError("@UTF 표 형식이 아닙니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableSize = view.getUint32(4, false);
  const table = bytes.subarray(8, 8 + tableSize);
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);

  const rowsOffset = tv.getUint32(0x00, false);
  const stringsOffset = tv.getUint32(0x04, false);
  const dataOffset = tv.getUint32(0x08, false);
  const numColumns = tv.getUint16(0x10, false);
  const rowLength = tv.getUint16(0x12, false);
  const numRows = tv.getUint32(0x14, false);

  let pos = 0x18;
  const columns = [];
  for (let i = 0; i < numColumns; i++) {
    const flags = table[pos]; pos += 1;
    const nameOffset = tv.getUint32(pos, false); pos += 4;
    const name = readCString(table, stringsOffset + nameOffset);
    const storage = flags & 0xf0; // 0x00/0x10=값 없음, 0x30=모든 행 공통값, 0x50=행마다 다른 값
    const type = flags & 0x0f;
    let constValue;
    if (storage === 0x30) {
      ({ value: constValue, pos } = readTypedValue(table, tv, pos, type, stringsOffset, dataOffset));
    }
    columns.push({ storage, type, name, constValue });
  }

  const rows = [];
  for (let r = 0; r < numRows; r++) {
    let cursor = rowsOffset + r * rowLength;
    const row = {};
    for (const col of columns) {
      if (col.storage === 0x30) {
        row[col.name] = col.constValue;
      } else if (col.storage === 0x00 || col.storage === 0x10) {
        row[col.name] = null;
      } else {
        const result = readTypedValue(table, tv, cursor, col.type, stringsOffset, dataOffset);
        row[col.name] = result.value;
        cursor = result.pos;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * USM 파일을 청크 단위로 쪼갭니다. 청크 헤더 32바이트의 뜻은 실제 샘플을 오프셋별로 대조해 확인했습니다.
 *   +0x00 signature(4)  +0x04 chunk_size(u32BE, 이 필드 다음부터의 길이)
 *   +0x08 header_size(u16BE)  +0x0A footer_size(u16BE)  +0x0C payload_type(u8)
 *   +0x10 frame_time(u32BE)   +0x14 frame_rate(u32BE)
 * payload는 [8+header_size, total_len-footer_size) 구간이며, 다음 청크는 total_len(=8+chunk_size) 뒤에 옵니다.
 */
function walkChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let pos = 0;
  while (pos + 32 <= bytes.length) {
    const sig = utf8.decode(bytes.subarray(pos, pos + 4));
    if (!CHUNK_SIGNATURES.has(sig)) break;
    const chunkSize = view.getUint32(pos + 4, false);
    const totalLen = 8 + chunkSize;
    if (totalLen < 32 || pos + totalLen > bytes.length) {
      throw new ConvertError("USM 청크 크기가 파일 범위를 벗어났습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.");
    }
    const headerSize = view.getUint16(pos + 8, false);
    const footerSize = view.getUint16(pos + 10, false);
    const type = bytes[pos + 12];
    const payloadStart = pos + 8 + headerSize;
    const payloadEnd = pos + totalLen - footerSize;
    if (payloadStart > payloadEnd || payloadEnd > bytes.length) {
      throw new ConvertError("USM 청크의 머리말/꼬리말 크기가 맞지 않습니다.");
    }
    chunks.push({ sig, type, payload: bytes.subarray(payloadStart, payloadEnd) });
    pos += totalLen;
  }
  if (chunks.length === 0 || chunks[0].sig !== "CRID") {
    throw new ConvertError("CRID로 시작하지 않습니다. .usm 파일이 맞는지 확인하세요.");
  }
  return chunks;
}

/** 청크 payload가 스트림 메타데이터(@UTF)인지, 구간 표시 마커(#...)인지, 실제 미디어 데이터인지 구분합니다. */
function classifyPayload(payload) {
  if (payload.length >= 4 && payload[0] === 0x40 && utf8.decode(payload.subarray(0, 4)) === "@UTF") return "info";
  if (payload.length >= 1 && payload[0] === 0x23 /* '#' */) return "marker"; // "#HEADER END" 등 구간 표시
  return "data";
}

// 사용자가 실제로 쓰던 키(crid_mod.exe -b 0000450D -a 608C479F)입니다. 우마무스메 인게임 영상은
// 거의 다 이 하나의 키로 암호화되어 있어, 화면에서 키를 직접 입력받지 않고 이 값을 그대로 씁니다.
// "-b" 값이 상위 32비트, "-a" 값이 하위 32비트로 들어갑니다 (사용자가 실사용 중인 순서로 확인됨).
export const DEFAULT_KEY_HI = 0x0000450d;
export const DEFAULT_KEY_LO = 0x608c479f;

const AUDIO_MASK_TEXT = [0x55, 0x52, 0x55, 0x43]; // "URUC" — 오디오 마스크의 홀수 바이트에 고정으로 쓰입니다.

/**
 * 64비트 키(BigInt)에서 영상용 64바이트 키와 오디오용 32바이트 키를 유도합니다.
 * CRI USM이 널리 쓰는 것으로 알려진 공개 구현(WannaCRI, MIT)의 계산식을 그대로 옮겼습니다.
 */
function generateKeys(keyNum) {
  const cipherKey = new Uint8Array(8);
  let n = keyNum;
  for (let i = 0; i < 8; i++) {
    cipherKey[i] = Number(n & 0xffn);
    n >>= 8n;
  }

  const key = new Uint8Array(0x20);
  key[0x00] = cipherKey[0];
  key[0x01] = cipherKey[1];
  key[0x02] = cipherKey[2];
  key[0x03] = (cipherKey[3] - 0x34) & 0xff;
  key[0x04] = (cipherKey[4] + 0xf9) & 0xff;
  key[0x05] = cipherKey[5] ^ 0x13;
  key[0x06] = (cipherKey[6] + 0x61) & 0xff;
  key[0x07] = key[0x00] ^ 0xff;
  key[0x08] = (key[0x01] + key[0x02]) & 0xff;
  key[0x09] = (key[0x01] - key[0x07]) & 0xff;
  key[0x0a] = key[0x02] ^ 0xff;
  key[0x0b] = key[0x01] ^ 0xff;
  key[0x0c] = (key[0x0b] + key[0x09]) & 0xff;
  key[0x0d] = (key[0x08] - key[0x03]) & 0xff;
  key[0x0e] = key[0x0d] ^ 0xff;
  key[0x0f] = (key[0x0a] - key[0x0b]) & 0xff;
  key[0x10] = (key[0x08] - key[0x0f]) & 0xff;
  key[0x11] = key[0x10] ^ key[0x07];
  key[0x12] = key[0x0f] ^ 0xff;
  key[0x13] = key[0x03] ^ 0x10;
  key[0x14] = (key[0x04] - 0x32) & 0xff;
  key[0x15] = (key[0x05] + 0xed) & 0xff;
  key[0x16] = key[0x06] ^ 0xf3;
  key[0x17] = (key[0x13] - key[0x0f]) & 0xff;
  key[0x18] = (key[0x15] + key[0x07]) & 0xff;
  key[0x19] = (0x21 - key[0x13]) & 0xff;
  key[0x1a] = key[0x14] ^ key[0x17];
  key[0x1b] = (key[0x16] + key[0x16]) & 0xff;
  key[0x1c] = (key[0x17] + 0x44) & 0xff;
  key[0x1d] = (key[0x03] + key[0x04]) & 0xff;
  key[0x1e] = (key[0x05] - key[0x16]) & 0xff;
  key[0x1f] = key[0x1d] ^ key[0x13];

  const videoKey = new Uint8Array(0x40);
  const audioKey = new Uint8Array(0x20);
  for (let i = 0; i < 0x20; i++) {
    videoKey[i] = key[i];
    videoKey[0x20 + i] = key[i] ^ 0xff;
    audioKey[i] = i % 2 !== 0 ? AUDIO_MASK_TEXT[(i >> 1) % 4] : key[i] ^ 0xff;
  }
  return { videoKey, audioKey };
}

/** @SFV/@ALP 페이로드를 복호화합니다. 앞 0x40바이트는 원래부터 평문이라 그대로 둡니다. */
function decryptVideoPacket(packet, videoKey) {
  const data = new Uint8Array(packet);
  const encryptedSize = data.length - 0x40;
  if (encryptedSize >= 0x200) {
    const rolling = new Uint8Array(videoKey);
    for (let i = 0x100; i < encryptedSize; i++) {
      const idx = 0x20 + (i % 0x20);
      data[0x40 + i] ^= rolling[idx];
      rolling[idx] = data[0x40 + i] ^ videoKey[idx];
    }
    for (let i = 0; i < 0x100; i++) {
      const idx = i % 0x20;
      rolling[idx] ^= data[0x140 + i];
      data[0x40 + i] ^= rolling[idx];
    }
  }
  return data;
}

/**
 * @SFA 페이로드를 복호화합니다. 앞 0x140바이트는 원래부터 평문이라 그대로 둡니다.
 * ADX 오디오에만 적용합니다 — HCA는 이 XOR을 적용하면 오히려 무음이 되고, ADX는 반대로 이걸
 * 적용하지 않으면 디코더가 몇 프레임 만에 멈춥니다(convertUsm/buildAudioTracks의 관련 주석 참고).
 */
function decryptAudioPacket(packet, audioKey) {
  const data = new Uint8Array(packet);
  if (data.length > 0x140) {
    for (let i = 0x140; i < data.length; i++) {
      data[i] ^= audioKey[i % 0x20];
    }
  }
  return data;
}

function concatParts(parts, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * 오디오 페이로드의 실제 형식을 내용으로 판별합니다. USM 내부의 "audio_codec" 숫자 필드는 게임/버전마다
 * 다른 값을 쓰는 것으로 보여(같은 프로젝트 안에서도 HCA가 4, ADX가 2로 나온 사례가 있었습니다) 그 값을
 * 믿지 않고, 표준으로 알려진 헤더 시그니처를 직접 봅니다.
 *   - ADX: 맨 앞 2바이트가 정확히 0x80 0x00 (CRI ADX 고정 매직)
 *   - HCA: 맨 앞 3바이트가 "HCA"(0x48 0x43 0x41) 또는 헤더 매직을 0x80으로 가린 "\xC8\xC3\xC1"
 * 둘 다 아니면 실제 코덱을 못 찾은 것이므로 확장자를 강제하지 않고 .bin으로 둡니다(재생은 못 해도
 * 최소한 잘못된 확장자 때문에 변환 도구가 실패하지는 않습니다).
 */
function detectAudioFormat(payload) {
  if (payload.length >= 2 && payload[0] === 0x80 && payload[1] === 0x00) {
    return { ext: "adx", label: "ADX" };
  }
  if (payload.length >= 3) {
    const [b0, b1, b2] = payload;
    const isHca = (b0 === 0x48 && b1 === 0x43 && b2 === 0x41) || (b0 === 0xc8 && b1 === 0xc3 && b2 === 0xc1);
    if (isHca) return { ext: "hca", label: "HCA" };
  }
  return { ext: "bin", label: null };
}

function buildTracks(partsMap, infoMap) {
  return [...partsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([type, parts]) => {
      const total = parts.reduce((n, p) => n + p.length, 0);
      return { type, bytes: concatParts(parts, total), info: infoMap.get(type) ?? null };
    });
}

/**
 * 오디오 트랙을 만듭니다. 형식(ADX/HCA)은 첫 조각의 헤더로 판별하고, ADX일 때만 청크별로
 * decryptAudioPacket을 적용한 뒤 이어 붙입니다 (헤더의 preserve-prefix 규칙이 청크마다 적용되므로
 * 이어 붙이기 전에 청크 단위로 복호화해야 합니다 — convertUsm 머리말 주석 참고).
 */
function buildAudioTracks(partsMap, infoMap, audioKey) {
  return [...partsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([type, parts]) => {
      const format = detectAudioFormat(parts[0] ?? new Uint8Array(0));
      const finalParts = format.ext === "adx" && audioKey ? parts.map((p) => decryptAudioPacket(p, audioKey)) : parts;
      const total = finalParts.reduce((n, p) => n + p.length, 0);
      return { type, bytes: concatParts(finalParts, total), info: infoMap.get(type) ?? null, format };
    });
}

/**
 * @param {Uint8Array} bytes .usm 파일 전체
 * @param {{ forceKey?: boolean }} [options] 기본값은 항상 키를 적용합니다(true). 사용자가 실제로
 *   변환해 보고 확인한 바로는, 파일 내부 이름에 "_no_encrypted" 표시가 있어도 영상은 키 없이는
 *   깨진 상태로 나옵니다 (오디오는 키가 없어도 들립니다). 그래서 파일 이름으로 자동 판단하지 않고
 *   항상 키를 적용하며, false를 넘기면 그때만 키 없이 원본 그대로 꺼냅니다.
 * @returns {{
 *   sourceName: string,
 *   videoTracks: { type: number, bytes: Uint8Array, info: Record<string, any>|null }[],
 *   audioTracks: { type: number, bytes: Uint8Array, info: Record<string, any>|null, format: { ext: string, label: string|null } }[],
 *   hasAlpha: boolean,
 *   keyApplied: boolean,
 * }}
 */
export function convertUsm(bytes, { forceKey = true } = {}) {
  const chunks = walkChunks(bytes);

  const crid = chunks[0];
  if (classifyPayload(crid.payload) !== "info") {
    throw new ConvertError("CRID 청크에 스트림 목록(@UTF)이 없습니다.");
  }
  const streamRows = parseUtfTable(crid.payload);

  // chno가 65535인 행이 USM 컨테이너 자신을 가리키는 행이고, filename이 원본(암호화 전) 파일 이름입니다.
  // "_no_encrypted" 표시는 파일 이름 정리(sourceName)에만 쓰고, 키 적용 여부 판단에는 더 이상 쓰지
  // 않습니다. 이 표시가 있어도 영상은 암호화(또는 난독화)되어 있는 것으로 실제 변환 테스트에서
  // 확인됐기 때문입니다.
  const nameRow = streamRows.find((r) => r.chno === 65535) ?? streamRows[0];
  const rawName = String(nameRow?.filename ?? "usm");
  const keyApplied = forceKey;

  // 오디오는 형식에 따라 처리가 다릅니다 (실제 변환 테스트로 확인):
  //   - HCA: 키를 적용하지 않아도 정상 재생됩니다. 오히려 키를 적용하면(decryptAudioPacket) 무음이
  //     됩니다. 즉 USM 컨테이너 키로 암호화되어 있지 않습니다 (HCA 헤더 매직에 걸린 별도의 고정
  //     0x80 마스킹과는 다른 이야기입니다 — 그건 vgmstream이 알아서 처리합니다).
  //   - ADX: 반대로 키를 적용하지 않으면 ffmpeg가 처음 몇 밀리초만 읽고 멈춥니다(디코드 실패).
  //     decryptAudioPacket을 적용해야 전체 길이가 정상적으로 디코드됩니다.
  // 그래서 오디오 포맷을 먼저 판별(detectAudioFormat)한 뒤, ADX일 때만 decryptAudioPacket을 적용합니다.
  // 이 판별은 항상 안전합니다 — 두 형식 모두 헤더(시그니처가 있는 맨 앞부분)는 원래부터 평문이라
  // 키 적용 여부와 무관하게 그대로 보이기 때문입니다.
  const keys = keyApplied ? generateKeys(combineKey(DEFAULT_KEY_HI, DEFAULT_KEY_LO)) : null;
  const videoKey = keys?.videoKey ?? null;
  const audioKey = keys?.audioKey ?? null;

  const videoParts = new Map(); // type -> Uint8Array[]
  const audioParts = new Map();
  const videoInfo = new Map(); // type -> @UTF row
  const audioInfo = new Map();
  let hasAlpha = false;

  for (const chunk of chunks) {
    const kind = classifyPayload(chunk.payload);

    if (kind === "info" && chunk.sig !== "CRID") {
      const rows = parseUtfTable(chunk.payload);
      const row = rows[0] ?? null;
      if (chunk.sig === "@SFV" && !videoInfo.has(chunk.type)) videoInfo.set(chunk.type, row);
      if (chunk.sig === "@SFA" && !audioInfo.has(chunk.type)) audioInfo.set(chunk.type, row);
    }

    if (kind !== "data") continue;

    if (chunk.sig === "@SFV") {
      const payload = videoKey ? decryptVideoPacket(chunk.payload, videoKey) : chunk.payload;
      if (!videoParts.has(chunk.type)) videoParts.set(chunk.type, []);
      videoParts.get(chunk.type).push(payload);
    } else if (chunk.sig === "@SFA") {
      // 원본 그대로 모아 두고, 형식(ADX/HCA)에 따라 아래에서 필요할 때만 복호화합니다.
      if (!audioParts.has(chunk.type)) audioParts.set(chunk.type, []);
      audioParts.get(chunk.type).push(chunk.payload);
    } else if (chunk.sig === "@ALP") {
      // 알파(투명도) 스트림은 plan.md에서 정한 대로 첫 버전 범위에서 뺍니다. 있다는 사실만 기록합니다.
      hasAlpha = true;
    }
  }

  if (videoParts.size === 0) {
    throw new ConvertError("이 USM 파일에서 영상 스트림(@SFV)을 찾지 못했습니다.");
  }

  const videoTracks = buildTracks(videoParts, videoInfo);
  const audioTracks = buildAudioTracks(audioParts, audioInfo, audioKey);

  const sourceName = rawName.replace(/\.[^./\\]+$/, "").replace(/_no_encrypted$/i, "");

  return { sourceName, videoTracks, audioTracks, hasAlpha, keyApplied };
}

/** 화면의 두 키 입력칸(32비트씩)을 하나의 64비트 BigInt로 합칩니다. hi가 상위 32비트입니다. */
export function combineKey(hi, lo) {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

function formatFrameRate(info) {
  if (!info || !info.framerate_n) return null;
  const d = info.framerate_d || 1;
  const rate = info.framerate_n / d;
  return Number.isInteger(rate) ? rate : Number(rate.toFixed(3));
}

function videoFileName(track, multiple) {
  return multiple ? `video_${track.type}.h264` : "video.h264";
}

function audioFileName(track) {
  return `audio_${track.type}.${track.format?.ext ?? "bin"}`;
}

function wavFileName(track) {
  // vgmstream-web 같은 브라우저 변환 사이트는 원본 확장자를 지우지 않고 그대로 둔 채 뒤에 .wav만
  // 붙여서 내려줍니다(예: audio_0.adx -> audio_0.adx.wav). vgmstream-cli는 -o로 이름을 직접
  // 지정하니 상관없지만, 사이트를 쓰는 사람이 더 많을 것으로 보고 "다음 단계" 명령이 실제 받게 될
  // 파일 이름과 어긋나지 않도록 여기서도 원본 확장자를 그대로 반영합니다.
  const ext = track.format?.ext ?? "bin";
  return `audio_${track.type}.${ext}.wav`;
}

/**
 * 변환 결과에 맞춰 "다음 단계" 안내를 구조화된 형태로 만듭니다. 화면(usm/main.js)은 이 구조로 복사
 * 버튼이 있는 카드를 그리고, ZIP 안 README.txt는 이걸 평문으로 펼친 것입니다. 즉 화면과 ZIP 안 글이
 * 항상 같은 내용을 보여줍니다.
 * @param {ReturnType<typeof convertUsm>} result
 * @returns {{ title: string, body?: string, commands?: { label: string, text: string }[] }[]}
 */
export function buildNextSteps(result) {
  const multiVideo = result.videoTracks.length > 1;
  const rate = formatFrameRate(result.videoTracks[0]?.info) ?? 30;
  const steps = [];

  steps.push({
    title: "1. ffmpeg가 있는지 확인하기",
    body: "이미 설치되어 있다면 이 단계는 건너뛰세요. 없다면 ffmpeg.org에서 받거나(Windows는 winget, Mac은 brew로도 설치할 수 있습니다) 아래 명령으로 확인하세요.",
    commands: [{ label: "설치 확인", text: "ffmpeg -version" }],
  });

  const unknownAudio = result.audioTracks.filter((t) => t.format?.ext === "bin");
  const knownAudio = result.audioTracks.filter((t) => t.format?.ext !== "bin");

  if (knownAudio.length > 0) {
    const formats = [...new Set(knownAudio.map((t) => t.format.label))].join("/");
    steps.push({
      title: `2. ${formats}를 WAV로 바꾸기`,
      body:
        "설치 없이 하려면 vgmstream-web(https://katiefrogs.github.io/vgmstream-web/)에 audio_* 파일을 끌어다 놓아 WAV로 받으세요. " +
        "명령줄을 쓰고 싶다면 vgmstream-cli(https://github.com/vgmstream/vgmstream)를 설치한 뒤 아래를 실행하세요. vgmstream은 ADX/HCA " +
        "모두 지원하니 확장자만 맞으면 명령 형태는 같습니다.",
      commands: knownAudio.map((t) => ({
        label: `${audioFileName(t)} -> ${wavFileName(t)}`,
        text: `vgmstream-cli -o ${wavFileName(t)} ${audioFileName(t)}`,
      })),
    });
  }
  if (unknownAudio.length > 0) {
    steps.push({
      title: `${knownAudio.length > 0 ? "2-1" : "2"}. 형식을 알 수 없는 오디오 (${unknownAudio.map(audioFileName).join(", ")})`,
      body:
        "표준 ADX/HCA 헤더 시그니처와 일치하지 않아 자동으로 인식하지 못했습니다. .bin 그대로 vgmstream이나 " +
        "VGMToolbox의 스트림 도구에 넣어 형식을 확인해 보세요. (재생 가능한 형식이 아닐 수도 있습니다.)",
    });
  }

  const stepNum = result.audioTracks.length > 0 ? 3 : 2;
  const videoName = videoFileName(result.videoTracks[0], multiVideo);

  if (knownAudio.length === 0) {
    steps.push({
      title: `${stepNum}. 영상만 재생 가능한 파일로 바꾸기`,
      body:
        result.audioTracks.length === 0
          ? "이 USM에는 오디오가 없어 영상만 그대로 담으면 됩니다."
          : "오디오 형식을 알아내지 못해 우선 영상만 담습니다. 위에서 오디오 형식을 확인한 뒤 필요하면 이 MKV에 나중에 소리를 더할 수 있습니다.",
      commands: [{ label: "MKV로 담기", text: `ffmpeg -framerate ${rate} -i ${videoName} -c:v copy output.mkv` }],
    });
  } else if (knownAudio.length === 1) {
    const wav = wavFileName(knownAudio[0]);
    steps.push({
      title: `${stepNum}. 영상 + 소리를 하나의 MKV로 합치기`,
      commands: [
        {
          label: "합치기",
          text: `ffmpeg -framerate ${rate} -i ${videoName} -i ${wav} -map 0:v:0 -map 1:a:0 -c:v copy -c:a flac output.mkv`,
        },
      ],
    });
  } else {
    const wavs = knownAudio.map(wavFileName);
    const inputs = wavs.map((w) => `-i ${w}`).join(" ");
    const maps = knownAudio.map((_, i) => `-map ${i + 1}:a:0`).join(" ");
    const mixInputs = knownAudio.map((_, i) => `[${i + 1}:a]`).join("");
    steps.push({
      title: `${stepNum}. 영상 + 소리 ${knownAudio.length}개를 하나의 MKV로 합치기`,
      body: `오디오 트랙(${wavs.join(", ")})을 서로 다른 트랙으로 그대로 두는 방법과, 하나로 믹스해 담는 방법 중 골라 쓰세요.`,
      commands: [
        {
          label: "트랙을 따로 유지 (플레이어에서 오디오 트랙 선택 가능)",
          text: `ffmpeg -framerate ${rate} -i ${videoName} ${inputs} -map 0:v:0 ${maps} -c:v copy -c:a flac output.mkv`,
        },
        {
          label: "하나로 믹스해서 담기",
          text: `ffmpeg -framerate ${rate} -i ${videoName} ${inputs} -filter_complex "${mixInputs}amix=inputs=${knownAudio.length}:duration=longest[a]" -map 0:v:0 -map "[a]" -c:v copy -c:a flac output.mkv`,
        },
      ],
    });
  }

  steps.push({
    title: `${stepNum + 1}. 결과 확인하기`,
    body: "output.mkv를 VLC나 mpv로 열어 영상·소리·길이가 맞는지 확인하세요. 재생이 이상하면 관용도가 높은 플레이어(VLC/mpv)로 먼저 확인해 보고, 그래도 안 되면 위 -framerate 값을 바꿔 다시 시도해 보세요.",
  });

  return steps;
}

/**
 * 결과 ZIP에 함께 넣을 안내문(README.txt)을 만듭니다. buildNextSteps와 같은 정보를 평문으로 펼칩니다.
 * @param {ReturnType<typeof convertUsm>} result
 */
export function buildUsmReadme(result) {
  const lines = [];
  lines.push(`UmaConvert - .usm 영상 데이터 변환 결과`);
  lines.push(`원본: ${result.sourceName}`);
  lines.push("");

  const hasAdx = result.audioTracks.some((t) => t.format.ext === "adx");
  const hasHca = result.audioTracks.some((t) => t.format.ext === "hca");
  if (result.keyApplied) {
    const audioNote = hasAdx && hasHca
      ? " (ADX 오디오도 함께 복호화했고, HCA 오디오는 키와 무관하게 원래부터 정상 재생됩니다.)"
      : hasAdx
        ? " (ADX 오디오도 함께 복호화했습니다.)"
        : hasHca
          ? " (오디오는 HCA라 키와 무관하게 원래부터 정상 재생됩니다.)"
          : "";
    lines.push(`알려진 키로 영상을 복호화했습니다.${audioNote}`);
    lines.push(`영상이나 ADX 오디오가 깨져 보이면 UmaConvert 화면에서 "키 없이 다시 변환"을 눌러 보세요.`);
  } else {
    lines.push(`요청에 따라 키를 적용하지 않고 원본 바이트를 그대로 꺼냈습니다.`);
    lines.push(`영상이나 ADX 오디오가 깨져 보이면 UmaConvert 화면에서 파일을 다시 열어 보세요 (다시 열면 키가 적용됩니다).`);
  }
  lines.push("");

  const multiVideo = result.videoTracks.length > 1;
  for (const track of result.videoTracks) {
    const info = track.info;
    lines.push(`${videoFileName(track, multiVideo)}  (${track.bytes.length.toLocaleString()} 바이트)`);
    if (info) {
      const rate = formatFrameRate(info);
      lines.push(
        `  해상도 ${info.width}x${info.height}` +
          (rate ? `, ${rate}fps` : "") +
          (info.total_frames ? `, 총 ${info.total_frames}프레임` : ""),
      );
    }
  }
  lines.push("");

  for (const track of result.audioTracks) {
    const info = track.info;
    lines.push(`${audioFileName(track)}  (${track.bytes.length.toLocaleString()} 바이트, ${track.format.label ?? "형식 미확인"})`);
    if (info) {
      lines.push(
        `  ` +
          (info.sampling_rate ? `${info.sampling_rate}Hz, ` : "") +
          (info.num_channels ? `${info.num_channels}채널` : ""),
      );
    }
  }
  if (result.audioTracks.length === 0) {
    lines.push(`(이 USM에는 오디오 스트림이 없습니다.)`);
  }
  lines.push("");

  if (result.hasAlpha) {
    lines.push(`이 USM에는 알파(투명도) 스트림도 있지만, 첫 버전 범위에서 제외해 꺼내지 않았습니다.`);
    lines.push(`(합성 없이 RGB 영상만 재생해도 화면상 이상은 없고, 배경 투명 효과만 빠집니다.)`);
    lines.push("");
  }

  lines.push(`--- 재생 가능한 파일로 합치는 방법 ---`);
  for (const step of buildNextSteps(result)) {
    lines.push("");
    lines.push(step.title);
    if (step.body) lines.push(step.body);
    for (const cmd of step.commands ?? []) {
      lines.push(`  ${cmd.label}`);
      lines.push(`  $ ${cmd.text}`);
    }
  }
  lines.push("");
  lines.push(`팬이 만든 비공식 도구입니다.`);

  return lines.join("\n");
}
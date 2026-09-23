// UnityFS 번들(.unity3d, 확장자 없는 에셋 파일)을 열어 안에 든 파일 목록을 꺼냅니다.
//
// 번들 구조:
//   [머리글] [블록 정보(압축됨)] [데이터 블록들(압축됨)]
// 블록 정보에는 "데이터 블록 목록"과 "안에 든 파일 목록(이름, 위치, 크기)"이 있습니다.

import { ByteReader } from "./reader.js";
import { lz4Decompress } from "./lz4.js";
import { ConvertError } from "./errors.js";

const SIGNATURE = "UnityFS";

// 압축 방식 (플래그 하위 6비트)
const COMPRESSION_NONE = 0;
const COMPRESSION_LZMA = 1;
const COMPRESSION_LZ4 = 2;
const COMPRESSION_LZ4HC = 3;

// 번들 플래그
const FLAG_BLOCKS_INFO_AT_END = 0x80;
const FLAG_PADDING_AFTER_BLOCKS_INFO = 0x200;

function decompress(kind, src, size) {
  switch (kind) {
    case COMPRESSION_NONE:
      return src;
    case COMPRESSION_LZ4:
    case COMPRESSION_LZ4HC:
      return lz4Decompress(src, size);
    case COMPRESSION_LZMA:
      throw new ConvertError("LZMA로 압축된 번들은 아직 지원하지 않습니다.");
    default:
      throw new ConvertError(`알 수 없는 압축 방식입니다 (${kind}).`);
  }
}

/**
 * @param {Uint8Array} bytes 번들 파일 전체
 * @returns {{ unityVersion: string, files: { path: string, flags: number, data: Uint8Array }[] }}
 */
export function parseBundle(bytes) {
  const r = new ByteReader(bytes, false);

  let signature = "";
  try {
    signature = r.cstring();
  } catch {
    /* 아래에서 처리 */
  }
  if (signature !== SIGNATURE) {
    const head = Array.from(bytes.subarray(0, 8), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    throw new ConvertError(
      `Unity 번들(UnityFS) 파일이 아닙니다. 파일 머리글: "${head}". ` +
        "암호화되어 있거나 다른 종류의 파일일 수 있습니다."
    );
  }

  const version = r.u32();
  if (version < 6 || version > 8) {
    throw new ConvertError(`지원하지 않는 번들 버전입니다 (${version}).`);
  }
  r.cstring(); // 플레이어 버전 (예: 5.x.x)
  const unityVersion = r.cstring();

  r.i64(); // 파일 전체 크기
  const compressedInfoSize = r.u32();
  const uncompressedInfoSize = r.u32();
  const flags = r.u32();

  if (version >= 7) r.align(16);

  // 블록 정보 읽기
  let infoBytes;
  if (flags & FLAG_BLOCKS_INFO_AT_END) {
    infoBytes = bytes.subarray(bytes.length - compressedInfoSize);
  } else {
    infoBytes = r.slice(compressedInfoSize);
    if (flags & FLAG_PADDING_AFTER_BLOCKS_INFO) r.align(16);
  }

  let info;
  try {
    info = decompress(flags & 0x3f, infoBytes, uncompressedInfoSize);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError("번들 정보를 풀지 못했습니다. 파일이 손상되었거나 암호화된 파일일 수 있습니다.");
  }

  const ir = new ByteReader(info, false);
  ir.slice(16); // 해시(무시)

  const blockCount = ir.i32();
  const blocks = [];
  let totalSize = 0;
  for (let i = 0; i < blockCount; i++) {
    const uncompressedSize = ir.u32();
    const compressedSize = ir.u32();
    const blockFlags = ir.u16();
    blocks.push({ uncompressedSize, compressedSize, compression: blockFlags & 0x3f });
    totalSize += uncompressedSize;
  }

  const nodeCount = ir.i32();
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const offset = ir.i64();
    const size = ir.i64();
    const nodeFlags = ir.u32();
    const path = ir.cstring();
    nodes.push({ offset, size, flags: nodeFlags, path });
  }

  // 데이터 블록을 모두 풀어 하나로 이어 붙입니다.
  const data = new Uint8Array(totalSize);
  let out = 0;
  try {
    for (const block of blocks) {
      const src = r.slice(block.compressedSize);
      data.set(decompress(block.compression, src, block.uncompressedSize), out);
      out += block.uncompressedSize;
    }
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError("번들 데이터를 풀지 못했습니다. 파일이 손상되었거나 암호화된 파일일 수 있습니다.");
  }

  const files = nodes.map((n) => ({
    path: n.path,
    flags: n.flags,
    data: data.subarray(n.offset, n.offset + n.size),
  }));

  return { unityVersion, files };
}

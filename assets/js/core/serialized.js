// 번들 안의 "CAB-..." 파일(SerializedFile)을 읽어 오브젝트 목록을 만듭니다.
// 오브젝트 하나가 Texture2D, Sprite 같은 에셋 하나에 해당합니다.

import { ByteReader } from "./reader.js";
import { readTypeTreeBlob, readObject } from "./typetree.js";
import { ConvertError } from "./errors.js";

export const CLASS_TEXTURE2D = 28;
export const CLASS_SPRITE = 213;

const MIN_SUPPORTED_VERSION = 17; // Unity 2017 이상

function readType(r, version, hasTypeTree) {
  const type = { classId: r.i32(), scriptTypeIndex: -1, tree: null };
  if (version >= 16) r.u8(); // isStrippedType
  if (version >= 17) type.scriptTypeIndex = r.i16();
  if (version >= 13) {
    if (type.classId === 114 || type.classId < 0) r.slice(16); // 스크립트 해시
    r.slice(16); // 타입 해시
  }
  if (hasTypeTree) {
    type.tree = readTypeTreeBlob(r, version);
    if (version >= 21) {
      const n = r.i32(); // 타입 의존 목록
      for (let i = 0; i < n; i++) r.i32();
    }
  }
  return type;
}

/**
 * @param {Uint8Array} bytes SerializedFile 데이터
 */
export function parseSerializedFile(bytes) {
  const r = new ByteReader(bytes, false);

  // 머리글 (big-endian)
  r.u32(); // metadata size
  r.u32(); // file size
  const version = r.u32();
  let dataOffset = r.u32();

  if (version < MIN_SUPPORTED_VERSION) {
    throw new ConvertError(`너무 오래된 에셋 형식입니다 (serialized ${version}).`);
  }

  let littleEndian = true;
  if (version >= 9) {
    littleEndian = r.u8() === 0;
    r.slice(3);
  }
  if (version >= 22) {
    r.u32(); // metadata size
    r.i64(); // file size
    dataOffset = r.i64();
    r.i64();
  }
  r.little = littleEndian;

  const unityVersion = r.cstring();
  r.i32(); // target platform
  const hasTypeTree = r.u8() !== 0;

  const typeCount = r.i32();
  const types = [];
  for (let i = 0; i < typeCount; i++) types.push(readType(r, version, hasTypeTree));

  const objectCount = r.i32();
  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    r.align(4);
    const pathId = r.i64Big();
    const byteStart = (version >= 22 ? r.i64() : r.u32()) + dataOffset;
    const byteSize = r.u32();
    const typeIndex = r.i32();
    const type = types[typeIndex];
    objects.push({ pathId, byteStart, byteSize, classId: type?.classId ?? -1, type });
  }

  return {
    version,
    unityVersion,
    hasTypeTree,
    objects,

    /** 오브젝트의 필드를 타입트리에 따라 읽어 JS 객체로 돌려줍니다. */
    read(object) {
      if (!object.type?.tree) {
        throw new ConvertError("이 번들에는 타입트리가 없어 에셋을 읽을 수 없습니다.");
      }
      const data = bytes.subarray(object.byteStart, object.byteStart + object.byteSize);
      return readObject(new ByteReader(data, littleEndian), object.type.tree);
    },
  };
}

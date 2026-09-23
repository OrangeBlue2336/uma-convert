// 타입트리: "이 오브젝트는 어떤 필드가 어떤 순서로 들어 있다"는 설계도입니다.
// 번들에 설계도가 함께 들어 있어서, Unity 버전이 달라도 같은 코드로 필드를 읽을 수 있습니다.

import { COMMON_STRINGS } from "./commonStrings.js";
import { ByteReader, utf8 } from "./reader.js";

const META_ALIGN = 0x4000; // 이 필드를 읽은 뒤 4바이트 경계로 맞춤

/**
 * 타입트리 블롭(버전 12 이상 형식)을 읽어 트리 구조로 돌려줍니다.
 * @param {ByteReader} r
 * @param {number} serializedVersion
 */
export function readTypeTreeBlob(r, serializedVersion) {
  const nodeCount = r.i32();
  const stringBufferSize = r.i32();

  const raw = [];
  for (let i = 0; i < nodeCount; i++) {
    const node = {
      version: r.u16(),
      level: r.u8(),
      typeFlags: r.u8(),
      typeOffset: r.u32(),
      nameOffset: r.u32(),
      byteSize: r.i32(),
      index: r.i32(),
      metaFlags: r.i32(),
    };
    if (serializedVersion >= 19) r.u64Big(); // 참조 타입 해시(사용 안 함)
    raw.push(node);
  }
  const strings = r.slice(stringBufferSize);

  const readString = (offset) => {
    if (offset & 0x80000000) return COMMON_STRINGS.get(offset & 0x7fffffff) ?? `#${offset}`;
    let end = offset;
    while (end < strings.length && strings[end] !== 0) end++;
    return utf8.decode(strings.subarray(offset, end));
  };

  // 평평한 목록(level 값 포함)을 트리로 바꿉니다.
  const root = { type: "", name: "", metaFlags: 0, children: [] };
  const stack = [root];
  for (const n of raw) {
    const node = {
      type: readString(n.typeOffset),
      name: readString(n.nameOffset),
      metaFlags: n.metaFlags,
      children: [],
    };
    stack.length = n.level + 1;
    stack[n.level].children.push(node);
    stack[n.level + 1] = node;
  }
  return root.children[0] ?? null;
}

/**
 * 타입트리에 따라 오브젝트 한 개를 읽어 JS 객체로 돌려줍니다.
 * 64비트 정수는 BigInt, 바이트 배열은 Uint8Array로 나옵니다.
 * @param {ByteReader} r
 * @param {object} rootNode
 */
export function readObject(r, rootNode) {
  return readValue(rootNode, r);
}

function readValue(node, r) {
  let align = (node.metaFlags & META_ALIGN) !== 0;
  let value;

  switch (node.type) {
    case "SInt8": value = r.i8(); break;
    case "UInt8":
    case "char": value = r.u8(); break;
    case "short":
    case "SInt16": value = r.i16(); break;
    case "UInt16":
    case "unsigned short": value = r.u16(); break;
    case "int":
    case "SInt32": value = r.i32(); break;
    case "UInt32":
    case "unsigned int":
    case "Type*": value = r.u32(); break;
    case "long long":
    case "SInt64": value = r.i64Big(); break;
    case "UInt64":
    case "unsigned long long":
    case "FileSize": value = r.u64Big(); break;
    case "float": value = r.f32(); break;
    case "double": value = r.f64(); break;
    case "bool": value = r.u8() !== 0; break;

    case "string": {
      const n = r.i32();
      value = utf8.decode(r.slice(n));
      align = true;
      break;
    }

    case "TypelessData": {
      const n = r.i32();
      value = r.slice(n);
      break;
    }

    default: {
      const first = node.children[0];
      if (first && first.type === "Array") {
        // vector / map 등: [개수][원소들]
        if (first.metaFlags & META_ALIGN) align = true;
        const n = r.i32();
        const element = first.children[1];
        if (element.children.length === 0 && (element.type === "UInt8" || element.type === "SInt8")) {
          value = r.slice(n);
        } else {
          value = new Array(n);
          for (let i = 0; i < n; i++) value[i] = readValue(element, r);
        }
      } else {
        // 구조체: 자식 필드를 순서대로
        value = {};
        for (const child of node.children) value[child.name] = readValue(child, r);
      }
    }
  }

  if (align) r.align(4);
  return value;
}

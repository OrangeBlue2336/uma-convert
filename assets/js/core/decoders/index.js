// 텍스처 형식 번호 -> 디코더 연결표.
// 새 형식을 지원하려면 디코더를 만들고 아래 FORMATS에 한 줄만 추가하면 됩니다.
//
//   id      Unity의 TextureFormat 번호
//   name    화면에 보여줄 이름
//   decode  (bytes, width, height) => RGBA Uint8Array (Unity 방식대로 아래쪽 줄부터 저장된 상태)
//   size    (width, height) => 밉맵 0단계가 차지하는 바이트 수

import { decodeDXT1, decodeDXT5, dxtSize } from "./dxt.js";
import {
  decodeAlpha8, decodeARGB4444, decodeARGB32, decodeBGRA32, decodeR8,
  decodeRGB24, decodeRGB565, decodeRGBA32, decodeRGBA4444,
} from "./raw.js";

const perPixel = (bytes) => (w, h) => w * h * bytes;

const FORMATS = [
  { id: 1, name: "Alpha8", decode: decodeAlpha8, size: perPixel(1) },
  { id: 2, name: "ARGB4444", decode: decodeARGB4444, size: perPixel(2) },
  { id: 3, name: "RGB24", decode: decodeRGB24, size: perPixel(3) },
  { id: 4, name: "RGBA32", decode: decodeRGBA32, size: perPixel(4) },
  { id: 5, name: "ARGB32", decode: decodeARGB32, size: perPixel(4) },
  { id: 7, name: "RGB565", decode: decodeRGB565, size: perPixel(2) },
  { id: 10, name: "DXT1", decode: decodeDXT1, size: (w, h) => dxtSize(w, h, 8) },
  { id: 12, name: "DXT5", decode: decodeDXT5, size: (w, h) => dxtSize(w, h, 16) },
  { id: 13, name: "RGBA4444", decode: decodeRGBA4444, size: perPixel(2) },
  { id: 14, name: "BGRA32", decode: decodeBGRA32, size: perPixel(4) },
  { id: 63, name: "R8", decode: decodeR8, size: perPixel(1) },
];

// 지원하지 않는 형식의 이름을 안내 문구에 쓰기 위한 목록입니다.
const KNOWN_UNSUPPORTED = {
  9: "R16", 15: "RHalf", 16: "RGHalf", 17: "RGBAHalf", 18: "RFloat", 19: "RGFloat", 20: "RGBAFloat",
  22: "RGB9e5Float", 24: "BC6H", 25: "BC7", 26: "BC4", 27: "BC5",
  28: "DXT1Crunched", 29: "DXT5Crunched",
  30: "PVRTC_RGB2", 31: "PVRTC_RGBA2", 32: "PVRTC_RGB4", 33: "PVRTC_RGBA4",
  34: "ETC_RGB4", 45: "ETC2_RGB", 46: "ETC2_RGBA1", 47: "ETC2_RGBA8",
  48: "ASTC_4x4", 49: "ASTC_5x5", 50: "ASTC_6x6", 51: "ASTC_8x8", 52: "ASTC_10x10", 53: "ASTC_12x12",
  64: "ETC_RGB4Crunched", 65: "ETC2_RGBA8Crunched",
};

const byId = new Map(FORMATS.map((f) => [f.id, f]));

export const getFormat = (id) => byId.get(id) ?? null;
export const formatLabel = (id) => byId.get(id)?.name ?? KNOWN_UNSUPPORTED[id] ?? `형식 ${id}`;
export const supportedFormatNames = () => FORMATS.map((f) => f.name);

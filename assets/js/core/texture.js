// 번들에서 Texture2D를 찾아 픽셀(RGBA)로 복원합니다.

import { CLASS_TEXTURE2D } from "./serialized.js";
import { getFormat, formatLabel, supportedFormatNames } from "./decoders/index.js";
import { ConvertError } from "./errors.js";

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * 번들 안의 모든 Texture2D 정보를 읽습니다. 픽셀 복원은 decode()를 부를 때 합니다.
 * @param {ReturnType<import("./serialized.js").parseSerializedFile>} serialized
 * @param {Map<string, { data: Uint8Array }>} resources 번들 안의 파일들(이름 -> 파일). .resS 조회용
 */
export function listTextures(serialized, resources) {
  const textures = [];

  for (const object of serialized.objects) {
    if (object.classId !== CLASS_TEXTURE2D) continue;
    const t = serialized.read(object);

    const info = {
      pathId: object.pathId,
      name: t.m_Name || "texture",
      width: t.m_Width,
      height: t.m_Height,
      formatId: t.m_TextureFormat,
      formatName: formatLabel(t.m_TextureFormat),
      mipCount: t.m_MipCount,
      _raw: t,
    };

    info.decode = () => decodeTexture(info, resources);
    textures.push(info);
  }
  return textures;
}

/** 텍스처의 압축된 픽셀 데이터를 찾습니다. 번들 안 .resS 파일에 따로 들어 있는 경우가 많습니다. */
function findImageData(t, resources) {
  const inline = t["image data"];
  if (inline && inline.length > 0) return inline;

  const stream = t.m_StreamData;
  if (stream && Number(stream.size) > 0) {
    const file = resources.get(basename(stream.path));
    if (!file) {
      throw new ConvertError(
        `텍스처 데이터 파일(${basename(stream.path)})이 번들 안에 없습니다. ` +
          "이미지가 별도 파일로 저장된 번들일 수 있습니다."
      );
    }
    const offset = Number(stream.offset);
    return file.data.subarray(offset, offset + Number(stream.size));
  }
  throw new ConvertError("텍스처에 이미지 데이터가 없습니다.");
}

/**
 * Unity는 이미지를 아래쪽 줄부터 저장하므로, 화면에서 보이는 방향(위쪽 줄부터)으로 뒤집습니다.
 */
function flipVertical(rgba, width, height) {
  const stride = width * 4;
  const tmp = new Uint8Array(stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * stride;
    const b = bottom * stride;
    tmp.set(rgba.subarray(a, a + stride));
    rgba.copyWithin(a, b, b + stride);
    rgba.set(tmp, b);
  }
}

/**
 * @returns {Uint8Array} 위쪽 줄부터 저장된 RGBA 픽셀 (width * height * 4 바이트)
 */
export function decodeTexture(info, resources) {
  const format = getFormat(info.formatId);
  if (!format) {
    throw new ConvertError(
      `지원하지 않는 텍스처 형식입니다: ${info.formatName} (${info.formatId}). ` +
        `지원 형식: ${supportedFormatNames().join(", ")}.`
    );
  }

  const { width, height } = info;
  if (!(width > 0 && height > 0)) throw new ConvertError("이미지 크기가 올바르지 않습니다.");

  const data = findImageData(info._raw, resources);
  const needed = format.size(width, height);
  if (data.length < needed) {
    throw new ConvertError(`이미지 데이터가 부족합니다 (${data.length} / ${needed} 바이트).`);
  }

  // 밉맵이 여러 단계여도 가장 큰 그림(0단계)이 맨 앞에 있습니다.
  const rgba = format.decode(data.subarray(0, needed), width, height);
  flipVertical(rgba, width, height);
  return rgba;
}

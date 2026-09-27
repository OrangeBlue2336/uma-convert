// "크기 보정": 일부 조각(서포트 카드, 칭호 등)은 게임 데이터 안에서부터 이미 비율이 눌린 채로
// 저장되어 있습니다. 실제 게임에서도 이 조각을 쓸 때 항상 같은 고정 크기로 늘려서 쓰기 때문에,
// 여기서도 그 고정 크기(PRESETS)로 강제로 늘리거나 줄이면 원래 비율로 되돌아갑니다.
//
// encode/png.js는 canvas.toBlob()이 반투명 픽셀 색을 미세하게 바꾸는 문제 때문에 canvas를 피하지만,
// 이 기능은 애초에 "크기 자체를 바꾸는" 작업이라 원본 픽셀을 그대로 보존할 수 없고, 대신 확대/축소할
// 때 매끄러운 보간이 필요합니다. 그래서 여기서는 예외적으로 canvas의 drawImage 확대/축소를 그대로
// 사용합니다(다른 변환 경로에는 영향을 주지 않는 별도 기능이라 안전합니다).

/** 조각 종류별로 강제로 맞출 고정 크기 (게임에서 실제로 쓰는 크기) */
export const CORRECTION_PRESETS = {
  supportCard: { label: "서포트 카드", width: 1536, height: 2048 },
  honor: { label: "칭호", width: 512, height: 105 },
};

/**
 * RGBA 픽셀을 지정한 크기로 강제로 늘리거나 줄입니다. (원본 비율은 무시합니다.)
 * @param {Uint8Array} rgba 원본 픽셀 (위쪽 줄부터, srcWidth * srcHeight * 4 바이트)
 * @returns {{ rgba: Uint8Array, width: number, height: number, canvas: HTMLCanvasElement }}
 */
export function resizeRGBA(rgba, srcWidth, srcHeight, dstWidth, dstHeight) {
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  srcCanvas.getContext("2d").putImageData(new ImageData(pixels, srcWidth, srcHeight), 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = dstWidth;
  dstCanvas.height = dstHeight;
  const dstCtx = dstCanvas.getContext("2d");
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(srcCanvas, 0, 0, srcWidth, srcHeight, 0, 0, dstWidth, dstHeight);

  const { data } = dstCtx.getImageData(0, 0, dstWidth, dstHeight);
  return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: dstWidth, height: dstHeight, canvas: dstCanvas };
}

// 사용자에게 그대로 보여줄 수 있는 오류입니다.
// 화면에서는 이 오류의 message를 안내 문구로 표시합니다.

export class ConvertError extends Error {
  /**
   * @param {string} message 한국어 기본 문구. CLI와 사전 누락 시에도 그대로 보여 줍니다.
   * @param {string} [key] 화면이 사전에서 찾을 오류 키
   * @param {Record<string, string | number>} [values] 번역 문구에 넣을 값
   */
  constructor(message, key, values) {
    super(message);
    this.name = "ConvertError";
    this.key = key;
    this.values = values;
  }
}

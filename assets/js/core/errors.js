// 사용자에게 그대로 보여줄 수 있는 오류입니다.
// 화면에서는 이 오류의 message를 안내 문구로 표시합니다.

export class ConvertError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConvertError";
  }
}

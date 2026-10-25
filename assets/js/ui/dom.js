// 화면 조각을 만들 때 쓰는 아주 작은 도우미입니다. 문자열을 HTML로 이어 붙이지 않고 항상 textContent로 넣어서,
// 게임 데이터 안의 글자(<, & 등)가 화면 구조를 깨뜨리거나 스크립트로 해석될 여지를 없앱니다.

/** 요소를 만듭니다: el("div", "클래스", "글자") */
export function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** 눌렀을 때 동작하는 버튼. */
export function button(label, onClick, className = "") {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

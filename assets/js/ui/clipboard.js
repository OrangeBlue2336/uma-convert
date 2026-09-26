// 명령줄 복사 버튼 같은 곳에서 쓰는 클립보드 복사 도우미.

/**
 * 텍스트를 클립보드에 복사합니다. HTTPS/localhost가 아니면 navigator.clipboard가 없을 수 있어
 * 옛 방식(execCommand)으로 한 번 더 시도합니다.
 * @returns {Promise<boolean>} 성공 여부
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 폴백: 화면 밖 textarea에 넣고 선택 후 복사.
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.append(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 버튼을 눌렀을 때 text를 복사하고, 잠깐 라벨을 "복사됨"으로 바꿨다가 되돌립니다. */
export function wireCopyButton(button, text) {
  button.addEventListener("click", async () => {
    const ok = await copyText(text);
    const original = button.textContent;
    button.textContent = ok ? "복사됨" : "복사 실패";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1400);
  });
}

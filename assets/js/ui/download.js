// 파일 저장과 파일 이름 정리.

/** 브라우저가 파일을 내려받게 합니다. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 파일 이름에 쓸 수 없는 글자를 밑줄로 바꿉니다. */
export function safeFileName(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned || "unnamed";
}

/** 이름이 겹치면 _2, _3 을 붙여 서로 다른 이름 목록을 만듭니다. */
export function uniqueNames(names) {
  const used = new Map();
  return names.map((name) => {
    const base = safeFileName(name);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

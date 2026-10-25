// 표를 CSV 글자로 만듭니다. (DOM 없음)
// 쉼표, 따옴표, 줄바꿈이 들어간 칸은 따옴표로 감싸고 안의 따옴표는 두 번 씁니다. (RFC 4180)

function cell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Uint8Array ? Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {string[]} headers 열 이름
 * @param {Iterable<any[]>} rows 각 행의 값
 * @returns {string} 맨 앞에 BOM(\uFEFF)을 붙입니다. 엑셀이 UTF-8 한글을 깨뜨리지 않게 하기 위해서입니다.
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

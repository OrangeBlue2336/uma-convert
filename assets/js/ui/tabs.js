// 탭 전환. 마우스와 키보드(좌우 방향키) 모두 지원합니다.
// HTML에서 role="tab" 버튼의 aria-controls가 가리키는 요소가 해당 탭의 내용입니다.

export function createTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));

  const panelOf = (tab) => document.getElementById(tab.getAttribute("aria-controls"));

  function show(id) {
    const target = byId.get(id);
    for (const tab of tabs) {
      const selected = tab === target;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panelOf(tab).hidden = !selected;
    }
  }

  function setEnabled(id, enabled) {
    byId.get(id).disabled = !enabled;
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => show(tab.id));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const usable = tabs.filter((t) => !t.disabled);
      const next = usable[(usable.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + usable.length) % usable.length];
      show(next.id);
      next.focus();
    });
  }

  return { show, setEnabled };
}

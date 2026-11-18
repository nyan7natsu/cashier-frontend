type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** 小さな要素ビルダー。`on〇〇` は addEventListener、それ以外はプロパティか属性に入れる */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === "class") {
        el.className = String(value);
      } else if (key in el && typeof value !== "string") {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

let toastTimer: number | undefined;

/** 画面下に短いメッセージを出す */
export function toast(message: string): void {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("is-shown");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-shown"), 2200);
}

/** Android なら軽く振動させる（iOS は無視される） */
export function tick(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // 振動できない端末は何もしない
  }
}

import { h } from "./dom.ts";
import { DENOMS, type Denom, type Tally } from "./money.ts";

/** お金のアイコン。色と大きさを実物に寄せる */
const MONEY: Record<Denom, { kind: "bill" | "coin"; color: string; size?: number; hole?: boolean; text: string }> = {
  10000: { kind: "bill", color: "#7a6440", text: "壱万" },
  5000: { kind: "bill", color: "#6a4f86", text: "五千" },
  2000: { kind: "bill", color: "#4f7a5a", text: "弐千" },
  1000: { kind: "bill", color: "#3f6f9a", text: "千" },
  500: { kind: "coin", color: "#d4b04a", size: 30, text: "500" },
  100: { kind: "coin", color: "#c4c4c4", size: 26, text: "100" },
  50: { kind: "coin", color: "#d6d6d6", size: 24, hole: true, text: "" },
  10: { kind: "coin", color: "#b5703f", size: 27, text: "10" },
  5: { kind: "coin", color: "#c9a43a", size: 25, hole: true, text: "" },
  1: { kind: "coin", color: "#e4e4e4", size: 22, text: "1" },
};

export function moneyIcon(d: Denom): HTMLElement {
  const m = MONEY[d];
  if (m.kind === "bill") return h("span", { class: "bill", style: `background:${m.color}`, "aria-hidden": "true" }, m.text);
  return h(
    "span",
    {
      class: `coin${m.hole ? " coin--hole" : ""}`,
      style: `background:${m.color};width:${m.size}px;height:${m.size}px;${d === 10 ? "color:#fff" : ""}`,
      "aria-hidden": "true",
    },
    m.text,
  );
}

/** 「1000円札」「500円玉」 */
export function denomName(d: Denom): string {
  return `${d.toLocaleString("ja-JP")}円${MONEY[d].kind === "bill" ? "札" : "玉"}`;
}

/** 枚数ぶん重ねたアイコン。多いときは 4 枚まで描く */
function stack(d: Denom, n: number): HTMLElement {
  const shown = Math.min(n, 4);
  return h(
    "span",
    { class: `stack stack--${MONEY[d].kind}`, "aria-hidden": "true" },
    ...Array.from({ length: shown }, () => moneyIcon(d)),
  );
}

/**
 * おつりの内訳。お札から順に、1 金種 1 行で「アイコン・名前・枚数」を並べる。
 * 確定後の画面で使う大きい表示。
 */
export function changeList(t: Tally): HTMLElement {
  const rows = DENOMS.filter((d) => t[d] > 0).map((d) =>
    h(
      "li",
      { class: "give__row", "aria-label": `${denomName(d)} ${t[d]}枚` },
      h("span", { class: "give__icons" }, stack(d, t[d])),
      h("span", { class: "give__name" }, denomName(d)),
      h("span", { class: "give__count num" }, String(t[d]), h("small", null, "枚")),
    ),
  );
  return h("ul", { class: "give" }, ...rows);
}

/** 預かり画面に出す小さい内訳。アイコンと枚数だけを横に並べる */
export function changeChips(t: Tally): HTMLElement[] {
  return DENOMS.filter((d) => t[d] > 0).map((d) =>
    h("span", { class: "give-chip", "aria-label": `${denomName(d)} ${t[d]}枚` }, moneyIcon(d), h("span", { class: "num" }, `×${t[d]}`)),
  );
}

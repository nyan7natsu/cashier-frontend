import { h } from "../dom.ts";
import { DENOMS, yen, type CashCount, type Denom } from "../money.ts";
import { moneyIcon } from "../money-view.ts";
import { load, save } from "../storage.ts";

/** 棒金 1 本の枚数 */
export const ROLL = 50;

/** 棒金がある金種（硬貨） */
const ROLLED: ReadonlySet<Denom> = new Set([500, 100, 50, 10, 5, 1]);

type Draft = { roll: Partial<Record<Denom, number>>; loose: Partial<Record<Denom, number>>; key?: string };

export type CountForm = {
  el: HTMLElement;
  /** 金種ごとの枚数（棒金 × 50 ＋ バラ） */
  cashCount(): CashCount;
  total(): number;
  /** 送信に使う冪等キー。数え直しても、記録できるまでは同じキーを使う */
  idempotencyKey(): string;
  /** 記録できたら下書きを消す */
  clear(): void;
  /** 理論在高が変わったら描き直す */
  refresh(): void;
  focusFirst(): void;
};

/**
 * 実在高の入力欄。開局と点検で使う。
 * 入力は下書きとして端末に残すので、ログインが切れて読み直しても消えない
 */
export function countForm(opts: {
  draftKey: string;
  expected: () => number | null;
  submitLabel: string;
  onSubmit: () => void;
}): CountForm {
  const storageKey = `draft.${opts.draftKey}`;
  let draft: Draft = readDraft(storageKey);

  const inputs: HTMLInputElement[] = [];
  const rowViews = new Map<Denom, { count: HTMLElement; amount: HTMLElement; row: HTMLElement }>();

  const field = (d: Denom, kind: "roll" | "loose") => {
    const input = h("input", {
      class: "cf__input num",
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      enterkeyhint: "next",
      "aria-label": `${d.toLocaleString("ja-JP")}円 ${kind === "roll" ? "棒金（本）" : "バラ（枚）"}`,
      value: String(draft[kind][d] ?? 0),
    });
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
      input.value = digits.replace(/^0+(?=\d)/, "");
      set(d, kind, Number(digits || 0));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return opts.onSubmit();
      const i = inputs.indexOf(input);
      (inputs[i + 1] ?? input).focus();
    });
    inputs.push(input);

    const step = (delta: number) => {
      const next = Math.max(0, (draft[kind][d] ?? 0) + delta);
      input.value = String(next);
      set(d, kind, next);
    };
    return h(
      "span",
      { class: `cf__field cf__field--${kind}` },
      h("span", { class: "cf__fieldlabel" }, kind === "roll" ? "棒金" : "バラ"),
      h(
        "span",
        { class: "cf__stepper" },
        h("button", { class: "cf__step", type: "button", tabindex: -1, "aria-label": "1 減らす", onclick: () => step(-1) }, "−"),
        input,
        h("button", { class: "cf__step", type: "button", tabindex: -1, "aria-label": "1 増やす", onclick: () => step(1) }, "＋"),
      ),
      h("span", { class: "cf__unit" }, kind === "roll" ? "本" : "枚"),
    );
  };

  const rows = DENOMS.map((d) => {
    const count = h("span", { class: "cf__count num" });
    const amount = h("span", { class: "cf__amount num" });
    const row = h(
      "div",
      { class: "cf__row" },
      h("span", { class: "cf__name" }, moneyIcon(d), h("span", null, `${d.toLocaleString("ja-JP")}円`)),
      ROLLED.has(d) ? field(d, "roll") : h("span", { class: "cf__field cf__field--roll cf__none", "aria-hidden": "true" }, "—"),
      field(d, "loose"),
      count,
      amount,
    );
    rowViews.set(d, { count, amount, row });
    return row;
  });

  const actual = h("span", { class: "num" });
  const theory = h("span", { class: "num" });
  const diff = h("span", { class: "num" });
  const diffCard = h("div", { class: "stat" }, h("span", { class: "stat__label" }, "過不足"), diff);

  const el = h(
    "div",
    { class: "cf" },
    h(
      "div",
      { class: "card cf__table" },
      h(
        "div",
        { class: "cf__row cf__head", "aria-hidden": "true" },
        h("span", null, "金種"),
        h("span", null, "棒金 (本)"),
        h("span", null, "バラ (枚)"),
        h("span", null, "枚数"),
        h("span", null, "金額"),
      ),
      ...rows,
    ),
    h("p", { class: "hint" }, `棒金は 1 本 ${ROLL} 枚で数えます。枚数 = 棒金 × ${ROLL} ＋ バラ。Enter で次の欄、Ctrl + Enter で記録します。`),
    h(
      "div",
      { class: "cf__summary" },
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "実在高"), actual),
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "理論在高"), theory),
        diffCard,
      ),
      h("button", { class: "btn btn--primary cf__submit", type: "button", onclick: () => opts.onSubmit() }, opts.submitLabel),
    ),
  );

  function set(d: Denom, kind: "roll" | "loose", n: number): void {
    draft[kind][d] = n;
    save(storageKey, JSON.stringify(draft));
    refresh();
  }

  function countOf(d: Denom): number {
    return (draft.roll[d] ?? 0) * ROLL + (draft.loose[d] ?? 0);
  }

  function cashCount(): CashCount {
    const out = {} as CashCount;
    for (const d of DENOMS) out[`yen_${d}`] = countOf(d);
    return out;
  }

  function total(): number {
    return DENOMS.reduce((sum, d) => sum + d * countOf(d), 0);
  }

  function refresh(): void {
    for (const d of DENOMS) {
      const v = rowViews.get(d)!;
      const n = countOf(d);
      v.count.textContent = `${n.toLocaleString("ja-JP")}枚`;
      v.amount.textContent = yen(n * d);
      v.row.classList.toggle("is-set", n > 0);
    }
    const t = total();
    const e = opts.expected();
    actual.textContent = yen(t);
    theory.textContent = e === null ? "—" : yen(e);
    const delta = e === null ? null : t - e;
    diff.textContent = delta === null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${yen(Math.abs(delta))}`;
    diffCard.classList.toggle("is-ng", delta !== null && delta !== 0);
    diffCard.classList.toggle("is-ok", delta === 0);
  }

  refresh();
  return {
    el,
    cashCount,
    total,
    idempotencyKey() {
      if (!draft.key) {
        draft.key = crypto.randomUUID();
        save(storageKey, JSON.stringify(draft));
      }
      return draft.key;
    },
    clear() {
      draft = { roll: {}, loose: {} };
      save(storageKey, null);
      for (const input of inputs) input.value = "0";
      refresh();
    },
    refresh,
    focusFirst() {
      inputs[0]?.focus();
    },
  };
}

function readDraft(key: string): Draft {
  try {
    const v = JSON.parse(load(key) ?? "null") as Draft | null;
    if (v && typeof v === "object" && v.roll && v.loose) return v;
  } catch {
    // 壊れていたら新しく始める
  }
  return { roll: {}, loose: {} };
}

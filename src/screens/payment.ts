import type { App } from "../app.ts";
import { h, tick, toast } from "../dom.ts";
import { emptyTally, makeChange, tallyTotal, yen, type Denom, type Tally } from "../money.ts";
import { changeChips, denomName, moneyIcon } from "../money-view.ts";
import { config } from "../config.ts";
import { confirmSale } from "../sale.ts";

const GRID: readonly Denom[] = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];
const MAX_DIGITS = 6;

/**
 * 預かり画面。キーパッドで受け取った金額を打つ。
 *
 * - 何も打たずに確定すると「ちょうど」で受け取ったとみなす
 * - 受け取ったお金の内訳（金種ごとの枚数）は、金額から大きい金種の順に推定する。
 *   違っていれば「直す」で金種ごとに入れ直せる
 */
export function renderPayment(app: App): HTMLElement {
  // 商品を減らして小計が値引きを下回ったら、値引きを外す（サーバーが 422 を返すので）
  if (app.discount > app.subtotal) {
    app.discount = 0;
    toast("小計が値引きより少なくなったので、値引きを外しました");
  }

  // ---- 金額の表示 ----
  const subtotalRow = h("div", { class: "row row--small" }, h("span", { class: "row__label" }, "小計"), h("span", { class: "row__value num" }));
  const discountRow = h("div", { class: "row row--small" }, h("span", { class: "row__label" }, "値引き"), h("span", { class: "row__value num" }));
  const totalValue = h("span", { class: "row__value num" });
  const depositLabel = h("span", { class: "row__label" });
  const depositValue = h("span", { class: "row__value num pay__deposit" });
  const clearInput = h("button", { class: "link pay__clear", onclick: () => setInput("") }, "消す");
  const changeLabel = h("span", { class: "row__label" });
  const changeValue = h("span", { class: "row__value num" });
  const changeBox = h("div", { class: "change" }, h("div", { class: "row" }, changeLabel, changeValue));
  const changeDetail = h("div", { class: "give-chips" });
  const received = h("div", { class: "give-chips pay__received" });
  // おつりに使うお金が足りない・少ないときの知らせ
  const cashNote = h("p", { class: "cash-note", role: "status" });
  // 値引きは今回ほぼ使わないので、設定で出したときだけ見せる
  const discountButton = h("button", { class: "link pay__discount", hidden: !config.showDiscount, onclick: () => openDiscount() });

  const confirm = h("button", { class: "btn btn--primary", onclick: () => onConfirm() });

  const info = h(
    "div",
    { class: "pay" },
    h(
      "div",
      { class: "pay__nav" },
      h("button", { class: "link", onclick: () => app.go("products") }, "← 商品"),
      discountButton,
    ),
    subtotalRow,
    discountRow,
    h("div", { class: "row row--small" }, h("span", { class: "row__label" }, `合計（${app.itemCount}点）`), totalValue),
    h("div", { class: "row" }, depositLabel, h("span", { class: "pay__depositbox" }, clearInput, depositValue)),
    changeBox,
    changeDetail,
    received,
    cashNote,
  );

  // ---- キーパッド ----
  const key = (label: string, onPress: () => void) =>
    h(
      "button",
      {
        class: "key num",
        type: "button",
        onclick: () => {
          tick();
          onPress();
        },
      },
      label,
    );
  const keys = h(
    "div",
    { class: "keys" },
    ...["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((d) => key(d, () => typeIn(d))),
    key("00", () => typeIn("00")),
    key("0", () => typeIn("0")),
    h(
      "button",
      {
        class: "key key--back",
        type: "button",
        "aria-label": "1 文字消す",
        onclick: () => {
          tick();
          setInput(app.tenderInput.slice(0, -1));
        },
      },
      "⌫",
    ),
  );

  const foot = h("div", { class: "foot" }, confirm);

  function typeIn(digits: string): void {
    const next = (app.tenderInput + digits).replace(/^0+/, "");
    if (next.length > MAX_DIGITS) return;
    setInput(next);
  }

  function setInput(value: string): void {
    app.tenderInput = value;
    // 打ち直したら、手で直した内訳は捨てて推定に戻す
    app.tenderEdited = false;
    refresh();
  }

  /** 打った金額（空ならちょうど）から、受け取ったお金の内訳を推定する */
  function syncTender(): void {
    if (app.tenderEdited) return;
    const amount = app.tenderInput === "" ? app.total : Number(app.tenderInput);
    app.tender = makeChange(amount);
  }

  function refresh(): void {
    syncTender();
    const total = app.total;
    const exact = app.tenderInput === "" && !app.tenderEdited;
    const deposit = tallyTotal(app.tender);
    const short = deposit < total;

    subtotalRow.hidden = app.discount === 0;
    discountRow.hidden = app.discount === 0;
    subtotalRow.lastElementChild!.textContent = yen(app.subtotal);
    discountRow.lastElementChild!.textContent = `−${yen(app.discount)}`;
    discountButton.textContent = app.discount > 0 ? `値引き −${yen(app.discount)}` : "値引き";
    discountButton.classList.toggle("is-set", app.discount > 0);

    totalValue.textContent = yen(total);
    depositLabel.textContent = exact ? "預かり（ちょうど）" : "預かり";
    depositValue.textContent = yen(deposit);
    depositValue.classList.toggle("is-exact", exact);
    clearInput.hidden = exact;

    changeBox.classList.toggle("is-short", short);
    changeLabel.textContent = short ? "あと" : "おつり";
    changeValue.textContent = yen(short ? total - deposit : deposit - total);
    const plan = short ? null : app.planChange(deposit - total);
    const chips = plan ? changeChips(plan.change) : [];
    changeDetail.replaceChildren(...(chips.length > 0 ? [h("span", { class: "give-chips__label" }, "返す"), ...chips] : []));

    // 受け取ったお金（推定か、手で直したもの）
    const got = deposit > 0 ? changeChips(app.tender) : [];
    received.replaceChildren(
      h("span", { class: "give-chips__label" }, app.tenderEdited ? "受け取り" : "受け取り（推定）"),
      ...got,
      h("button", { class: "link pay__fix", onclick: () => openBreakdown() }, "直す"),
    );

    if (app.register === "closed") {
      confirm.textContent = "閉局中は確定できません";
      confirm.className = "btn btn--blocked";
    } else if (app.register === "unauthorized") {
      confirm.textContent = "パスワードを入れ直す";
      confirm.className = "btn btn--blocked";
    } else if (short) {
      confirm.textContent = `あと${yen(total - deposit)}`;
      confirm.className = "btn btn--waiting";
    } else {
      // 打たずに押すと「ちょうど」になるので、押す前に分かるようにする
      confirm.textContent = exact ? `ちょうど ${yen(total)} で確定` : `確定（おつり ${yen(deposit - total)}）`;
      confirm.className = "btn btn--primary";
    }

    // 足りない・組み方を変えた・残り少、の順に大事なものを 1 つ出す
    const low = app.lowStock;
    if (plan?.short) {
      cashNote.className = "cash-note is-ng";
      cashNote.textContent = "レジのお金ではおつりを組めません。細かいお金がないか聞いてください";
    } else if (plan?.adjusted) {
      cashNote.className = "cash-note is-warn";
      cashNote.textContent = "少ない金種を避けて、おつりの組み方を変えました";
    } else if (low.length > 0) {
      cashNote.className = "cash-note is-warn";
      cashNote.textContent = `残り少: ${low.map((x) => `${denomName(x.denom)} ${x.count}枚`).join("・")}`;
    } else {
      cashNote.className = "cash-note";
      cashNote.textContent = "";
    }
  }

  function onConfirm(): void {
    if (app.register === "unauthorized") return app.askPassword();
    if (!app.canConfirm) {
      toast("レジが閉じています。開けてもらってから確定してください");
      return;
    }
    syncTender();
    if (tallyTotal(app.tender) < app.total) return;
    confirmSale(app);
  }

  // ---- 受け取ったお金の内訳を直す ----
  function openBreakdown(): void {
    const draft: Tally = { ...app.tender };
    const tiles = new Map<Denom, { tile: HTMLElement; badge: HTMLElement }>();
    const sum = h("span", { class: "row__value num" });
    const drawer = app.drawer;

    const tile = (d: Denom) => {
      const badge = h("span", { class: "denom__badge num" });
      const el = h(
        "div",
        { class: "denom" },
        h("button", { class: "denom__minus", type: "button", "aria-label": `${d}円を1枚減らす`, onclick: () => bump(d, -1) }, "−"),
        h(
          "button",
          { class: "denom__plus", type: "button", "aria-label": `${d}円を1枚増やす`, onclick: () => bump(d, 1) },
          moneyIcon(d),
          h("span", { class: "num" }, d.toLocaleString("ja-JP")),
          h("span", { class: "denom__left num" }, drawer ? `残り ${drawer[d]}` : ""),
        ),
        badge,
      );
      tiles.set(d, { tile: el, badge });
      return el;
    };

    const bump = (d: Denom, delta: number) => {
      if (delta < 0 && draft[d] === 0) return;
      draft[d] += delta;
      tick();
      draw();
    };

    const draw = () => {
      for (const [d, t] of tiles) {
        t.tile.classList.toggle("is-on", draft[d] > 0);
        t.badge.textContent = String(draft[d]);
      }
      sum.textContent = yen(tallyTotal(draft));
    };

    const dialog = h(
      "dialog",
      { class: "sheet sheet--wide", "aria-label": "受け取ったお金を直す" },
      h("h2", null, "受け取ったお金"),
      h("p", { class: "hint", style: "text-align:left" }, "お客さんから受け取ったお札と硬貨の枚数に直してください"),
      h("div", { class: "row" }, h("span", { class: "row__label" }, "合計"), sum),
      h("div", { class: "denoms" }, ...GRID.map(tile), tile(2000)),
      h(
        "div",
        { class: "sheet__actions" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: () => {
              Object.assign(draft, emptyTally());
              draw();
            },
          },
          "全部消す",
        ),
        h(
          "button",
          {
            class: "btn btn--primary",
            type: "button",
            onclick: () => {
              app.tender = { ...draft };
              app.tenderEdited = true;
              app.tenderInput = String(tallyTotal(draft));
              dialog.close();
            },
          },
          "決定",
        ),
      ),
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      refresh();
    });
    document.body.append(dialog);
    draw();
    dialog.showModal();
  }

  // ---- 値引き ----
  function openDiscount(): void {
    const input = h("input", {
      class: "field num",
      type: "text",
      inputmode: "numeric",
      pattern: "[0-9]*",
      value: app.discount > 0 ? String(app.discount) : "",
      placeholder: "0",
      "aria-label": "値引きの金額（円）",
    });
    const error = h("p", { class: "error", role: "alert" });
    const quick = (n: number) => h("button", { class: "btn", type: "button", onclick: () => (input.value = String(n)) }, yen(n));

    const dialog = h(
      "dialog",
      { class: "sheet", "aria-label": "値引き" },
      h("h2", null, "値引き"),
      h("p", { class: "hint", style: "text-align:left" }, `小計 ${yen(app.subtotal)} から引く金額`),
      input,
      h("div", { class: "quick" }, quick(50), quick(100), quick(150), quick(200)),
      error,
      h(
        "div",
        { class: "sheet__actions" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: () => {
              app.discount = 0;
              dialog.close();
            },
          },
          "なし",
        ),
        h(
          "button",
          {
            class: "btn btn--primary",
            type: "button",
            onclick: () => {
              const text = input.value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
              const n = text === "" ? 0 : Number(text);
              if (!Number.isInteger(n) || n < 0) {
                error.textContent = "0 以上の整数（円）で入れてください";
                return;
              }
              if (n > app.subtotal) {
                error.textContent = `小計 ${yen(app.subtotal)} より大きくはできません`;
                return;
              }
              app.discount = n;
              dialog.close();
            },
          },
          "決定",
        ),
      ),
    );
    input.addEventListener("input", () => (error.textContent = ""));
    dialog.addEventListener("close", () => {
      dialog.remove();
      refresh();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  refresh();
  app.onStateChange = refresh;
  return h("div", { class: "screen screen--payment" }, info, keys, foot);
}

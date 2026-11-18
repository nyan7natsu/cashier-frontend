import type { App } from "../app.ts";
import { h, tick, toast } from "../dom.ts";
import { makeChange, tallyTotal, yen, type Denom } from "../money.ts";
import { changeChips, moneyIcon } from "../money-view.ts";
import { config } from "../config.ts";
import { confirmSale } from "../sale.ts";

const GRID: readonly Denom[] = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

export function renderPayment(app: App): HTMLElement {
  // 商品を減らして小計が値引きを下回ったら、値引きを外す（サーバーが 422 を返すので）
  if (app.discount > app.subtotal) {
    app.discount = 0;
    toast("小計が値引きより少なくなったので、値引きを外しました");
  }
  const tiles = new Map<Denom, { tile: HTMLElement; badge: HTMLElement }>();

  const tile = (d: Denom) => {
    const badge = h("span", { class: "denom__badge num" });
    const el = h(
      "div",
      { class: "denom" },
      h("button", { class: "denom__minus", "aria-label": `${d}円を1枚減らす`, onclick: () => change(d, -1) }, "−"),
      h(
        "button",
        { class: "denom__plus", "aria-label": `${d}円を1枚増やす`, onclick: () => change(d, 1) },
        moneyIcon(d),
        h("span", { class: "num" }, d.toLocaleString("ja-JP")),
      ),
      badge,
    );
    tiles.set(d, { tile: el, badge });
    return el;
  };

  // ---- 金額の表示 ----
  const subtotalRow = h("div", { class: "row row--small" }, h("span", { class: "row__label" }, "小計"), h("span", { class: "row__value num" }));
  const discountRow = h("div", { class: "row row--small" }, h("span", { class: "row__label" }, "値引き"), h("span", { class: "row__value num" }));
  const totalValue = h("span", { class: "row__value num" });
  const depositValue = h("span", { class: "row__value num" });
  const changeLabel = h("span", { class: "row__label" });
  const changeValue = h("span", { class: "row__value num" });
  const changeBox = h("div", { class: "change" }, h("div", { class: "row" }, changeLabel, changeValue));
  const changeDetail = h("div", { class: "give-chips" });
  // 値引きは今回ほぼ使わないので、設定で出したときだけ見せる
  const discountButton = h("button", { class: "link pay__discount", hidden: !config.showDiscount, onclick: () => openDiscount() });

  const extra = h("div", { class: "denoms", hidden: app.tender[2000] === 0 }, tile(2000));
  const moreButton = h(
    "button",
    {
      class: "link more",
      hidden: app.tender[2000] > 0,
      onclick: () => {
        extra.hidden = false;
        moreButton.hidden = true;
      },
    },
    "2000円札 ›",
  );

  const confirm = h("button", { class: "btn btn--primary", onclick: () => onConfirm() });

  const body = h(
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
    h("div", { class: "row" }, h("span", { class: "row__label" }, `合計（${app.itemCount}点）`), totalValue),
    h("div", { class: "row" }, h("span", { class: "row__label" }, "預かり"), depositValue),
    changeBox,
    changeDetail,
    h("div", { class: "denoms" }, ...GRID.map(tile)),
    extra,
    moreButton,
  );

  const foot = h("div", { class: "foot" }, confirm);

  function change(d: Denom, delta: number): void {
    if (delta < 0 && app.tender[d] === 0) return;
    app.tender[d] += delta;
    tick();
    refresh();
  }

  function refresh(): void {
    const total = app.total;
    const deposit = tallyTotal(app.tender);
    const short = deposit < total;

    subtotalRow.hidden = app.discount === 0;
    discountRow.hidden = app.discount === 0;
    subtotalRow.lastElementChild!.textContent = yen(app.subtotal);
    discountRow.lastElementChild!.textContent = `−${yen(app.discount)}`;
    discountButton.textContent = app.discount > 0 ? `値引き −${yen(app.discount)}` : "値引き";
    discountButton.classList.toggle("is-set", app.discount > 0);

    totalValue.textContent = yen(total);
    depositValue.textContent = yen(deposit);

    changeBox.classList.toggle("is-short", short);
    changeLabel.textContent = short ? "あと" : "おつり";
    changeValue.textContent = yen(short ? total - deposit : deposit - total);
    const chips = short ? [] : changeChips(makeChange(deposit - total));
    changeDetail.replaceChildren(...(chips.length > 0 ? [h("span", { class: "give-chips__label" }, "返す"), ...chips] : []));

    if (app.register === "closed") {
      confirm.textContent = "閉局中は確定できません";
      confirm.className = "btn btn--blocked";
    } else if (app.register === "unauthorized") {
      confirm.textContent = "パスワードを入れ直す";
      confirm.className = "btn btn--blocked";
    } else {
      confirm.textContent = short ? `あと${yen(total - deposit)}` : "確定";
      confirm.className = short ? "btn btn--waiting" : "btn btn--primary";
    }

    for (const [d, t] of tiles) {
      const n = app.tender[d];
      t.tile.classList.toggle("is-on", n > 0);
      t.badge.textContent = String(n);
    }
  }

  function onConfirm(): void {
    if (app.register === "unauthorized") return app.askPassword();
    if (!app.canConfirm) {
      toast("レジが閉じています。開けてもらってから確定してください");
      return;
    }
    if (tallyTotal(app.tender) < app.total) return;
    confirmSale(app);
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
  return h("div", { class: "screen" }, body, foot);
}

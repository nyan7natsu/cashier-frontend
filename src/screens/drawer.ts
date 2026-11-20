import type { App } from "../app.ts";
import { h } from "../dom.ts";
import { DENOMS, tallyTotal, yen } from "../money.ts";
import { denomName, moneyIcon } from "../money-view.ts";

/** レジのお金（目安）。サーバーの記録と、この端末の送信待ちから計算する */
export function renderDrawer(app: App): HTMLElement {
  const body = h("div", { class: "history" });

  function draw(): void {
    const drawer = app.drawer;
    const low = new Set(app.lowStock.map((x) => x.denom));
    const high = new Set(app.highStock.map((x) => x.denom));
    const back = h("div", null, h("button", { class: "link", onclick: () => app.go("products") }, "← 商品"));

    if (!drawer) {
      body.replaceChildren(
        back,
        h("h2", { class: "history__title" }, "レジのお金"),
        h("p", { class: "muted" }, "まだサーバーから取れていません。オンラインになると表示されます。"),
      );
      return;
    }

    const rows = DENOMS.filter((d) => d !== 2000 || drawer[d] !== 0).map((d) =>
      h(
        "li",
        { class: `give__row${low.has(d) ? " is-low" : high.has(d) ? " is-high" : ""}` },
        h("span", { class: "give__icons" }, moneyIcon(d)),
        h(
          "span",
          { class: "give__name" },
          denomName(d),
          low.has(d) ? h("span", { class: "give__tag" }, "残り少") : high.has(d) ? h("span", { class: "give__tag" }, "多い") : null,
        ),
        h("span", { class: "give__count num" }, String(drawer[d]), h("small", null, "枚")),
      ),
    );

    body.replaceChildren(
      back,
      h(
        "div",
        { class: "row" },
        h("span", { class: "row__label" }, "レジのお金"),
        h("span", { class: "row__value num" }, yen(tallyTotal(drawer))),
      ),
      h(
        "p",
        { class: "cash-note is-warn" },
        [
          app.lowStock.length > 0 ? "「残り少」の金種は、両替や補充を頼んでください。" : "",
          app.highStock.length > 0 ? "「多い」の金種は、金庫へ移すとよいです。" : "",
        ].join(""),
      ),
      h("ul", { class: "give give--drawer" }, ...rows),
      h(
        "p",
        { class: "hint", style: "text-align:left" },
        app.register === "offline"
          ? "オフラインなので、最後に取れたサーバーの記録に、この端末の送信待ちを足した目安です。"
          : "サーバーの記録に、この端末の送信待ちを足した目安です。ほかの端末の送信待ちは入っていません。",
      ),
    );
  }

  draw();
  app.onStateChange = draw;
  return h("div", { class: "screen" }, body);
}

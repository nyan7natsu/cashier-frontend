import type { App } from "../app.ts";
import { h, tick, toast } from "../dom.ts";
import { yen } from "../money.ts";

export function renderProducts(app: App): HTMLElement {
  const rows = new Map<number, { row: HTMLElement; qty: HTMLElement }>();
  // 縦向きの 1 列・2 列は設定で切り替える。横向きでは CSS でカテゴリーごとの列になる
  const list = h("div", { class: `items items--${app.layout}` });

  // 紙のオーダー表に合わせて、category ごとにまとめて見出しを付ける
  let rowsBox: HTMLElement | null = null;
  let category: string | undefined;
  app.products.forEach((p, i) => {
    if (i === 0 || p.category !== category) {
      category = p.category;
      rowsBox = h("div", { class: "cat__rows" });
      list.append(h("section", { class: "cat" }, category ? h("h2", { class: "items__group" }, category) : null, rowsBox));
    }
    const qty = h("span", { class: "item__qty num" });
    const row = h(
      "div",
      { class: "item" },
      h("button", { class: "item__minus", "aria-label": `${p.name} を1つ減らす`, onclick: () => change(p.id, -1) }, "−"),
      h(
        "button",
        { class: "item__plus", "aria-label": `${p.name} を1つ増やす`, onclick: () => change(p.id, 1) },
        h(
          "span",
          { class: "item__name" },
          h("span", { class: "item__main" }, p.name),
          h("span", { class: "item__sub num" }, yen(p.price)),
        ),
        qty,
      ),
    );
    rows.set(p.id, { row, qty });
    rowsBox!.append(row);
  });

  if (app.products.length === 0) {
    list.append(
      h("p", { class: "hint" }, "商品の一覧を読み込めませんでした。"),
      h(
        "button",
        {
          class: "btn",
          onclick: async () => {
            await app.loadMaster();
            app.go("products");
          },
        },
        "読み直す",
      ),
    );
  }

  // ---- 下部のバー ----
  const count = h("span", null);
  const total = h("span", { class: "foot__total num" });
  const lines = h("div", { class: "lines", hidden: true });
  const toggle = h("button", { class: "link", "aria-expanded": "false", onclick: () => toggleLines() }, count);

  const foot = h(
    "div",
    { class: "foot" },
    lines,
    h("div", { class: "foot__sum" }, toggle, total),
    h(
      "div",
      { class: "foot__actions" },
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            if (app.cart.size === 0) return;
            app.resetSale();
            refreshAll();
          },
        },
        "クリア",
      ),
      h(
        "button",
        {
          class: "btn btn--primary",
          onclick: () => {
            if (app.cart.size === 0) {
              toast("商品を選んでください");
              return;
            }
            app.go("payment");
          },
        },
        "お会計 →",
      ),
    ),
  );

  function change(id: number, delta: number): void {
    if (delta < 0 && app.qty(id) === 0) return;
    app.addItem(id, delta);
    tick();
    refreshRow(id);
    refreshFoot();
  }

  function refreshRow(id: number): void {
    const r = rows.get(id);
    if (!r) return;
    const q = app.qty(id);
    r.row.classList.toggle("is-on", q > 0);
    r.qty.textContent = q > 0 ? String(q) : "＋";
  }

  function refreshFoot(): void {
    count.textContent = `${app.itemCount}点 ${lines.hidden ? "▴" : "▾"} 明細`;
    total.textContent = yen(app.subtotal);
    if (!lines.hidden) drawLines();
  }

  function drawLines(): void {
    const items = app.products.filter((p) => app.qty(p.id) > 0);
    lines.replaceChildren(
      ...(items.length === 0
        ? [h("div", { class: "line muted" }, "まだ何も選んでいません")]
        : items.map((p) =>
            h(
              "div",
              { class: "line" },
              h("span", null, `${p.name} ×${app.qty(p.id)}`),
              h("span", { class: "num" }, yen(p.price * app.qty(p.id))),
            ),
          )),
    );
  }

  function toggleLines(): void {
    lines.hidden = !lines.hidden;
    toggle.setAttribute("aria-expanded", String(!lines.hidden));
    refreshFoot();
  }

  function refreshAll(): void {
    for (const id of rows.keys()) refreshRow(id);
    refreshFoot();
  }

  refreshAll();
  return h("div", { class: "screen screen--products" }, list, foot);
}

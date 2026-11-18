import type { App } from "../app.ts";
import { h } from "../dom.ts";
import { yen } from "../money.ts";
import type { SaleRecord } from "../queue.ts";

/** 送信待ち・要確認・最近の会計 */
export function renderHistory(app: App): HTMLElement {
  const body = h("div", { class: "history" });

  const time = (r: SaleRecord) =>
    new Date(r.payload.occurred_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  const items = (r: SaleRecord) =>
    r.payload.items
      .map((it) => `${app.products.find((p) => p.id === it.product_id)?.name ?? `商品${it.product_id}`} ×${it.quantity}`)
      .join("、");

  const card = (r: SaleRecord, extra?: HTMLElement | null) =>
    h(
      "div",
      { class: "record" },
      h(
        "div",
        { class: "record__top" },
        h("span", { class: "record__id num" }, r.receiptId !== undefined ? `#${r.receiptId}` : time(r)),
        r.receiptId !== undefined ? h("span", { class: "muted num" }, time(r)) : null,
        h("span", { class: "record__total num" }, yen(r.total)),
      ),
      h("div", { class: "record__items" }, items(r)),
      r.error && r.status !== "sent" ? h("div", { class: "record__error" }, r.error) : null,
      extra ?? null,
    );

  function draw(): void {
    const q = app.queue;
    const sections: HTMLElement[] = [];

    if (q.rejected.length > 0) {
      sections.push(
        h("h2", { class: "history__title history__title--ng" }, `要確認 ${q.rejected.length}`),
        h("p", { class: "hint", style: "text-align:left" }, "サーバーに受け付けられなかった会計です。内容を確かめて、係の人に伝えてください。"),
        ...q.rejected.map((r) =>
          card(
            r,
            h(
              "button",
              {
                class: "btn",
                onclick: () => {
                  if (window.confirm("この会計を一覧から外します。サーバーには記録されていません。よろしいですか？")) {
                    q.dismiss(r.payload.idempotency_key);
                  }
                },
              },
              "確認した",
            ),
          ),
        ),
      );
    }

    sections.push(h("h2", { class: "history__title" }, `送信待ち ${q.pending.length}`));
    if (q.pending.length === 0) {
      sections.push(h("p", { class: "muted" }, "送信待ちの会計はありません"));
    } else {
      sections.push(
        h(
          "button",
          { class: "btn", onclick: () => (q.paused && app.register === "unauthorized" ? app.askPassword() : q.resume()) },
          q.paused ? "パスワードを入れ直して送る" : "今すぐ送る",
        ),
        ...q.pending.map((r) => card(r, r.status === "sending" ? h("div", { class: "muted" }, "送信中…") : null)),
      );
    }

    sections.push(h("h2", { class: "history__title" }, "最近の会計"));
    sections.push(
      ...(q.recent.length === 0 ? [h("p", { class: "muted" }, "まだありません")] : q.recent.map((r) => card(r))),
    );

    body.replaceChildren(h("div", null, h("button", { class: "link", onclick: () => app.go("products") }, "← 商品")), ...sections);
  }

  draw();
  app.onStateChange = draw;
  return h("div", { class: "screen" }, body);
}

import type { App } from "../app.ts";
import { config } from "../config.ts";
import { h } from "../dom.ts";
import { yen } from "../money.ts";
import { changeList } from "../money-view.ts";

export function renderDone(app: App): HTMLElement {
  const key = app.lastSaleKey;
  const first = key ? app.queue.find(key) : undefined;
  if (!key || !first) {
    queueMicrotask(() => app.go("products"));
    return h("div");
  }

  const changeAmount = first.deposit - first.total;

  const head = h("div", { style: "display:contents" });
  const next = h("button", { class: "btn btn--primary", onclick: () => goNext() });
  let canLeave = false;

  function goNext(): void {
    if (!canLeave) return;
    app.lastSaleKey = null;
    app.go("products");
  }

  function draw(): void {
    // 送ったあとは送信待ちから最近の会計へ移るので、毎回探し直す
    const sale = app.queue.find(key!) ?? first!;
    const tried = sale.attempts > 0;

    const chip =
      sale.status === "sent"
        ? h("span", { class: "chip chip--ok" }, "送信済み")
        : sale.status === "rejected"
          ? h("span", { class: "chip chip--ng" }, "要確認")
          : sale.status === "sending"
            ? h("span", { class: "chip chip--wait" }, "送信中…")
            : h(
                "span",
                { class: "chip chip--wait" },
                tried
                  ? "送信待ち（自動で送り直します）"
                  : app.queue.pending[0] !== sale
                    ? "送信待ち（前の会計のあとに送ります）"
                    : "送信待ち",
              );

    // レシート番号は出さない（あとで探すときは「会計の記録」で見られる）
    head.replaceChildren(
      h(
        "div",
        { class: "done__head" },
      chip,
      sale.error && sale.status !== "sent" ? h("p", { class: "done__error" }, sale.error) : null,
      sale.status === "pending" && tried
          ? h("button", { class: "btn", style: "min-width:60%", onclick: () => app.queue.resume() }, "今すぐ送り直す")
          : null,
      ),
    );

    // 待つ設定のときは、一度送ってみるまで次へ進ませない。
    // 前の会計が送れずに送信待ちが止まっているときは、待っても進まないので次へ進ませる
    // オフラインと分かっているときも、待っても届かないので次へ進ませる
    const waiting =
      config.waitForSend &&
      app.register !== "offline" &&
      (sale.status === "sending" || (sale.status === "pending" && !tried && app.queue.busy));
    canLeave = !waiting;
    if (waiting) {
      next.textContent = "送信中…";
      next.className = "btn btn--blocked";
    } else if (config.waitForSend && (sale.status === "pending" || sale.status === "sending")) {
      next.textContent = "送信待ちに残して次の会計";
      next.className = "btn btn--waiting";
    } else {
      next.textContent = "次の会計";
      next.className = "btn btn--primary";
    }
  }

  const body = h(
    "div",
    { class: "done" },
    head,
    h(
      "div",
      { class: `change change--done${changeAmount === 0 ? " is-none" : ""}` },
      h("div", { class: "row" }, h("span", { class: "row__label" }, "おつり"), h("span", { class: "row__value num" }, yen(changeAmount))),
      changeAmount > 0 ? changeList(first.change) : h("p", { class: "give__none" }, "おつりはありません"),
    ),
    h("div", { class: "row row--small", style: "align-self:stretch" }, h("span", { class: "row__label" }, "合計"), h("span", { class: "row__value num" }, yen(first.total))),
    h("div", { class: "row row--small", style: "align-self:stretch" }, h("span", { class: "row__label" }, "預かり"), h("span", { class: "row__value num" }, yen(first.deposit))),
  );

  draw();
  app.onStateChange = draw;
  return h("div", { class: "screen" }, body, h("div", { class: "foot" }, next));
}

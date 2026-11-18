import type { App } from "../app.ts";
import { h } from "../dom.ts";

export function renderOperator(app: App): HTMLElement {
  const list = h("div", { class: "operators" });

  const draw = () => {
    const back =
      app.operator && app.returnTo !== "operator"
        ? h("button", { class: "link", onclick: () => app.go(app.returnTo) }, "← 戻る")
        : null;

    const buttons = app.operators.map((op) => {
      const selected = op.id === app.operatorId;
      return h(
        "button",
        {
          class: "btn operator",
          "aria-pressed": String(selected),
          onclick: () => {
            app.setOperator(op.id);
            const next = app.returnTo;
            app.returnTo = "products";
            app.go(next === "operator" || next === "login" ? "products" : next);
          },
        },
        h("span", null, op.name),
        selected ? h("span", null, "✓") : null,
      );
    });

    list.replaceChildren(
      ...(back ? [h("div", null, back)] : []),
      h("h1", null, "担当はどなたですか"),
      ...buttons,
    );
    if (app.operators.length === 0) {
      list.append(
        h(
            "div",
            { class: "center" },
            h("p", { class: "hint" }, "担当者の一覧がありません。Discord で担当者のロールを設定してから読み直してください。"),
            h(
              "button",
              {
                class: "btn",
                onclick: async () => {
                  await app.loadMaster();
                  draw();
                },
              },
              "読み直す",
            ),
          ),
      );
    }
  };

  draw();
  // 一覧が古いかもしれないので、開くたびに読み直す
  void app.loadMaster().then(() => {
    if (app.screen === "operator") draw();
  });
  return list;
}

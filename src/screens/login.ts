import { api, describeFailure } from "../api.ts";
import type { App } from "../app.ts";
import { h } from "../dom.ts";
import { extractPassword, scanPassword } from "../qr.ts";

export function renderLogin(app: App): HTMLElement {
  const input = h("input", {
    class: "field",
    type: "password",
    autocomplete: "current-password",
    enterkeyhint: "go",
    "aria-label": "パスワード",
    placeholder: "パスワード",
  });
  const error = h("p", { class: "error", role: "alert" }, app.loginError);
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "入る");

  const scan = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: async () => {
        error.textContent = "";
        const pw = await scanPassword();
        if (pw === null) return;
        input.value = pw;
        form.requestSubmit();
      },
    },
    h("span", { class: "qr-icon", "aria-hidden": "true" }),
    "QR コードを読み取る",
  );

  const form = h(
    "form",
    {
      class: "center",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        // QR の URL をそのまま貼られたときは、pw= の部分だけ使う
        const pw = extractPassword(input.value) ?? input.value;
        if (!pw) {
          error.textContent = "パスワードを入れてください";
          input.focus();
          return;
        }
        submit.textContent = "確認中…";
        const r = await api.auth(pw);
        submit.textContent = "入る";
        if (r.ok) {
          app.setPassword(pw);
          app.setRegister("unknown");
          app.afterLogin();
          return;
        }
        error.textContent =
          r.kind === "network" ? "オフラインのため、パスワードを確かめられません" : describeFailure(r);
        input.select();
      },
    },
    h("h1", { class: "title" }, "まんじゅう レジ"),
    scan,
    h("div", { class: "or", "aria-hidden": "true" }, "または"),
    input,
    error,
    submit,
    h("p", { class: "hint" }, "パスワードと QR コードは Discord で確認できます"),
  );

  input.addEventListener("input", () => (error.textContent = ""));
  return form;
}

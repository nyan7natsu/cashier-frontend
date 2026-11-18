import { api, type Operator, type Product } from "./api.ts";
import { h, toast } from "./dom.ts";
import { emptyTally, type Tally } from "./money.ts";
import { pwa } from "./pwa.ts";
import { SaleQueue, type SendOutcome } from "./queue.ts";
import { load, save } from "./storage.ts";
import { renderDone } from "./screens/done.ts";
import { renderHistory } from "./screens/history.ts";
import { renderLogin } from "./screens/login.ts";
import { renderOperator } from "./screens/operator.ts";
import { renderPayment } from "./screens/payment.ts";
import { renderProducts } from "./screens/products.ts";

export type Screen = "login" | "operator" | "products" | "payment" | "done" | "history";
export type RegisterState = "unknown" | "open" | "closed" | "offline" | "unauthorized";
export type Theme = "auto" | "dark" | "light";

const STATUS_INTERVAL_MS = 10_000;

export class App {
  password: string | null = load("password");
  operators: Operator[] = parseJson<Operator[]>(load("operators")) ?? [];
  operatorId: string | null = load("operator");
  products: Product[] = parseJson<Product[]>(load("products")) ?? [];

  cart = new Map<number, number>();
  tender: Tally = emptyTally();
  discount = 0;
  /** 確定後の画面に出している会計 */
  lastSaleKey: string | null = null;
  queue: SaleQueue;
  /** 今の画面が、レジの状態や送信待ちの変化を受けて描き直すための関数 */
  onStateChange: (() => void) | null = null;

  register: RegisterState = "unknown";
  screen: Screen = "login";
  /** パスワードや担当者を入れたあとに戻る画面 */
  returnTo: Screen = "products";
  /** 起動時の自動ログインで失敗したときの理由 */
  loginError = "";

  private band: HTMLElement;
  private main: HTMLElement;
  private menu: HTMLDialogElement;
  private statusTimer: number | undefined;

  constructor(root: HTMLElement) {
    this.band = h("header", { class: "band" });
    this.main = h("main", { class: "screen" });
    this.menu = h("dialog", { class: "drawer", "aria-label": "メニュー" });
    this.menu.addEventListener("click", (e) => {
      if (e.target === this.menu) this.menu.close();
    });
    root.replaceChildren(this.band, this.main, this.menu);
    applyTheme(this.theme);

    this.queue = new SaleQueue({
      password: () => this.password,
      onChange: () => this.stateChanged(),
      onOutcome: (o) => this.applyOutcome(o),
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.checkStatus();
    });
    pwa.onChange = () => {
      this.renderBand();
      if (this.menu.open) this.openMenu();
    };
    window.addEventListener("online", () => {
      void this.checkStatus();
      this.queue.kick();
    });
    window.addEventListener("offline", () => this.setRegister("offline"));
  }

  // ---------- 起動 ----------

  async start(): Promise<void> {
    const fromUrl = takePasswordFromUrl();
    const candidate = fromUrl ?? this.password;
    if (!candidate) return this.go("login");

    const r = await api.auth(candidate);
    if (r.ok) {
      this.setPassword(candidate);
      await this.afterLogin();
    } else if (r.kind === "http" && r.status === 401) {
      this.setPassword(null);
      this.loginError = fromUrl ? "URL のパスワードが違います" : "パスワードが変わりました。入れ直してください";
      this.go("login");
    } else {
      // つながらないときは、保存してあるパスワードと商品で始める
      this.setPassword(candidate);
      this.register = "offline";
      await this.afterLogin();
    }
  }

  async afterLogin(): Promise<void> {
    this.loginError = "";
    await this.loadMaster();
    this.startStatusPolling();
    const back = this.returnTo;
    this.returnTo = "products";
    if (!this.operator) {
      this.returnTo = back;
      this.go("operator");
    } else {
      this.go(back === "login" || back === "operator" ? "products" : back);
    }
  }

  /** 担当者と商品を読み込む。つながらなければ前回の分を使う */
  async loadMaster(): Promise<void> {
    if (!this.password) return;
    const [ops, prods] = await Promise.all([api.operators(this.password), api.products(this.password)]);
    if (ops.ok) {
      this.operators = ops.data.operators;
      save("operators", JSON.stringify(this.operators));
    }
    if (prods.ok) {
      this.products = prods.data.products;
      save("products", JSON.stringify(this.products));
    }
    if (!ops.ok || !prods.ok) {
      if (ops.ok === false && ops.kind === "http" && ops.status === 401) this.setRegister("unauthorized");
      else if (this.products.length > 0) toast("つながらないので、前回の商品一覧を使います");
    }
  }

  // ---------- 画面の切り替え ----------

  go(screen: Screen): void {
    this.screen = screen;
    this.onStateChange = null;
    this.menu.close();
    this.renderBand();
    const view = (() => {
      switch (screen) {
        case "login":
          return renderLogin(this);
        case "operator":
          return renderOperator(this);
        case "products":
          return renderProducts(this);
        case "payment":
          return renderPayment(this);
        case "done":
          return renderDone(this);
        case "history":
          return renderHistory(this);
      }
    })();
    this.main.replaceChildren(view);
    window.scrollTo(0, 0);
  }

  /** パスワードを入れ直してもらい、終わったら今の画面に戻る */
  askPassword(): void {
    if (this.screen !== "login") this.returnTo = this.screen;
    this.go("login");
  }

  /** 担当者を替えてもらい、終わったら今の画面に戻る */
  askOperator(): void {
    if (this.screen !== "operator" && this.screen !== "login") this.returnTo = this.screen;
    this.go("operator");
  }

  // ---------- 状態 ----------

  get operator(): Operator | undefined {
    return this.operators.find((o) => o.id === this.operatorId);
  }

  setOperator(id: string): void {
    this.operatorId = id;
    save("operator", id);
  }

  setPassword(pw: string | null): void {
    this.password = pw;
    save("password", pw);
    if (pw) this.queue.resume();
  }

  get theme(): Theme {
    const t = load("theme");
    return t === "dark" || t === "light" ? t : "auto";
  }

  set theme(t: Theme) {
    save("theme", t === "auto" ? null : t);
    applyTheme(t);
  }

  setRegister(state: RegisterState): void {
    if (this.register === state) return;
    const wasOpen = this.register === "open";
    this.register = state;
    if (state === "open" && !wasOpen) this.queue.kick();
    this.stateChanged();
  }

  /** 閉局中とパスワード切れのときは、会計を確定させない */
  get canConfirm(): boolean {
    return this.register !== "closed" && this.register !== "unauthorized";
  }

  private stateChanged(): void {
    this.renderBand();
    this.onStateChange?.();
  }

  private applyOutcome(o: SendOutcome): void {
    if (o === "ok") void this.checkStatus();
    else if (o === "offline") this.setRegister("offline");
    else if (o === "unauthorized") this.setRegister("unauthorized");
    else if (o === "closed") this.setRegister("closed");
  }

  // ---------- 会計 ----------

  qty(id: number): number {
    return this.cart.get(id) ?? 0;
  }

  addItem(id: number, delta: number): number {
    const next = Math.max(0, this.qty(id) + delta);
    if (next === 0) this.cart.delete(id);
    else this.cart.set(id, next);
    return next;
  }

  get itemCount(): number {
    let n = 0;
    for (const q of this.cart.values()) n += q;
    return n;
  }

  get subtotal(): number {
    let sum = 0;
    for (const [id, q] of this.cart) sum += (this.products.find((p) => p.id === id)?.price ?? 0) * q;
    return sum;
  }

  get total(): number {
    return Math.max(0, this.subtotal - this.discount);
  }

  /** 次の会計に移る */
  resetSale(): void {
    this.cart.clear();
    this.tender = emptyTally();
    this.discount = 0;
  }

  // ---------- 上部の色帯 ----------

  renderBand(): void {
    const s = this.screen;
    const showSession = s !== "login";
    this.band.dataset.state = this.register;

    const label: Record<RegisterState, string> = {
      unknown: "確認中…",
      open: "開局中",
      closed: "閉局中",
      offline: "つながっていません",
      unauthorized: "パスワードを入れ直す",
    };

    const status = h(
      "div",
      { class: "band__status" },
      this.register === "unauthorized" && s !== "login"
        ? h("button", { class: "band__operator", onclick: () => this.askPassword() }, label.unauthorized)
        : h("span", null, s === "login" ? "レジ" : label[this.register]),
      showSession && this.operator && this.register !== "unauthorized" ? "·" : null,
      showSession && this.operator && this.register !== "unauthorized"
        ? h("button", { class: "band__operator", onclick: () => this.askOperator() }, this.operator.name)
        : null,
    );

    const waiting = this.queue.pending.length;
    const rejected = this.queue.rejected.length;
    const counts =
      showSession && (waiting > 0 || rejected > 0)
        ? h(
            "button",
            { class: "band__counts", onclick: () => this.go("history") },
            waiting > 0 ? h("span", { class: "band__count" }, `送信待ち ${waiting}`) : null,
            rejected > 0 ? h("span", { class: "band__count band__count--ng" }, `要確認 ${rejected}`) : null,
          )
        : null;

    this.band.replaceChildren(
      h(
        "button",
        {
          class: `band__menu${pwa.needRefresh && showSession ? " has-dot" : ""}`,
          "aria-label": pwa.needRefresh ? "メニュー（新しい版があります）" : "メニュー",
          onclick: () => this.openMenu(),
          disabled: !showSession,
        },
        showSession ? "☰" : "",
      ),
      status,
      counts ?? "",
    );
  }

  // ---------- メニュー ----------

  openMenu(): void {
    const themeButton = (t: Theme, text: string) =>
      h(
        "button",
        {
          "aria-pressed": String(this.theme === t),
          onclick: () => {
            this.theme = t;
            this.openMenu();
          },
        },
        text,
      );

    this.menu.replaceChildren(
      h(
        "div",
        { class: "drawer__head" },
        "メニュー",
        h("button", { class: "band__menu", "aria-label": "閉じる", onclick: () => this.menu.close() }, "×"),
      ),
      h(
        "button",
        { class: "drawer__item", onclick: () => this.askOperator() },
        "担当を替える",
        h("span", { class: "muted" }, this.operator?.name ?? "未選択"),
      ),
      h(
        "button",
        { class: "drawer__item", onclick: () => this.go("history") },
        "会計の記録",
        h(
          "span",
          { class: "muted" },
          [
            this.queue.pending.length > 0 ? `送信待ち ${this.queue.pending.length}` : "",
            this.queue.rejected.length > 0 ? `要確認 ${this.queue.rejected.length}` : "",
          ]
            .filter(Boolean)
            .join("・"),
        ),
      ),
      h(
        "button",
        {
          class: "drawer__item",
          onclick: async () => {
            this.menu.close();
            await this.loadMaster();
            if (this.screen === "products") this.go("products");
            toast("商品と担当者を読み直しました");
          },
        },
        "商品を読み直す",
      ),
      ...this.appItems(),
      h("div", { class: "drawer__section" }, "表示"),
      h("div", { class: "segmented" }, themeButton("auto", "自動"), themeButton("dark", "暗"), themeButton("light", "明")),
      h(
        "div",
        { class: "drawer__foot" },
        h("button", { class: "drawer__item", onclick: () => this.askPassword() }, "パスワードを入れ直す"),
      ),
    );
    if (!this.menu.open) this.menu.showModal();
  }

  /** メニューの「新しい版にする」「ホーム画面に追加」 */
  private appItems(): HTMLElement[] {
    const items: HTMLElement[] = [];
    if (pwa.needRefresh) {
      items.push(
        h(
          "button",
          {
            class: "drawer__item drawer__item--accent",
            onclick: () => {
              if (this.cart.size > 0 && !window.confirm("選んでいる商品は消えます。新しい版にしますか？")) return;
              pwa.update();
            },
          },
          "新しい版にする",
          h("span", { class: "muted" }, "読み直します"),
        ),
      );
    }
    if (!pwa.installed && (pwa.canPrompt || pwa.isIOS)) {
      items.push(
        h(
          "button",
          { class: "drawer__item", onclick: () => (pwa.canPrompt ? void pwa.install() : this.showInstallHelp()) },
          "ホーム画面に追加",
          h("span", { class: "muted" }, "アプリとして使う"),
        ),
      );
    }
    return items;
  }

  /** iPhone はインストールの確認を出せないので、手順を見せる */
  private showInstallHelp(): void {
    this.menu.close();
    const dialog = h(
      "dialog",
      { class: "sheet", "aria-label": "ホーム画面に追加" },
      h("h2", null, "ホーム画面に追加"),
      h(
        "ol",
        { class: "steps" },
        h("li", null, "Safari で開く（ほかのアプリの中のブラウザでは追加できません）"),
        h("li", null, "下の共有ボタン ", h("span", { class: "share-icon", "aria-label": "共有" }), " を押す"),
        h("li", null, "「ホーム画面に追加」を選ぶ"),
        h("li", null, "ホーム画面の「レジ」から開く"),
      ),
      h("div", { class: "sheet__actions" }, h("button", { class: "btn btn--primary", onclick: () => dialog.close() }, "わかった")),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  // ---------- レジの状態 ----------

  startStatusPolling(): void {
    window.clearInterval(this.statusTimer);
    void this.checkStatus();
    this.statusTimer = window.setInterval(() => void this.checkStatus(), STATUS_INTERVAL_MS);
  }

  async checkStatus(): Promise<void> {
    if (!this.password) return;
    const r = await api.status(this.password);
    if (r.ok) this.setRegister(r.data.is_open ? "open" : "closed");
    else if (r.kind === "http" && r.status === 401) this.setRegister("unauthorized");
    else this.setRegister("offline");
  }
}

function applyTheme(t: Theme): void {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/** `?pw=...` を読み取り、アドレスバーから消す（Discord の QR がこの形で出す） */
function takePasswordFromUrl(): string | null {
  const url = new URL(location.href);
  const pw = url.searchParams.get("pw");
  if (pw === null) return null;
  url.searchParams.delete("pw");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return pw;
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

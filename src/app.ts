import { api, describeFailure, type CashThreshold, type Operator, type Product } from "./api.ts";
import { h, toast } from "./dom.ts";
import { config } from "./config.ts";
import { addTally, DENOMS, emptyTally, fromCashCount, planChange, type ChangePlan, type Denom, type Tally } from "./money.ts";
import { bestDiscount, type DiscountResult, type DiscountRule } from "./pricing.ts";
import { forceUpdate, pwa } from "./pwa.ts";
import { SaleQueue, type SendOutcome } from "./queue.ts";
import { load, save } from "./storage.ts";
import { renderDone } from "./screens/done.ts";
import { renderDrawer } from "./screens/drawer.ts";
import { renderHistory } from "./screens/history.ts";
import { renderLogin } from "./screens/login.ts";
import { renderOperator } from "./screens/operator.ts";
import { renderPayment } from "./screens/payment.ts";
import { renderProducts } from "./screens/products.ts";

export type Screen = "login" | "operator" | "products" | "payment" | "done" | "history" | "drawer";
export type RegisterState = "unknown" | "open" | "closed" | "offline" | "unauthorized";
export type Theme = "auto" | "dark" | "light";
/** 商品の並べ方（縦向きのとき）。横向きでは、カテゴリーごとの列になる */
export type Layout = "one" | "two";

const STATUS_INTERVAL_MS = 10_000;

export class App {
  password: string | null = load("password");
  operators: Operator[] = parseJson<Operator[]>(load("operators")) ?? [];
  operatorId: string | null = load("operator");
  products: Product[] = parseJson<Product[]>(load("products")) ?? [];
  /** 自動割引のルール（最後に取れたもの） */
  discounts: DiscountRule[] = parseJson<DiscountRule[]>(load("discounts")) ?? [];
  /** 割引のルールを最後にサーバーから取れた時刻 */
  discountsAt: number | null = Number(load("discounts_at")) || null;
  /** サーバーが記録しているレジのお金（最後に取れたもの） */
  serverCash: Tally | null = parseJson<Tally>(load("cash"));
  /** サーバーが決めている金種ごとの閾値（最後に取れたもの） */
  cashThreshold: CashThreshold | null = parseJson<CashThreshold>(load("cash_threshold"));

  cart = new Map<number, number>();
  tender: Tally = emptyTally();
  /** キーパッドで打った預かり金額。空なら「ちょうど」として扱う */
  tenderInput = "";
  /** 受け取ったお金の内訳を、推定ではなく手で直したか */
  tenderEdited = false;
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
  private lastProductRefresh = Date.now();
  /** 直前の読み直しで、売り止めの商品を外したか（知らせを上書きしないため） */
  private droppedFromCart = false;

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
      this.updateWhenIdle();
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

    // 保存してあるパスワードで始めるときは、サーバーの返事を待たずに前回のデータで画面を出す。
    // オフラインだと返事が来るまで何秒もかかるため。パスワードの確認は裏で行う
    if (!fromUrl && this.password) {
      this.afterLogin();
      void this.verifyPassword(this.password);
      return;
    }

    if (!fromUrl) return this.go("login");

    // URL から新しいパスワードを受け取ったときは、正しいか確かめてから使う
    const r = await api.auth(fromUrl);
    if (r.ok || r.kind === "network" || (r.kind === "http" && r.status >= 500)) {
      // オフラインなら確かめようがないので、そのまま使う（違っていれば、つながったときに 401 で分かる）
      this.setPassword(fromUrl);
      if (!r.ok) this.setRegister("offline");
      this.afterLogin();
    } else if (r.status === 401) {
      if (this.password) {
        // 前のパスワードがあれば、それで続ける
        toast("URL のパスワードが違います。前のパスワードで続けます");
        this.afterLogin();
        void this.verifyPassword(this.password);
      } else {
        this.loginError = "URL のパスワードが違います";
        this.go("login");
      }
    } else {
      this.loginError = describeFailure(r);
      this.go("login");
    }
  }

  /** 保存してあるパスワードが今も使えるか、裏で確かめる */
  private async verifyPassword(pw: string): Promise<void> {
    const r = await api.auth(pw);
    if (this.password !== pw) return;
    if (r.ok) return;
    if (r.kind === "http" && r.status === 401) {
      this.setRegister("unauthorized");
      // 会計の途中でなければ、すぐにパスワードの画面を出す
      if (this.cart.size === 0 && (this.screen === "products" || this.screen === "operator")) {
        this.loginError = "パスワードが変わりました。入れ直してください";
        this.askPassword();
      }
    } else if (r.kind === "network") {
      this.setRegister("offline");
    }
  }

  /** 画面を出す。担当者と商品は、前回の分があれば待たずに使い、裏で読み直す */
  afterLogin(): void {
    this.loginError = "";
    const hasCache = this.products.length > 0 && this.operators.length > 0;
    const loading = this.loadMaster();
    this.startStatusPolling();
    if (hasCache) {
      this.showNext();
      void loading.then((changed) => {
        // 商品や担当者が変わっていたら描き直す（選んでいる商品はそのまま）
        if (changed && (this.screen === "products" || this.screen === "operator")) this.go(this.screen);
      });
    } else {
      void loading.then(() => this.showNext());
    }
  }

  private showNext(): void {
    const back = this.returnTo;
    this.returnTo = "products";
    if (!this.operator) {
      this.returnTo = back;
      this.go("operator");
    } else {
      this.go(back === "login" || back === "operator" ? "products" : back);
    }
  }

  /**
   * 担当者と商品を読み込む。読めなければ前回の分を使う。
   * 前回から変わったかどうかを返す
   */
  async loadMaster(): Promise<boolean> {
    if (!this.password) return false;
    const before = JSON.stringify([this.operators, this.products, this.discounts]);
    const [ops, prods, threshold, discounts] = await Promise.all([
      api.operators(this.password),
      api.products(this.password, this.showAll),
      api.cashThreshold(this.password),
      api.discounts(this.password),
    ]);
    if (discounts.ok && Array.isArray(discounts.data.discounts)) {
      // 形の合わないもの（take がないなど）は使わない
      this.discounts = discounts.data.discounts.filter(
        (d) => d.enabled !== false && typeof d.discount === "number" && Array.isArray(d.take),
      );
      save("discounts", JSON.stringify(this.discounts));
      this.discountsAt = Date.now();
      save("discounts_at", String(this.discountsAt));
    }
    if (threshold.ok) {
      this.cashThreshold = threshold.data;
      save("cash_threshold", JSON.stringify(threshold.data));
    }
    if (ops.ok) {
      this.operators = ops.data.operators;
      save("operators", JSON.stringify(this.operators));
    }
    if (prods.ok) {
      this.products = prods.data.products.filter((p) => this.showAll || p.enabled !== false);
      save("products", JSON.stringify(this.products));
      this.dropUnavailable();
    }
    if (!ops.ok || !prods.ok) {
      if (ops.ok === false && ops.kind === "http" && ops.status === 401) this.setRegister("unauthorized");
      else if (ops.ok === false && ops.kind === "network") this.setRegister("offline");
    }
    return JSON.stringify([this.operators, this.products, this.discounts]) !== before;
  }

  dropUnavailableNow(): void {
    this.dropUnavailable();
  }

  /** 売り止めになって一覧から消えた商品を、選んでいる商品から外す */
  private dropUnavailable(): void {
    const removed = [...this.cart.keys()].filter((id) => !this.products.some((p) => p.id === id));
    if (removed.length === 0) return;
    for (const id of removed) this.cart.delete(id);
    this.droppedFromCart = true;
    toast("売り止めになった商品を、選んでいる商品から外しました");
    if (this.screen === "payment" && this.cart.size === 0) this.go("products");
    else if (this.screen === "payment") this.go("payment");
  }

  // ---------- 画面の切り替え ----------

  /**
   * 新しい版が届いていて、会計の途中でなければ、その場で入れ替える（読み直す）。
   * 「新しい版にする」を押し忘れて、端末ごとに古い版が残るのを防ぐ
   */
  updateWhenIdle(): void {
    if (!pwa.needRefresh || this.menu.open || this.cart.size > 0 || this.tenderInput !== "") return;
    if (!["login", "operator", "products", "history", "drawer"].includes(this.screen)) return;
    save("updated_notice", "1");
    pwa.update();
  }

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
        case "drawer":
          return renderDrawer(this);
      }
    })();
    this.main.replaceChildren(view);
    window.scrollTo(0, 0);
    queueMicrotask(() => this.updateWhenIdle());
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

  /**
   * 特別販売モード: ふだんは出していない商品（enabled: false）も一覧に出して売れるようにする。
   * 端末ごとに覚える
   */
  get showAll(): boolean {
    return load("show_all") === "1";
  }

  set showAll(on: boolean) {
    save("show_all", on ? "1" : null);
  }

  get layout(): Layout {
    return load("layout") === "two" ? "two" : "one";
  }

  set layout(l: Layout) {
    save("layout", l === "one" ? null : l);
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

  /**
   * レジのお金の目安。サーバーの記録に、この端末でまだ送れていない会計の分を足したもの。
   * ほかの端末の送信待ちは入らない。サーバーから一度も取れていなければ null
   */
  get drawer(): Tally | null {
    if (!this.serverCash) return null;
    let t = this.serverCash;
    for (const r of this.queue.pending) t = addTally(t, fromCashCount(r.payload.cash_count));
    return t;
  }

  /** 今の預かりでのおつりの組み方。預かったお金もおつりに使える */
  planChange(amount: number): ChangePlan {
    const d = this.drawer;
    return planChange(amount, d ? addTally(d, this.tender) : null);
  }

  /**
   * 残りが少ない金種。サーバーの閾値（near_empty 以下）で判定する。
   * 閾値をまだ取れていなければ config.lowStock を使う
   */
  get lowStock(): { denom: Denom; count: number }[] {
    const d = this.drawer;
    if (!d) return [];
    const t = this.cashThreshold;
    const limit = (denom: Denom): number | null => {
      if (t) {
        const v = t.near_empty[`yen_${denom}`];
        return typeof v === "number" && v >= 0 ? v : null;
      }
      const v = config.lowStock[denom];
      // config の値は「この枚数を下回ったら」なので、以下の比較に合わせて 1 引く
      return typeof v === "number" ? v - 1 : null;
    };
    return DENOMS.flatMap((denom) => {
      const l = limit(denom);
      return l !== null && d[denom] <= l ? [{ denom, count: d[denom] }] : [];
    });
  }

  /** 多すぎる金種（near_full 以上）。金庫へ移す目安 */
  get highStock(): { denom: Denom; count: number }[] {
    const d = this.drawer;
    const t = this.cashThreshold;
    if (!d || !t) return [];
    return DENOMS.flatMap((denom) => {
      const v = t.near_full[`yen_${denom}`];
      return typeof v === "number" && v >= 0 && d[denom] >= v ? [{ denom, count: d[denom] }] : [];
    });
  }

  /** 閉局中とパスワード切れのときは、会計を確定させない */
  get canConfirm(): boolean {
    return this.register !== "closed" && this.register !== "unauthorized";
  }

  stateChanged(): void {
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

  /** 自動割引（いちばん得になる組み合わせ） */
  get autoDiscount(): DiscountResult {
    return bestDiscount(this.cart, this.products, this.discounts);
  }

  /** 値引きの合計（自動割引 ＋ 手で入れた値引き）。小計を超えない */
  get totalDiscount(): number {
    return Math.min(this.subtotal, this.autoDiscount.total + this.discount);
  }

  get total(): number {
    return Math.max(0, this.subtotal - this.totalDiscount);
  }

  /** 次の会計に移る */
  resetSale(): void {
    this.cart.clear();
    this.tender = emptyTally();
    this.tenderInput = "";
    this.tenderEdited = false;
    this.discount = 0;
  }

  // ---------- 上部の色帯 ----------

  renderBand(): void {
    const s = this.screen;
    const showSession = s !== "login";
    this.band.dataset.state = this.register;

    const label: Record<RegisterState, string> = {
      unknown: "確認中…",
      open: "オンライン",
      // 閉局中かどうかはオンラインのときしか分からないので、「オンライン」は付けない
      closed: "閉局中",
      offline: "オフライン",
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
    // 特別販売モードの切り忘れに気づけるよう、オンの間は帯に出す（押すとメニュー）
    const special =
      showSession && this.showAll
        ? h("button", { class: "band__counts", onclick: () => this.openMenu() }, h("span", { class: "band__count band__count--special" }, "特別販売"))
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
      special ?? "",
      counts ?? "",
    );
  }

  // ---------- メニュー ----------

  openMenu(): void {
    const showAllButton = (on: boolean, text: string) =>
      h(
        "button",
        {
          "aria-pressed": String(this.showAll === on),
          onclick: async () => {
            if (this.showAll === on) return;
            this.showAll = on;
            // 隠すときは、つながらなくてもすぐ消えるよう、手元の一覧からも外す
            if (!on) {
              this.products = this.products.filter((p) => p.enabled !== false);
              save("products", JSON.stringify(this.products));
            }
            this.openMenu();
            this.lastProductRefresh = Date.now();
            await this.loadMaster();
            if (this.screen === "products") this.go("products");
            if (!on) this.dropUnavailableNow();
            toast(on ? "特別販売モードにしました。ふだん出していない商品も売れます" : "特別販売モードを終えました");
          },
        },
        text,
      );
    const layoutButton = (l: Layout, text: string) =>
      h(
        "button",
        {
          "aria-pressed": String(this.layout === l),
          onclick: () => {
            this.layout = l;
            if (this.screen === "products") this.go("products");
            this.openMenu();
          },
        },
        text,
      );
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
        { class: "drawer__item", onclick: () => this.go("drawer") },
        "レジのお金",
        h(
          "span",
          { class: this.lowStock.length + this.highStock.length > 0 ? "warn-text" : "muted" },
          [
            this.lowStock.length > 0 ? `残り少 ${this.lowStock.length}` : "",
            this.highStock.length > 0 ? `多い ${this.highStock.length}` : "",
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
            this.lastProductRefresh = Date.now();
            this.droppedFromCart = false;
            await this.loadMaster();
            if (this.screen === "products") this.go("products");
            if (!this.droppedFromCart) {
              toast(this.register === "offline" ? "オフラインなので、前回の一覧のままです" : "商品と担当者を読み直しました");
            }
          },
        },
        "商品を読み直す",
      ),
      ...this.appItems(),
      h("div", { class: "drawer__section" }, "表示"),
      h("div", { class: "segmented" }, themeButton("auto", "自動"), themeButton("dark", "暗"), themeButton("light", "明")),
      h("div", { class: "drawer__section" }, "商品の並べ方（縦向き）"),
      h("div", { class: "segmented" }, layoutButton("one", "1 列"), layoutButton("two", "2 列")),
      h("div", { class: "drawer__section" }, "特別販売モード（ふだん出していない商品も売る）"),
      h("div", { class: "segmented" }, showAllButton(false, "オフ"), showAllButton(true, "オン")),
      h(
        "div",
        { class: "drawer__foot" },
        h("button", { class: "drawer__item", onclick: () => this.askPassword() }, "パスワードを入れ直す"),
        h(
          "button",
          {
            class: "drawer__item",
            onclick: async (e: Event) => {
              const ok = window.confirm(
                "端末に保存したアプリを消して、サーバーから読み直します。\n" +
                  "パスワードや送信待ちの会計は消えません。" +
                  (this.cart.size > 0 ? "\n選んでいる商品は消えます。" : "") +
                  "\n\n続けますか？",
              );
              if (!ok) return;
              const button = e.currentTarget as HTMLButtonElement;
              button.disabled = true;
              button.textContent = "読み直しています…";
              if ((await forceUpdate()) === "offline") {
                button.disabled = false;
                button.textContent = "キャッシュを消して読み直す";
                toast("サーバーにつながらないので、できませんでした。オンラインのときにもう一度試してください");
              }
            },
          },
          "キャッシュを消して読み直す",
        ),
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
    const hm = (t: number) => new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
    items.push(
      h("div", { class: "drawer__note" }, "今の版", h("span", { class: "num" }, pwa.version)),
      ...(pwa.needRefresh
        ? [h("div", { class: "drawer__note is-new" }, "届いている版", h("span", { class: "num" }, pwa.nextVersion ?? "（番号を確認中）"))]
        : []),
      h(
        "div",
        { class: `drawer__note${this.discountsAt ? "" : " is-warn"}` },
        "割引のルール",
        h("span", null, this.discountsAt ? `${this.discounts.length} 件（${hm(this.discountsAt)} に取得）` : "まだ取れていません"),
      ),
    );
    items.push(
      h(
        "div",
        { class: `drawer__note${pwa.offline === "unsupported" || pwa.offline === "dev" ? " is-warn" : ""}` },
        "オフライン",
        h(
          "span",
          null,
          pwa.offline === "ready"
            ? "使えます"
            : pwa.offline === "preparing"
              ? "準備中…"
              : pwa.offline === "dev"
                ? "使えません（開発モード）"
                : "使えません（https で開いてください）",
        ),
      ),
    );
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
    this.updateWhenIdle();
    if (!this.password) return;
    const r = await api.status(this.password);
    if (r.ok) {
      this.setRegister(r.data.is_open ? "open" : "closed");
      this.setServerCash(r.data.cash_count ? fromCashCount(r.data.cash_count) : null);
      // 売り止めを反映するため、ときどき商品一覧も読み直す
      if (Date.now() - this.lastProductRefresh >= config.productRefreshMs) {
        this.lastProductRefresh = Date.now();
        void this.loadMaster().then((changed) => {
          if (changed && this.screen === "products") this.go("products");
        });
      }
    } else if (r.kind === "http" && r.status === 401) this.setRegister("unauthorized");
    else this.setRegister("offline");
  }

  private setServerCash(cash: Tally | null): void {
    if (!cash || JSON.stringify(cash) === JSON.stringify(this.serverCash)) return;
    this.serverCash = cash;
    save("cash", JSON.stringify(cash));
    this.stateChanged();
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

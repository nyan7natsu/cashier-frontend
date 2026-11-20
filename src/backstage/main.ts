import "./style.css";
import { h, toast } from "../dom.ts";
import { api, describe, LOGIN_URL, LOGOUT_URL, type Session, type Status } from "./api.ts";
import { renderCount, renderHome, renderSales } from "./pages.ts";

export type Page = "home" | "open" | "x" | "sales";

const PAGES: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "ホーム", icon: "⌂" },
  { id: "open", label: "開局", icon: "↗" },
  { id: "x", label: "点検 (X)", icon: "✓" },
  { id: "sales", label: "売上・取消", icon: "≡" },
];

/** backstage 全体の状態 */
export class BackStage {
  session: Session | null = null;
  status: Status | null = null;
  /** ページが描き直しのために登録する関数 */
  onStatus: (() => void) | null = null;

  private nav = h("nav", { class: "nav", "aria-label": "業務" });
  private main = h("main", { class: "main" });
  private user = h("div", { class: "user" });
  private pill = h("span", { class: "pill" });
  private shell: HTMLElement;

  constructor(root: HTMLElement) {
    this.shell = h(
      "div",
      { class: "shell" },
      h(
        "aside",
        { class: "side" },
        h("div", { class: "brand" }, h("span", { class: "brand__mark", "aria-hidden": "true" }, "P"), h("span", null, "POS Service", h("b", null, " BackStage"))),
        this.user,
        this.nav,
      ),
      h("div", { class: "content" }, h("div", { class: "topline" }, this.pill), this.main),
    );
    root.replaceChildren(this.shell);
    window.addEventListener("hashchange", () => this.route());
    // 残り時間の表示を進め、ときどきセッションと状態を取り直す
    window.setInterval(() => this.renderUser(), 15_000);
    window.setInterval(() => void this.refresh(), 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.refresh();
    });
  }

  get page(): Page {
    const p = location.hash.replace(/^#\/?/, "") as Page;
    return PAGES.some((x) => x.id === p) ? p : "home";
  }

  go(page: Page): void {
    if (location.hash === `#/${page}`) this.route();
    else location.hash = `#/${page}`;
  }

  async start(): Promise<void> {
    const s = await api.session();
    if (!s.ok) return this.showLogin(s.kind === "http" && s.status === 401 ? null : describe(s));
    this.session = s.data;
    await this.refreshStatus();
    this.route();
  }

  /** セッションと状態を取り直す。ログインが切れていたらログイン画面に戻す */
  async refresh(): Promise<void> {
    if (!this.session) return;
    const s = await api.session();
    if (!s.ok && s.kind === "http" && s.status === 401) return this.expired();
    if (s.ok) this.session = s.data;
    await this.refreshStatus();
    this.renderUser();
  }

  async refreshStatus(): Promise<void> {
    const r = await api.status();
    if (r.ok) this.status = r.data;
    else if (r.kind === "http" && r.status === 401 && !this.status) {
      // /api/register/status がまだ Cookie を受け付けていないとき。理論在高なしで続ける
      this.status = null;
    }
    this.renderPill();
    this.onStatus?.();
  }

  /** API が 401 を返したときに呼ぶ */
  expired(): void {
    this.session = null;
    toast("ログインが切れました。もう一度ログインしてください");
    this.showLogin(null);
  }

  private route(): void {
    if (!this.session) return;
    this.onStatus = null;
    const page = this.page;
    this.nav.replaceChildren(
      ...PAGES.map((p) =>
        h(
          "a",
          { class: `nav__item${p.id === page ? " is-on" : ""}`, href: `#/${p.id}`, "aria-current": p.id === page ? "page" : null },
          h("span", { class: "nav__icon", "aria-hidden": "true" }, p.icon),
          p.label,
        ),
      ),
    );
    const view =
      page === "home"
        ? renderHome(this)
        : page === "sales"
          ? renderSales(this)
          : renderCount(this, page);
    this.main.replaceChildren(view);
    this.renderUser();
    this.renderPill();
    document.title = `${PAGES.find((p) => p.id === page)!.label} - POS Service BackStage`;
  }

  private renderPill(): void {
    const st = this.status;
    this.pill.className = `pill${st ? (st.is_open ? " pill--open" : " pill--closed") : ""}`;
    this.pill.textContent = st ? (st.is_open ? "開局中" : "閉局中") : "状態を取れません";
  }

  private renderUser(): void {
    const s = this.session;
    if (!s) return this.user.replaceChildren();
    const left = Math.max(0, Math.round((new Date(s.expires_at).getTime() - Date.now()) / 60_000));
    this.user.replaceChildren(
      h("span", { class: "user__avatar", "aria-hidden": "true" }, s.user_name.slice(0, 1).toUpperCase()),
      h("span", { class: "user__text" }, h("span", null, s.user_name), h("span", { class: "muted" }, `ログイン残り ${left} 分`)),
      h("a", { class: "user__logout", href: LOGOUT_URL }, "ログアウト"),
    );
  }

  private showLogin(error: string | null): void {
    this.main.replaceChildren(
      h(
        "div",
        { class: "login card" },
        h("h1", null, "POS Service BackStage"),
        h("p", { class: "muted" }, "開局・点検・売上の確認と取消を行う管理画面です。Discord の管理者ロールでログインしてください。"),
        error ? h("p", { class: "error" }, error) : null,
        h("a", { class: "btn btn--primary", href: LOGIN_URL }, "Discord でログイン"),
      ),
    );
    this.nav.replaceChildren();
    this.user.replaceChildren();
    this.pill.textContent = "";
    this.pill.className = "pill";
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (root) void new BackStage(root).start();

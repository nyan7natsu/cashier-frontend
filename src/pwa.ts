import { registerSW } from "virtual:pwa-register";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

const UPDATE_CHECK_MS = 30 * 60_000;

/** アプリとして入れる・新しい版にする、のための状態 */
export const pwa = {
  /** 新しい版をダウンロード済みで、入れ替えを待っている */
  needRefresh: false,
  /** 今動いている版 */
  version: __APP_VERSION__,
  /** 届いている新しい版の番号（サーバーの version.json）。分からなければ null */
  nextVersion: null as string | null,
  /** Android の Chrome で「インストール」を出せる */
  canPrompt: false,
  /**
   * オフラインで使えるか。
   * - "dev": Vite の開発サーバーで動いている（service worker を作らない）
   * - "unsupported": http で開いているなどで、ブラウザが service worker を使わせない
   * - "preparing": 保存の途中
   * - "ready": オフラインでも開ける
   */
  offline: (import.meta.env.DEV ? "dev" : "serviceWorker" in navigator ? "preparing" : "unsupported") as
    | "dev"
    | "unsupported"
    | "preparing"
    | "ready",
  /** 状態が変わったら呼ぶ（メニューの描き直しなど） */
  onChange: () => {},

  /** ホーム画面から開いているか */
  get installed(): boolean {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  },

  get isIOS(): boolean {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },

  /** Android: インストールの確認を出す */
  async install(): Promise<void> {
    const e = deferred;
    if (!e) return;
    deferred = null;
    this.canPrompt = false;
    await e.prompt();
    await e.userChoice.catch(() => undefined);
    this.onChange();
  },

  /**
   * 新しい版に入れ替えて読み直す。
   *
   * vite-plugin-pwa の updateSW(true) は、ページを開いた時点で service worker が
   * まだ動いていなかった（インストール直後の最初の起動）と、入れ替えても読み直さない。
   * そのため、待っている版があれば切り替えを頼み、どちらの場合も必ず読み直す
   */
  update(): void {
    if (updating) return;
    updating = true;
    void (async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.waiting) {
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        void updateSW(true);
        // 切り替えの知らせが来なくても、少し待って読み直す
        window.setTimeout(() => location.reload(), 3000);
      } else {
        // すでに新しい版が動き始めている（待っている版がない）ので、読み直すだけでよい
        location.reload();
      }
    })();
  },
};

let deferred: InstallPromptEvent | null = null;
/** 入れ替えを一度だけ行うため */
let updating = false;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  pwa.canPrompt = true;
  pwa.onChange();
});

window.addEventListener("appinstalled", () => {
  deferred = null;
  pwa.canPrompt = false;
  pwa.onChange();
});

const updateSW = registerSW({
  onOfflineReady() {
    pwa.offline = "ready";
    pwa.onChange();
  },
  onRegisterError() {
    pwa.offline = "unsupported";
    pwa.onChange();
  },
  onNeedRefresh() {
    pwa.needRefresh = true;
    pwa.onChange();
    void fetchNextVersion();
  },
  onRegisteredSW(_url, registration) {
    // すでに保存済みで開き直したときは onOfflineReady が来ないので、ここで ready にする
    if (registration?.active) {
      pwa.offline = "ready";
      pwa.onChange();
    }
    // 開きっぱなしで使うので、ときどき新しい版がないか見に行く
    if (registration) window.setInterval(() => void registration.update().catch(() => undefined), UPDATE_CHECK_MS);
  },
});

/**
 * 強制アップデート: 端末に保存したアプリ本体（service worker とキャッシュ）を全部消して、
 * サーバーから読み直す。パスワードや送信待ちの会計（localStorage）は消さない。
 *
 * 消したあとにサーバーにつながらないとアプリが開けなくなるので、
 * 先にサーバーにつながることを確かめる。つながらなければ何もしない
 */
export async function forceUpdate(): Promise<"done" | "offline"> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "offline";
  } catch {
    return "offline";
  }
  const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
  await Promise.all(regs.map((r) => r.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  location.reload();
  return "done";
}

/** サーバーにある版の番号を読む（届いた新しい版の番号として出す） */
async function fetchNextVersion(): Promise<void> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version === "string" && data.version !== pwa.version) {
      pwa.nextVersion = data.version;
      pwa.onChange();
    }
  } catch {
    // オフラインなら出さない
  }
}

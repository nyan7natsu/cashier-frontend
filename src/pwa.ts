import { registerSW } from "virtual:pwa-register";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

const UPDATE_CHECK_MS = 30 * 60_000;

/** アプリとして入れる・新しい版にする、のための状態 */
export const pwa = {
  /** 新しい版をダウンロード済みで、入れ替えを待っている */
  needRefresh: false,
  /** Android の Chrome で「インストール」を出せる */
  canPrompt: false,
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

  /** 新しい版に入れ替えて読み直す */
  update(): void {
    void updateSW(true);
  },
};

let deferred: InstallPromptEvent | null = null;

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
  onNeedRefresh() {
    pwa.needRefresh = true;
    pwa.onChange();
  },
  onRegisteredSW(_url, registration) {
    // 開きっぱなしで使うので、ときどき新しい版がないか見に行く
    if (registration) window.setInterval(() => void registration.update().catch(() => undefined), UPDATE_CHECK_MS);
  },
});

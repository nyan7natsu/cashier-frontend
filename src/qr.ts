import { h } from "./dom.ts";

/**
 * 文字列から `pw=` の値を抜き出す。
 * Discord の QR は `https://…?pw=…` の形なので、URL として読めなくても `pw=` 以降を拾う。
 */
export function extractPassword(text: string): string | null {
  const m = /[?&#]pw=([^&#\s]*)/.exec(text) ?? /^pw=([^&#\s]*)/.exec(text.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1];
  }
}

type Detector = (video: HTMLVideoElement) => Promise<string | null>;

/** 端末に QR を読む機能があれば使い、なければ jsQR で読む */
async function makeDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats();
      if (formats.includes("qr_code")) {
        const detector = new Native({ formats: ["qr_code"] });
        return async (video) => {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue ?? null;
        };
      }
    } catch {
      // 使えなければ jsQR に回す
    }
  }

  // iPhone の Safari には BarcodeDetector がないので、こちらを使う
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (video) => {
    const w = video.videoWidth;
    const hgt = video.videoHeight;
    if (!w || !hgt) return null;
    // 大きいままだと重いので、長い辺を 640px に縮める
    const scale = Math.min(1, 640 / Math.max(w, hgt));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(hgt * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats(): Promise<string[]>;
};

/**
 * カメラで QR を読み、パスワードが見つかったら返す。閉じられたら null。
 */
export function scanPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    const video = h("video", { class: "scan__video", playsinline: true, muted: true, autoplay: true });
    // iOS は属性で付けないと全画面再生になる
    video.setAttribute("playsinline", "");
    video.muted = true;
    const message = h("p", { class: "scan__message" }, "QR コードを枠に合わせてください");
    const close = h("button", { class: "btn", type: "button", onclick: () => finish(null) }, "やめる");

    const dialog = h(
      "dialog",
      { class: "scan", "aria-label": "QR コードを読み取る" },
      h("div", { class: "scan__view" }, video, h("div", { class: "scan__frame", "aria-hidden": "true" })),
      message,
      close,
    );

    let stream: MediaStream | null = null;
    let done = false;
    let lastWrong = "";

    function finish(pw: string | null): void {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
      dialog.close();
      dialog.remove();
      resolve(pw);
    }

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        message.textContent = window.isSecureContext
          ? "この端末ではカメラを使えません"
          : "カメラは https で開いたときだけ使えます";
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        message.textContent =
          name === "NotAllowedError"
            ? "カメラが許可されていません。設定でこのアプリのカメラを許可してください"
            : "カメラを起動できませんでした";
        return;
      }
      if (done) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const detect = await makeDetector();
      while (!done) {
        const text = await detect(video).catch(() => null);
        if (text) {
          const pw = extractPassword(text);
          if (pw) return finish(pw);
          if (text !== lastWrong) {
            lastWrong = text;
            message.textContent = "パスワードの QR コードではないようです";
          }
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
  });
}

import "./style.css";
import "./pwa.ts";
import { App } from "./app.ts";
import { toast } from "./dom.ts";
import { load, save } from "./storage.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) void new App(root).start();

// 手が空いたときに新しい版へ入れ替えたので、読み直したあとに一言知らせる
if (load("updated_notice")) {
  save("updated_notice", null);
  window.setTimeout(() => toast("新しい版になりました"), 800);
}

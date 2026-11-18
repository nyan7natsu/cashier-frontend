import "./style.css";
import "./pwa.ts";
import { App } from "./app.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) void new App(root).start();

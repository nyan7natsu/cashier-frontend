import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// アイコンは背景まで描いてあるので、余白は足さずに小豆色で埋める
const fill = { padding: 0, resizeOptions: { background: "#7a2e38" } };

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...fill },
    apple: { ...minimal2023Preset.apple, ...fill },
  },
  images: ["public/icon.svg"],
});

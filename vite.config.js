import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = dirname(fileURLToPath(import.meta.url))


export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                "backstage": resolve(__dirname, 'backstage.html'),
            },
        },
    },
    plugins: [
        VitePWA({
            // 会計の途中で勝手に再読み込みしないよう、新しい版はメニューから入れてもらう
            registerType: 'prompt',
            injectRegister: false,
            // マニフェストは public/manifest.json に置き、index.html だけから読む。
            // プラグインに作らせると backstage.html にも入ってしまうため
            manifest: false,
            includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg', 'manifest.json'],
            workbox: {
                globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
                // backstage は Discord でログインする別の画面なので、レジのキャッシュには入れない
                globIgnores: ['backstage.html'],
                // オフラインでも、どの URL で開いてもレジの画面を出す（?pw= 付きでも）
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//, /^\/backstage/],
                cleanupOutdatedCaches: true,
            },
        }),
    ],
})

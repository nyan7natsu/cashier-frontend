import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 版の番号。ビルドした時刻（日本時間）を「2026.11.22-1143」の形にする
const BUILT_AT = new Date()
const APP_VERSION = (() => {
    const p = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(BUILT_AT)
    const v = (t) => p.find((x) => x.type === t)?.value ?? ''
    return `${v('year')}.${v('month')}.${v('day')}-${v('hour')}${v('minute')}`
})()

/**
 * version.json を出力する。service worker には保存させないので、
 * 端末はいつでもサーバーにある最新の版の番号を読める
 */
const versionFile = () => ({
    name: 'version-file',
    generateBundle() {
        this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: APP_VERSION, built_at: BUILT_AT.toISOString() }),
        })
    },
})


export default defineConfig({
    // どの版が動いているかをメニューで確かめるため、ビルドした時刻を埋め込む
    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                "backstage": resolve(__dirname, 'backstage.html'),
            },
        },
    },
    plugins: [
        versionFile(),
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
                // backstage.html と、リセット用のページ（public/backstage/）は端末に保存しない
                globIgnores: ['backstage.html', 'backstage/**'],
                // オフラインでも、どの URL で開いてもレジの画面を出す（?pw= 付きでも）
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//, /^\/backstage/],
                cleanupOutdatedCaches: true,
            },
        }),
    ],
})

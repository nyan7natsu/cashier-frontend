import { discountOf, type Product, type SaleEntry } from "./api.ts";

/**
 * 売上履歴を CSV にする。
 *
 * 1 行 = 会計の中の 1 品目。値引きは「値引き」という行にマイナスで入れるので、
 * 「金額」列をそのまま合計すると、その会計（や全体）の売上になる。
 * 取消済みの会計も含め、「取消」列で見分けられるようにする。
 */
export function salesCsv(sales: SaleEntry[], products: Map<number, Product>): string {
  const header = ["台帳番号", "日時", "取消", "担当者ID", "商品ID", "商品名", "カテゴリー", "単価", "数量", "金額", "会計の合計"];
  const rows: (string | number)[][] = [];

  for (const s of [...sales].sort((a, b) => a.id - b.id)) {
    const e = s.event;
    const voided = Boolean(s.voided ?? e.voided) ? "取消" : "";
    const discount = discountOf(e);
    const total = e.items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0) - discount;
    const base = [s.id, jst(e.occurred_at), voided, String(e.operator)];
    for (const it of e.items) {
      const p = products.get(it.product_id);
      rows.push([...base, it.product_id, p?.name ?? `商品 ${it.product_id}`, p?.category ?? "", it.unit_price, it.quantity, it.unit_price * it.quantity, total]);
    }
    if (discount) rows.push([...base, "", "値引き", "", "", "", -discount, total]);
  }

  // Excel で文字化けしないよう、先頭に BOM を付け、改行は CRLF にする
  return "\ufeff" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** ダウンロードさせる。iPhone の Safari では「ファイル」に保存するか聞かれる */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** ファイル名に入れる日時（日本時間）: 20261121-1403 */
export function stamp(d = new Date()): string {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}${v("month")}${v("day")}-${v("hour")}${v("minute")}`;
}

/** 2026/11/21 14:03:05（日本時間） */
function jst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** カンマ・改行・引用符を含むものは引用符で囲む */
function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

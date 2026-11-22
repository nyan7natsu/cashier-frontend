import type { SalePayload } from "./api.ts";
import type { App } from "./app.ts";
import { tallyTotal, toCashCount } from "./money.ts";

/**
 * 確定ボタンを押した瞬間に、送る中身をすべて決めて送信待ちに入れる。
 * idempotency_key・occurred_at・operator は、再送のときも作り直さない。
 */
export function confirmSale(app: App): void {
  const operator = app.operatorId;
  if (!operator) {
    app.askOperator();
    return;
  }
  if (!app.canConfirm) return;

  const total = app.total;
  const deposit = tallyTotal(app.tender);
  // 画面に出していた組み方と同じものを記録する（レジのお金が足りない金種を避けた組み方）
  const change = app.planChange(deposit - total).change;

  const payload: SalePayload = {
    idempotency_key: crypto.randomUUID(),
    items: [...app.cart].map(([id, quantity]) => ({
      product_id: id,
      quantity,
      unit_price: app.products.find((p) => p.id === id)!.price,
    })),
    // 自動割引と、手で入れた値引きの合計
    discount: app.totalDiscount,
    discount_ids: app.autoDiscount.applied.flatMap((a) => (a.id === undefined ? [] : Array<number>(a.count).fill(a.id))),
    cash_count: toCashCount(app.tender, change),
    occurred_at: new Date().toISOString(),
    operator,
  };

  // 先に送信待ちへ入れて、画面を移る前に localStorage へ残す
  app.queue.add({ payload, total, deposit, change, status: "pending", attempts: 0 });
  app.lastSaleKey = payload.idempotency_key;
  app.resetSale();
  app.go("done");
}

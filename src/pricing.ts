/**
 * 自動割引の計算。
 *
 * 割引のルールは「このカテゴリーの商品をこの数だけ含むと、この額を引く」。
 * 1 つの商品は 1 つのルールにしか使わず、値引きの合計がいちばん大きくなる組み合わせを選ぶ
 * （お客さんにとっていちばん安い値段になる）。
 */

export type DiscountTake = { category: string; quantity: number };

export type DiscountRule = {
  id?: number;
  name: string;
  /** 1 回あたりに引く額 */
  discount: number;
  enabled?: boolean;
  take: DiscountTake[];
};

export type PricedProduct = { id: number; price: number; category?: string };

export type AppliedDiscount = { id?: number; name: string; count: number; amount: number };

export type DiscountResult = {
  /** 値引きの合計（小計を超えない） */
  total: number;
  /** 使った割引（同じ割引を 2 回使えば count が 2） */
  applied: AppliedDiscount[];
};

const NONE: DiscountResult = { total: 0, applied: [] };

export function bestDiscount(
  cart: ReadonlyMap<number, number>,
  products: readonly PricedProduct[],
  rules: readonly DiscountRule[],
): DiscountResult {
  const active = rules.filter((r) => r.enabled !== false && r.discount > 0 && r.take.length > 0 && r.take.every((t) => t.quantity > 0));
  if (active.length === 0 || cart.size === 0) return NONE;

  // カートの商品を、ルールに出てくるカテゴリーごとに数える
  const categories = [...new Set(active.flatMap((r) => r.take.map((t) => t.category)))];
  const counts = categories.map(() => 0);
  let subtotal = 0;
  for (const [id, qty] of cart) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    subtotal += p.price * qty;
    const i = categories.indexOf(p.category ?? "");
    if (i >= 0) counts[i] += qty;
  }

  // ルールごとに、カテゴリーの番号へ直しておく
  const needs = active.map((r) => {
    const need = categories.map(() => 0);
    for (const t of r.take) need[categories.indexOf(t.category)] += t.quantity;
    return need;
  });

  // ルールを 1 つずつ見て、それを何回使うかを全部試す（状態ごとに結果を覚えておく）
  const memo = new Map<string, { value: number; uses: number[] }>();
  const search = (i: number, left: number[]): { value: number; uses: number[] } => {
    if (i === active.length) return { value: 0, uses: [] };
    const key = `${i}|${left.join(",")}`;
    const hit = memo.get(key);
    if (hit) return hit;

    const need = needs[i];
    let max = Infinity;
    need.forEach((n, c) => {
      if (n > 0) max = Math.min(max, Math.floor(left[c] / n));
    });

    let best = { value: -1, uses: [] as number[] };
    // 回数の多い方から試し、値引きが同じなら先に見つかった方（多く使う方）を残す
    for (let k = max; k >= 0; k--) {
      const rest = left.map((v, c) => v - need[c] * k);
      const sub = search(i + 1, rest);
      const value = k * active[i].discount + sub.value;
      if (value > best.value) best = { value, uses: [k, ...sub.uses] };
    }
    memo.set(key, best);
    return best;
  };

  const { value, uses } = search(0, counts);
  if (value <= 0) return NONE;
  const applied = uses
    .map((count, i) => ({ id: active[i].id, name: active[i].name, count, amount: count * active[i].discount }))
    .filter((a) => a.count > 0);
  // サーバーは値引きが小計を超えると受け付けないので、念のため小計で止める
  return { total: Math.min(value, subtotal), applied };
}

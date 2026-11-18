export const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1] as const;
export type Denom = (typeof DENOMS)[number];
export type CashKey = `yen_${Denom}`;
/** API の cash_count。金種ごとの枚数（マイナスもあり得る） */
export type CashCount = Record<CashKey, number>;
/** 画面で扱う金種ごとの枚数 */
export type Tally = Record<Denom, number>;

/** おつりに使う金種。2000円札は使わない */
const CHANGE_DENOMS: readonly Denom[] = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

export function emptyTally(): Tally {
  return { 10000: 0, 5000: 0, 2000: 0, 1000: 0, 500: 0, 100: 0, 50: 0, 10: 0, 5: 0, 1: 0 };
}

export function tallyTotal(t: Tally): number {
  return DENOMS.reduce((sum, d) => sum + d * t[d], 0);
}

/** おつりの金種を大きい方から決める */
export function makeChange(amount: number): Tally {
  const out = emptyTally();
  let rest = amount;
  for (const d of CHANGE_DENOMS) {
    out[d] = Math.floor(rest / d);
    rest -= out[d] * d;
  }
  return out;
}

/** 預かった枚数 − おつりの枚数 */
export function toCashCount(tender: Tally, change: Tally): CashCount {
  const out = {} as CashCount;
  for (const d of DENOMS) out[`yen_${d}`] = tender[d] - change[d];
  return out;
}

export function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

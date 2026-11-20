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

/** API の cash_count を、画面で扱う形にする */
export function fromCashCount(c: Partial<CashCount> | null | undefined): Tally {
  const out = emptyTally();
  if (!c) return out;
  for (const d of DENOMS) out[d] = Number(c[`yen_${d}`] ?? 0) || 0;
  return out;
}

export function addTally(a: Tally, b: Tally): Tally {
  const out = emptyTally();
  for (const d of DENOMS) out[d] = a[d] + b[d];
  return out;
}

export type ChangePlan = {
  change: Tally;
  /** レジのお金では組めなかった（足りない金種がある） */
  short: boolean;
  /** 足りない金種を避けるため、大きい順の組み方から変えた */
  adjusted: boolean;
};

/**
 * おつりの組み方を決める。
 * `available` が分かっていれば、その枚数の範囲で、なるべく大きい金種から組む。
 * 組めないときは大きい順の組み方を返し、`short` を立てる。
 */
export function planChange(amount: number, available: Tally | null): ChangePlan {
  const greedy = makeChange(amount);
  if (!available || amount <= 0) return { change: greedy, short: false, adjusted: false };

  const fits = CHANGE_DENOMS.every((d) => greedy[d] <= Math.max(0, available[d]));
  if (fits) return { change: greedy, short: false, adjusted: false };

  // 大きい金種から、使える枚数の多い順に試す（最初に見つかった組み方を使う）
  const out = emptyTally();
  let steps = 0;
  const search = (i: number, rest: number): boolean => {
    if (rest === 0) return true;
    if (i >= CHANGE_DENOMS.length || ++steps > 20_000) return false;
    const d = CHANGE_DENOMS[i];
    const max = Math.min(Math.floor(rest / d), Math.max(0, available[d]));
    for (let n = max; n >= 0; n--) {
      out[d] = n;
      if (search(i + 1, rest - n * d)) return true;
    }
    out[d] = 0;
    return false;
  };
  if (search(0, amount)) return { change: out, short: false, adjusted: true };
  return { change: greedy, short: true, adjusted: false };
}

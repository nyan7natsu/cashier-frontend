import type { CashCount } from "./money.ts";

export type Operator = {
  /** Discord の Snowflake。JavaScriptのnumber型では大きな数字を扱うのが難しいのでstring */
  id: string;
  name: string;
};

export type Product = {
  id: number;
  name: string;
  price: number;
  /** 紙のオーダー表の区切り。同じ値が続くものを 1 つのまとまりとして表示する */
  category?: string;
  /** false なら売り止め（API は true のものだけ返すが、念のため） */
  enabled?: boolean;
};

export type RegisterStatus = {
  is_open: boolean;
  cash_count: CashCount | null;
};

/** 金種ごとの閾値。near_empty 以下で「残り少」、near_full 以上で「多い」。-1 なら見ない */
export type CashThreshold = {
  near_full: CashCount;
  near_empty: CashCount;
};

export type SaleItem = {
  product_id: number;
  quantity: number;
  unit_price: number;
};

export type SalePayload = {
  idempotency_key: string;
  items: SaleItem[];
  discount: number;
  cash_count: CashCount;
  occurred_at: string;
  operator: string;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "network" }
  | { ok: false; kind: "http"; status: number; body: unknown };

/** 状態や一覧の確認。オフラインかどうかを早く知りたいので短くする */
const CHECK_TIMEOUT_MS = 4_000;
/** 会計の送信。サーバーの書き込みを待つので長めにする */
const SALE_TIMEOUT_MS = 10_000;

async function request<T>(
  method: "GET" | "POST",
  path: string,
  password: string,
  body?: unknown,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        "X-Auth-Password": password,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, kind: "network" };
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok)
    return { ok: false, kind: "http", status: res.status, body: parsed };
  return { ok: true, data: parsed as T };
}

export const api = {
  auth: (pw: string) => request<unknown>("POST", "/auth", pw),
  status: (pw: string) =>
    request<RegisterStatus>("GET", "/register/status", pw),
  operators: (pw: string) =>
    request<{ operators: Operator[] }>("GET", "/register/operators", pw),
  products: (pw: string) =>
    request<{ products: Product[] }>("GET", "/register/products", pw),
  cashThreshold: (pw: string) => request<CashThreshold>("GET", "/cash/threshold", pw),
  sale: (pw: string, payload: SalePayload) =>
    request<{ receipt_id: number }>("POST", "/register/sale", pw, payload, SALE_TIMEOUT_MS),
};

/** 失敗の中身を、人が読める短い文にする */
export function describeFailure(
  r: Exclude<ApiResult<unknown>, { ok: true }>,
): string {
  if (r.kind === "network") return "オフラインのため送れませんでした";
  switch (r.status) {
    case 401:
      return "パスワードが違います";
    case 409:
      return "レジが閉じています";
    case 422:
      return "内容がサーバーに受け付けられませんでした";
    default:
      return r.status >= 500
        ? "サーバーでエラーが起きました"
        : `エラー（${r.status}）`;
  }
}

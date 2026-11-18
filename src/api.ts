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
};

export type RegisterStatus = {
  is_open: boolean;
  cash_count: CashCount | null;
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

const TIMEOUT_MS = 10_000;

async function request<T>(
  method: "GET" | "POST",
  path: string,
  password: string,
  body?: unknown,
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  sale: (pw: string, payload: SalePayload) =>
    request<{ receipt_id: number }>("POST", "/register/sale", pw, payload),
};

/** 失敗の中身を、人が読める短い文にする */
export function describeFailure(
  r: Exclude<ApiResult<unknown>, { ok: true }>,
): string {
  if (r.kind === "network") return "サーバーにつながりません";
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

import type { CashCount } from "../money.ts";

/** backstage の API。認証は Discord ログインの Cookie（同じオリジンなので自動で付く） */

export type Session = {
  user_id: string;
  user_name: string;
  expires_at: string;
};

export type Status = {
  is_open: boolean;
  cash_count: CashCount | null;
  expected_cash: number;
  last_event_id: number;
};

export type Product = {
  id: number;
  name: string;
  price: number;
  category?: string;
  /** レシピ（材料と数量） */
  items?: { product_name: string; quantity: number }[];
};

export type SaleItem = { product_id: number; quantity: number; unit_price: number };

/** /api/backstage/sales の 1 件（台帳の行そのもの） */
export type SaleEntry = {
  id: number;
  recorded_at: string;
  event: {
    idempotency_key: string;
    occurred_at: string;
    operator: string | number;
    items: SaleItem[];
    discount: number;
    cash_delta: number;
    cash_count: CashCount;
    voided?: boolean;
    void_reason?: string;
  };
  voided?: boolean;
};

export type Mismatch = {
  error: "cash_count_mismatch";
  detail?: string;
  expected?: number;
  reported?: number;
  diff?: number;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "network" }
  | { ok: false; kind: "http"; status: number; body: Record<string, unknown> | null };

const TIMEOUT_MS = 10_000;

/**
 * JSON の中の大きな整数（Discord の ID など）を、精度を落とさないよう文字列のまま読む。
 * 16 桁以上の数字だけを対象にする
 */
function parseJsonKeepingIds(text: string): unknown {
  const safe = text.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
  return JSON.parse(safe);
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  let parsed: unknown = null;
  try {
    const text = await res.text();
    parsed = text ? parseJsonKeepingIds(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    return { ok: false, kind: "http", status: res.status, body: (parsed as Record<string, unknown>) ?? null };
  }
  return { ok: true, data: parsed as T };
}

export const api = {
  session: () => request<Session>("GET", "/backstage/discord/session"),
  status: () => request<Status>("GET", "/register/status"),
  products: () => request<{ products: Product[] }>("GET", "/register/products"),
  sales: () => request<{ sales: SaleEntry[] }>("GET", "/backstage/sales"),
  open: (body: { idempotency_key: string; cash_count: CashCount; ignore_mismatch?: boolean }) =>
    request<{ event_id: number }>("POST", "/backstage/open", body),
  xReport: (body: { idempotency_key: string; cash_count: CashCount; ignore_mismatch?: boolean }) =>
    request<{ event_id: number }>("POST", "/backstage/x_report", body),
  /** 売れた分の材料の合計（台帳の全期間、取消を除く） */
  items: () => request<{ item_counts: Record<string, number> }>("GET", "/backstage/items"),
  void: (body: { idempotency_key: string; target_key: string; reason: string }) =>
    request<{ void_event_id: number }>("POST", "/backstage/void", body),
};

export const LOGIN_URL = "/api/backstage/discord/login";
export const LOGOUT_URL = "/api/backstage/discord/logout";

/** 失敗を、人が読める短い文にする */
export function describe(r: Exclude<Result<unknown>, { ok: true }>): string {
  if (r.kind === "network") return "サーバーにつながりません（オフラインかもしれません）";
  const error = typeof r.body?.error === "string" ? r.body.error : "";
  switch (r.status) {
    case 401:
      return "ログインが切れました。もう一度ログインしてください";
    case 409:
      if (error.includes("already open")) return "レジはもう開いています";
      if (error.includes("closed")) return "レジが閉じています";
      if (error.includes("state")) return "ほかの操作と重なりました。もう一度試してください";
      return "今はこの操作ができません";
    case 422:
      return error === "cash_count_mismatch" ? "数えたお金が理論在高と合いません" : "入力の内容が受け付けられませんでした";
    default:
      return r.status >= 500 ? `サーバーでエラーが起きました（${r.status}）` : `エラー（${r.status}）`;
  }
}

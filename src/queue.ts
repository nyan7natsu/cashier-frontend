import { api, describeFailure, type SalePayload } from "./api.ts";
import type { Tally } from "./money.ts";
import { load, save } from "./storage.ts";

export type SaleStatus = "pending" | "sending" | "sent" | "rejected";

export type SaleRecord = {
  payload: SalePayload;
  total: number;
  deposit: number;
  change: Tally;
  status: SaleStatus;
  receiptId?: number;
  /** 最後に送れなかった理由 */
  error?: string;
  /** 送ろうとした回数 */
  attempts: number;
};

/** 送った結果のうち、レジの状態に関わるもの */
export type SendOutcome = "ok" | "offline" | "unauthorized" | "closed" | "server";

type Hooks = {
  password: () => string | null;
  onChange: () => void;
  onOutcome: (o: SendOutcome) => void;
};

const RECENT_MAX = 30;
const CLOSED_RETRY_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * 送信待ちの会計。
 *
 * - 古いものから 1 件ずつ送る。先頭が送れないあいだは、後ろも送らない
 * - localStorage に置くので、再読み込みしても消えない
 * - 401 で止まり、パスワードを入れ直すと再開する
 * - 422 は「要確認」に移し、後ろの会計を先に進める
 */
export class SaleQueue {
  /** 送信待ち（古い順） */
  pending: SaleRecord[] = readList("queue");
  /** サーバーに断られた会計（422） */
  rejected: SaleRecord[] = readList("rejected");
  /** 送れた会計（新しい順） */
  recent: SaleRecord[] = readList("recent");
  /** 401 を受けて止まっている */
  paused = false;

  private hooks: Hooks;
  private running = false;

  /** 今まさに送っている、または送り続けている途中か */
  get busy(): boolean {
    return this.running;
  }
  private timer: number | undefined;

  constructor(hooks: Hooks) {
    this.hooks = hooks;
    // 送っている途中で閉じられた分は、送信待ちに戻す
    for (const r of this.pending) if (r.status === "sending") r.status = "pending";
  }

  add(record: SaleRecord): void {
    this.pending.push(record);
    this.persist();
    this.hooks.onChange();
    this.kick();
  }

  find(key: string): SaleRecord | undefined {
    return [...this.pending, ...this.rejected, ...this.recent].find((r) => r.payload.idempotency_key === key);
  }

  /** 待ち時間を飛ばして、今すぐ送り始める */
  kick(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    void this.run();
  }

  /** パスワードを入れ直したあとに再開する */
  resume(): void {
    this.paused = false;
    this.kick();
  }

  /** 要確認の会計を、確認済みとして一覧から外す */
  dismiss(key: string): void {
    this.rejected = this.rejected.filter((r) => r.payload.idempotency_key !== key);
    this.persist();
    this.hooks.onChange();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0 && !this.paused) {
        const pw = this.hooks.password();
        if (!pw) {
          this.paused = true;
          break;
        }
        const head = this.pending[0];
        head.status = "sending";
        this.hooks.onChange();

        const r = await api.sale(pw, head.payload);
        head.attempts += 1;

        if (r.ok) {
          head.status = "sent";
          head.receiptId = r.data.receipt_id;
          head.error = undefined;
          this.pending.shift();
          this.recent = [head, ...this.recent].slice(0, RECENT_MAX);
          this.persist();
          this.hooks.onChange();
          this.hooks.onOutcome("ok");
          continue;
        }

        head.error = describeFailure(r);

        if (r.kind === "http" && r.status === 422) {
          head.status = "rejected";
          this.pending.shift();
          this.rejected.push(head);
          this.persist();
          this.hooks.onChange();
          continue;
        }

        head.status = "pending";
        this.persist();
        this.hooks.onChange();

        if (r.kind === "http" && r.status === 401) {
          this.paused = true;
          this.hooks.onOutcome("unauthorized");
          break;
        }
        if (r.kind === "http" && r.status === 409) {
          this.hooks.onOutcome("closed");
          this.schedule(CLOSED_RETRY_MS);
        } else {
          this.hooks.onOutcome(r.kind === "network" ? "offline" : "server");
          this.schedule(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** head.attempts));
        }
        break;
      }
    } finally {
      this.running = false;
      // 止まったことを画面に伝える（「次の会計」を押せるようにするため）
      this.hooks.onChange();
    }
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.kick(), ms);
  }

  private persist(): void {
    save("queue", JSON.stringify(this.pending));
    save("rejected", JSON.stringify(this.rejected));
    save("recent", JSON.stringify(this.recent));
  }
}

function readList(key: string): SaleRecord[] {
  const text = load(key);
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? (v as SaleRecord[]) : [];
  } catch {
    return [];
  }
}

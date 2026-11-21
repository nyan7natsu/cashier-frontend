import { h, toast } from "../dom.ts";
import { yen } from "../money.ts";
import { api, describe, type Mismatch, type Product, type SaleEntry } from "./api.ts";
import { countForm } from "./count.ts";
import type { BackStage } from "./main.ts";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });

/** replaceChildren に渡すため、null などを取り除く */
const nodes = (...xs: (Node | string | null | false | undefined)[]): (Node | string)[] =>
  xs.filter((x): x is Node | string => x !== null && x !== false && x !== undefined);

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${yen(Math.abs(n))}`;

// ---------- ホーム ----------

export function renderHome(app: BackStage): HTMLElement {
  const body = h("div", { class: "page" });

  const draw = () => {
    const st = app.status;
    body.replaceChildren(
      ...nodes(
      h("h1", { class: "page__title" }, "ホーム"),
      h(
        "div",
        { class: "stats" },
        h(
          "div",
          { class: "stat" },
          h("span", { class: "stat__label" }, "レジ"),
          h("span", null, st ? (st.is_open ? "開局中" : "閉局中") : "—"),
        ),
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "理論在高"), h("span", { class: "num" }, st ? yen(st.expected_cash) : "—")),
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "台帳の最新"), h("span", { class: "num" }, st ? `#${st.last_event_id}` : "—")),
      ),
      st
        ? null
        : h("p", { class: "notice" }, "レジの状態を取れませんでした。サーバーが backstage のログインで /api/register/status を返せるようになると表示されます。"),
      h(
        "div",
        { class: "actions" },
        !st || !st.is_open
          ? h("a", { class: "tile", href: "#/open" }, h("b", null, "開局"), h("span", { class: "muted" }, "釣り銭準備金を数えて、レジを開けます"))
          : null,
        !st || st.is_open
          ? h("a", { class: "tile", href: "#/x" }, h("b", null, "点検 (X)"), h("span", { class: "muted" }, "レジのお金を数えて、理論在高と合わせます"))
          : null,
        h("a", { class: "tile", href: "#/sales" }, h("b", null, "売上・取消"), h("span", { class: "muted" }, "今日の会計の一覧と集計。打ち間違いの取消（VOID）")),
        h("a", { class: "tile", href: "#/items" }, h("b", null, "材料"), h("span", { class: "muted" }, "これまでに売れた分で、どの材料をどれだけ使ったか")),
      ),
      h("p", { class: "muted small" }, "閉局と入金・出金は Discord のコマンドで行います。"),
      ),
    );
  };

  draw();
  app.onStatus = draw;
  return body;
}

// ---------- 開局・点検 ----------

export function renderCount(app: BackStage, kind: "open" | "x"): HTMLElement {
  const isOpen = kind === "open";
  const body = h("div", { class: "page" });
  const title = isOpen ? "開局" : "点検 (X)";
  const blocked = h("p", { class: "notice" });
  const result = h("div", { class: "result" });

  const form = countForm({
    draftKey: kind,
    expected: () => app.status?.expected_cash ?? null,
    submitLabel: isOpen ? "開局する" : "点検を記録",
    onSubmit: () => void submit(false),
  });

  let sending = false;
  async function submit(ignoreMismatch: boolean): Promise<void> {
    if (sending) return;
    const st = app.status;
    if (st && isOpen && st.is_open) return toast("レジはもう開いています");
    if (st && !isOpen && !st.is_open) return toast("レジが閉じています。先に開局してください");
    sending = true;
    const payload = { idempotency_key: form.idempotencyKey(), cash_count: form.cashCount(), ignore_mismatch: ignoreMismatch };
    const r = isOpen ? await api.open(payload) : await api.xReport(payload);
    sending = false;

    if (r.ok) {
      const expected = app.status?.expected_cash ?? null;
      const reported = form.total();
      form.clear();
      await app.refreshStatus();
      showResult(r.data.event_id, reported, expected);
      toast(isOpen ? "開局しました" : "点検を記録しました");
      return;
    }
    if (r.kind === "http" && r.status === 401) return app.expired();
    if (r.kind === "http" && r.status === 422 && r.body?.error === "cash_count_mismatch") {
      return confirmMismatch(r.body as Mismatch, ignoreMismatch);
    }
    toast(describe(r));
    await app.refreshStatus();
  }

  /** 合わなかったとき: 数え直すか、このまま記録するかを選んでもらう */
  function confirmMismatch(m: Mismatch, alreadyForced: boolean): void {
    const expected = m.expected ?? app.status?.expected_cash ?? null;
    const reported = m.reported ?? form.total();
    const diff = m.diff ?? (expected === null ? null : reported - expected);
    if (alreadyForced) {
      // 「このまま記録」を送っても合わないと言われた（サーバーがまだ対応していない）
      return void modal(
        "記録できませんでした",
        h("p", null, "サーバーが、合わないままの記録をまだ受け付けていません。数え直してください。"),
        [{ label: "閉じる" }],
      );
    }
    void modal(
      "数えたお金が合いません",
      h(
        "div",
        { class: "stats stats--compact" },
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "実在高"), h("span", { class: "num" }, yen(reported))),
        h("div", { class: "stat" }, h("span", { class: "stat__label" }, "理論在高"), h("span", { class: "num" }, expected === null ? "—" : yen(expected))),
        h("div", { class: "stat is-ng" }, h("span", { class: "stat__label" }, "過不足"), h("span", { class: "num" }, diff === null ? "—" : signed(diff))),
      ),
      [
        { label: "数え直す" },
        {
          label: isOpen ? "このまま開局する" : "差を記録して点検する",
          danger: true,
          run: () => void submit(true),
        },
      ],
    );
  }

  function showResult(eventId: number, reported: number, expected: number | null): void {
    const diff = expected === null ? null : reported - expected;
    result.replaceChildren(
      h(
        "div",
        { class: "card result__card" },
        h("h2", null, `${isOpen ? "開局しました" : "点検を記録しました"}（台帳 #${eventId}）`),
        h(
          "div",
          { class: "stats stats--compact" },
          h("div", { class: "stat" }, h("span", { class: "stat__label" }, "実在高"), h("span", { class: "num" }, yen(reported))),
          h("div", { class: "stat" }, h("span", { class: "stat__label" }, "理論在高"), h("span", { class: "num" }, expected === null ? "—" : yen(expected))),
          h(
            "div",
            { class: `stat${diff ? " is-ng" : " is-ok"}` },
            h("span", { class: "stat__label" }, "過不足"),
            h("span", { class: "num" }, diff === null ? "—" : signed(diff)),
          ),
        ),
        isOpen ? null : salesSummary(),
      ),
    );
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const draw = () => {
    const st = app.status;
    const wrong = st && (isOpen ? st.is_open : !st.is_open);
    blocked.hidden = !wrong;
    blocked.textContent = isOpen ? "レジはもう開いています。" : "レジが閉じています。点検は開局中にだけできます。";
    form.el.hidden = !!wrong;
    form.refresh();
  };

  body.append(
    h(
      "div",
      { class: "page__head" },
      h("h1", { class: "page__title" }, title),
      h(
        "p",
        { class: "muted" },
        isOpen
          ? "釣り銭準備金を金種ごとに数えて入れてください。前回の閉局のときと合わないと、確認が出ます。"
          : "レジのお金を金種ごとに数えて入れてください。差があれば、記録する前に確認が出ます。",
      ),
    ),
    blocked,
    result,
    form.el,
  );
  draw();
  app.onStatus = draw;
  queueMicrotask(() => form.focusFirst());
  return body;
}

/** 点検の結果に添える「売上の部」 */
function salesSummary(): HTMLElement {
  const box = h("div", { class: "summary" }, h("p", { class: "muted" }, "売上を集計しています…"));
  void loadSales().then((data) => {
    if (!data) {
      box.replaceChildren(h("p", { class: "muted" }, "売上の一覧を取れませんでした。"));
      return;
    }
    box.replaceChildren(summaryView(data.sales, data.products));
  });
  return box;
}

// ---------- 売上・取消 ----------

export function renderSales(app: BackStage): HTMLElement {
  const body = h("div", { class: "page" });
  const list = h("div", { class: "card sales" }, h("p", { class: "muted pad" }, "読み込んでいます…"));
  const summary = h("div", { class: "summary" });

  async function load(): Promise<void> {
    const data = await loadSales(app);
    if (!data) {
      list.replaceChildren(h("p", { class: "muted pad" }, "売上の一覧を取れませんでした。"));
      return;
    }
    const { sales, products } = data;
    summary.replaceChildren(summaryView(sales, products));
    if (sales.length === 0) {
      list.replaceChildren(h("p", { class: "muted pad" }, "まだ会計はありません。"));
      return;
    }
    list.replaceChildren(
      h(
        "div",
        { class: "sales__row sales__head", "aria-hidden": "true" },
        h("span", null, "時刻"),
        h("span", null, "番号"),
        h("span", null, "品目"),
        h("span", null, "金額"),
      ),
      ...[...sales]
        .sort((a, b) => b.id - a.id)
        .map((s) => {
          const voided = isVoided(s);
          return h(
            "button",
            { class: `sales__row${voided ? " is-void" : ""}`, type: "button", onclick: () => openSale(s, products) },
            h("span", { class: "num" }, time(s.event.occurred_at)),
            h("span", { class: "num" }, `#${s.id}`),
            h("span", { class: "sales__items" }, itemsText(s, products)),
            h("span", { class: "num sales__amount" }, voided ? h("span", { class: "tag" }, "取消済み") : null, yen(saleTotal(s))),
          );
        }),
    );
  }

  function openSale(s: SaleEntry, products: Map<number, Product>): void {
    const voided = isVoided(s);
    const reason = h("input", { class: "field", type: "text", placeholder: "打ち間違い", "aria-label": "取消の理由" });
    const error = h("p", { class: "error" });
    const detail = h(
      "div",
      { class: "detail" },
      h("p", { class: "muted" }, `${time(s.event.occurred_at)}・台帳 #${s.id}`),
      h(
        "div",
        { class: "detail__lines" },
        ...s.event.items.map((it) =>
          h(
            "div",
            { class: "line" },
            h("span", null, `${products.get(it.product_id)?.name ?? `商品 ${it.product_id}`} × ${it.quantity}`),
            h("span", { class: "num" }, yen(it.unit_price * it.quantity)),
          ),
        ),
        s.event.discount ? h("div", { class: "line" }, h("span", null, "値引き"), h("span", { class: "num" }, `−${yen(s.event.discount)}`)) : null,
        h("div", { class: "line line--total" }, h("span", null, "合計"), h("span", { class: "num" }, yen(saleTotal(s)))),
      ),
      voided
        ? h("p", { class: "notice" }, "この会計は取り消し済みです。")
        : h("label", { class: "label" }, "取消の理由", reason, error),
    );
    void modal(
      `会計 #${s.id}`,
      detail,
      voided
        ? [{ label: "閉じる" }]
        : [
            { label: "閉じる" },
            {
              label: "取消（VOID）する",
              danger: true,
              keepOpen: true,
              run: async (close) => {
                const text = reason.value.trim();
                if (!text) {
                  error.textContent = "理由を入れてください";
                  reason.focus();
                  return;
                }
                const r = await api.void({ idempotency_key: crypto.randomUUID(), target_key: s.event.idempotency_key, reason: text });
                if (r.ok) {
                  close();
                  toast("取り消しました");
                  await app.refreshStatus();
                  await load();
                  return;
                }
                if (r.kind === "http" && r.status === 401) {
                  close();
                  return app.expired();
                }
                error.textContent =
                  r.kind === "http" && typeof r.body?.error === "string" && r.status === 409 ? `取り消せません: ${r.body.error}` : describe(r);
              },
            },
          ],
    );
  }

  body.append(
    h(
      "div",
      { class: "page__head" },
      h("h1", { class: "page__title" }, "売上・取消"),
      h("button", { class: "btn", type: "button", onclick: () => void load() }, "読み直す"),
    ),
    summary,
    list,
  );
  void load();
  return body;
}

// ---------- 材料 ----------

export function renderItems(app: BackStage): HTMLElement {
  const body = h("div", { class: "page" });
  const table = h("div", { class: "card items-used" }, h("p", { class: "muted pad" }, "読み込んでいます…"));
  const updated = h("span", { class: "muted small" });

  async function load(): Promise<void> {
    const [items, prods] = await Promise.all([api.items(), api.products()]);
    if (!items.ok) {
      if (items.kind === "http" && items.status === 401) return app.expired();
      table.replaceChildren(h("p", { class: "muted pad" }, `材料の集計を取れませんでした。${describe(items)}`));
      return;
    }
    const counts = items.data.item_counts ?? {};
    const products = prods.ok ? prods.data.products : [];

    // products.yaml に出てくる順に並べる（パン → あん → 飲み物、のように紙の表と揃う）。
    // どの商品に使われているかも、あわせて出す
    const order: string[] = [];
    const usedIn = new Map<string, string[]>();
    for (const p of products) {
      for (const it of p.items ?? []) {
        if (!order.includes(it.product_name)) order.push(it.product_name);
        usedIn.set(it.product_name, [...(usedIn.get(it.product_name) ?? []), p.name]);
      }
    }
    for (const name of Object.keys(counts)) if (!order.includes(name)) order.push(name);

    updated.textContent = `${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })} 時点`;
    if (order.length === 0) {
      table.replaceChildren(h("p", { class: "muted pad" }, "まだ材料の情報がありません。products.yaml に items を書くと出てきます。"));
      return;
    }
    table.replaceChildren(
      h("div", { class: "items-used__row items-used__head", "aria-hidden": "true" }, h("span", null, "材料"), h("span", null, "使った量")),
      ...order.map((name) =>
        h(
          "div",
          { class: `items-used__row${counts[name] ? "" : " is-zero"}` },
          h(
            "span",
            { class: "items-used__name" },
            h("b", null, name),
            usedIn.has(name) ? h("span", { class: "muted small" }, usedIn.get(name)!.join("、")) : null,
          ),
          h("span", { class: "num items-used__qty" }, (counts[name] ?? 0).toLocaleString("ja-JP")),
        ),
      ),
    );
  }

  body.append(
    h(
      "div",
      { class: "page__head" },
      h("h1", { class: "page__title" }, "材料"),
      h("span", { class: "page__tools" }, updated, h("button", { class: "btn", type: "button", onclick: () => void load() }, "読み直す")),
      h("p", { class: "muted" }, "これまでに売れた分（取消を除く、全期間）で、各材料をどれだけ使ったかの合計です。数量は products.yaml の items の値をそのまま足しています。"),
    ),
    table,
  );
  void load();
  return body;
}

// ---------- 売上の読み込みと集計 ----------

async function loadSales(app?: BackStage): Promise<{ sales: SaleEntry[]; products: Map<number, Product> } | null> {
  const [s, p] = await Promise.all([api.sales(), api.products()]);
  if (!s.ok) {
    if (app && s.kind === "http" && s.status === 401) app.expired();
    return null;
  }
  const products = new Map<number, Product>(p.ok ? p.data.products.map((x) => [x.id, x]) : []);
  return { sales: s.data.sales ?? [], products };
}

function isVoided(s: SaleEntry): boolean {
  return Boolean(s.voided ?? s.event.voided);
}

function saleTotal(s: SaleEntry): number {
  return s.event.items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0) - s.event.discount;
}

function itemsText(s: SaleEntry, products: Map<number, Product>): string {
  return s.event.items.map((it) => `${products.get(it.product_id)?.name ?? `商品 ${it.product_id}`} ×${it.quantity}`).join("、");
}

/** 売上の部: 件数・売上・取消・商品別 */
function summaryView(sales: SaleEntry[], products: Map<number, Product>): HTMLElement {
  const live = sales.filter((s) => !isVoided(s));
  const voided = sales.filter(isVoided);
  const net = live.reduce((sum, s) => sum + saleTotal(s), 0);
  const discount = live.reduce((sum, s) => sum + s.event.discount, 0);
  const byProduct = new Map<number, { qty: number; amount: number }>();
  for (const s of live) {
    for (const it of s.event.items) {
      const cur = byProduct.get(it.product_id) ?? { qty: 0, amount: 0 };
      cur.qty += it.quantity;
      cur.amount += it.quantity * it.unit_price;
      byProduct.set(it.product_id, cur);
    }
  }
  const rows = [...byProduct.entries()].sort((a, b) => b[1].amount - a[1].amount);

  return h(
    "div",
    { class: "summary__inner" },
    h(
      "div",
      { class: "stats" },
      h("div", { class: "stat" }, h("span", { class: "stat__label" }, "会計"), h("span", { class: "num" }, `${live.length} 件`)),
      h("div", { class: "stat" }, h("span", { class: "stat__label" }, "売上"), h("span", { class: "num" }, yen(net))),
      h(
        "div",
        { class: "stat" },
        h("span", { class: "stat__label" }, "取消"),
        h("span", { class: "num" }, `${voided.length} 件・${yen(voided.reduce((sum, s) => sum + saleTotal(s), 0))}`),
      ),
    ),
    discount ? h("p", { class: "muted small" }, `値引き ${yen(discount)} を引いた額です。`) : null,
    rows.length
      ? h(
          "details",
          { class: "card byproduct" },
          h("summary", null, "商品別"),
          ...rows.map(([id, v]) =>
            h(
              "div",
              { class: "line" },
              h("span", null, products.get(id)?.name ?? `商品 ${id}`),
              h("span", { class: "num muted" }, `${v.qty} 個`),
              h("span", { class: "num" }, yen(v.amount)),
            ),
          ),
        )
      : null,
  );
}

// ---------- ダイアログ ----------

type Action = { label: string; danger?: boolean; keepOpen?: boolean; run?: (close: () => void) => void | Promise<void> };

function modal(title: string, content: HTMLElement, actions: Action[]): Promise<void> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "modal", "aria-label": title });
    const close = () => dialog.close();
    dialog.append(
      h("h2", null, title),
      content,
      h(
        "div",
        { class: "modal__actions" },
        ...actions.map((a) =>
          h(
            "button",
            {
              class: `btn${a.danger ? " btn--danger" : ""}`,
              type: "button",
              onclick: async () => {
                if (!a.keepOpen) close();
                await a.run?.(close);
              },
            },
            a.label,
          ),
        ),
      ),
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

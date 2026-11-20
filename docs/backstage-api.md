# POS Service BackStage が使う API

backstage（管理画面）でできることは、開局・点検（X）・売上の確認と取消（VOID）。
閉局と入金・出金は Discord のコマンドで行う。

棒金（50 枚）の計算は画面側で行い、API にはふつうの `cash_count`（金種ごとの枚数）を送る。

## 使っている API

| API | 画面 | 認証 |
|---|---|---|
| `GET /api/backstage/discord/login`・`logout` | ログイン・ログアウト | — |
| `GET /api/backstage/discord/session` | ログイン中の人と残り時間 | Cookie |
| `GET /api/register/status` | ホームの状態・理論在高 | **Cookie でも通してほしい**（下を参照） |
| `GET /api/register/products` | 売上一覧の商品名 | **Cookie でも通してほしい** |
| `POST /api/backstage/open` | 開局 | Cookie |
| `POST /api/backstage/x_report` | 点検 | Cookie |
| `GET /api/backstage/sales` | 売上・取消の一覧と集計 | Cookie |
| `POST /api/backstage/void` | 取消 | Cookie |

## 直してほしいこと（2026-11-21 時点のコードを読んで）

### 1. `GET /api/backstage/sales` が 500 になる（必須）

`e.model_dump()` のままだと、中の `datetime`（`recorded_at`, `occurred_at`）を JSON にできず、会計が 1 件でもあると 500 になる。

```python
return json_response({"sales": [e.model_dump(mode="json") for e in sales]})
```

あわせて、次も足してほしい。

- **取消済みの印**: 各会計に `"voided": true/false`。今はこの一覧から、取り消し済みかどうかが分からない。対応する `VoidEvent`（`ref_event_id` が会計の ID）があれば `true`。
- **担当者の ID**: `operator` を文字列にする（`str(...)`）。Discord の ID は JavaScript の数値では精度が落ちる。画面側でも 16 桁以上の数字は文字列として読むようにしているが、サーバーで文字列にしておくのが確実。

### 2. 点検で、合わないままでも記録できるようにする（必須）

`POST /api/backstage/x_report` は、合計が合わないと必ず 422 を返す。
決めたとおり、差があっても記録して、数えた枚数を新しい起点にしたい。

- `ignore_mismatch: true` が来たら、422 にせずに記録する
- そのときは `cash_delta = reported - expected` にする。こうすると、点検のあとも理論在高（`expected_cash()`）と、金種ごとの枚数の合計（`get_cash_count().total()`）が一致する
- 画面は、合わないとき「差を記録して点検する」で `ignore_mismatch: true` を付けて送り直す（作ってある）

### 3. 同じキーで送り直したら、前回の結果を返す（必須）

`x_report` を同じ `idempotency_key` で送り直すと、`ledger.append` の重複チェックで `RuntimeError` になり 500 になる。
通信が切れて送り直すことがあるので、先に `ledger.find(idempotency_key=...)` を見て、あれば `{"event_id": 既存のID}` を返してほしい（会計の API と同じ）。

### 4. `/api/register/status` と `/api/register/products` を Cookie でも通す（必須）

backstage にはレジのパスワードがないので、今は状態も商品名も取れない。
`authenticator.check_request(request)` に加えて、backstage のセッションが有効なら通すようにしてほしい。

```python
cog = self.bot.get_cog("BackStage")
if not (self.bot.app.authenticator.check_request(request) or (cog and cog.is_session_valid(request))):
    return json_response({"error": "unauthorized"}, status=401)
```

### 5. セッションの Cookie も延ばす

サーバー側の有効期限は、使うたびに 30 分延びるようになった。
ただ、Cookie の `max_age` はログインしたときの 30 分のままなので、ブラウザがそこで Cookie を消してしまう。

- 案 A: Cookie に `max_age` を付けない（ブラウザを閉じるまで有効。期限はサーバーで見ているので十分）
- 案 B: 有効なリクエストのたびに `Set-Cookie` を送り直す

### 6. `GET /api/backstage/discord/session` の `user_id` を文字列にする

今は数値で返している。画面では文字列として読み直しているが、サーバーで `str(...)` にしておくのが確実。

## 確かめたこと

モックの API で、次の流れを画面から確かめた。

- ログイン → ホーム（状態・理論在高・台帳の最新番号）
- 点検: 合わない → 確認 →「差を記録」→（今のサーバーでは断られる）→ 数え直して記録 → 結果と売上の集計
- 売上・取消: 一覧 → 会計を開く → 理由を入れて取消 → 一覧に「取消済み」
- スマホ縦（幅 390）とダークテーマ

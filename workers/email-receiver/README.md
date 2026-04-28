# notify-email-receiver

`notify.ippoan.org` ドメインに届いたメールを受信し、添付ファイル付きで rust-alc-api の `/api/notify/ingest` エンドポイントに転送する Cloudflare Email Worker。

## 仕組み

1. Cloudflare Email Routing が `*@notify.ippoan.org` を本 Worker に転送
2. Worker は宛先メールの local-part (例: `tenant-acme`) を KV namespace `INGEST_KEYS_KV` で引き、テナントごとの ingest key を取得
3. `postal-mime` で MIME を解析し、添付ファイルを base64 化
4. `POST {INGEST_ENDPOINT}` に `X-Ingest-Key` ヘッダ付きで送信
5. 200/201 以外なら `setReject` でメールを差し戻し、Cloudflare がバウンス送信

## 制限

- 添付合計 25MB 超で reject (Cloudflare Email Routing 自体の上限)
- 添付件数 20 件超は無視
- 添付 0 件のメールは reject (ファイル管理 UI に出したくないため)

## デプロイ

```bash
# KV namespace 作成 (初回のみ)
wrangler kv namespace create INGEST_KEYS_KV
wrangler kv namespace create INGEST_KEYS_KV --env staging
# 出力された ID を wrangler.toml の `REPLACE_WITH_*_KV_ID` に書き戻す

# 本番デプロイ
wrangler deploy

# staging
wrangler deploy --env staging
```

## ingest_key の登録

nuxt-notify の管理画面で発行した plaintext key を KV に登録する:

```bash
wrangler kv key put --namespace-id <prod-kv-id> tenant-acme "<plaintext-key>"
# staging:
wrangler kv key put --namespace-id <staging-kv-id> --env staging tenant-acme "<plaintext-key>"
```

`tenant-acme@notify.ippoan.org` 宛にメールを送ると acme テナントに紐づく。

## Cloudflare ダッシュボード手順 (初回のみ)

1. zone `ippoan.org` → Email → Email Routing 有効化
2. `notify.ippoan.org` の MX レコード (CF が指示する3件) + SPF TXT を追加
3. Routing rules → catch-all を作成 → Worker `notify-email-receiver` を選択
4. staging 用には `notify-staging.ippoan.org` を別途設定し `notify-email-receiver-staging` を割り当てる

# notify-email-receiver

`notify.ippoan.org` ドメインに届いたメールを受信し、添付ファイル付きで ippoan/alc-notify-worker の `POST /api/notify/ingest` に Service Binding で転送する Cloudflare Email Worker。

## 仕組み

1. Cloudflare Email Routing が catch-all で本 Worker に転送
2. 宛先の host で取り込み先を選ぶ (`notify.ippoan.org` → binding `NOTIFY` = `alc-notify`、`notify-staging.ippoan.org` → `NOTIFY_STAGING` = `alc-notify-staging`)。
   local-part `tenant-{short_id}` の short_id を body の `tenant_short_id` に入れ、worker が `tenants.short_id` で tenant を引く
3. `postal-mime` で MIME を解析し、添付ファイルを base64 化
4. binding の `fetch("https://alc-notify/api/notify/ingest")` に JSON で POST。**共有の秘密は無い** (信頼は Service Binding だけ。
   alc-notify は workers.dev も route も持たず、auth-worker の振り分け表にも ingest は載らない。W8c-2、Refs ippoan/rust-alc-api#680)
5. 200/201 以外なら `setReject` でメールを差し戻し、Cloudflare がバウンス送信

## 制限

- 添付合計 25MB 超で reject (Cloudflare Email Routing 自体の上限)
- 添付件数 20 件超は無視
- 添付 0 件のメールは reject (ファイル管理 UI に出したくないため)

## デプロイ

`.github/workflows/email-worker-deploy.yml` (PR → staging、タグ → 本番)。secret は持たない。

`tenant-{short_id}@notify.ippoan.org` 宛にメールを送ると、その short_id のテナントに紐づく。

## Cloudflare ダッシュボード手順 (初回のみ)

1. zone `ippoan.org` → Email → Email Routing 有効化
2. `notify.ippoan.org` の MX レコード (CF が指示する3件) + SPF TXT を追加
3. Routing rules → catch-all を作成 → Worker `notify-email-receiver` を選択
4. staging 用には `notify-staging.ippoan.org` を別途設定し `notify-email-receiver-staging` を割り当てる

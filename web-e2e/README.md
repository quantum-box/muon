# muon-web-e2e

muon の宣言的 YAML テストを Web UI に広げるパッケージ。ブラウザ E2E の
テストケースを YAML で書き、実行は [Playwright](https://playwright.dev/) が
担当する。コード生成は行わず、YAML をランタイムで解釈する。

フロー構文は [Maestro](https://maestro.mobile.dev/) 互換の書き味を採用して
いる(`tapOn` / `inputText` / `assertVisible` など)。Maestro は Mobile Dev
Inc. の商標であり、本パッケージは Maestro 公式の製品ではない。

muon 本体が `config:` + `steps:` で API シナリオを扱うのに対し、本パッケージは
ブラウザ操作を対象とする。

## 使い方

フローを置くディレクトリを作り、Playwright の spec から一括登録する。

```ts
// e2e/web.spec.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineWebFlows } from 'muon-web-e2e'

const here = path.dirname(fileURLToPath(import.meta.url))
defineWebFlows({ dir: path.join(here, 'flows') })
```

フローは設定ヘッダと手順の 2 ドキュメント YAML。

```yaml
# flows/sign-in.yaml
url: /sign_in            # launchApp が開く URL(Playwright の baseURL 相対)
name: サインインできる
tags: [smoke]
env:
  EMAIL: test@example.com
---
- launchApp
- tapOn:
    role: textbox
    name: 'Email'
- inputText: ${EMAIL}
- pressKey: Tab
- inputText: secret
- tapOn:
    role: button
    name: 'Sign in'
- assertVisible: 'ようこそ'
- takeScreenshot: signed-in
```

1 フローが 1 つの Playwright テストになり、各ステップは `test.step()` として
HTML レポートや trace に出る。`takeScreenshot` はテストの添付ファイルになる。

## 設定ヘッダ

| キー | 説明 |
| --- | --- |
| `url` | `launchApp` が開く URL。baseURL 相対パス可。`${VAR}` 補間可 |
| `name` | テストタイトル。省略時はファイル名 |
| `tags` | Playwright のタグ。`smoke` は `@smoke` になる |
| `env` | フロー内で `${VAR}` として参照できる変数 |
| `skip` / `only` | `test.skip` / `test.only` で登録 |

`appId` は Maestro 互換のため無視される(エラーにしない)。

## ステップ一覧

| ステップ | 説明 |
| --- | --- |
| `launchApp` | 設定ヘッダの `url`(または `url` パラメータ)へ遷移 |
| `openLink: <url>` | 任意 URL へ遷移 |
| `back` | ブラウザバック |
| `tapOn` / `doubleTapOn` | クリック / ダブルクリック |
| `inputText: <text>` | フォーカス中の要素へタイプ。`text` + セレクタ指定で `fill` |
| `eraseText` | セレクタ指定で全消去、`characters: n` で n 文字 Backspace |
| `pressKey: <key>` | `Enter` `Tab` `Escape` `Backspace` `arrow up` など |
| `assertVisible` / `assertNotVisible` | 表示 / 非表示(不存在含む)を検証 |
| `assertTitle: <pattern>` | ページタイトル検証(Web 拡張) |
| `assertUrl: <pattern>` | 現在 URL 検証(Web 拡張) |
| `scroll` | ホイールスクロール(`direction` / `amount`) |
| `scrollUntilVisible` | 要素までスクロールして表示を待つ |
| `wait: <ms>` | 固定待機(Web 拡張) |
| `waitForAnimationToEnd` | network idle まで待機(近似実装) |
| `extendedWaitUntil` | `visible` / `notVisible` + `timeout` で待機 |
| `takeScreenshot: <name>` | フルページスクリーンショットを添付 |
| `evalScript: <js>` | ページ内で JavaScript を実行 |
| `copyTextFrom` | 要素のテキストを `${maestro.copiedText}` に保存 |
| `pasteText` | `${maestro.copiedText}` をタイプ |
| `runFlow: <file>` | サブフロー実行(フローファイルからの相対パス) |
| `repeat` | `times` 回 `commands` を繰り返す |

共通パラメータ: `optional: true`(失敗を無視)、`timeout`(ms)、
`label`(レポート表示名)。

## セレクタ

`tapOn: 'Sign in'` のような文字列はテキストマッチ。オブジェクト形式では
以下の軸を 1 つ指定する(優先順: `css` > `id` > `role` > `label` >
`placeholder` > `text`)。

```yaml
- tapOn:
    id: submit-button      # data-testid
- tapOn:
    role: button
    name: 'Sign in'        # アクセシブルネーム
- tapOn:
    css: 'nav >> text=Home'
- tapOn:
    text: '/^行$/'          # /.../ 囲みは正規表現
    index: 2               # 複数マッチ時。省略時は先頭要素
```

要素の待機と特定は Playwright のロケータに委譲しているため、auto-waiting と
role / label / placeholder ベースの解決がそのまま効く。

## 変数補間

`${VAR}` は 実行時変数(`maestro.copiedText`) > `defineWebFlows` の `env` >
フローの `env` > `process.env` の順で解決する。未定義参照はエラー。

## サブフロー

`_` 始まりのファイル・ディレクトリはテスト登録から除外されるので、共有
フラグメントは `_shared/` などに置き、`runFlow` から参照する。

## 開発

```bash
npm install
npm run ts            # 型チェック
npm test              # ユニットテスト(ブラウザ不要)
npm run test:browser  # 実ブラウザ統合テスト(要 playwright install chromium)
```

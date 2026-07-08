<div align="right">

[![English](https://img.shields.io/badge/lang-English-2b7489?style=flat-square)](./README.en.md)

</div>

# claude-pipeline-template

Claude Code で **1 つのプロジェクト**を、ざっくりした案からゲート付き・テスト済みの
成果物まで進めるための **GitHub テンプレートリポジトリ**。複数プロジェクトは別リポジトリ
として並列に走らせるだけでよい（共有状態なし）。Ralph 式の反復は build ステージの内部に
だけ、テストで束ねた有界ループとして使う（無人の朝までグラインドではない）。

## ファイル構成
- `pipeline.yaml`  — 宣言的な仕様（単一の真実）。run.sh と同期を保つこと。
- `scripts/run.sh` — POSIX ドライバ本体：段階を進め、人間ゲートで通知して停止。
- `scripts/gates.sh` — 機械ゲート（テスト / lint / ui）。プロジェクトごとに調整。
- `prompts/0X-*.md` — 各段階の「契約」。
- `CLAUDE.md`      — プロジェクト記憶（グローバルの UI ルールを取り込む）。
- `.claude/settings.json` — スコープ付き権限（安全性の項参照）。素の skip-permissions は使わない。
- `Makefile`       — 任意の短縮（`make plan`, `make build` …）。

## マシン全体の一度きり設定（このリポジトリ外）
1. git の co-author 行を全プロジェクトで止める：
   `~/.claude/settings.json` → `{ "includeCoAuthoredBy": false }`
2. 全プロジェクト共通の UI 方針：
   `docs/ui-rules.starter.md` を `~/.claude/rules/ui.md` にコピーして継続的に洗練する。
   `~/.claude/CLAUDE.md` と `~/.claude/rules/` は全プロジェクトで読み込まれる。フロントエンドの
   glob にスコープすれば UI 作業時のみ読み込まれる（rules ディレクトリのドキュメント参照）。

## プロジェクトごとの使い方
1. GitHub でこのリポジトリを Template repository に設定（Settings → Template repository）。
2. 新規プロジェクトごとに Use this template → 新リポジトリ → clone。
3. `CLAUDE.md`（`<name>`、コマンド）を記入。UI があるなら `touch state/has_ui`。
4. パイプライン実行：`sh scripts/run.sh all`（段階ごとにも：`… intake` など）。

## 段階（ゲート）
0 intake（人間・1回）／1 criteria（人間）／2 design_gate（UI のみ・人間・1回）／
3 plan（目視）／4 build（機械ゲート・worktree で並列）／
5 feature_accept（機械＋軽い人間・ローカルマージ）／6 integration_accept（機械＋人間・1回）

## モデル
仕様・基準 = Opus、design・build = Sonnet。段階ごとに環境変数で指定
（`MODEL_BUILD=sonnet` など）。`opus-plan` は対話モードでありヘッドレスのモデル文字列では
ないので、ヘッドレスの plan では `MODEL_PLAN` は実在モデルのまま。Fable は**手動エスカレー
ションのみ**（ブロッカーを `state/BLOCKED-*.md` に書いて手で上げる）。一部の Fable クエリは
Opus に迂回し可用性・セーフガードの注意もあるため、自動化はしない。

## 安全性（重要）
- 各機能は隔離された `git worktree` でビルドする。この隔離が安全境界。
- `.claude/settings.json` はスコープ付き許可リストを与え、push と rm -rf を deny する。
  本番マシンで `--dangerously-skip-permissions` を使わないこと。使う場合も worktree /
  サンドボックス内に限定する。
- 既定では push しない — すべてローカル git。

## 初回実行前に確認
`claude` のフラグと settings.json のスキーマはバージョンで変わりうる。初回だけ
`claude --help` と現行ドキュメントで実際のヘッドレス起動と権限キーを突き合わせ、
`run.sh` / `settings.json` を合わせること。

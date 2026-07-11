<div align="right">

[![English](https://img.shields.io/badge/lang-English-2b7489?style=flat-square)](./README.en.md)

</div>

# Voice Transcript

音声ファイルを Groq のホスト型 Whisper API で文字起こしするターミナル CLI。**1 時間超の
長時間音声**も、無音位置での分割とスティッチで扱える。

## 必要環境
- **Node.js ≥ 24**
- **ffmpeg**（PATH 上に必要。音声の正規化・分割に使用）
- **`GROQ_API_KEY`**（環境変数。キーはここからのみ読み込む）

## セットアップ
```sh
npm install
npm run build          # dist/ に tsc でビルド（実行ファイル: transcribe -> dist/index.js）
# 開発時はビルド無しでも: npm run transcribe -- <audio> [options]   （tsx 実行）
```

## 使い方
```sh
transcribe <audio-file> [options]
```

| オプション | 説明 | 既定 |
|---|---|---|
| `-o, --output <file>` | 文字起こしをファイルに出力 | 標準出力 |
| `--format <txt\|srt\|vtt\|json>` | 出力形式 | `txt` |
| `--model <name>` | Whisper モデル（`whisper-large-v3-turbo` / `whisper-large-v3`） | `whisper-large-v3-turbo` |
| `--language <code>` | 言語を固定 | 自動判定 |

例:
```sh
export GROQ_API_KEY=...             # 必須
transcribe meeting.m4a                       # txt を標準出力へ
transcribe meeting.m4a --format srt -o out.srt
transcribe long.m4a --model whisper-large-v3 --language ja
```
成功時は終了コード `0`。エラー時は非ゼロで stderr にメッセージ（キー未設定・ファイル不在・
ffmpeg 未導入・API 失敗など）。

## 出力形式
`txt`（既定・タイムスタンプ無し）／`srt`／`vtt`／`json`（区間・語のタイムスタンプ）。

## 長時間音声の扱い
ffmpeg で 16 kHz モノラルに正規化 → エンコード後が上限（約 24 MB、Groq の 25 MB/リクエスト
制限の下）を超える場合は**無音位置で分割** → 各チャンクを文字起こし → 各チャンクの時間
オフセットを適用して**スティッチ**。約 78 分のテスト音声 `tests/test.m4a` で検証する。

**対象外**（明示）: 話者分離、翻訳、要約、複数ファイル一括、リアルタイム/ストリーミング、
リモート URL 入力、GUI。詳細は `SPEC.md`。

## 制約
- **Groq 無料枠のみ**（25 MB/リクエスト、7,200 音声秒/時、2,000 リクエスト/日）。
- ソース・出力に**絵文字禁止**（この no-UI ツールで唯一適用される UI ルール）。
- 生成物の言語は英語（`CLAUDE.md` の Language）。git はローカルのみ、push しない。

## 開発（ゲート付きパイプライン）
このリポジトリは `scripts/run.sh` のゲート付きパイプラインで作られる（仕様確定 → 失敗する
テスト → 計画 → 機能ごとに並列 build → 受け入れ）。段階ごとに実行:
```sh
sh scripts/run.sh from build                 # 途中から再開（build 以降）
INTERACTIVE=1 sh scripts/run.sh from build   # 進捗を見ながら / 通知付きで
```
合否基準は `ACCEPTANCE.md`、分解は `PLAN.md`。段階の詳細は `pipeline.yaml`。

## テスト
```sh
npm test          # vitest（単体。E2E は GROQ_API_KEY 未設定なら自動 skip）
npm run lint      # eslint + 絵文字禁止チェック
npm run typecheck # tsc --noEmit
```
E2E（`tests/e2e/`）は実 Groq API と `tests/test.m4a` に対して走り、`GROQ_API_KEY` 設定時のみ
有効。受け入れ基準の全項目は `ACCEPTANCE.md`（A〜F）を参照。

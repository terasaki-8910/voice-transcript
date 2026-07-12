// F19 (gui-i18n). GUI copy in Japanese and English (ACCEPTANCE G6). The
// product name ("Voice Transcript") does NOT translate, per
// design_brief.md's confirmed direction -- it's used as a literal string at
// call sites, not a translation key.
export const translations = {
  en: {
    queue: "Queue",
    history: "History",
    addFiles: "Add files",
    light: "Light",
    dark: "Dark",
    placeholder: "Queue, history, and settings land in upcoming builds.",
    statusQueued: "Queued",
    statusTranscribing: "Transcribing",
    statusDone: "Done",
    statusFailed: "Failed",
    view: "View",
    retry: "Retry",
    dropHint: "Drop audio files here, or use Add files",
    emptyQueue: "No files yet",
    historyLoading: "Loading history...",
    historyEmpty: "No history yet",
    trashAudio: "Trash audio",
    audioTrashed: "Audio trashed",
    deleteEntry: "Delete",
  },
  ja: {
    queue: "キュー",
    history: "履歴",
    addFiles: "ファイルを追加",
    light: "ライト",
    dark: "ダーク",
    placeholder: "キュー・履歴・設定は今後のビルドで追加されます。",
    statusQueued: "待機中",
    statusTranscribing: "文字起こし中",
    statusDone: "完了",
    statusFailed: "失敗",
    view: "表示",
    retry: "再試行",
    dropHint: "音声ファイルをここにドロップ、または「ファイルを追加」",
    emptyQueue: "まだファイルがありません",
    historyLoading: "履歴を読み込み中...",
    historyEmpty: "まだ履歴がありません",
    trashAudio: "音声をゴミ箱へ",
    audioTrashed: "ゴミ箱へ移動済み",
    deleteEntry: "削除",
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof (typeof translations)["en"];

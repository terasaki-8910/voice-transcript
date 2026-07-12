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
  },
  ja: {
    queue: "キュー",
    history: "履歴",
    addFiles: "ファイルを追加",
    light: "ライト",
    dark: "ダーク",
    placeholder: "キュー・履歴・設定は今後のビルドで追加されます。",
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof (typeof translations)["en"];

// Flat ESLint config. "No emoji in source" (SPEC / ACCEPTANCE F1) applies
// everywhere. The project now also has a UI (apps/desktop, has_ui: true):
// `local/no-hardcoded-hex` below covers hex-color literals in GUI TS/TSX now
// (zero new deps). Full a11y/contrast/responsive linting + CSS hex checks
// need eslint-plugin-jsx-a11y / stylelint, which aren't installed yet --
// importing them here would break `eslint .` on the current, already-shipping
// src/**. That's deferred to the apps/desktop build feature (see
// ACCEPTANCE.md G section / prompts/01-criteria.md's "cannot be
// machine-checked now -> becomes a later gate" escape hatch), not faked here.
import tseslint from "typescript-eslint";

// Local rule: forbid emoji anywhere in a source file (strings, comments, code).
// It scans raw source text so it catches emoji inside CLI output string literals
// as well as comments. Uses the Unicode Extended_Pictographic property.
const EMOJI = /\p{Extended_Pictographic}/u;
const noEmoji = {
  meta: {
    type: "problem",
    docs: { description: "Disallow emoji characters in source and output strings." },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program(node) {
        const lines = sourceCode.getText().split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const match = EMOJI.exec(lines[i]);
          if (match) {
            context.report({
              node,
              loc: { line: i + 1, column: match.index },
              message: `Emoji character not allowed (found ${JSON.stringify(match[0])}).`,
            });
          }
        }
      },
    };
  },
};

// Local rule: forbid hardcoded hex color literals (3/4/6/8 hex digits after
// `#`) anywhere in a source file. Same raw-text-scan shape as `no-emoji`, so
// it also catches literals inside template strings / inline styles, not just
// string-literal nodes. Scoped (see below) to apps/desktop/src/**/*.{ts,tsx}
// only -- it does not apply to today's src/**, and does not cover .css files
// (eslint doesn't parse those; see the deferred-stylelint note above).
const HEX_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const noHardcodedHex = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hardcoded hex color literals; use design tokens." },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program(node) {
        const lines = sourceCode.getText().split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const match = HEX_COLOR.exec(lines[i]);
          if (match) {
            context.report({
              node,
              loc: { line: i + 1, column: match.index },
              message: `Hardcoded hex color not allowed (found ${JSON.stringify(match[0])}); use a design token.`,
            });
          }
        }
      },
    };
  },
};

const local = { rules: { "no-emoji": noEmoji, "no-hardcoded-hex": noHardcodedHex } };

export default tseslint.config(
  {
    ignores: [
      "dist/**", "node_modules/**", "coverage/**", "tests/**/*.m4a", "state/**",
      "**/target/**", "apps/desktop/dist/**", "apps/desktop/src-tauri/gen/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      "src/**/*.ts", "tests/**/*.ts",
      "packages/*/src/**/*.ts", "packages/*/tests/**/*.ts",
      "apps/desktop/src/**/*.{ts,tsx}",
      "*.ts", "*.js",
    ],
    plugins: { local },
    rules: {
      "local/no-emoji": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    plugins: { local },
    rules: {
      "local/no-hardcoded-hex": "error",
    },
  },
);

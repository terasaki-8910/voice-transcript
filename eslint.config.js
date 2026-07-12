// Flat ESLint config. The only project-specific UI rule that applies to this
// no-UI CLI is "no emoji in source" (SPEC / ACCEPTANCE F1). Design-token and
// a11y/responsive rules are intentionally absent: there is no UI surface here.
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

const local = { rules: { "no-emoji": noEmoji } };

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "tests/**/*.m4a", "state/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "*.ts", "*.js"],
    plugins: { local },
    rules: {
      "local/no-emoji": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

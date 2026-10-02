// Obsidian review-bot lint config (eslint-plugin-obsidianmd).
// Run via tools/obsidian-review so it does not fight the plugin's eslint 7 / TS 4.9.
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: [
      "**/main.js",
      "**/node_modules/**",
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.js",
      "**/jest.setup.js",
      "**/__mocks__/**",
      "**/.eslintrc.js",
      // Test doubles only — not shipped in the plugin.
      "src/testUtils/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.review.mjs",
            "eslint.config.*",
            ".eslintrc.js",
            "rollup.config.mjs",
          ],
        },
      },
    },
    rules: {
      // Sample-plugin naming noise for a real product plugin
      "obsidianmd/sample-names": "off",
      // Custom settings UI: getSettingDefinitions() returns [] so display()
      // remains the render path (Obsidian only bypasses it for non-empty defs).
      "obsidianmd/settings-tab/no-deprecated-display": "off",
      // Technical token placeholders (hex colors, CSS lengths, API tokens)
      // are not prose; forcing sentence case would corrupt them.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  {
    files: ["package.json"],
    rules: {
      // moment is a devDependency for Jest + types only. Runtime uses the
      // Obsidian-provided moment via `import { moment } from "obsidian"`.
      "depend/ban-dependencies": "off",
    },
  },
  {
    rules: {
      // Allow narrowly-scoped, justified disables (settings custom UI + token
      // placeholders). The recommended config blocks all disables otherwise.
      "eslint-comments/no-restricted-disable": "off",
    },
  },
];

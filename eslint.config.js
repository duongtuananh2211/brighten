import js from "@eslint/js";
import tseslint from "typescript-eslint";

const decisionCoreFiles = [
  "packages/decision-core/**/*.ts",
  ".eslint-fixtures/decision-core/**/*.ts"
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [".eslint-fixtures/decision-core/*.ts"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { "prefer": "type-imports" }
      ]
    }
  },
  {
    files: decisionCoreFiles,
    rules: {
      "no-restricted-globals": [
        "error",
        {
          "name": "Date",
          "message": "decision-core must receive time through a clock port."
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          "paths": [
            "fs",
            "node:fs",
            "node:fs/promises",
            "path",
            "node:path",
            "net",
            "node:net",
            "http",
            "node:http",
            "https",
            "node:https",
            "crypto",
            "node:crypto",
            "child_process",
            "node:child_process"
          ],
          "patterns": [
            "@supabase/*",
            "@brighten/adapters",
            "@brighten/adapters/*"
          ]
        }
      ],
      "no-restricted-syntax": [
        "error",
        {
          "selector": "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          "message": "Use the decision-core clock port instead of Date.now()."
        },
        {
          "selector": "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          "message": "Randomness must enter decision-core through a port."
        }
      ]
    }
  }
);

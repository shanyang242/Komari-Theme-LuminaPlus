import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Focused lint config: the React Hooks rules catch exactly the dependency-array
// and rules-of-hooks bugs that are easy to introduce here (unstable subscribe
// closures, missing memo deps). Type/style checking is handled by `tsc -b`, so
// this stays narrow and low-noise.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "scripts", "public", "komari-main源码"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);

import nextConfig from "eslint-config-next";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      "out/**",
      "node_modules/**",
      "backend/**",
      "public/worklets/**",
      "coverage/**",
      ".worktrees/**",
    ],
  },
];

export default config;

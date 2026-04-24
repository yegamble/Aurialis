import nextConfig from "eslint-config-next";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "public/worklets/**",
      "coverage/**",
      ".worktrees/**",
    ],
  },
];

export default config;

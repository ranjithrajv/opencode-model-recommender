import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid({ include: [/\.tsx$/] })],
  resolve: {
    alias: [{ find: /^solid-js$/, replacement: "solid-js/dist/solid.js" }],
    conditions: ["browser"],
  },
  test: {
    environment: "happy-dom",
    // Keep solid (and the plugin's tui entry) processed by Vite so the
    // browser/dev builds below are used for every copy — Node's own
    // resolution would otherwise load the server build.
    server: { deps: { inline: [/solid-js/, /@opencode-ai\/plugin/] } },
    include: ["**/*.test.ts", "**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "metrics.ts", "tui.tsx"],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
})

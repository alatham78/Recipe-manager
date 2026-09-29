import { defineConfig } from "vitest/config";

// Unit tests run in Node without the Cloudflare plugin.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});

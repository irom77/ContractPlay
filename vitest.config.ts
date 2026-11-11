import { readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./apps/client/package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "apps/server/**"] },
  define: { __CONTRACTPLAY_VERSION__: JSON.stringify(version) }
});

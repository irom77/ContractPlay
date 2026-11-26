import { defineConfig, mergeConfig } from "vitest/config";
import clientConfig from "./apps/client/vite.config.ts";

export default mergeConfig(clientConfig, defineConfig({ root: "apps/client", test: {
  testTimeout: 15_000
} }));

import { defineConfig } from "tsup";
import { dependencies } from "./package.json";

export default defineConfig({
  name: "create-ponder-starknet",
  bundle: true,
  clean: true,
  entry: ["src/index.ts"],
  external: Object.keys(dependencies),
  format: ["esm"],
  platform: "node",
});

import resolve from "@rollup/plugin-node-resolve";
import typescript from "rollup-plugin-typescript2";

export default {
  input: "src/script.ts",
  output: {
    file: "dist/bundle.mjs",
    format: "es",
  },
  plugins: [resolve(), typescript()],
};

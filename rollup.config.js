import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import nodePolyfills from "rollup-plugin-node-polyfills";
import typescript from "rollup-plugin-typescript2";

export default {
  input: "src/script.ts",
  output: {
    file: "dist/bundle.mjs",
    format: "es",
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    typescript(),
    json(),
    nodePolyfills(),
    replace({
      "process.env.TILE_BASE_URL": JSON.stringify(process.env.TILE_BASE_URL),
      preventAssignment: true,
    }),
  ],
};

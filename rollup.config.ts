import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import dotenv from "dotenv";
import nodePolyfills from "rollup-plugin-node-polyfills";

dotenv.config();

const TILE_BASE_URL = process.env.TILE_BASE_URL || "";

const config = {
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
      preventAssignment: true,
      values: {
        "process.env.TILE_BASE_URL": JSON.stringify(TILE_BASE_URL),
      },
    }),
  ],
};

export default config;

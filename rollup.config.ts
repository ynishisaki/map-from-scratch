import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import dotenv from "dotenv";
import { InputPluginOption, RollupOptions } from "rollup";
import nodePolyfills from "rollup-plugin-node-polyfills";

dotenv.config();

const TILE_BASE_URL = process.env.TILE_BASE_URL || "";

const config = {
  input: {
    main: "src/main.ts",
    "tile-worker": "src/tile-worker.ts",
  },
  output: {
    format: "es",
    dir: "dist",
    entryFileNames: "[name].js",
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    typescript(),
    json(),
    nodePolyfills() as InputPluginOption,
    replace({
      preventAssignment: true,
      values: {
        "process.env.TILE_BASE_URL": JSON.stringify(TILE_BASE_URL),
      },
    }),
  ],
} satisfies RollupOptions;

export default config;

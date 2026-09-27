import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import autoPreprocess from "svelte-preprocess";

// rollup-plugin-svelte предупреждает через console.warn про package.json exports
// пакетов без поля "svelte" — для этого билда это неактуально, глушим точечно.
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  const text = args.map((a) => String(a)).join(" ");
  if (
    text.includes("did not export their") ||
    text.includes("obsidian-daily-notes-interface")
  ) {
    return;
  }
  _origWarn(...args);
};

export default {
  input: "src/main.ts",
  output: {
    format: "cjs",
    file: "main.js",
    exports: "default",
    inlineDynamicImports: true,
  },
  external: ["obsidian", "fs", "os", "path"],
  // Не печатаем TS-шум из node_modules
  onwarn(warning, warn) {
    const loc = String(warning.id || warning.loc?.file || "");
    if (warning.plugin === "typescript" && /node_modules[\\/]/.test(loc)) {
      return;
    }
    warn(warning);
  },
  plugins: [
    svelte({
      emitCss: false,
      preprocess: autoPreprocess(),
    }),
    typescript({ sourceMap: false }),
    resolve({
      browser: true,
      dedupe: ["svelte"],
    }),
    commonjs({
      include: "node_modules/**",
    }),
  ],
};

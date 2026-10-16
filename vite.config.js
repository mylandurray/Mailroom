import { defineConfig } from "vite";
import { singleFile } from "./scripts/single-file.js";

export default defineConfig(({ mode }) =>
  mode === "single"
    ? {
        base: "./",
        plugins: [singleFile()],
        build: {
          outDir: "dist-single",
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          assetsDir: "",
          chunkSizeWarningLimit: 100000,
          rolldownOptions: { output: { codeSplitting: false } },
        },
      }
    : { base: "./", build: { chunkSizeWarningLimit: 2000 } },
);

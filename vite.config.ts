import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Served from https://ouripoupko.github.io/QuizFlow/ in production; the
  // dev server stays at the domain root so `npm run dev` is unaffected.
  base: command === "build" ? "/QuizFlow/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 6173,
  },
}));

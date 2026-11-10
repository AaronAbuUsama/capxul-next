import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built, the app is served by the loop's host under /runs/ (and through the portal's server at the same path).
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/runs/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
}));

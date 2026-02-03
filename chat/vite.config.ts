import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import fs from "fs";

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "generate-404",
      closeBundle() {
        // Copy index.html to 404.html after build
        fs.copyFileSync("dist/index.html", "dist/404.html");
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

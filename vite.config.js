import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves from /<repo>/; override with VITE_BASE if the repo name differs.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/",
});

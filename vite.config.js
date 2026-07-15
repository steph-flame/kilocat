import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves from /<repo>/; override with VITE_BASE if the repo name differs.
// Cloudflare Pages serves from the domain root, so the default ("/") covers that target;
// the manifest below reuses the same value so start_url/scope stay correct either way.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    // Installable PWA — home-screen install is the point: iOS Safari evicts localStorage
    // (and with it months of weigh-in logs) after 7 days unused in a tab, but exempts
    // installed apps. autoUpdate keeps the cached shell current without a user prompt.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Cat Ration Calculator",
        short_name: "Cat Ration",
        description: "Target energy + food split + blend-to-blend transition planner for feeding a cat.",
        start_url: base,
        scope: base,
        display: "standalone",
        // Palette from src/theme.js: spruce (primary) / paper (page background).
        theme_color: "#3E5C50",
        background_color: "#F6F7F4",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});

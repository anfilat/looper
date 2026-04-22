import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/looper/",
  server: {
    port: 3000,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "Looper",
        short_name: "Looper",
        description: "Language learning tool that loops through video phrases",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        id: "/looper/",
        display: "standalone",
        start_url: "/looper/",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
      },
    }),
  ],
});

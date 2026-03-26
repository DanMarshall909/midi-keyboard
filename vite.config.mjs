import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  // Vite serves on 1420 to match Tauri's devUrl
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // On Windows, polling is more reliable for WSL/cross-drive setups
      usePolling: false,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

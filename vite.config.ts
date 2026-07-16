import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@xyflow")) return "flow-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/backups/**", "**/github uploading/**", "**/Updates/**", "**/data/**"]
    },
    proxy: {
      "/api": "http://127.0.0.1:4310"
    }
  }
});

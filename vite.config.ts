import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { runtimePorts } from "./server/runtimeConfig.js";

const { apiUrl, clientPort } = runtimePorts();

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@xyflow")) return "flow-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (
            id.includes("@react-three") ||
            id.includes("/three/") ||
            id.includes("\\three\\") ||
            id.includes("three-stdlib") ||
            id.includes("troika-three") ||
            id.includes("meshline") ||
            id.includes("maath")
          ) {
            return "three-vendor";
          }
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: clientPort,
    strictPort: true,
    watch: {
      ignored: ["**/backups/**", "**/github uploading/**", "**/Updates/**", "**/data/**"]
    },
    proxy: {
      "/api": apiUrl
    }
  }
});

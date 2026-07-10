import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const appUrl = env.APP_URL || "http://localhost:5173";
  // Use 127.0.0.1 (not localhost) so the proxy matches the API's loopback bind
  // without depending on IPv4/IPv6 resolution order for "localhost".
  const apiTarget = env.API_URL || "http://127.0.0.1:3031";
  const appPort = portFromUrl(appUrl) || "5173";

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            return id.includes("node_modules") ? "vendor" : undefined;
          },
        },
      },
    },
    server: {
      port: Number(appPort),
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "^/mcp$": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
  };
});

function portFromUrl(value?: string) {
  if (!value?.trim()) return "";
  try {
    return new URL(value).port;
  } catch {
    return "";
  }
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, isPreview }) => ({
  define: { __AIKYA_DEV_SERVER__: JSON.stringify(command === "serve" && !isPreview) },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        proxyTimeout: 15000,
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (!response.headersSent && typeof response.writeHead === "function") {
              response.writeHead(503, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: "Campus API is unavailable. Start the backend after configuring MONGODB_URI in server/.env." }));
            }
          });
        },
      },
    },
  },
}));

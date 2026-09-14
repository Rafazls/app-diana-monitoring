import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * O front fala com a API por `/api/*`, que o Vite encaminha para a
 * `guardian-api`. Assim não há URL absoluta no código nem CORS no caminho —
 * em produção basta apontar esse prefixo para o serviço real.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.GUARDIAN_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});

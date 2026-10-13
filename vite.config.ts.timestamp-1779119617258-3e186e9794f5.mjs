// vite.config.ts
import { defineConfig } from "file:///D:/mthunzi-pos-suite-main/node_modules/vite/dist/node/index.js";
import react from "file:///D:/mthunzi-pos-suite-main/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import { VitePWA } from "file:///D:/mthunzi-pos-suite-main/node_modules/vite-plugin-pwa/dist/index.js";
var __vite_injected_original_dirname = "D:\\mthunzi-pos-suite-main";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["robots.txt", "manifest.json", "favicon.ico", "favicon.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Serve core app assets (HTML, JS, CSS, images, fonts) with stale-while-revalidate
            urlPattern: ({ request }) => ["document", "script", "style", "image", "font"].includes(
              // destination is well-supported but keep this defensive
              request.destination || "document"
            ),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "mthunzi-static-assets"
            }
          }
        ]
      },
      manifest: {
        name: "Mthunzi-POS",
        short_name: "Mthunzi",
        description: "Professional Point of Sale and Inventory Management System",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#2563EB",
        icons: [
          { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" }
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxtdGh1bnppLXBvcy1zdWl0ZS1tYWluXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxtdGh1bnppLXBvcy1zdWl0ZS1tYWluXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9tdGh1bnppLXBvcy1zdWl0ZS1tYWluL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBWaXRlUFdBIH0gZnJvbSAndml0ZS1wbHVnaW4tcHdhJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IFwiOjpcIixcbiAgICBwb3J0OiA4MDgwLFxuICAgIGhtcjoge1xuICAgICAgb3ZlcmxheTogZmFsc2UsXG4gICAgfSxcbiAgfSxcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcbiAgICAgIGluY2x1ZGVBc3NldHM6IFsncm9ib3RzLnR4dCcsICdtYW5pZmVzdC5qc29uJywgJ2Zhdmljb24uaWNvJywgJ2Zhdmljb24ucG5nJ10sXG4gICAgICB3b3JrYm94OiB7XG4gICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxpY28scG5nLHN2Z30nXSxcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogJy9pbmRleC5odG1sJyxcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBTZXJ2ZSBjb3JlIGFwcCBhc3NldHMgKEhUTUwsIEpTLCBDU1MsIGltYWdlcywgZm9udHMpIHdpdGggc3RhbGUtd2hpbGUtcmV2YWxpZGF0ZVxuICAgICAgICAgICAgdXJsUGF0dGVybjogKHsgcmVxdWVzdCB9KSA9PlxuICAgICAgICAgICAgICBbJ2RvY3VtZW50JywgJ3NjcmlwdCcsICdzdHlsZScsICdpbWFnZScsICdmb250J10uaW5jbHVkZXMoXG4gICAgICAgICAgICAgICAgLy8gZGVzdGluYXRpb24gaXMgd2VsbC1zdXBwb3J0ZWQgYnV0IGtlZXAgdGhpcyBkZWZlbnNpdmVcbiAgICAgICAgICAgICAgICAocmVxdWVzdCBhcyBhbnkpLmRlc3RpbmF0aW9uIHx8ICdkb2N1bWVudCdcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdTdGFsZVdoaWxlUmV2YWxpZGF0ZScsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ210aHVuemktc3RhdGljLWFzc2V0cycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgbWFuaWZlc3Q6IHtcbiAgICAgICAgbmFtZTogJ010aHVuemktUE9TJyxcbiAgICAgICAgc2hvcnRfbmFtZTogJ010aHVuemknLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1Byb2Zlc3Npb25hbCBQb2ludCBvZiBTYWxlIGFuZCBJbnZlbnRvcnkgTWFuYWdlbWVudCBTeXN0ZW0nLFxuICAgICAgICBzdGFydF91cmw6ICcvJyxcbiAgICAgICAgZGlzcGxheTogJ3N0YW5kYWxvbmUnLFxuICAgICAgICBiYWNrZ3JvdW5kX2NvbG9yOiAnI2ZmZmZmZicsXG4gICAgICAgIHRoZW1lX2NvbG9yOiAnIzI1NjNFQicsXG4gICAgICAgIGljb25zOiBbXG4gICAgICAgICAgeyBzcmM6ICcvaWNvbnMvaWNvbi0xOTIuc3ZnJywgc2l6ZXM6ICcxOTJ4MTkyJywgdHlwZTogJ2ltYWdlL3N2Zyt4bWwnIH0sXG4gICAgICAgICAgeyBzcmM6ICcvaWNvbnMvaWNvbi01MTIuc3ZnJywgc2l6ZXM6ICc1MTJ4NTEyJywgdHlwZTogJ2ltYWdlL3N2Zyt4bWwnIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pLFxuICBdLmZpbHRlcihCb29sZWFuKSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICB9LFxuICB9LFxufSkpO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFpUSxTQUFTLG9CQUFvQjtBQUM5UixPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsZUFBZTtBQUh4QixJQUFNLG1DQUFtQztBQU16QyxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssT0FBTztBQUFBLEVBQ3pDLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxNQUNILFNBQVM7QUFBQSxJQUNYO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsZUFBZSxDQUFDLGNBQWMsaUJBQWlCLGVBQWUsYUFBYTtBQUFBLE1BQzNFLFNBQVM7QUFBQSxRQUNQLGNBQWMsQ0FBQyxnQ0FBZ0M7QUFBQSxRQUMvQyxrQkFBa0I7QUFBQSxRQUNsQixnQkFBZ0I7QUFBQSxVQUNkO0FBQUE7QUFBQSxZQUVFLFlBQVksQ0FBQyxFQUFFLFFBQVEsTUFDckIsQ0FBQyxZQUFZLFVBQVUsU0FBUyxTQUFTLE1BQU0sRUFBRTtBQUFBO0FBQUEsY0FFOUMsUUFBZ0IsZUFBZTtBQUFBLFlBQ2xDO0FBQUEsWUFDRixTQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsY0FDUCxXQUFXO0FBQUEsWUFDYjtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsVUFBVTtBQUFBLFFBQ1IsTUFBTTtBQUFBLFFBQ04sWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLFFBQ2IsV0FBVztBQUFBLFFBQ1gsU0FBUztBQUFBLFFBQ1Qsa0JBQWtCO0FBQUEsUUFDbEIsYUFBYTtBQUFBLFFBQ2IsT0FBTztBQUFBLFVBQ0wsRUFBRSxLQUFLLHVCQUF1QixPQUFPLFdBQVcsTUFBTSxnQkFBZ0I7QUFBQSxVQUN0RSxFQUFFLEtBQUssdUJBQXVCLE9BQU8sV0FBVyxNQUFNLGdCQUFnQjtBQUFBLFFBQ3hFO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0gsRUFBRSxPQUFPLE9BQU87QUFBQSxFQUNoQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K

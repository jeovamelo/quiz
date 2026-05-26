// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // Pre-bundle pdfjs-dist so the first PDF upload doesn't trigger a
    // dep-optimization full-page reload that wipes form state.
    optimizeDeps: {
      include: ["pdfjs-dist"],
    },
    // pdfjs-dist must NEVER load on the server (uses DOMMatrix, Worker, etc.)
    ssr: {
      noExternal: [],
      external: ["pdfjs-dist"],
    },
  },
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "url";
import { componentTagger } from "lovable-tagger";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    // A placeholder client turns missing deployment configuration into a misleading
    // browser fetch failure. Stop production builds before they can ship that state.
    if (mode === "production") {
        const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((name) => !env[name]);
        if (missing.length) {
            throw new Error(`Missing required production environment variable(s): ${missing.join(", ")}`);
        }
    }

    return {
    server: {
        host: "::",
        port: 8080,
        proxy: {
            "/api": {
                target: "http://localhost:5000",
                changeOrigin: true,
            },
        },
        hmr: {
            overlay: false,
        },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@backend": path.resolve(__dirname, "./backend"),
        },
    },
    };
});

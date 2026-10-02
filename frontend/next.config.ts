import type { NextConfig } from "next";

// The browser calls /api on the web origin; Next.js forwards it to the orchestrator, so one public
// URL (tunnel) serves both and there is no CORS. AYLAND_API_ORIGIN is read at build time.
const API_ORIGIN = process.env.AYLAND_API_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Next gzips responses before its proxy, and gzip holds SSE back until the stream ends (chat and the
  // trip event stream would arrive all at once, or never). The tunnel compresses on its own.
  compress: false,
  experimental: {
    // The proxy's default idle timeout (30 s) could cut a long turn; the backend also sends heartbeats.
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

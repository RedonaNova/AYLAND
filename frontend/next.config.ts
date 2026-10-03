import type { NextConfig } from "next";

// The browser calls /api on the web origin; Next.js (or Vercel's edge) forwards it to the orchestrator, so one
// public URL serves both and there is no CORS. AYLAND_API_ORIGIN is read at build time: on Vercel it is a
// project environment variable (the backend's tunnel URL, HANDBOOK §12), so changing it needs a redeploy.
const API_ORIGIN = process.env.AYLAND_API_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // This app is self-contained in frontend/; without this, the repo's second lockfile makes Next guess the root.
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  // Next gzips responses before its proxy, and gzip would hold back any streamed response. The tunnel and
  // Vercel compress on their own.
  compress: false,
  experimental: {
    // Long polls wait up to 20 s for the next event; the default 30 s proxy idle timeout is too close.
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

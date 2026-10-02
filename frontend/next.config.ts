import type { NextConfig } from "next";

// The browser calls /api on the web origin; Next.js forwards it to the orchestrator, so one public
// URL (tunnel) serves both and there is no CORS. AYLAND_API_ORIGIN is read at build time.
const API_ORIGIN = process.env.AYLAND_API_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;

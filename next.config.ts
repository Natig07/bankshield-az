import type { NextConfig } from "next";

// Cache Components and partial prefetching are deliberately NOT enabled.
// Every page in this app is authenticated and per-user, so prerendering a
// shared static shell adds risk for no benefit. See ARCHITECTURE.md.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native module; must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

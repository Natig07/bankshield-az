import type { NextConfig } from "next";

// Cache Components and partial prefetching are deliberately NOT enabled.
// Every page in this app is authenticated and per-user, so prerendering a
// shared static shell adds risk for no benefit. See ARCHITECTURE.md.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native module; must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Evidence uploads (max 10 MB, see src/lib/evidence/validation.ts) arrive as a Server
    // Action multipart body; the default 1 MB limit would reject them. The extra
    // megabyte covers multipart framing. Next.js also compares the request Origin with
    // the host for every Server Action, which is the CSRF protection for uploads.
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          // Only the CSP directives that cannot break Next.js inline bootstrap scripts.
          // script-src/style-src need per-request nonces and browser testing; see NEXT_STEPS.md.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          // HSTS only in production builds so local http://localhost development keeps working.
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
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

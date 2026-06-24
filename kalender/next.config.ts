import type { NextConfig } from "next";

// Defense-in-depth response headers applied to every route. Intentionally limited
// to headers that cannot break the app: clickjacking (frame-ancestors / X-Frame-Options),
// MIME sniffing, referrer leakage, and unused browser features. A full script-src CSP
// and Strict-Transport-Security are deferred to the TLS rollout (see docs/DEPLOY.md),
// since HSTS is a no-op over plain HTTP and a strict script-src needs testing against
// the dev overlay first.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Wir erlauben die Domain sowohl mit als auch ohne Port-Angabe
  allowedDevOrigins: ["kalender.local", "localhost:3000", "kalender.local:3000", "192.168.2.12"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
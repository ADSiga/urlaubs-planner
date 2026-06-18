import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Wir erlauben die Domain sowohl mit als auch ohne Port-Angabe
  allowedDevOrigins: ["kalender.local", "localhost:3000", "kalender.local:3000", "192.168.2.12"],
};

export default nextConfig;
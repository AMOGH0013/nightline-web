import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NIGHTLINE_DIST_DIR?.trim() || ".next",
  serverExternalPackages: ["pg", "embedded-postgres", "qrcode"],
};

export default nextConfig;

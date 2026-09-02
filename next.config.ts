import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the home-server deployment.
  output: "standalone",
  allowedDevOrigins: ["192.168.0.186"],
};

export default nextConfig;

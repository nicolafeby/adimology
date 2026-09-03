import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const scriptPolicy = isProduction
  ? "script-src 'self' 'unsafe-inline' https://s3.tradingview.com"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com";
const upgradePolicy = isProduction ? "; upgrade-insecure-requests" : "";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the home-server deployment.
  output: "standalone",
  allowedDevOrigins: ["192.168.0.186"],
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.stockbit.com https://generativelanguage.googleapis.com https://block.idx.id; frame-src https://www.tradingview.com${upgradePolicy}` },
    ];
    if (isProduction) {
      securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
    }
    return [{
      source: '/:path*',
      headers: securityHeaders,
    }];
  },
};

export default nextConfig;

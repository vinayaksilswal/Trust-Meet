import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: ["localhost"],
  transpilePackages: ["@conviya/ui", "@conviya/contracts"],
  async rewrites() {
    const api = process.env.CONVIYA_API_URL ?? "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: api + "/:path*" }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      ],
    }];
  },
};

export default config;

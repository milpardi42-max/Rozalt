import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project is an SSR Next.js app intended for Netlify / Vercel / Node hosts.
  // Avoid export mode here so route handlers, middleware, and server-side auth work correctly.
  images: {
    // The default candidate list tops out at 3840w, which appends dead weight to every srcset.
    // Nothing on this site renders wider than 2×1920; capping the list trims ~40% off each <img>.
    deviceSizes: [640, 750, 1080, 1200, 1920, 2560, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default nextConfig;

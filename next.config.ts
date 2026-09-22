import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project is an SSR Next.js app intended for Netlify / Vercel / Node hosts.
  // Avoid export mode here so route handlers, middleware, and server-side auth work correctly.
  //
  // `X-Powered-By: Next.js` is free reconnaissance for an attacker — drop it.
  poweredByHeader: false,

  /**
   * Baseline security headers, applied when this app is served by `next start`
   * (VPS / Docker / Liara …). On Netlify/Vercel the equivalent rules live in
   * netlify.toml / the platform dashboard.
   *
   * Deliberately NOT set here:
   *   • X-Frame-Options / frame-ancestors — live previews and embedded
   *     dashboards render the site inside an iframe, so framing must stay open.
   *   • HSTS — terminate HTTPS at the reverse proxy, where the domain is known.
   *   • Permissions-Policy camera/microphone — the webinar broadcast UI needs them.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },

  images: {
    // The default candidate list tops out at 3840w, which appends dead weight to every srcset.
    // Nothing on this site renders wider than 2×1920; capping the list trims ~40% off each <img>.
    deviceSizes: [640, 750, 1080, 1200, 1920, 2560, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default nextConfig;

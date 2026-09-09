import type { NextConfig } from "next";

/**
 * Response headers for the transaction interface.
 *
 * The threat model puts the browser interface in scope and lists frontend
 * deception as a risk, but the shipped page sent no security headers at all.
 * The controls on it are irreversible and one click each — closing a vault,
 * executing a claim — which is exactly what a clickjacking overlay is for.
 *
 * Being honest about what this does and does not buy: `connect-src` has to
 * stay open, because the RPC endpoint is whatever chain the user's wallet is
 * on and can be one they configured themselves. So the value here is
 * `frame-ancestors`, plus closing the older injection routes — not a tight
 * content policy.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js inlines its bootstrap script and hydration data, and injects
  // styles at runtime; both need 'unsafe-inline' without a nonce pipeline.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Wallets and RPC endpoints are user-chosen; restricting this would break
  // custom networks rather than protect anyone.
  "connect-src *",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The one that matters: this page may never be embedded.
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Belt and braces for browsers that predate frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A vault URL carries the owner's address in its query; do not leak it.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

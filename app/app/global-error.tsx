"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * The boundary of last resort: this replaces the root layout, so it cannot
 * assume the stylesheet, the fonts or anything else loaded. Everything here is
 * inline and dependency-free on purpose.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Mortal Vault fatal error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#05060c",
          color: "#eef1f8",
          fontFamily:
            "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: "520px" }} role="alert">
          <p
            style={{
              margin: 0,
              fontSize: "11px",
              letterSpacing: "0.16em",
              color: "#ee6a4d",
            }}
          >
            MORTAL VAULT
          </p>
          <h1
            style={{
              margin: "12px 0 0",
              fontSize: "26px",
              lineHeight: 1.2,
              fontWeight: 500,
            }}
          >
            This page broke. Your vault did not.
          </h1>
          <p
            style={{
              margin: "16px 0 0",
              fontSize: "15px",
              lineHeight: 1.65,
              color: "#8b92a6",
            }}
          >
            Your funds have not moved and your plan is unchanged — only the
            interface failed. The quiet period is still counting, so if you came
            here to check in, do that first.
          </p>
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginTop: "24px",
              flexWrap: "wrap",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/?action=checkin"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "44px",
                padding: "0 20px",
                borderRadius: "9px",
                background: "#5ce0a1",
                color: "#06090f",
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Check in now
            </a>
            <button
              type="button"
              onClick={reset}
              style={{
                height: "44px",
                padding: "0 20px",
                borderRadius: "9px",
                border: "1px solid rgba(148, 163, 200, 0.26)",
                background: "transparent",
                color: "#c6cbd9",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Try loading it again
            </button>
          </div>
          <p
            style={{
              margin: "24px 0 0",
              fontSize: "13px",
              lineHeight: 1.6,
              color: "#5a6175",
            }}
          >
            Your vault is reachable without this site: the contract can be
            called directly from any wallet or block explorer.
            {error.digest ? ` Reference ${error.digest}.` : ""}
          </p>
        </div>
      </body>
    </html>
  );
}

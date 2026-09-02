import { ImageResponse } from "next/og";

export const alt = "Cocokologi — Dashboard Analisis Saham";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const features = ["Target Harga", "Broker Summary", "Watchlist", "Performance"];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          color: "#f8fafc",
          background:
            "linear-gradient(135deg, #080b17 0%, #111329 48%, #17102b 100%)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: "50%",
            left: -180,
            top: -230,
            background: "rgba(99, 102, 241, 0.32)",
            filter: "blur(75px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 540,
            height: 540,
            borderRadius: "50%",
            right: -170,
            bottom: -300,
            background: "rgba(139, 92, 246, 0.3)",
            filter: "blur(80px)",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            margin: 42,
            padding: "48px 56px",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 32,
            background: "rgba(10, 12, 27, 0.76)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.38)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 58,
                height: 58,
                borderRadius: 17,
                fontSize: 31,
                fontWeight: 800,
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                boxShadow: "0 10px 30px rgba(124, 58, 237, 0.38)",
              }}
            >
              A
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 28, fontWeight: 750, letterSpacing: -0.5 }}>
                COCOKOLOGI
              </span>
              <span style={{ color: "#9ca3af", fontSize: 17 }}>
                Smarter stock analysis
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", maxWidth: 920 }}>
            <div
              style={{
                display: "flex",
                color: "#a78bfa",
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: 2.5,
                marginBottom: 14,
              }}
            >
              DASHBOARD ANALISIS SAHAM
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 52,
                lineHeight: 1.08,
                fontWeight: 800,
                letterSpacing: -2.2,
              }}
            >
              Data lebih ringkas. Keputusan lebih terarah.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {features.map((feature) => (
              <div
                key={feature}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 17px",
                  border: "1px solid rgba(167,139,250,0.28)",
                  borderRadius: 999,
                  color: "#d8d7e5",
                  background: "rgba(124,58,237,0.10)",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {feature}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

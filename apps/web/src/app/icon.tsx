import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "linear-gradient(135deg, #0a2419 0%, #0f1e18 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          border: "1px solid rgba(52,211,153,0.35)",
        }}
      >
        {/* Alvo / crosshair simplificado */}
        <div
          style={{
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Círculo externo */}
          <div
            style={{
              position: "absolute",
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "1.5px solid #34d399",
            }}
          />
          {/* Círculo interno */}
          <div
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: "1.5px solid #34d399",
            }}
          />
          {/* Ponto central */}
          <div
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "#34d399",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}

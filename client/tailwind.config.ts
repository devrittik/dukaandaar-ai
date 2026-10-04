import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#16724a", dark: "#105a3a", light: "#e3f2e9" },
        sidebar: { DEFAULT: "#173c2d", line: "#223e32" },
        avatar: { DEFAULT: "#eadfce", ink: "#725738" },
        ink: { DEFAULT: "#17251e", soft: "#4d5c53" },
        surface: { DEFAULT: "#ffffff", subtle: "#f5f7f4", green: "#eff7f0" },
        muted: "#829087",
        line: "#e8ede8",
        danger: { DEFAULT: "#c5443e", light: "#fff1ef" },
        success: { DEFAULT: "#16724a", light: "#e8f5ec" },
        amber: { DEFAULT: "#c38524", light: "#fff6e8" },
        blue: { DEFAULT: "#467fa7", light: "#edf6fb" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        display: ["DM Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "18px",
        panel: "22px",
      },
      boxShadow: {
        card: "0 3px 18px rgba(26, 50, 34, 0.045)",
        float: "0 16px 40px rgba(24, 52, 35, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
        ink: {
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          400: "#a1a1aa",
          500: "#71717a",
          700: "#3f3f46",
          900: "#18181b",
          950: "#09090b",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Space Grotesk", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

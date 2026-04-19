/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sovereign: {
          bg: "#0a0e17",
          panel: "#111827",
          border: "#1f2937",
          accent: "#10b981",
          danger: "#ef4444",
          warn: "#f59e0b",
          text: "#e5e7eb",
          muted: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};

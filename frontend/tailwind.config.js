/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Original Apple pink/red accent — used for active states, seek, glow.
        accent: {
          DEFAULT: "#fa233b",
          soft: "#ff375f",
        },
      },
      fontFamily: {
        // SF Pro-like stack; Inter is loaded in index.html as the web fallback.
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Segoe UI",
          "sans-serif",
        ],
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.37)",
        glow: "0 0 40px rgba(250, 35, 59, 0.35)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "equalizer": {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
        "equalizer": "equalizer 0.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

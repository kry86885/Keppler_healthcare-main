/** @type {import('tailwindcss').Config} */
export default {
  content: ["./*.html", "./src/**/*.{js,css}"],
  theme: {
    extend: {
      colors: {
        mist: "#f6fbfc",
        slateInk: "#274353",
        deep: "#102436",
        coral: "#0d6fc2",
        mint: "#10c68c",
        aqua: "#0b8e92"
      },
      fontFamily: {
        heading: ["'Sora'", "sans-serif"],
        body: ["'Manrope'", "sans-serif"]
      },
      boxShadow: {
        glow: "0 24px 80px -32px rgba(9, 30, 45, 0.35)"
      }
    }
  },
  plugins: []
};

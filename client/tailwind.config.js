import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sds = require("@czi-sds/components/dist/tailwind.json");

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: sds,
  },
  plugins: [],
};

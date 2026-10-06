import { defineConfig } from "astro/config";

// SITE and BASE_PATH are set by the GitHub Actions workflow from GitHub Pages settings.
// Locally the site runs at the root.
export default defineConfig({
  site: process.env.SITE || "http://localhost:4321",
  base: process.env.BASE_PATH || "/",
  trailingSlash: "ignore",
});

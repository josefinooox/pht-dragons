import type { APIRoute } from "astro";
import { url } from "../lib/url";

// Web app manifest: lets phones add the site to the home screen as an app ("D" icon, no browser
// bar). Generated so the paths follow the GitHub Pages base path.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: "PHT Dragons",
      short_name: "Dragons",
      description: "Rozpis zápasů, rozbor soupeřů a statistiky PHT Dragons.",
      lang: "cs",
      start_url: url(),
      scope: url(),
      display: "standalone",
      background_color: "#181818",
      theme_color: "#181818",
      icons: [
        { src: url("icon-192.png"), sizes: "192x192", type: "image/png" },
        { src: url("icon-512.png"), sizes: "512x512", type: "image/png" },
        { src: url("icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );

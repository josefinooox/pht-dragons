import type { APIRoute, GetStaticPaths } from "astro";
import { gameSlug, mine, type Game } from "../../lib/data";
import { matchImage } from "../../lib/og";

// Link-preview image of one game (og:image of /zapas/{slug}), see src/lib/og.ts.
export const getStaticPaths = (() => mine.map((game) => ({ params: { slug: gameSlug(game) }, props: { game } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await matchImage(props.game as Game)), { headers: { "Content-Type": "image/png" } });

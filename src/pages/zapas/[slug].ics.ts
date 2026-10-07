import type { APIRoute, GetStaticPaths } from "astro";
import { gameSlug, mine, type Game } from "../../lib/data";
import { calendar, icsResponse } from "../../lib/ics";
import { url } from "../../lib/url";

// Single game "add to calendar" file. Same UID as in the season feed.
export const getStaticPaths = (() => mine.map((game) => ({ params: { slug: gameSlug(game) }, props: { game } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site }) => {
  const game = props.game as Game;
  return icsResponse(calendar([game], (g) => new URL(url(`zapas/${gameSlug(g)}`), site).href, "PHT Dragons"));
};

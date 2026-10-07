import type { APIRoute } from "astro";
import { gameSlug, mine } from "../lib/data";
import { calendar, icsResponse } from "../lib/ics";
import { url } from "../lib/url";

// Season feed for calendar subscriptions (webcal://.../dragons.ics).
export const GET: APIRoute = ({ site }) =>
  icsResponse(calendar(mine, (g) => new URL(url(`zapas/${gameSlug(g)}`), site).href, "PHT Dragons"));

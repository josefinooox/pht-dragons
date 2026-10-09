// Link-preview images (Open Graph, 1200 × 630) for match pages, rendered at build time:
// satori lays the card out and turns the text into paths (so the Barlow fonts work on any
// machine), sharp turns the SVG into a PNG. Upcoming games show date, time and venue; played
// games the score and the result.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import satori from "satori";
import { OUR, SRAZ_MIN, forT, isFinal, team, type Game } from "./data";
import { dayMonthDot, minusMinutes, weekdayShort } from "./format";

const require = createRequire(import.meta.url);
const root = process.cwd();
const font = (pkg: string, file: string) => readFile(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files", file));

// Czech needs both the latin and latin-ext subsets. Satori falls back along the font-family list,
// so the latin-ext files get their own family name (" X") listed second.
let fontsP: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800 | 900; style: "normal" }[]> | null = null;
const fonts = () =>
  (fontsP ??= Promise.all(
    ([
      ["Barlow Condensed", "@fontsource/barlow-condensed", "barlow-condensed", 700],
      ["Barlow Condensed", "@fontsource/barlow-condensed", "barlow-condensed", 900],
      ["Barlow", "@fontsource/barlow", "barlow", 400],
      ["Barlow", "@fontsource/barlow", "barlow", 600],
    ] as const).flatMap(([name, pkg, base, weight]) =>
      ["latin", "latin-ext"].map(async (subset) => ({
        name: subset === "latin" ? name : `${name} X`,
        weight,
        style: "normal" as const,
        data: await font(pkg, `${base}-${subset}-${weight}-normal.woff`),
      })),
    ),
  ));

const dataUri = (buf: Buffer, type = "image/png") => `data:${type};base64,${buf.toString("base64")}`;
async function logo(teamId: string) {
  const file =
    teamId === OUR ? path.join(root, "src/assets/dragons-badge.svg") : path.join(root, "public/logos", `${teamId}.webp`);
  try {
    return dataUri(await sharp(await readFile(file), { density: 300 }).resize(240, 240, { fit: "contain", background: "#ffffff" }).png().toBuffer());
  } catch {
    return null;
  }
}
const wordmark = async () => dataUri(await readFile(path.join(root, "src/assets/dragons-logo.svg")), "image/svg+xml");

// tiny element helper for satori (no JSX here)
type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style: { display: "flex", ...style }, children, ...extra },
});

const CONDENSED = "'Barlow Condensed', 'Barlow Condensed X'";
const SANS = "'Barlow', 'Barlow X'";
const C = { bg: "#181818", text: "#ffffff", muted: "#9d9d9d", red: "#e3000a", blue: "#104fed", green: "#10b981", draw: "#6d6d6d" };

async function side(teamId: string) {
  const t = team(teamId);
  const src = await logo(teamId);
  // fixed height, top aligned: logos line up even when a long name wraps to two lines
  return h("div", { width: 320, height: 320, flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 22, paddingTop: 20 }, [
    h(
      "div",
      { width: 200, height: 200, borderRadius: 100, background: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
      src
        ? h("img", { width: 200, height: 200, objectFit: "contain" }, undefined, { src, width: 200, height: 200 })
        : h("div", { fontFamily: CONDENSED, fontWeight: 900, fontSize: 64, color: "#181818" }, t.shortName ?? t.name.slice(0, 3)),
    ),
    h(
      "div",
      { fontFamily: CONDENSED, fontWeight: 900, fontSize: 44, lineHeight: 1.05, color: C.text, textTransform: "uppercase", textAlign: "center", justifyContent: "center" },
      t.name,
    ),
  ]);
}

export async function matchImage(g: Game): Promise<Buffer> {
  const final = isFinal(g);
  const r = final ? forT(g, OUR) : null;
  const result = r ? { V: ["Výhra", C.green], R: ["Remíza", C.draw], P: ["Prohra", C.red] }[r.r] : null;
  const middle = final
    ? h("div", { flexDirection: "column", alignItems: "center", gap: 18 }, [
        h("div", { fontFamily: CONDENSED, fontWeight: 900, fontSize: 190, lineHeight: 1, color: C.text, letterSpacing: -2 }, `${g.homeGoals}:${g.awayGoals}`),
        h(
          "div",
          { background: result![1], color: "#ffffff", borderRadius: 999, padding: "8px 26px", fontFamily: CONDENSED, fontWeight: 900, fontSize: 34, textTransform: "uppercase" },
          result![0],
        ),
      ])
    : h("div", { flexDirection: "column", alignItems: "center", gap: 6 }, [
        h(
          "div",
          { fontFamily: CONDENSED, fontWeight: 900, fontSize: 52, color: C.muted, textTransform: "uppercase" },
          `${weekdayShort(g.date)} ${dayMonthDot(g.date)}`,
        ),
        h("div", { fontFamily: CONDENSED, fontWeight: 900, fontSize: 170, lineHeight: 1, color: C.text }, g.time),
        h("div", { fontFamily: CONDENSED, fontWeight: 700, fontSize: 36, color: C.red, textTransform: "uppercase" }, `Sraz ${minusMinutes(g.time, SRAZ_MIN)}`),
      ]);
  const foot = [final ? `${weekdayShort(g.date)} ${dayMonthDot(g.date)}` : null, g.venue].filter(Boolean).join("  ·  ");

  const svg = await satori(
    // satori adds padding to width/height (content box): 1080 + 2 × 60 = 1200, 522 + 48 + 60 = 630
    h("div", { width: 1080, height: 522, background: C.bg, flexDirection: "column", padding: "48px 60px 60px", fontFamily: SANS }, [
      h("div", { justifyContent: "space-between", alignItems: "center" }, [
        h("img", { height: 40 }, undefined, { src: await wordmark(), height: 40, width: 165 }),
        h("div", { fontFamily: CONDENSED, fontWeight: 700, fontSize: 30, color: C.muted, textTransform: "uppercase" }, "PHM Cup · zápas"),
      ]),
      h("div", { flex: 1, alignItems: "center", justifyContent: "space-between" }, [await side(g.homeTeamId), middle, await side(g.awayTeamId)]),
      h("div", { justifyContent: "center", fontSize: 32, fontWeight: 600, color: C.muted }, foot),
      // brand stripe
      h("div", { position: "absolute", left: 0, right: 0, bottom: 0, height: 12 }, [
        h("div", { flex: 1, background: C.blue }),
        h("div", { flex: 1, background: C.red }),
      ]),
    ]),
    { width: 1200, height: 630, fonts: await fonts() },
  );
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
}

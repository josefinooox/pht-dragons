// Internal links must include the GitHub Pages base path.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

/** url("tabulka") -> "/pht-dragons/tabulka"; url("") -> "/pht-dragons/" */
export const url = (path = "") => `${base}/${path.replace(/^\//, "")}`;

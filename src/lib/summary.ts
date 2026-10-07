// Opponent summary: template over computed facts (prototype's aiSummary).
// If this ever becomes AI-generated, keep computing the facts here and let the model only phrase them.
import { OUR, active, attackRank, commonOpponents, defenseRank, forT, pimRank, played, rankOf, stats, team } from "./data";
import { num, plural } from "./format";

/** Length of the current streak of identical results (last result, count). */
export function streak(t: string) {
  const res = played(t).map((g) => forT(g, t).r);
  const last = res[res.length - 1];
  let k = 0;
  for (let i = res.length - 1; i >= 0 && res[i] === last; i--) k++;
  return { last, k };
}

export function opponentSummary(o: string): string {
  const s = stats(o);
  const n = team(o).name;
  const me = stats(OUR);
  const N = active.length;
  if (!s.gp) return `${n} v sezóně ještě nehráli, takže zatím není z čeho vycházet. Rozbor se doplní po jejich prvním zápase.`;

  const out: string[] = [];
  const { last, k } = streak(o);
  let s1 = `${n} jsou ${rankOf(o)}. v tabulce s ${s.pts} ${s.pts === 1 ? "bodem" : "body"} z ${s.gp} ${s.gp === 1 ? "zápasu" : "zápasů"}`;
  if (k >= 2 && last !== "R")
    s1 += ` a ${last === "V" ? "vyhráli" : "prohráli"} posledn${k < 5 ? "í" : "ích"} ${k} ${plural(k, "zápas", "zápasy", "zápasů")}`;
  out.push(s1 + ".");

  const ar = attackRank(o);
  const dr = defenseRank(o);
  if (ar <= 3 && dr <= 3)
    out.push(
      `Patří k nejvyrovnanějším týmům skupiny: ${ar === 1 ? "" : ar + ". "}nejlepší útok (${num(s.gfpg)} gólu na zápas) a ${dr === 1 ? "" : dr + ". "}nejlepší obrana (${num(s.gapg)}).`,
    );
  else if (ar <= 3)
    out.push(`Jejich zbraní je útok, s průměrem ${num(s.gfpg)} gólu na zápas jsou ${ar === 1 ? "nejlepší" : ar + ". nejlepší"} ve skupině.`);
  else if (dr <= 3)
    out.push(`Stojí na obraně, dostávají jen ${num(s.gapg)} gólu na zápas, což je ${dr === 1 ? "nejméně" : dr + ". nejméně"} ve skupině.`);
  else if (dr > N - 3) out.push(`Slabinou je obrana, dostávají ${num(s.gapg)} gólu na zápas.`);
  else out.push(`Útok i obrana jsou průměrné, dávají ${num(s.gfpg)} a dostávají ${num(s.gapg)} gólu na zápas.`);

  // Comparison against common opponents (goal difference), else on paper.
  const common = commonOpponents(o);
  let dUs = 0;
  let dThem = 0;
  for (const c of common) {
    for (const g of c.us) dUs += forT(g, OUR).f - forT(g, OUR).a;
    for (const g of c.them) dThem += forT(g, o).f - forT(g, o).a;
  }
  const signed = (x: number) => `${x > 0 ? "+" : ""}${x}`;
  if (common.length)
    out.push(
      `Proti ${common.length === 1 ? "společnému soupeři" : `${common.length} společným soupeřům`} si vedli ${dThem > dUs ? "lépe než my" : dThem < dUs ? "hůř než my" : "podobně jako my"} (rozdíl skóre ${signed(dThem)} oproti našim ${signed(dUs)}).`,
    );
  else if (me.gp) {
    const diff = s.gfpg - s.gapg;
    const ours = me.gfpg - me.gapg;
    out.push(
      diff > ours + 1
        ? "Na papíře jsou silnější než my, hlavně díky lepšímu poměru skóre."
        : diff < ours - 1
          ? "Na papíře jsme favorité, máme lepší poměr skóre."
          : "Na papíře jsou zhruba na naší úrovni.",
    );
  }
  if (pimRank(o) <= 3) out.push(`Hodně faulují (${num(s.pimpg)} trestných minut na zápas), takže počítejte s přesilovkami.`);
  return out.join(" ");
}

# PHT Dragons

Týmový web PHT Dragons (PHM Cup). Statický web v Astru, data z HMS API,
hosting zdarma na GitHub Pages.

## 1. Jednorázové nastavení (cca 5 minut)

1. Na github.com vytvoř nový **veřejný** repozitář, třeba `pht-dragons`.
   Veřejný proto, že má neomezené minuty pro GitHub Actions; data jsou stejně veřejná.
2. V repozitáři: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. V této složce spusť:
   ```
   git init
   git add .
   git commit -m "Initial scaffold"
   git branch -M main
   git remote add origin https://github.com/TVUJ-UCET/pht-dragons.git
   git push -u origin main
   ```
4. V záložce **Actions** se spustí první build. Po dokončení bude web na
   `https://TVUJ-UCET.github.io/pht-dragons/` s textem „Web se staví. Deploy funguje.“

Lokálně: `npm install`, pak `npm run dev`.

## 2. Práce s Claude Code

Všechen kontext projektu je v `CLAUDE.md`, Claude Code si ho načte sám.
Doporučené pořadí, jedna úloha na session:

1. **Datová vrstva** – první prompt:
   > Implement scripts/fetch-data.mjs per CLAUDE.md: fetch games, standings and
   > competitionInfo, validate with zod, normalize to JSON in /data (teams, games,
   > standings, meta with fetchedAt), download logos to /public/logos as webp.
   > On any fetch or validation error, keep existing /data and exit 0.
   > Run it, show me a summary of the output, and add a small test for the normalizer.
2. **Stránky bez stylu** – rozpis, detail zápasu, tabulka, 404, podle CLAUDE.md.
3. **Kalendář a náhledy odkazů** – `/dragons.ics` a Open Graph tagy.
4. **Vizuální styl** – podle tvého zadání.

## Poznámky

- Workflow běží každých 30 minut. GitHub plánované běhy občas o pár minut zpozdí.
- GitHub vypne plánované běhy, když v repozitáři 60 dní nepřibude commit.
  Během sezóny to řeší automatické commity dat; mimo sezónu stačí ruční spuštění
  v záložce Actions (Run workflow).
- Ruční aktualizace kdykoli: Actions → Fetch data, build, deploy → Run workflow.

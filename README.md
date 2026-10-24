# OutdoorWild Navigator

Routenplanung und Navigation abseits von Straßen: Waldwege, Pfade und Trails für MTB, Gravel, Wandern und Trailrunning. Die Heimatregion ist der **Neckar-Odenwald-Kreis** (Baden-Württemberg).

## Starten

```bash
npm install
npm run dev
```

Danach <http://localhost:5173> öffnen. Am Handy im selben WLAN geht das über die Netzwerk-Adresse, die `npm run dev` anzeigt. Für GPS braucht das Handy HTTPS, das kommt mit dem Hosting.

```bash
npm test                                    # Unit-Tests (ohne Netz)
LIVE=1 npx vitest run src/lib/live.test.ts   # echte Routensuche gegen brouter.de
npm run build                               # Produktions-Build nach dist/ (PWA, offline-fähig)
```

## Online (GitHub Pages)

Bei jedem Push auf `main` testet und baut [deploy.yml](.github/workflows/deploy.yml) die App und veröffentlicht sie unter **https://kubana90.github.io/outdoorwild-navigator/**.
Voraussetzung: Das Repo ist öffentlich, und unter Settings → Pages steht Source auf „GitHub Actions“.

## Alternative: Cloudflare Pages (Repo bleibt privat)

Dann läuft die App unter **https://outdoorwild-navigator.pages.dev**. Cloudflare baut jeden Push auf `main` automatisch, das Repo bleibt dabei privat.

Einstellungen im Cloudflare-Projekt:

| Einstellung | Wert |
| --- | --- |
| Framework preset | Vite (oder None) |
| Build command | `npm test && npm run build` |
| Build output directory | `dist` |
| Node-Version | über `.nvmrc` (22) |

## So funktioniert es

| Teil | Datei | Was es tut |
| --- | --- | --- |
| Wildnis-Profil | `src/lib/profile.ts` | erzeugt ein BRouter-Profil aus Aktivität, Wildnis-Regler (0–100), Schwierigkeit und 2-Meter-Regel |
| Routing | `src/lib/brouter.ts` | lädt das Profil auf den BRouter-Server und holt Routen (mit Wiederholung, wenn der Server bremst) |
| Start/Ziel-Eingabe | `src/components/PointInput.tsx` | Ortssuche (Nominatim), eigener Standort, Karte antippen mit Rückwärtssuche des Namens; „Zum Ziel navigieren“ plant ab dem aktuellen Standort und startet die Führung sofort |
| Routensuche | `src/lib/planner.ts` | A→B mit bis zu 4 Varianten, Rundtouren in 3 Richtungen, sortiert nach Wildnis-Score |
| Analyse | `src/lib/analysis.ts` | Wildnis-Score, Wegearten, Untergrund, Anstiege, Zeit, Schwierigkeit, Beschreibungstext |
| Navigation | `src/lib/nav.ts`, `src/components/NavigationView.tsx` | Fortschritt, Abbiegehinweise mit Wegeart, Weg-verlassen-Erkennung, automatischer Rückweg zum Pfad (nach 8 s abseits), Pfad-Kompass, Anstiegs-Vorschau, Tageslicht, GPS-Ausfall-Warnung, Track-Aufzeichnung als GPX |
| Offline | `src/lib/offline.ts`, `public/sw.js` | gemerkte Touren, Karten entlang der Route vorladen, Kachel-Cache |
| Region | `src/lib/region.ts` | Neckar-Odenwald-Kreis: Kartenausschnitt, Startorte, Suchbereich |

**Eigener Routing-Server:** Statt des öffentlichen `brouter.de` kann ein eigener BRouter (z. B. in Docker) genutzt werden:
`VITE_BROUTER_URL=http://localhost:17777/brouter npm run dev`

## Daten und Rechtliches

- Wege: © OpenStreetMap-Mitwirkende (ODbL)
- Karte: OpenTopoMap (CC-BY-SA)
- Overlays: waymarkedtrails.org
- Routing: BRouter
- Ortssuche: Nominatim

**2-Meter-Regel:** In Baden-Württemberg dürfen Radfahrer im Wald nur Wege über 2 m Breite befahren (LWaldG § 37). OSM erfasst die Wegbreite selten. Deshalb meidet die App für Räder schmale Pfade ohne ausdrückliche Radfreigabe und weist auf verbleibende Stücke hin.

Die App ersetzt keinen Notruf (112).

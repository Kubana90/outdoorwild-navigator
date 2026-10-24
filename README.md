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

## Native App (Android / iPhone)

Die App gibt es zusätzlich als echte Smartphone-App (Capacitor). Gegenüber der Web-App:
GPS läuft als Hintergrunddienst weiter, wenn der Bildschirm aus ist; Berechtigungen kommen als
System-Dialoge direkt bei der Einrichtung; Spracheingabe nutzt die Spracherkennung des Handys.

**Android-APK bauen** (Android Studio mit SDK ist nötig):

```bash
npm run build:app
```

Danach in `android/` mit dem JDK von Android Studio: `gradlew.bat assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.
Installieren per USB: `adb install -r app-debug.apk`, oder die Datei aufs Handy schicken und öffnen
(„Installation aus unbekannten Quellen“ einmal erlauben). Für den Play Store wird ein signiertes
Release-Bundle gebraucht (`gradlew bundleRelease` mit eigenem Schlüssel) und ein Entwicklerkonto (25 $ einmalig).

**iPhone** (nur auf einem Mac mit Xcode und Apple-Entwicklerkonto, 99 $/Jahr):

```bash
npm run build:app
npx cap open ios
```

In Xcode das eigene Team unter *Signing & Capabilities* wählen, dann auf ein iPhone oder an TestFlight/App Store.
Berechtigungstexte und Hintergrund-Standort sind in `ios/App/App/Info.plist` schon eingetragen.

Ohne eigenen Mac prüft [ios.yml](.github/workflows/ios.yml) bei jedem Push auf einem Mac von GitHub, dass die
iPhone-App fehlerfrei baut (Simulator, unsigniert). Spracheingabe nutzt auf dem iPhone die Spracherkennung der
WebView, weil das Speech-Plugin für Capacitor 8 kein Swift-Paket hat.

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
| Notfall | `src/lib/emergency.ts`, `src/components/EmergencySheet.tsx` | SOS-Knopf: 112 anrufen, Koordinaten für die Leitstelle, nächster Rettungspunkt (OSM `highway=emergency_access_point` über Overpass, 7 Tage zwischengespeichert), Standort an Kontakt teilen |
| Wetter & Boden | `src/lib/weather.ts`, `src/components/WeatherPanel.tsx` | Matsch-Index aus Bodenfeuchte, Regen der letzten 48 h und Naturboden-Anteil; bestes Zeitfenster heute; Warnung bei Gewitter, Böen, Frost (Open-Meteo) |
| Umkehr-Check | `src/lib/nav.ts` (`turnaroundCheck`) | Live beim Navigieren: Weiter vs. Umkehren mit Ankunftszeiten, spätester Umkehrzeitpunkt vor Dunkelheit, Ansage wenn nur Umkehren noch vor Dunkelheit reicht |
| Natur-Highlights | `src/lib/poi.ts` | Aussichtspunkte, Gipfel, Quellen, Höhlen, Felsen, Schutzhütten, Burgen, Ruinen aus OSM; auf der Route verortet mit km-Stand und Seite; Ansage 300 m vorher |
| Zeitbudget | `src/lib/analysis.ts` (`lengthForMinutes`) | „Ich habe 2 h“ → passende Rundenlänge aus Tempo und typischer Hügeligkeit (18 Hm/km) |
| Sprachbefehl | `src/lib/voice.ts` | Mikrofon-Knopf an Start und Ziel: „Navigiere zum Katzenbuckel“ → Ortssuche, bester Treffer wird übernommen |
| Overpass | `src/lib/overpass.ts`, `src/lib/region.ts` (`queryBbox`) | ein Zugriffspunkt mit Ersatz-Server; für Routen in der Heimatregion wird die ganze Region einmal geladen und 7 Tage gespeichert |
| Einrichtung | `src/lib/permissions.ts`, `src/components/Onboarding.tsx` | Beim ersten Start: ein Knopf fragt Kompass (iOS), Standort, Mikrofon und dauerhaften Speicher nacheinander ab; zeigt den Zustand und bei Ablehnung, wo man es einschaltet. Später über „⚙ Berechtigungen prüfen“ |
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

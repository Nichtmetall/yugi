# Kartenbinder

Yu-Gi-Oh!-Sammlung und Decks verwalten, Karten per Handykamera erfassen. Läuft als Web-App (PWA) im Browser, ohne Backend.

- **Sammlung**: Karten mit Druck (Set-Code, Seltenheit) und Anzahl, Cardmarket-Wert
- **Decks**: Main/Extra/Side, Banlisten- und Größenprüfung, Abgleich mit der Sammlung (was fehlt, was kostet es), YDK-Import/-Export
- **Scannen**: Karte in den Rahmen halten, Texterkennung liest Name, Set-Code und Passcode und gleicht sie mit der lokalen Datenbank ab. Im Auto-Modus werden sichere Treffer direkt übernommen.
- **Detailansicht**: 3D-Karte zum Drehen (Ziehen, Doppeltippen, Pfeiltasten oder Bewegungssensor) mit Holo-Schimmer je nach Seltenheit

Kartendaten, Bilder und Preise stammen aus der öffentlichen API von [YGOPRODeck](https://ygoprodeck.com/api-guide/). Die komplette Datenbank (ca. 14.600 Karten, optional mit deutschen Texten) wird einmalig in IndexedDB geladen. Suche und Scan-Abgleich laufen danach lokal.

## Starten

```powershell
npm install
npm run dev
```

Vite zeigt eine `Network`-Adresse wie `https://192.168.x.x:5173`. Diese auf dem Handy im selben WLAN öffnen und die Zertifikatswarnung bestätigen (selbstsigniert). HTTPS ist nötig, weil Browser die Kamera sonst nicht freigeben.

Für den Dauerbetrieb: `npm run build` und den Ordner `dist/` auf einen beliebigen statischen HTTPS-Host legen (GitHub Pages, Netlify, Cloudflare Pages, eigener Webserver). Auf dem Handy dann „Zum Startbildschirm hinzufügen“.

## Eigene Kartenrückseite

Unter Einstellungen → Kartenrückseite ein Bild wählen oder die Rückseite einer eigenen Karte fotografieren. Das Bild wird im Browser gespeichert und in der 3D-Ansicht als Rückseite gezeigt.

Alternativ für alle Geräte: eine Datei `card-back.jpg` (oder `.png`, `.webp`) in `public/` legen. Ein in der App gewähltes Bild hat Vorrang. Ohne beides gibt es die eingebaute Rückseite. Am besten passt das Kartenformat 59 × 86 (z. B. 421 × 614 px).

## Daten

Sammlung und Decks liegen im `localStorage` des jeweiligen Browsers. Unter Einstellungen gibt es Backup-Export und -Import als JSON.

## Entwicklung

```powershell
npm run typecheck   # TypeScript
npm test            # Unit-Tests für OCR-Abgleich und YDK
npm run build
```

Aufbau:

- `src/api/ygoprodeck.ts`: API-Zugriff und Reduktion der Kartendaten
- `src/db/cardDb.ts`: lokale Datenbank, Indizes (ID, Set-Code, Namen) und Suche
- `src/scan/`: Bildausschnitte und Tesseract (`ocr.ts`), Abgleich (`match.ts`, `recognize.ts`)
- `src/components/Card3D.tsx` und `.card3d-*` in `src/styles.css`: 3D-Karte und Holo-Effekt
- `public/sw.js`: Offline-Cache für App und (sofern CORS erlaubt) Kartenbilder

## Hinweise

- Yu-Gi-Oh! ist eine Marke von Konami. Privates Fanprojekt, nicht offiziell.
- Die Erkennung arbeitet über den Kartennamen und, falls lesbar, Set-Code und Passcode. Deutsche Karten werden am Namen nur erkannt, wenn beim Laden die deutschen Texte aktiviert waren.

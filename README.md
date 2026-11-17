# Speedtest

Kleine Speedtest-Web-App (PWA) mit Tacho: misst Ping, Jitter, Download und Upload.

- Vanilla JS (ES-Module), SVG-Tacho, kein Build-Schritt, keine Abhängigkeiten
- Installierbar als App (Manifest + Service Worker)

## Starten

```sh
node server/server.mjs      # oder: npm start
```

Dann http://localhost:8080 öffnen.

## Wohin gehen die Daten?

Die App spricht jeden Server an, der diese zwei Endpunkte hat:

| Endpunkt | Zweck |
|---|---|
| `GET /__down?bytes=N` | liefert N Bytes (Download, mit `bytes=0` auch Ping) |
| `POST /__up` | nimmt Daten an und verwirft sie (Upload) |
| `GET /meta` | optional: Anbieter und Standort für die Anzeige |

Wählbar über ⚙︎:

- **Cloudflare (speed.cloudflare.com)**: ohne Registrierung, nahes Rechenzentrum. Inoffiziell, Cloudflare kann das jederzeit ändern. Nur zum Testen gedacht.
- **Dieser Server**: `server/server.mjs` aus diesem Repo. Im Heimnetz misst das nur das WLAN/LAN, nicht das Internet. Erst auf einem Server im Internet (VPS) misst es die Internetleitung.
- **Eigene Adresse**: jeder andere Server mit derselben Schnittstelle, z. B. später ein eigener Cloudflare Worker.

Für den Download muss der Server CORS erlauben (`Access-Control-Allow-Origin: *`), Ping und Upload funktionieren auch ohne.

## Messverfahren

- **Ping/Jitter:** 10 Mini-Anfragen nach einer Aufwärm-Anfrage. Ping = Median, Jitter = mittlere Abweichung aufeinanderfolgender Werte.
- **Download/Upload:** 4 parallele Verbindungen. Der Upload wird mit Fortschritt gezählt (XHR); erlaubt der Server das nicht (CORS-Preflight), misst die App automatisch gröber pro abgeschlossener Anfrage weiter. Die Paketgröße startet klein und verdoppelt sich, solange eine Anfrage kürzer als 300 ms dauert.
- **Abbruch je Richtung**, je nachdem, was zuerst eintritt: 6 Sekunden, Datenlimit erreicht, oder der Wert ist 1,5 s lang stabil (±7 %).
- **Ergebnis:** Durchschnitt nach der Anlaufphase (0,7 s). Der Tacho zeigt live den Schnitt der letzten Sekunde.
- **Datenlimit** (⚙︎): Klein ca. 10 MB, Normal ca. 35 MB, Genau ca. 150 MB insgesamt. Ist das Limit schon in der Anlaufphase aufgebraucht (Gigabit), wächst es bei „Normal“ bis aufs 4-Fache, bei „Genau“ aufs 2-Fache. „Klein“ bleibt immer klein.

## Logo-Entwürfe

In `logos/` liegen drei Entwürfe (A Tacho, B Pfeile, C Stoppuhr). Gewählt: **A Tacho** – ist das App-Icon (`icons/`).

## Bedienung

- Die Seite scrollt nie und passt sich der Bildschirmhöhe an (quer: Tacho links, Werte rechts).
- Einstellungen (⚙︎) schließen bei einem Tipp daneben, mit erneutem Tipp auf ⚙︎ oder mit Esc.
- **Aktualisieren:** im oberen Viertel des Bildschirms nach unten wischen.

## Verbindungsart

Neben dem Titel steht WLAN / Mobile Daten / LAN, wenn der Browser es verrät (`navigator.connection.type`). Das kann nur Chrome auf Android; iPhone (alle Browser), Firefox und Desktop-Browser geben die Art nicht preis – dann wird nichts angezeigt. „Offline“ wird überall erkannt.

## Weitere Funktionen

- **GO-Knopf** in der Tacho-Mitte; beim Start schlägt die Nadel einmal voll aus. Bei Tempo zittert sie leicht, ab 500 Mbit/s roter Bereich. Am Ende vibriert das Handy (nur Android).
- **Live-Kurve** unter dem Tacho: Verlauf von Download und Upload während der Messung (je eigene Skala – zeigt, ob die Leitung schwankt).
- **Anbieter und Serverstandort** in der Fußzeile (z. B. „Telekom · Server Frankfurt“), sofern der Server sie liefert.
- **Verlauf** (Uhr-Symbol): einzelne Einträge per Papierkorb löschbar (mit „Rückgängig“), alle Messungen mit Verbindungsart, Anbieter und Ort, Durchschnitt, Filter WLAN/Mobil, Diagramm der letzten 30 Messungen und eine **Karte der Messorte**. Gespeichert nur lokal im Browser.
- **Standort** (⚙︎ → „Standort im Verlauf“): *Genau* per GPS (Browser fragt einmal), *Ungefähr* über die IP-Adresse (aus Cloudflares `/meta`) oder *Aus*. Ohne GPS-Erlaubnis wird automatisch der IP-Standort genommen. Ortsnamen zu GPS-Koordinaten liefert OpenStreetMap Nominatim; dafür gehen die Koordinaten einer Messung einmal an nominatim.openstreetmap.org.
- **Karte:** Leaflet (in `vendor/leaflet`, BSD-2-Lizenz) mit Kacheln von OpenStreetMap. Messungen am selben Ort (~100 m) werden zusammengefasst; die Zahl ist der Ø-Download, die Farbe die Verbindungsart, gestrichelt = nur ungefährer Standort.

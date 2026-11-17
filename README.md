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

Wählbar über ⚙︎:

- **Cloudflare (speed.cloudflare.com)**: ohne Registrierung, nahes Rechenzentrum. Inoffiziell, Cloudflare kann das jederzeit ändern. Nur zum Testen gedacht.
- **Dieser Server**: `server/server.mjs` aus diesem Repo. Im Heimnetz misst das nur das WLAN/LAN, nicht das Internet. Erst auf einem Server im Internet (VPS) misst es die Internetleitung.
- **Eigene Adresse**: jeder andere Server mit derselben Schnittstelle, z. B. später ein eigener Cloudflare Worker.

Für den Download muss der Server CORS erlauben (`Access-Control-Allow-Origin: *`), Ping und Upload funktionieren auch ohne.

## Messverfahren

- **Ping/Jitter:** 10 Mini-Anfragen nach einer Aufwärm-Anfrage. Ping = Median, Jitter = mittlere Abweichung aufeinanderfolgender Werte.
- **Download/Upload:** 4 parallele Verbindungen. Die Paketgröße startet klein und verdoppelt sich, solange eine Anfrage kürzer als 300 ms dauert.
- **Abbruch je Richtung**, je nachdem, was zuerst eintritt: 6 Sekunden, Datenlimit erreicht, oder der Wert ist 1,5 s lang stabil (±7 %).
- **Ergebnis:** Durchschnitt nach der Anlaufphase (0,7 s). Der Tacho zeigt live den Schnitt der letzten Sekunde.
- **Datenlimit** (⚙︎): Klein ca. 10 MB, Normal ca. 35 MB, Genau ca. 150 MB insgesamt. Bei sehr schnellen Leitungen (Gigabit) misst „Klein“/„Normal“ zu niedrig, weil das Limit vor dem vollen Tempo erreicht ist.

## Logo-Entwürfe

In `logos/` liegen drei Entwürfe (A Tacho, B Pfeile, C Stoppuhr). Gewählt: **A Tacho** – ist das App-Icon (`icons/`).

## Bedienung

- Die Seite scrollt nie und passt sich der Bildschirmhöhe an (quer: Tacho links, Werte rechts).
- Einstellungen (⚙︎) schließen bei einem Tipp daneben, mit erneutem Tipp auf ⚙︎ oder mit Esc.
- **Aktualisieren:** im oberen Viertel des Bildschirms nach unten wischen.

## Verbindungsart

Neben dem Titel steht WLAN / Mobile Daten / LAN, wenn der Browser es verrät (`navigator.connection.type`). Das kann nur Chrome auf Android; iPhone (alle Browser), Firefox und Desktop-Browser geben die Art nicht preis – dann wird nichts angezeigt. „Offline“ wird überall erkannt.

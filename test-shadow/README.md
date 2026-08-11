# Vergleich: Gruppenmarkierungen mit Sigma.js

`index.html` enthält vierzehn Darstellungsarten in einem Dropdown. Es wird jeweils nur die ausgewählte Variante gerendert, damit stets nur ein WebGL-Kontext aktiv ist:

1. Geglättete Convex Hull
2. Metaballs / Bubble Set
3. Abgerundete Gruppenfläche
4. Concave Hull (über eine geordnete Gruppen-Grenze, ohne Zusatzbibliothek)
5. Nur Umriss
6. Abgerundete Bounding Box
7. Ellipse
8. Kapsel entlang eines Pfads
9. Kantenbasierte Einfassung
10. Dichtekarte / Heatmap
11. Voronoi-Zellen
12. Klammer mit Label
13. Halo + Dimmen
14. Eingeklappter Cluster-Node

Alle Varianten verwenden Graphology für die Node-Positionen und Sigma.js für die Umrechnung in Viewport-Koordinaten. Die zentrale Zeile ist in `app.js` kommentiert:

```js
return sigma.graphToViewport({ x, y });
```

Zum lokalen Starten im Ordner:

```sh
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Die Bibliotheken werden per CDN geladen.

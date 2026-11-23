# Flâne

Web app (PWA) de navigation : elle affiche d'abord le trajet le plus court, puis tu choisis combien de
temps tu veux mettre. Plus tu rallonges, plus elle te fait passer par de beaux endroits (parcs, berges,
ponts, monuments, points de vue, rues piétonnes) tout en t'amenant à destination. À pied ou à vélo.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5280
npm test           # tests unitaires
npm run build      # version de production dans dist/
python3 tools/make_icons.py   # régénère les icônes
npm run deploy     # tests + construction + mise en ligne (branche gh-pages)
```

En ligne : https://neutreph.github.io/flane/

Test « en vrai » sur le réseau (Maastricht) : `LIVE=1 npx vitest run tests/pipeline.live.test.ts`.

Sur ordinateur, sans GPS, le départ de démo est la gare de Maastricht. Le GPS du téléphone exige
HTTPS : pour essayer dehors, il faut la mettre en ligne (GitHub Pages par exemple).

## Comment ça marche

1. **Trajet le plus court** : Valhalla (serveur FOSSGIS), instructions en français.
2. **Repérage des spots** dans l'ellipse des détours possibles (`src/data/spots.ts`) :
   - tuiles vectorielles OpenFreeMap décodées dans le navigateur : points de vue, monuments, églises,
     parcs (avec leur surface), berges (chemins qui longent l'eau), ponts, places et rues piétonnes
     (bonus selon le nombre de cafés et boutiques autour) ;
   - Wikipédia (fr, en et langue locale) : bonus de notoriété, et lieux remarquables manquants ;
   - Wikimedia Commons : nombre de photos prises autour des 12 meilleurs candidats (signal de beauté).
3. **Matrice des temps** entre ~30 candidats : OSRM (repli Valhalla, puis estimation).
4. **Choix des étapes** (`src/engine/orienteering.ts`) : problème de course d'orientation résolu par
   GRASP + 2-opt + échanges, avec rendements décroissants (pas trois églises d'affilée). Chaque durée
   part de la solution de la durée précédente : en glissant la règle, la balade grandit au lieu de sauter.
5. **Itinéraire réel** par Valhalla (8 étapes au plus) ; si la durée réelle s'écarte de la demande,
   la matrice est recalée et le calcul relancé.
6. **Navigation** (`src/engine/navigation.ts`) : position sur le tracé, prochaine instruction, temps
   restant, sortie de route (recalcul), spots « tamponnés » au passage, voix optionnelle.

## Limites connues

- Serveurs gratuits FOSSGIS (Valhalla, OSRM) : parfaits pour un usage perso, pas pour un lancement
  public à grande échelle (il faudra alors un serveur d'itinéraires à nous).
- Wikimedia limite à 200 requêtes/min par navigateur : tout est mis en cache (localStorage).
- Overpass (base de lieux OSM) était hors service pendant le développement : on ne s'en sert pas.
- Pas de suivi écran éteint (limite des web apps) : l'écran reste allumé pendant la navigation.

Données : © contributeurs OpenStreetMap, OpenMapTiles, OpenFreeMap, Wikipédia (CC BY-SA).

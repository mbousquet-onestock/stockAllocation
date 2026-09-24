# Stock allocation

Application de segmentation de stock : rechercher un article ou un groupe d'articles (catégorie) et répartir son stock
entre segments de vente (Brand site, Marketplace, Social…) par entrepôt, avec seuils d'alerte et période d'activation.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de production
```

## Écrans

- **Liste des articles** (`/`) : recherche (nom, SKU, catégorie), tri, pagination, filtres « Below threshold » par segment,
  sélection multiple, import de fichier.
- **Détail article** (`/items/:id`) : totaux par segment, répartition par entrepôt, période d'activation.
  Un clic sur une ligne ouvre **Edit segmentation** (quantités, seuils, période ; le non alloué est recalculé et le
  dépassement du stock est bloqué).
- **Add item segmentation** : applique une règle en masse
  1. cible : articles choisis (ou sélectionnés dans la liste) **ou** catégories entières,
  2. entrepôts concernés,
  3. règle en **pourcentage** du stock (ex. 50 % / 20 % / 30 %) ou en **quantité fixe** par entrepôt (plafonnée au stock
     disponible, dans l'ordre des segments), seuils d'alerte optionnels,
  4. période d'activation.
- **File import** : CSV `sku;location_code;brand_site;brand_site_threshold;…;start_date;end_date` (modèle téléchargeable).
- **Cloche** : liste des articles sous seuil.

## Architecture

```
src/
  api/types.ts         Contrat StockAllocationApi (à implémenter côté HTTP)
  api/mockApi.ts       Implémentation mockée (données en mémoire + localStorage)
  api/index.ts         Point unique où brancher la vraie API
  config/segments.ts   Liste des segments (sera fournie par l'API)
  utils/allocation.ts  Règles métier : non alloué, alertes, calcul d'une règle
  pages/               Liste & détail
  features/            Modales (édition, règle en masse, import)
```

Pour brancher le backend : écrire un `httpApi` implémentant `StockAllocationApi` et l'exporter dans `src/api/index.ts`.
Le bouton « Reset demo data » restaure les données de démo (mock uniquement).

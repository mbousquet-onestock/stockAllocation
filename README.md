# Stock allocation

Application de segmentation de stock : rechercher un article ou un groupe d'articles (catégorie) et répartir son stock
entre segments de vente (Brand site, Marketplace, Social…) par entrepôt, avec seuils d'alerte et période d'activation.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de production
```

## Principe

Des **règles de segmentation** sont définies sur des caractéristiques de la fiche article (SKU, catégorie, marque,
saison…). Lors de l'**import du stock** d'un article, pour chaque entrepôt, la première règle active (par priorité) dont
tous les critères correspondent calcule la répartition, en **pourcentage** du stock ou en **quantité fixe** par entrepôt.
Sans règle correspondante, tout le stock reste non alloué.

- Critères : ET entre caractéristiques, OU entre les valeurs d'une même caractéristique
  (ex. `Catégorie ∈ {Irons} ET Marque ∈ {Calor}`).
- Pourcentages arrondis à l'inférieur, le reste est non alloué ; quantités fixes plafonnées au stock, dans l'ordre des segments.

## Écrans

- **Segmentation rules** (`/`, écran principal) : recherche des règles par caractéristique (sélecteur + texte).
  Une recherche par SKU liste toutes les règles qui s'appliquent à l'article (y compris via sa catégorie, sa marque…)
  et indique la règle effective. Tableau : priorité (réordonnable), critères, entrepôts, répartition, période, nombre
  d'articles concernés (lien vers leur allocation), activation, duplication, suppression.
  Actions : **New segmentation rule**, **Stock import** (CSV `sku;location_code;quantity`, applique les règles),
  **Apply rules** (re-segmente le stock actuel).
- **Item allocation** (`/items`) : recherche d'un article et visualisation de son allocation (écran existant), filtre
  par règle, création d'une règle pour les articles sélectionnés.
- **Détail article** (`/items/:id`) : allocation par entrepôt, source (règle / manuel / aucune), règle qui sera appliquée
  au prochain import ; clic sur une ligne = modification manuelle (**Edit segmentation**) ; import CSV de segmentation.

## Architecture

```
src/
  api/types.ts         Contrat StockAllocationApi (à implémenter côté HTTP)
  api/mockApi.ts       Implémentation mockée (données en mémoire + localStorage)
  api/index.ts         Point unique où brancher la vraie API
  config/segments.ts   Liste des segments (sera fournie par l'API)
  utils/allocation.ts  Règles métier : non alloué, alertes, calcul d'une règle
  config/attributes.ts Caractéristiques article utilisables dans les critères
  utils/rules.ts       Correspondance article ↔ critères, règle effective
  pages/               Règles, liste des articles, détail
  features/            Éditeur de règle, édition manuelle, imports
```

Pour brancher le backend : écrire un `httpApi` implémentant `StockAllocationApi` et l'exporter dans `src/api/index.ts`.
Le bouton « Reset demo data » restaure les données de démo (mock uniquement).

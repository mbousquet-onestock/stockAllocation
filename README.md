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

- **Types de stock** (onglet *Settings*) : types principaux (ex. `on_hand`, `container`, `planned`) divisés en groupes
  (ex. `on_hand_A`, `on_hand_B`). Chaque type et chaque groupe est un **segment**. Un type principal peut être marqué
  « stock futur » (container, planned…) : son stock peut porter un **purchase order**.
- Un stock est toujours **mis à jour sur un type de stock** (import `sku;location_code;stock_type;quantity;purchase_order`,
  `stock_type` vide ou absent = `on_hand`, le type par défaut).
  La première règle active (par priorité) correspondant à l'article, au type, à l'entrepôt et au purchase order répartit
  alors la quantité **en pourcentage** sur les groupes du type ; le reste (et l'arrondi) reste sur le type principal.
  Sans règle, tout reste sur le type principal.
- Une règle cible un ou plusieurs types de stock principaux, **tous par défaut** (y compris ceux ajoutés plus tard) ;
  la répartition en % est saisie pour les groupes de chaque type ciblé (copiable d'un type à l'autre par suffixe de groupe).
- Critères des règles : ET entre caractéristiques (SKU, catégorie, marque, saison), OU entre les valeurs d'une même
  caractéristique. Restriction par purchase order uniquement si la règle cible **un seul type de stock futur**.

## Écrans

- **Segmentation rules** (`/`) : recherche des règles par caractéristique, type de stock ou purchase order. Une recherche
  par SKU liste toutes les règles qui s'appliquent à l'article et met en évidence celles utilisées par son stock.
  Tableau : priorité (réordonnable), critères, type de stock + purchase orders, entrepôts, répartition en %, période,
  articles concernés, activation, duplication, suppression. Actions : nouvelle règle, **Stock import**, **Apply rules**.
- **Item allocation** (`/items`) : articles avec du stock en premier (ordre par défaut), recherche avec complétion (nom, SKU), stock de chaque article par segment (colonnes groupées par type principal), alertes
  de seuil, filtre par règle.
- **Détail article** (`/items/:id`) : totaux par type de stock, lignes de stock (entrepôt × type × purchase order) avec
  la répartition sur les groupes, la source (règle / manuel / aucune) et la règle du prochain import ; clic sur une
  ligne = modification manuelle.
- **Settings** (`/settings`) → *Stock types* : création, modification, ordre et suppression des types et de leurs groupes.
- **Settings** → *OneStock API* : URL, site_id, token, langue par défaut ; tests de chargement des catégories, des stock locations, des articles et du stock.
- **Settings** → *Database* : stockage des règles de segmentation (navigateur ou base Vercel), URL de l'API, clé API,
  test de connexion, initialisation de la base, copie des règles locales vers la base.

## Base de données Vercel (règles de segmentation)

Les règles peuvent être stockées dans une base **Postgres (Neon) sur Vercel**, via les fonctions serverless de `api/` :

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/health` | État de la connexion (base, table, nombre de règles) |
| POST | `/api/setup` | Création de la table `segmentation_rules` (idempotent) |
| GET / POST | `/api/rules` | Liste (par priorité) / création |
| PUT | `/api/rules` | `{ order: [ids] }` ordre des priorités, ou `{ rules: [...] }` remplacement complet |
| GET / PUT / DELETE | `/api/rules/:id` | Lecture / modification / suppression |

Mise en place :
1. Projet Vercel → *Storage* → *Create Database* → *Neon (Postgres)* → connecter au projet (ajoute `DATABASE_URL`).
2. Optionnel : variable d'environnement `API_KEY` (secret exigé dans l'en-tête `x-api-key`).
3. Redéployer, puis dans l'application *Settings → Database* : « Vercel database », API URL `/api`, clé API,
   *Test connection* → *Initialize database* → (option) *Copy local rules to the database* → *Save*.

Les identifiants de la base restent côté serveur (variables d'environnement Vercel) ; le navigateur ne connaît que l'URL
de l'API et la clé API. En local, mettre `DATABASE_URL` et `API_KEY` dans `.env.local` (voir `.env.example`) :
`npm run dev` exécute les mêmes fonctions.

## API OneStock (catégories, stock locations, articles, stock)

*Settings → OneStock API* : `{{url}}`, `{{site_id}}`, `{{token}}`, langue par défaut des libellés, méthode HTTP (GET par
défaut). Quand l'API est configurée, les valeurs du critère **Category** de l'éditeur de règle viennent de
`{{url}}/categories` (corps `{ "site_id", "token" }`).

- Les **stock locations** des règles (choix des points de stock) viennent de `{{url}}/endpoints` :
  `{ endpoints: [{ id, name, address: { city, regions: { country: { code } } } }] }` → id stocké dans la règle, nom affiché.
- Les **articles** viennent de `{{url}}/v3/items` :
  - index des ids (`{ pagination: { limit: 25, start } }`, repli sur `search_after` si `start` n'est pas pris en compte),
    chargé une fois (jusqu'à 5 000 articles, cache 10 min) pour la **complétion** de la recherche et les critères SKU ;
  - détail par lot (`{ item_ids: [...] }`) : `features.<langue>` (langue par défaut, sinon la première) → nom, image,
    désignation, description et toutes les caractéristiques affichées dans le détail article.
  - L'import de stock accepte alors tout SKU OneStock (id d'article) et les ids d'endpoints comme `location_code`.
- Le **stock** des articles vient de `{{url}}/stock_export` (`{ request_name: {{stock_request}}, item_filter: { ids } }`,
  par lots de 50, cache 2 min) : chaque enregistrement `{ item_id, endpoint_id, quantity, type, purchase_order_number,
  eta_start, eta_end }` est rattaché au type de stock de *Settings → Stock types* dont le code est `type` (sans tenir
  compte de la casse). Le stock OneStock est déjà segmenté : un enregistrement sur un groupe (`Container_A`) est la
  quantité du groupe, un enregistrement sur le type principal (`Container`) ce qui reste dessus. Les lignes affichées
  (article × endpoint × type principal × purchase order) sont en lecture seule ; les seuils viennent de la règle qui
  s'appliquerait. Les types non configurés sont signalés et ignorés. Un enregistrement **sans type** (ou type vide) est
  affecté à `on_hand`, le type de stock par défaut, et renvoyé sans type au `stock_import`.
  Les quantités affichées (liste et détail) viennent toujours d'appels filtrés par `item_filter.ids`. Pour mettre les
  articles avec du stock en premier : jusqu'à 250 articles (ex. après une recherche), totaux exacts par ces mêmes appels ;
  au-delà, un appel `stock_export` sans `item_filter` (tout l'export, cache 2 min) sert uniquement à l'ordre, corrigé par
  le stock déjà lu article par article. *Refresh stock* (liste) relit OneStock. Les pastilles « Below threshold »,
  calculées sur le stock local, sont masquées quand le stock vient de OneStock.
- Les **modifications de stock** sont renvoyées avec `PATCH {{url}}/stock_import`
  (`{ import: { incremental: false }, stocks: [{ item_id, endpoint_id, quantity, type, purchase_order_number, eta_start,
  eta_end }] }`, toujours non incrémental : quantités absolues), par lots de 500 enregistrements :
  - modification manuelle d'une ligne OneStock dans le détail article ;
  - **Apply rules → OneStock** (détail article, articles sélectionnés, ou bouton *Apply rules* de la page des règles pour
    tous les articles en stock) : aperçu avant / après des lignes que les règles re-segmentent, puis envoi.
  - Chaque ligne envoie le type principal (quantité − répartition) et chacun de ses groupes. Le code du type est repris
    tel que lu au GET (`Container`, `Container_B`…), et pour le stock futur le `purchase_order_number` et les
    `eta_start` / `eta_end` lus au GET sont renvoyés ; une ligne future sans ETA connue n'est pas envoyée.
- L'appel passe par le proxy `POST /api/onestock` (fonction Vercel) : le navigateur ne peut pas appeler l'API OneStock
  directement (CORS). Le proxy n'autorise que les chemins listés (`/categories`, `/endpoints`, `/v3/items`, `/stock_export`, `/stock_import` — PATCH uniquement sur ce dernier,
  5 000 enregistrements maximum par appel), ne relaie que `pagination`, `item_ids`, `request_name`, `item_filter`,
  `import` et `stocks` en plus de
  `site_id` / `token`, et impose https.
- La réponse est un arbre `{ category: { sub_category: [{ id, display_info: { <langue>: { name } }, sub_category? }] } }` :
  chaque nœud devient une catégorie (libellé « Parent › Enfant » pour les niveaux inférieurs), nommée dans la langue par
  défaut, sinon dans la première langue disponible, sinon par son id. Les règles stockent l'**id** de la catégorie.
- Le proxy utilise l'URL et la clé API de *Settings → Database*.

## Architecture

```
api/                   Fonctions serverless Vercel (règles de segmentation en base Postgres)
src/
  api/types.ts         Contrat StockAllocationApi (à implémenter côté HTTP)
  api/remoteRules.ts   Client HTTP des fonctions /api ; api/dbConfig.ts : paramètres Settings → Database
  api/onestock.ts      Paramètres Settings → OneStock API, appel via le proxy, lecture des catégories, endpoints, articles et stock ; utils/onestockStock.ts : stock_export → lignes de stock
  api/mockApi.ts       Implémentation mockée (données en mémoire + localStorage)
  api/index.ts         Point unique où brancher la vraie API
  utils/stockTypes.ts  Hiérarchie des types de stock (types principaux → groupes)
  utils/allocation.ts  Répartition d'une ligne de stock, alertes, totaux par segment
  config/attributes.ts Caractéristiques article utilisables dans les critères
  utils/rules.ts       Correspondance article ↔ critères, règle effective
  pages/               Règles, liste des articles, détail, paramétrage
  features/            Éditeur de règle, édition manuelle, imports
```

Pour brancher le backend : écrire un `httpApi` implémentant `StockAllocationApi` et l'exporter dans `src/api/index.ts`.
Le bouton « Reset demo data » restaure les données de démo (mock uniquement).

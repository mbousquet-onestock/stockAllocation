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
- Un stock est toujours **mis à jour sur un type de stock** (import `sku;location_code;stock_type;quantity;purchase_order`).
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
- **Item allocation** (`/items`) : stock de chaque article par segment (colonnes groupées par type principal), alertes
  de seuil, filtre par règle.
- **Détail article** (`/items/:id`) : totaux par type de stock, lignes de stock (entrepôt × type × purchase order) avec
  la répartition sur les groupes, la source (règle / manuel / aucune) et la règle du prochain import ; clic sur une
  ligne = modification manuelle.
- **Settings** (`/settings`) → *Stock types* : création, modification, ordre et suppression des types et de leurs groupes.
- **Settings** → *OneStock API* : URL, site_id, token, langue par défaut ; test de chargement des catégories.
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

## API OneStock (catégories)

*Settings → OneStock API* : `{{url}}`, `{{site_id}}`, `{{token}}`, langue par défaut des libellés, méthode HTTP (GET par
défaut). Quand l'API est configurée, les valeurs du critère **Category** de l'éditeur de règle viennent de
`{{url}}/categories` (corps `{ "site_id", "token" }`).

- L'appel passe par le proxy `POST /api/onestock` (fonction Vercel) : le navigateur ne peut pas appeler l'API OneStock
  directement (CORS). Le proxy n'autorise que les chemins listés (`/categories`) et impose https.
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
  api/onestock.ts      Paramètres Settings → OneStock API, appel via le proxy, lecture de l'arbre des catégories
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

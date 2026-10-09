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
  alors la quantité **en pourcentage** sur les groupes du type ; le reste reste sur le type principal ; l'arrondi
  va toujours **à la hausse sur le segment au plus fort pourcentage**, qui peut être le type principal (segment par défaut :
  on_hand, container…). Ex. 25 à A 50 % / B 30 % → 13 / 7, 5 sur le type principal ; 25 à A 30 % / B 20 % → 7 / 5, 13 sur
  le type principal (50 %). À égalité, un groupe l'emporte.
  Sans règle, tout reste sur le type principal.
- Une règle cible un ou plusieurs types de stock principaux, **tous par défaut** (y compris ceux ajoutés plus tard) ;
  la répartition en % est saisie pour les groupes de chaque type ciblé (copiable d'un type à l'autre par suffixe de groupe).
- Critères des règles (facultatifs : sans critère, la règle vise tous les articles) : ET entre caractéristiques (SKU, catégorie, marque, saison), OU entre les valeurs d'une même
  caractéristique. Restriction par purchase order uniquement si la règle cible **un seul type de stock futur**.

## Écrans

- **Segmentation rules** (`/`) : recherche des règles par caractéristique, type de stock ou purchase order. Une recherche
  par SKU liste toutes les règles qui s'appliquent à l'article et met en évidence celles utilisées par son stock.
  Tableau : priorité (réordonnable par glisser-déposer ou flèches), critères, type de stock + purchase orders, entrepôts, répartition en %, période,
  articles concernés, activation, duplication, suppression. Actions : nouvelle règle, **Stock import**, **Apply rules**.
- **Item allocation** (`/items`) : articles avec du stock en premier (ordre par défaut), recherche avec complétion (nom, SKU), stock de chaque article par segment (colonnes groupées par type principal), alertes
  de seuil, filtre par règle.
  - Bloc **Alerts** en tête de liste : tuiles compteurs — *Total* (articles ayant au moins un segment sous son seuil) puis
    une tuile par segment (groupe) avec le nombre d'articles sous son seuil (seuils enregistrés ou seuils des règles).
    Un clic sur une tuile **filtre la liste des articles** (`?alert=all` ou id du groupe) ; un second clic retire le filtre.
    Les compteurs comptent les **stocks en alerte** (segment × emplacement × purchase order). Avec le stock OneStock, les articles vérifiés sont ceux ayant un seuil enregistré, et ceux ayant du stock et visés par une règle à seuils (1 000 max).
- **Détail article** (`/items/:id`) : totaux par type de stock, lignes de stock (entrepôt × type × purchase order) avec
  une colonne par groupe (A, B…), le non réparti et une barre de répartition en %, recherche et filtres sur les lignes (texte libre
  sur PO / point de stock / type, suggestions de PO avec quantité et ETA, de points de stock et « sans purchase order »,
  clic sur un PO d'une ligne), la source (règle / manuel / aucune) et la règle du prochain import ; clic sur une
  ligne = modification manuelle.
- **Settings** (`/settings`) → *Stock types* : éditeur de toute la configuration (codes, libellés, stock futur, ordre,
  ajout et suppression des types et de leurs groupes), enregistrée d'un coup par **Save for site …** pour le site ID
  (base Vercel), ou dans le navigateur sans base. *Cancel* annule les modifications. L'enregistrement est refusé si un
  type supprimé est utilisé par une règle ; un code invalide ou en double est signalé pendant la saisie.
- **Settings** → *OneStock API* : URL, site_id, token, langue par défaut ; tests de chargement des catégories, des stock locations, des articles et du stock.
- **Settings** → *API calls* : journal des appels API (OneStock via le proxy, base de données) avec date, méthode,
  chemin, statut, durée, résumé du résultat, requête et réponse (JSON, copiables) ; filtres par API, erreurs seules et
  recherche ; export JSON ; tokens et clés masqués. Avec la base Vercel (*Settings → Database*), l'historique est
  **stocké en base** (table `api_calls`, envoi par lots) et lu depuis la base (filtres côté serveur, « Load more ») ;
  **Clear purge la table**. Sans base, les 300 derniers appels sont gardés dans le navigateur.
- **Settings** → *Database* : stockage des règles de segmentation (navigateur ou base Vercel), URL de l'API, clé API,
  test de connexion, initialisation de la base, copie des règles locales vers la base.

## Paramètres partagés par site

Sans base de données, tous les paramètres sont propres à chaque navigateur. Avec la base Vercel, les données sont
**rattachées au site OneStock** (`site_id`, envoyé dans l'en-tête `x-site-id`) et partagées par tous les postes du site :

| Donnée | Stockage |
| --- | --- |
| Règles de segmentation | table `segmentation_rules` (clé `site_id` + `id`) |
| Types de stock | table `site_settings` (`stockTypes`) — le premier poste d'un site y dépose les siens |
| Options OneStock (url, langue, méthode, stock request, options) | table `site_settings` (`onestock`) |
| Historique des appels API | table `api_calls` (`site_id`) — *Clear* ne purge que le site |
| Seuils d'alerte des lignes de stock OneStock | table `stock_thresholds` (site × article × endpoint × groupe × purchase order) — saisis dans *Item allocation* (édition d'une ligne), relus à la consultation. Seul un seuil **différent de celui de la règle** est gardé pour la ligne ; un champ vide (affiché « Rule: X ») = seuil de la règle applicable, qui suit ses modifications |
| Token OneStock (option *Store the token in the database*) | table `site_settings` (colonne `secrets`, jamais renvoyée au navigateur : seul le proxy la lit) |
| Accès à la base (API URL, clé) et **site ID** (+ token si non stocké en base) | navigateur de chaque poste |

Le `site_id` est **obligatoire** pour les règles, l'historique et les paramètres (HTTP 400 sinon) : chaque ligne des
tables `segmentation_rules` et `api_calls` porte son site (colonne sans valeur par défaut, index `(site_id, …)`). Sans
site ID saisi, l'historique reste dans le navigateur. Les lignes antérieures (site vide) sont reprises par le premier
site qui utilise la table.

Sur un nouveau poste, l'accès à la base (URL de l'API, clé) ne peut pas venir de la base elle-même (il faut le
connaître pour la lire). Il est obtenu ainsi (`src/api/bootstrap.ts`, au démarrage) :
- **lien de configuration** : *Settings → Database → Connect the other users → Copy the setup link*
  (`…/?setup=…` : API URL, clé API optionnelle, site ID). En l'ouvrant, le navigateur est configuré puis le paramètre est
  retiré de l'adresse. Le lien contient la clé : à envoyer par un canal privé ;
- **sans clé API** (`API_KEY` non défini sur Vercel) : la base du déploiement (`/api`) est détectée automatiquement
  au premier lancement ;
- **site** : pris automatiquement si la base ne connaît qu'un site (`GET /api/health` → `sites`), sinon proposé dans
  *Settings → OneStock API* ;
- si la base demande une clé et que le poste n'en a pas, un bandeau invite à ouvrir le lien ou à saisir la clé.

Les options OneStock, le token (s'il est stocké en base), les types de stock et les règles du site sont ensuite chargés
depuis la base.

Token en base : cocher *Store the token in the database* puis *Save*. `PUT /api/settings` reçoit
`{ secrets: { onestockToken } }` (`""` le supprime) ; `GET /api/settings` ne renvoie que `hasToken`. Quand le navigateur
n'envoie pas de token, le proxy `/api/onestock` lit celui du `site_id` en base. Un token saisi sur le poste reste
prioritaire.

## Base de données Vercel (règles de segmentation)

Les règles peuvent être stockées dans une base **Postgres (Neon) sur Vercel**, via les fonctions serverless de `api/` :

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/health` | État de la connexion (base, table, nombre de règles) |
| POST | `/api/setup` | Création de la table `segmentation_rules` (idempotent) |
| GET / POST | `/api/rules` | Liste (par priorité) / création |
| PUT | `/api/rules` | `{ order: [ids] }` ordre des priorités, ou `{ rules: [...] }` remplacement complet |
| GET / PUT / DELETE | `/api/rules/:id` | Lecture / modification / suppression |
| GET / PUT | `/api/thresholds` | Seuils des lignes de stock : `?item_ids=a,b` / `{ thresholds: [{ item_id, endpoint_id, stock_type, purchase_order, threshold }] }` (`threshold: null` supprime le seuil de la ligne : celui de la règle s'applique) |
| GET / PUT | `/api/settings` | Paramètres partagés du site (types de stock, options OneStock ; token en écriture seule) |
| POST | `/api/stock-import` | Import / re-segmentation du stock OneStock avec les règles du site (voir ci-dessous) |
| GET / POST / DELETE | `/api/api-calls` | Historique des appels API : lecture (`limit`, `offset`, `target`, `errors`, `q`) / ajout par lots / purge |

Mise en place :
1. Projet Vercel → *Storage* → *Create Database* → *Neon (Postgres)* → connecter au projet (ajoute `DATABASE_URL`).
2. Optionnel : variable d'environnement `API_KEY` (secret exigé dans l'en-tête `x-api-key`).
3. Redéployer, puis dans l'application *Settings → Database* : « Vercel database », API URL `/api`, clé API,
   *Test connection* → *Initialize database* → (option) *Copy local rules to the database* → *Save*.

Les identifiants de la base restent côté serveur (variables d'environnement Vercel) ; le navigateur ne connaît que l'URL
de l'API et la clé API. En local, mettre `DATABASE_URL` et `API_KEY` dans `.env.local` (voir `.env.example`) :
`npm run dev` exécute les mêmes fonctions.

## API OneStock (catégories, stock locations, articles, stock)

*Settings → OneStock API* : `{{url}}`, `{{site_id}}`, `{{token}}`, langue par défaut des libellés, stock request (`request_name` de
stock_export), méthode HTTP des lectures (GET par défaut : categories, endpoints, v3/items et stock_export envoient
`site_id` / `token` dans un corps JSON ; POST si l'API n'accepte pas de corps en GET ; stock_import est toujours en PATCH). Quand l'API est configurée, les valeurs du critère **Category** de l'éditeur de règle viennent de
`{{url}}/categories` (corps `{ "site_id", "token" }`).

- Les **stock locations** des règles (choix des points de stock) viennent de `{{url}}/endpoints` :
  `{ endpoints: [{ id, name, address: { city, regions: { country: { code } } } }] }` → id stocké dans la règle, nom affiché.
- Les **articles** viennent de `{{url}}/v3/items` :
  - index des ids (`{ pagination: { limit: 25, start } }`, repli sur `search_after` si `start` n'est pas pris en compte),
    chargé une fois (jusqu'à 5 000 articles, cache 10 min) pour la **complétion** de la recherche et les critères SKU ;
  - détail par lot (`{ item_ids: [...] }`, **sans pagination**, 25 ids par appel, 4 appels en parallèle) :
    `features.<langue>` (langue par défaut, sinon la première) → nom, image, désignation, marque / saison si
    présentes ; la **catégorie** vient de `category_ids` (niveau article), une règle sur une catégorie couvre aussi ses
    sous-catégories. Le détail est chargé pour **tout le catalogue** afin d'évaluer les critères des règles (cache compact
    d'une heure dans le navigateur). Les SKU sont affichés « désignation (id) » dans les critères et suggestions.
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
  (`{ import: { incremental: true }, stocks: [{ item_id, endpoint_id, quantity, type, purchase_order_number, eta_start,
  eta_end }] }`), par lots de 500 enregistrements. Import **incrémental** : `quantity` est la **variation** appliquée à
  chaque type de stock (nouvelle quantité − quantité lue au GET) ; seuls les types qui changent sont envoyés, et un
  déplacement entre segments a une somme nulle (ex. `Container` −3, `Container_A` +3) :
  - modification manuelle d'une ligne OneStock dans le détail article ;
  - **Apply rules → OneStock** (détail article, articles sélectionnés, ou bouton *Apply rules* de la page des règles pour
    tous les articles en stock) : aperçu avant / après des lignes que les règles re-segmentent, puis envoi.
  - Pour chaque ligne : variation du type principal (non réparti) et de chacun de ses groupes. Le code du type est repris
    tel que lu au GET (`Container`, `Container_B`…), et pour le stock futur le `purchase_order_number` et les
    `eta_start` / `eta_end` lus au GET sont renvoyés ; une ligne future sans ETA connue n'est pas envoyée.
- L'appel passe par le proxy `POST /api/onestock` (fonction Vercel) : le navigateur ne peut pas appeler l'API OneStock
  directement (CORS). Le proxy n'autorise que les chemins listés (`/categories`, `/endpoints`, `/v3/items`, `/stock_export`, `/stock_import` — PATCH uniquement sur ce dernier,
  5 000 enregistrements maximum par appel), ne relaie que `pagination`, `item_ids`, `request_name`, `item_filter`,
  `import` et `stocks` en plus de
  `site_id` / `token` (token lu en base pour le site s'il n'est pas fourni), et impose https.
- La réponse est un arbre `{ category: { sub_category: [{ id, display_info: { <langue>: { name } }, sub_category? }] } }` :
  chaque nœud devient une catégorie (libellé « Parent › Enfant » pour les niveaux inférieurs), nommée dans la langue par
  défaut, sinon dans la première langue disponible, sinon par son id. Les règles stockent l'**id** de la catégorie.
- Le proxy utilise l'URL et la clé API de *Settings → Database*.

## API d'import de stock (Vercel)

`POST /api/stock-import` (en-têtes `x-api-key`, `x-site-id`) s'exécute **côté serveur**, sans navigateur : elle peut être
appelée par un ERP, un ordonnanceur ou un cron. Elle utilise ce qui est enregistré en base pour le site : URL et
options OneStock, **token** (*Store the token in the database* obligatoire), types de stock et règles de segmentation.
Les calculs sont ceux de l'application (module commun `api/_lib/segmentation.ts`).

Trois usages selon le corps JSON :

| Corps | Traitement |
| --- | --- |
| `{ "stocks": [...], "incremental": false }` | **Import** d'un article × endpoint × type principal (× `purchase_order_number` pour le stock futur). `incremental: false` (défaut, *update*) : la quantité est le nouveau stock et le stock entier est re-segmenté par la règle ; `incremental: true` : c'est une **variation** (+ / −) : **seule la variation** est répartie par la règle et ajoutée aux segments actuels, sans re-segmenter le stock existant (une baisse qui manque sur un segment est prise sur les autres, plus forte part d'abord ; refusée si le stock deviendrait négatif) |
| `{ "item_ids": [...] }` | **Re-segmentation** du stock OneStock actuel de ces articles |
| `{}` ou `{ "limit": 200, "cursor": [...] }` | **Re-segmentation du catalogue** page par page : ids lus par `v3/items`, seuls les articles couverts par une règle sont traités ; rappeler avec `next_cursor` tant qu'il n'est pas `null` |

Option `"dry_run": true` : calcule sans envoyer. Déroulé : `v3/items` (`item_ids`, détails → critères `category_ids`,
marque, saison…) → règle effective par ligne → `stock_export` (stock actuel, `item_filter`) → `PATCH stock_import`
avec `incremental: true` et la **variation** de chaque type de stock (lots de 500).

```json
POST /api/stock-import
{ "stocks": [
  { "item_id": "michelin_…-30", "endpoint_id": "michelin_clermont-warehouse", "type": "on_hand", "quantity": 40 },
  { "item_id": "michelin_…-12", "endpoint_id": "michelin_sydney-warehouse", "type": "Container", "quantity": 10,
    "purchase_order_number": "Container_009", "eta_start": 1790589600, "eta_end": 1790589600 }
] }
```

Réponse : compteurs (`lines`, `changed`, `unchanged`, `without_rule`, `blocked`, `records_sent`…), `errors`,
`changes` (avant / après par segment, règle appliquée) et `records` envoyés. Règles :
- `type` absent = `on_hand` ; un **groupe** (`on_hand_A`…) est refusé : c'est la règle qui répartit le type principal.
- Stock futur : `purchase_order_number` obligatoire ; sans ETA (reçue ou lue dans OneStock) la ligne n'est pas envoyée.
- Article sans règle : les groupes gardent leur quantité (réduite si le nouveau stock est plus petit), le reste va sur
  le type principal.
- Une règle sur une catégorie s'applique aussi à ses sous-catégories (arbre `/categories`).
- Les appels OneStock faits par la fonction sont historisés (*Settings → API calls*, cible « OneStock (server) »).
- Durée maximale 60 s (`vercel.json`) ; le parcours du catalogue s'arrête avant et rend `next_cursor`.
- *Settings → Stock import API* : critères d'appel (URL, en-têtes, modes, champs, réponse), prérequis du site vérifiés
  en base, exemple `curl` et **testeur** (simulation `dry_run` par défaut, envoi réel après confirmation, page suivante
  du catalogue).

## Design

Couleurs, typographie et composants suivent le **OneStock Design System** (`@onestock-public/design-system`) : tokens
`--os-*` en tête de `src/styles.css` (teal `#24bdb0`, textes `#333`, bordures `#e5e5e5`, fond `#fafafa`, statuts
rouge / orange / vert / bleu, en-tête `dark-blue #18244a`), Roboto, rayon 5 px, boutons 34 px, champs 36 px.
Les fenêtres restent dans l'écran (seul leur contenu défile sur un très petit écran) ; l'éditeur de règle est en deux
colonnes (cible de la règle à gauche, répartition en tableau compact à droite) pour être lisible sans défilement.

## Architecture

```
api/                   Fonctions serverless Vercel (règles en base Postgres, proxy OneStock, stock-import)
  _lib/segmentation.ts Logique de segmentation commune à l'application et aux fonctions
src/
  api/types.ts         Contrat StockAllocationApi (à implémenter côté HTTP)
  api/remoteRules.ts   Client HTTP des fonctions /api ; api/dbConfig.ts : paramètres Settings → Database
  api/apiLog.ts        Journal des appels API (Settings → API calls)
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

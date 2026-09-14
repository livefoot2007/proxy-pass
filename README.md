# Simple HTTP Proxy

Petit reverse proxy configurable par variables d'environnement, adapté à un déploiement Docker/Dokploy.

## Fonctionnement

- `GET /health` ou `GET /healthz` répond `200` sans appeler la cible.
- Toute autre requête est envoyée vers `UPSTREAM_URL` en conservant la méthode, le chemin, la query string, les en-têtes et le corps.
- Exemple : `POST /api/orders?id=10` avec `UPSTREAM_URL=https://api.example.com` devient `https://api.example.com/api/orders?id=10`.
- Les logs sont écrits en JSON sur stdout : démarrage, requête reçue et réponse de l'upstream. Les corps et secrets ne sont jamais journalisés.
- Si `UPSTREAM_BEARER_TOKEN` est défini, le proxy envoie `Authorization: Bearer <token>` à l'upstream. Le token n'est jamais écrit dans les logs.

Exemple de logs :

```json
{"time":"2026-09-14T10:00:00.000Z","message":"Incoming request","method":"POST","path":"/hook/example/","ip":"178.18.244.143","contentType":"multipart/form-data; boundary=...","contentLength":"157"}
```

## Exécution locale

```bash
UPSTREAM_URL=https://httpbin.org node server.js
curl http://localhost:8080/get?test=1
```

## Déploiement Dokploy

1. Connecter ce dépôt et sélectionner le déploiement Dockerfile.
2. Définir `UPSTREAM_URL` dans les variables d'environnement (sans slash final recommandé).
3. Si nécessaire, définir `UPSTREAM_BEARER_TOKEN` avec le token secret, sans le préfixe `Bearer`.
4. Exposer le port `8080` et associer le domaine voulu.
5. Définir le health check sur `/health`.

Ne pas mettre de secret dans le dépôt : ajoutez les tokens via les variables Dokploy. Le proxy est volontairement limité à une cible fixe définie au démarrage afin d'éviter de transformer le service en proxy ouvert.

# lakemailblock-web

Frontend web per `lakemailblock` con login admin, monitoraggio pacchetti SMTP-GUARD e gestione configurazioni nft dei client.

## Funzioni

- Login admin (sessione web) usando `POST /api/login` del backend
- Dashboard IP bannati per nodo
- Unban manuale IP (singolo o multiplo) accodato via polling client
- Selezione nodi limitata ai nodi online (last seen entro TTL lato server)
- Tabella pacchetti con filtri (`node`, `action`, `ip`, `dpt`) e ordinamento per timestamp desc
- Timestamp convertiti in orario Italia (`Europe/Rome`)
- Evidenza colori:
  - `ok` (guarded) in verde
  - `ban` in rosso
- Vista configurazione attuale per nodo (`/api/reverse/latest`)
- Editor ruleset con push:
  - singolo nodo
  - tutti i nodi
- Auto-refresh configurabile

## Prerequisiti

- Backend `lakemailblock` in modalità server già attivo (default: `http://127.0.0.1:8000`)
- Un account admin in `accounts.yml` del backend

## Setup

1. Copia variabili ambiente:

```bash
cp .env.example .env
```

2. Modifica `.env`:

```env
HOST=0.0.0.0
PORT=8081
BACKEND_URL=http://127.0.0.1:8000
SESSION_SECRET=metti_un_valore_random_lungo
SESSION_TTL_MS=43200000
REQUEST_TIMEOUT_MS=30000
```

3. Avvio:

```bash
npm install
npm start
```

## Accesso

Apri:

- `http://<ip-server>:<PORT>`

Esegui login con credenziali admin del backend.

## API locali (web app)

Queste endpoint sono esposte dal frontend server (proxy sicuro con sessione):

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/backend-health`
- `GET /api/status`
- `GET /api/packets`
- `GET /api/logs`
- `GET /api/configs`
- `GET /api/configs/:node`
- `POST /api/configs/refresh/:node`
- `POST /api/configs/push`
- `GET /api/nodes`
- `POST /api/unban`

## Note sicurezza

- `SESSION_SECRET` va cambiato in produzione.
- Il JWT backend rimane lato server web (in sessione), non nel browser localStorage.

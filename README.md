# Speakr

AI call assistant for your phone: record what the other person said → **Whisper** transcribes → **GPT-4o** suggests a short reply → your phone **speaks** it (browser text-to-speech). Use on speakerphone during a live call.

## Run the server (local)

**Requirements:** [Node.js](https://nodejs.org/) **20+**

```bash
git clone https://github.com/seamuswc/speakr.git
cd speakr
npm install
cp .env.example .env
```

Edit `.env`: set `OPENAI_API_KEY` to a real key from [OpenAI API keys](https://platform.openai.com/api-keys) (not the `sk-your-key-here` placeholder).

```bash
npm start
```

Open **http://localhost:3000** in your browser.

- **`npm run dev`** — same as `npm start` but restarts the server when `server.js` changes.
- **Phone on Wi‑Fi:** use your computer’s LAN IP (e.g. `http://192.168.x.x:3000`). **iOS Safari** usually needs **HTTPS** for the mic; deploy to a host with HTTPS or use a tool like `mkcert` locally.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI secret key |
| `PORT` | No | Port (default `3000`) |
| `HOST` | No | Bind address (default `0.0.0.0` — use `127.0.0.1` if a reverse proxy terminates TLS on the same machine) |

Health check for uptime monitors: `GET /api/health` → `{ "ok": true }`.

## Deploy on DigitalOcean (one script)

From your Mac (after [installing `doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/) and adding an [SSH key](https://cloud.digitalocean.com/account/security) to your DO account):

```bash
export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."   # API token: DO → API → Generate token
export OPENAI_API_KEY="sk-..."
./scripts/setup-digitalocean.sh
```

Creates an Ubuntu droplet, installs Node 20, clones this repo, writes `.env`, starts **systemd** `speakr.service`, opens the firewall.

- **HTTP (quick test):** opens `http://YOUR_DROPLET_IP:3000/` — **iOS may block the mic** on plain HTTP.
- **HTTPS (phone-friendly):** point a domain’s **A record** at the droplet, then:

  ```bash
  export DOMAIN=app.yourdomain.com
  ./scripts/setup-digitalocean.sh speakr-https
  ```

  (Use a **new** droplet name if you already ran the script once, or install Caddy by hand on the existing VM — see **SETUP.md**.)

Full options, firewall notes, and manual steps: **[SETUP.md](./SETUP.md)**.

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
| `HOST` | No | Bind address (default `0.0.0.0` — correct for Railway/Docker) |

Health check for uptime monitors: `GET /api/health` → `{ "ok": true }`.

## Deploy, phone usage, troubleshooting, costs

See **[SETUP.md](./SETUP.md)** for Railway (or similar), HTTPS, controls (including **dictating your instruction** with the small mic), and fixes for common issues.

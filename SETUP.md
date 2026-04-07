# Speakr — Setup Guide

The app runs on a server. You open it in your **phone's browser**. Your phone does everything — it listens through its mic and speaks through its speaker. No laptop needed.

**Repo:** https://github.com/seamuswc/speakr — copy/paste server commands are in [README.md](./README.md).

---

## Prerequisites

- **Node.js 20+** (check with `node -v`)
- **OpenAI API key** with access to Whisper and GPT-4o (billing enabled on your OpenAI account)

---

## How it works

```
Other person talks → your phone mic picks it up
→ Whisper transcribes it
→ GPT-4o generates a reply
→ your phone speaks it out loud
→ other person hears it via speakerphone
```

---

## What you need

- **DigitalOcean** account (or any VPS you SSH into — adapt the script by hand)
- **OpenAI API key**
- Your phone

---

## Step 1 — Get an OpenAI API key

1. Go to https://platform.openai.com/api-keys
2. Click **Create new secret key**
3. Copy it — starts with `sk-`, you only see it once

---

## Step 2 — DigitalOcean: one-shot script (recommended)

On your **Mac or Linux** machine (not on the droplet):

1. Install **`doctl`**: `brew install doctl` — or see [DigitalOcean’s install guide](https://docs.digitalocean.com/reference/doctl/how-to/install/).
2. Create a **Personal Access Token** in DigitalOcean (**API** → **Generate new token**) with read+write. Export it:
   ```bash
   export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."
   ```
3. Add your **SSH public key** to DigitalOcean: https://cloud.digitalocean.com/account/security  
   (The script uses every key in your account unless you set `SSH_KEY_IDS=id1,id2`.)
4. From a clone of this repo:
   ```bash
   export OPENAI_API_KEY="sk-..."
   ./scripts/setup-digitalocean.sh
   ```
   Optional: `./scripts/setup-digitalocean.sh my-droplet-name`

**What it does:** creates an **Ubuntu 22.04** droplet (default size **`s-1vcpu-1gb`**, region **`nyc1`**), runs **cloud-init** to install **Node 20**, **`git clone`** this app into `/opt/speakr`, **`npm install --omit=dev`**, copies **`.env`**, installs a **`speakr`** **systemd** service, configures **UFW** (SSH + either port **3000** or **80/443**).

**Override defaults (env vars):**

| Variable | Default | Meaning |
|----------|---------|---------|
| `REGION` | `nyc1` | Droplet region |
| `SIZE` | `s-1vcpu-1gb` | Droplet slug |
| `REPO_URL` | this GitHub repo | Fork or private mirror URL |
| `SSH_KEY_IDS` | all keys in DO | Comma-separated key IDs |
| `DOMAIN` | _(empty)_ | If set, installs **Caddy** for **HTTPS** on that hostname |

**HTTPS for your phone (strongly recommended):**

1. Create an **A record** for e.g. `speakr.yourdomain.com` → your droplet’s **public IPv4** (shown when the script finishes).
2. Run again with a **new** droplet name (or configure Caddy manually on the existing server):
   ```bash
   export DOMAIN=speakr.yourdomain.com
   ./scripts/setup-digitalocean.sh speakr-prod
   ```
   The app listens on **127.0.0.1:3000**; **Caddy** terminates TLS on **443** and reverse-proxies to it.

**Useful SSH commands:**

```bash
ssh root@YOUR_DROPLET_IP
journalctl -u speakr -f    # app logs
systemctl restart speakr
```

**Health check:** `GET https://your-domain/api/health` or `http://YOUR_IP/api/health` (Caddy on :80; app on `127.0.0.1:3000`) → `{"ok":true}`.

---

### Already have a blank server? Deploy with only the IP

You **do not** need `doctl`. On your **Mac/Linux**, from a clone of this repo, **`ssh root@YOUR_IP`** must succeed (use the SSH key you added when creating the droplet).

```bash
export OPENAI_API_KEY="sk-..."
./scripts/deploy-to-ip.sh YOUR_PUBLIC_IP
```

This **uploads** the app to `/opt/speakr`, creates **`.env`** on the server with your key, runs **`npm install`**, installs **systemd** `speakr`, and **UFW**. Optional: `DOMAIN=app.example.com` (DNS **A** → that IP) for **Caddy + HTTPS**.

- Non-root user: `SSH_USER=ubuntu ./scripts/deploy-to-ip.sh IP`
- Custom key: `SSH_IDENTITY=~/.ssh/id_ed25519 ./scripts/deploy-to-ip.sh IP`

---

## Step 3 — Open on your phone

Use the URL the script prints:

- **With `DOMAIN`:** `https://your-domain/`  
- **Without a domain:** `http://DROPLET_IP/` (no `:3000` — Caddy proxies port 80 → app). Mic on **iOS** still prefers **HTTPS** with a real domain.

**Important:** For reliable **microphone** access on phones, prefer **HTTPS** (set `DOMAIN` + DNS, or put another reverse proxy with a real certificate in front of the app).

---

## Step 4 — Use it on a call

1. Set your **Instruction** — be specific:
   > *Politely ask to extend the payment deadline from the 15th to the end of the month. Use keigo. If refused, ask for 2 more weeks.*

2. Set **Tone** and **Language**

3. Start your phone call, put it on **speakerphone**

4. When the other person finishes speaking, tap the **mic button**

5. When they stop — tap again to stop recording

6. The AI speaks the response out loud through your phone speaker

7. The other person hears it through your speakerphone

---

## Controls

| Control | What it does |
|--------|-------------|
| **Big mic** (bottom) | Tap to record the **other person** on the call / tap again to stop → transcribe → reply → speak |
| **Small mic** (next to Instruction) | Tap to **dictate your goal** into the text box / tap again to stop (same Whisper API) |
| Replay | Plays the last response again |
| Stop | Cuts off the AI mid-sentence |
| Reset | Clears memory and starts fresh |

---

## Troubleshooting

**"Mic access denied"**
→ Tap the lock icon in your browser address bar → allow microphone → refresh

**No voice / silent response**
→ Your phone needs the right **offline / Siri / Google TTS voice** for the reply language
→ **Japanese:** iPhone: Settings → Accessibility → Spoken Content → Voices → Japanese → download a Siri voice  
→ **Thai:** iPhone: same path → **Thai** → download a voice. Android: Text-to-speech → install **Thai**

**AI responds in wrong language**
→ Set Language to **Japanese**, **English**, or **Thai** explicitly instead of **Auto** when unsure

**Response takes too long**
→ Normal on slow connections — Whisper + GPT-4o adds ~2–3 seconds
→ Keep recordings short (just the other person's sentence)

**"Transcription failed"**
→ OpenAI API key is wrong or has no credits → check https://platform.openai.com/usage

**Echo / AI hears itself**
→ This is expected — echo cancellation is off so the mic can pick up speakerphone audio
→ Tap mic only AFTER the other person finishes, stop before AI starts speaking

---

## Running locally (for development)

If you want to test on your own machine:

```bash
npm install
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
npm start
```

Then to access from your phone on the same Wi‑Fi:
1. Find your computer’s LAN IP — **Mac:** System Settings → Network, or run `ipconfig getifaddr en0` (Wi‑Fi) / `en1` if needed. **Windows:** `ipconfig` and look for IPv4.
2. On your phone, open `http://192.168.x.x:3000` (use your machine’s IP and the port from `.env`, default `3000`).

**iOS:** Safari blocks microphone on plain **HTTP** except in limited cases. Use **HTTPS** (DigitalOcean script with `DOMAIN`, or a local **mkcert** + reverse proxy).

---

## Cost

| What | Cost |
|------|------|
| Whisper STT | ~$0.006 per minute of audio |
| GPT-4o reply | ~$0.002 per exchange |
| TTS | Free — built into your phone |

A 10-minute call ≈ $0.10–0.20 total.

---

## File structure

```
speakr/
├── server.js          # Node.js backend — Whisper STT + GPT-4o
├── public/
│   └── index.html     # Mobile web app — mic, UI, on-device TTS
├── deploy/
│   └── ip.txt                  # Optional: your droplet IP (for deploy-to-ip.sh)
├── scripts/
│   ├── setup-digitalocean.sh   # Create DO droplet + install (+ optional Caddy)
│   └── deploy-to-ip.sh         # Deploy to existing Ubuntu box (SSH + IP only)
├── package.json
├── README.md          # Quick start: install, .env, npm start
├── .env.example       # Copy to .env and add your key
├── .gitignore
└── SETUP.md           # This file — deploy, phone, troubleshooting
```

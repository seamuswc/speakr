# Speakr — Setup Guide

The app runs on a server. You open it in your **phone's browser**. Your phone does everything — it listens through its mic and speaks through its speaker. No laptop needed.

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

- A server to run the Node.js backend (Railway recommended — free to start)
- An OpenAI API key
- Your phone

---

## Step 1 — Get an OpenAI API key

1. Go to https://platform.openai.com/api-keys
2. Click **Create new secret key**
3. Copy it — starts with `sk-`, you only see it once

---

## Step 2 — Deploy to Railway (easiest)

Railway gives you a public HTTPS URL your phone can reach.

1. Push this repo to GitHub
2. Go to https://railway.app → sign up → **New Project** → **Deploy from GitHub repo**
3. Select your repo
4. Go to your project → **Variables** → add:
   ```
   OPENAI_API_KEY = sk-your-key-here
   ```
5. Go to **Settings → Networking → Generate Domain**
6. Copy the domain — looks like `speakr-production.up.railway.app`

That's it. Railway auto-deploys on every git push.

---

## Step 3 — Open on your phone

Open your phone's browser and go to:
```
https://speakr-production.up.railway.app
```
(use your actual Railway domain)

**Important:** Must be HTTPS — browsers block microphone access on plain HTTP. Railway gives you HTTPS automatically.

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

| Button | What it does |
|--------|-------------|
| Mic button | Tap to start listening / tap again to stop |
| Replay | Plays the last response again |
| Stop | Cuts off the AI mid-sentence |
| Reset | Clears memory and starts fresh |

---

## Troubleshooting

**"Mic access denied"**
→ Tap the lock icon in your browser address bar → allow microphone → refresh

**No voice / silent response**
→ Your phone needs a Japanese voice installed for Japanese TTS
→ iPhone: Settings → Accessibility → Spoken Content → Voices → Japanese → download Siri voice
→ Android: Settings → General Management → Language → Text-to-speech → install Japanese

**AI responds in wrong language**
→ Set Language to "Japanese" or "English" explicitly instead of "Auto"

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

Then to access from your phone on the same WiFi:
1. Find your computer's local IP: run `ipconfig` (Windows) or `ifconfig | grep 192` (Mac)
2. On your phone, go to `http://192.168.x.x:3000`

Note: Microphone won't work over plain HTTP on iOS. Use a local HTTPS proxy (like `mkcert`) or just deploy to Railway.

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
├── package.json
├── .env.example       # Copy to .env and add your key
├── .gitignore
└── SETUP.md           # This file
```

/**
 * Speakr — AI Call Assistant
 * Phone browser records mic → server transcribes (Whisper) → GPT-4o responds → phone speaks it
 */

import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rawKey = (process.env.OPENAI_API_KEY || "").trim();
const placeholder = /^sk-your-key-here$/i.test(rawKey);
if (!rawKey || placeholder) {
  console.error(
    "\n❌ OPENAI_API_KEY missing or still a placeholder. Copy .env.example → .env and set a real key from https://platform.openai.com/api-keys\n"
  );
  process.exit(1);
}

const openai = new OpenAI({ apiKey: rawKey });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ── Session store (conversation history per session) ──────────────────────────
const sessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of sessions) if (s.lastActive < cutoff) sessions.delete(id);
}, 15 * 60 * 1000);

// ── Whisper language / prompt ─────────────────────────────────────────────────
function whisperLangParam(language) {
  if (language === "auto" || !language) return undefined;
  if (language === "ja") return "ja";
  if (language === "th") return "th";
  return "en";
}

function whisperPromptFor(language) {
  if (language === "ja") return "日本語のビジネス電話です。";
  if (language === "th") return "การสนทนาทางโทรศัพท์ภาษาไทย";
  return "This is a phone call.";
}

/** Vocabulary hint when language is auto (speakerphone / other party often dominates). */
const WHISPER_PROMPT_AUTO =
  "Live phone call, often speakerphone. Restaurant, reservation, table for, party of, how many guests, name, phone number, date, time.";

/** Map Whisper verbose `language` to ja | en | th when we recognize it; else undefined. */
function normalizeDetectedLanguage(raw) {
  if (raw == null || raw === "") return undefined;
  const low = String(raw).toLowerCase();
  if (low === "thai" || low === "th") return "th";
  if (low === "japanese" || low === "ja") return "ja";
  if (low === "english" || low === "en") return "en";
  return undefined;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildPrompt({ goal, tone, language }) {
  const lang = {
    ja: "Respond ONLY in Japanese. Use 敬語 (keigo) — 丁寧語 and 謙譲語. This is a Japanese business call.",
    en: "Respond ONLY in English.",
    th: "Respond ONLY in Thai. Use natural, polite spoken Thai appropriate for business or formal phone calls (ภาษาไทยสุภาพ เหมาะกับโทรศัพท์ธุรกิจ). Use ครับ/ค่ะ and polite particles as fits the situation.",
    auto: "Auto-detect the language spoken and respond in the same language. Use keigo if Japanese; polite Thai (ครับ/ค่ะ) if Thai.",
  }[language] || "Respond in the same language as the speaker.";

  const tones = {
    polite:   "Tone: polite and professional.",
    formal:   "Tone: highly formal. Most respectful forms.",
    assertive:"Tone: confident and direct, but respectful.",
    casual:   "Tone: friendly and relaxed.",
  };

  return `You are helping someone on a LIVE phone call. They play your reply OUT LOUD (or repeat it) toward the other party.

GOAL (may be in any language — infer intent; your line must follow LANGUAGE below): ${goal || "Handle the call professionally."}
LANGUAGE: ${lang}
${tones[tone] || tones.polite}

WHAT EACH "USER" TURN IS: a transcript of a short clip from the phone microphone — often speakerphone. It is usually what was JUST HEARD on the call (frequently the other person, e.g. restaurant staff), not a message typed by the user. It may be noisy or partial.

YOUR JOB: say ONLY the next words the CALLER should speak out loud on the phone to move toward GOAL (e.g. book a table for 10, give name, confirm time). Answer the staff directly. Do not explain the app, do not meta-comment.

RULES:
- Maximum 2 short sentences; prefer 1 when it is enough. Live speech — be concise.
- Never reveal you are an AI unless directly asked.
- No stage directions, no asterisks, no "you should say" — only the spoken words the caller will use.
- Stay focused on the goal.
- In Japanese: open with 「はい、承知いたしました」or similar when appropriate.
- In Thai: open politely (e.g. ครับ/ค่ะ, สวัสดีครับ/ค่ะ) when appropriate for the call.`;
}

// ── POST /api/transcribe ──────────────────────────────────────────────────────
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio received" });

  const language = req.body.language;

  try {
    const file = await toFile(req.file.buffer, "audio.webm", {
      type: req.file.mimetype || "audio/webm",
    });

    const isAuto = language === "auto" || !language;
    const wPrompt = isAuto ? WHISPER_PROMPT_AUTO : whisperPromptFor(language);
    const result = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: whisperLangParam(language),
      // json is lighter than verbose_json when caller language is fixed (faster turnaround)
      response_format: isAuto ? "verbose_json" : "json",
      temperature: 0,
      ...(wPrompt ? { prompt: wPrompt } : {}),
    });

    const text = result.text?.trim() ?? "";
    let detected;
    if (isAuto) {
      const rawLang = result.language ?? "en";
      detected = normalizeDetectedLanguage(rawLang) ?? rawLang;
    } else {
      detected = normalizeDetectedLanguage(language) ?? language;
    }

    res.json({ text, detectedLanguage: detected });
  } catch (err) {
    console.error("Whisper error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/respond ─────────────────────────────────────────────────────────
app.post("/api/respond", async (req, res) => {
  const { sessionId, transcript, goal, tone, language, detectedLanguage, stream: streamMode } = req.body;
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!sessionId || !text) return res.status(400).json({ error: "Missing fields" });

  const normDet = normalizeDetectedLanguage(detectedLanguage);
  const effectiveLang =
    language && language !== "auto" ? language : normDet || "auto";

  if (!sessions.has(sessionId)) sessions.set(sessionId, { history: [], lastActive: Date.now() });
  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  session.history.push({ role: "user", content: text });
  if (session.history.length > 20) session.history = session.history.slice(-20);

  const messages = [
    { role: "system", content: buildPrompt({ goal, tone, language: effectiveLang }) },
    ...session.history,
  ];

  if (streamMode === true) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    try {
      const streamRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 120,
        temperature: 0.45,
        stream: true,
      });
      let full = "";
      for await (const chunk of streamRes) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          res.write(JSON.stringify({ delta }) + "\n");
        }
      }
      const trimmed = full.trim();
      session.history.push({ role: "assistant", content: trimmed });
      res.write(
        JSON.stringify({
          done: true,
          response: trimmed,
          detectedLanguage: normDet ?? detectedLanguage,
        }) + "\n"
      );
      res.end();
    } catch (err) {
      session.history.pop();
      console.error("Chat stream error:", err);
      try {
        res.write(JSON.stringify({ error: err?.message || "Model request failed" }) + "\n");
      } catch {
        /* ignore */
      }
      res.end();
    }
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 120,
      temperature: 0.45,
    });

    const response = completion.choices[0]?.message?.content?.trim() ?? "";
    session.history.push({ role: "assistant", content: response });
    res.json({ response, detectedLanguage: normDet ?? detectedLanguage });
  } catch (err) {
    session.history.pop();
    console.error("Chat completion error:", err);
    const msg = err?.message || "Model request failed";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/speak — OpenAI TTS (better voice than browser synthesis) ─────────
const TTS_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

app.post("/api/speak", express.json({ limit: "64kb" }), async (req, res) => {
  const raw = req.body?.text;
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return res.status(400).json({ error: "No text" });
  if (t.length > 4096) return res.status(400).json({ error: "Text too long (max 4096)" });

  const modelRaw = (process.env.OPENAI_TTS_MODEL || "tts-1-hd").trim();
  const model = modelRaw === "tts-1" || modelRaw === "tts-1-hd" ? modelRaw : "tts-1-hd";
  const voiceRaw = (process.env.OPENAI_TTS_VOICE || "nova").trim().toLowerCase();
  const voice = TTS_VOICES.has(voiceRaw) ? voiceRaw : "nova";

  try {
    const resp = await openai.audio.speech.create({
      model,
      voice,
      input: t,
      response_format: "mp3",
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).json({ error: err?.message || "TTS failed" });
  }
});

// ── POST /api/outcome — summarize call toward goal in “your language” (ja|en|th) ─
function buildOutcomePrompt({ goal, language }) {
  const langRule = {
    ja: "出力は日本語のみ。",
    en: "Write ONLY in English.",
    th: "เขียนเป็นภาษาไทยเท่านั้น",
  }[language] || "Write ONLY in English.";

  return `You write a short outcome summary for someone who held a live phone call with help from an AI.

USER GOAL / INSTRUCTION (may be in any language): ${goal || "Not specified"}

${langRule}

Write 2–4 short sentences:
- Progress toward the goal (or lack of it).
- What is still open or should be done next.
- Any fact worth remembering.

Summarize in your own words. Do not translate the dialogue line-by-line; synthesize. No roleplay or markdown.`;
}

app.post("/api/outcome", async (req, res) => {
  const { goal, language, turns } = req.body || {};
  if (!Array.isArray(turns) || turns.length === 0) {
    return res.status(400).json({ error: "No conversation turns" });
  }
  const lang = ["ja", "en", "th"].includes(language) ? language : "en";

  const lines = turns
    .map((t, i) => {
      const c = String(t.caller ?? t.them ?? "").trim();
      const r = String(t.receiver ?? t.ai ?? "").trim();
      return `Turn ${i + 1}\nOther party (caller): ${c}\nSuggested line for user to say (receiver): ${r}`;
    })
    .join("\n\n");

  const messages = [
    { role: "system", content: buildOutcomePrompt({ goal, language: lang }) },
    {
      role: "user",
      content: `CALL LOG (synthesize; do not quote verbatim):\n\n${lines}`,
    },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 220,
      temperature: 0.35,
    });
    const outcome = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ outcome });
  } catch (err) {
    console.error("Outcome error:", err.message);
    res.status(500).json({ error: err?.message || "Outcome failed" });
  }
});

// ── POST /api/reset ───────────────────────────────────────────────────────────
app.post("/api/reset", (req, res) => {
  const sid = req.body?.sessionId;
  if (sid) sessions.delete(sid);
  res.json({ ok: true });
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Audio too large (max 10 MB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error" });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`\n✓ eigobot → http://localhost:${PORT}\n`);
});

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

  return `You are an AI speaking OUT LOUD on a live phone call on behalf of the user.

GOAL: ${goal || "Handle the call professionally."}
LANGUAGE: ${lang}
${tones[tone] || tones.polite}

RULES:
- Maximum 2 sentences. This is live speech — be concise.
- Never reveal you are an AI unless directly asked.
- No stage directions, no asterisks, no explanations — only the spoken words.
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

    const wPrompt = language === "auto" ? undefined : whisperPromptFor(language);
    const result = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: whisperLangParam(language),
      response_format: "verbose_json",
      temperature: 0,
      ...(wPrompt ? { prompt: wPrompt } : {}),
    });

    const rawLang = result.language ?? "en";
    const detected = normalizeDetectedLanguage(rawLang) ?? rawLang;

    res.json({ text: result.text?.trim() ?? "", detectedLanguage: detected });
  } catch (err) {
    console.error("Whisper error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/respond ─────────────────────────────────────────────────────────
app.post("/api/respond", async (req, res) => {
  const { sessionId, transcript, goal, tone, language, detectedLanguage } = req.body;
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

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: buildPrompt({ goal, tone, language: effectiveLang }) },
        ...session.history,
      ],
      max_tokens: 100,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content?.trim() ?? "";
    session.history.push({ role: "assistant", content: response });
    res.json({ response, detectedLanguage: normDet ?? detectedLanguage });
  } catch (err) {
    session.history.pop();
    console.error("GPT-4o error:", err);
    const msg = err?.message || "Model request failed";
    res.status(500).json({ error: msg });
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

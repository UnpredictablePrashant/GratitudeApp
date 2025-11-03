const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const OpenAI = require("openai");

const PROTO_PATH = path.join(__dirname, "protos", "entries.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const entriesProto = grpc.loadPackageDefinition(packageDefinition).entries;

const ENTRIES_ADDR = process.env.ENTRIES_SERVICE_ADDR || "entries-cluster-ip-service:50051";
const entriesClient = new entriesProto.Entries(ENTRIES_ADDR, grpc.credentials.createInsecure());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openAiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

const ensureOpenAi = (res) => {
  if (!openAiClient) {
    res.status(503).send({ ok: false, error: "OPENAI_API_KEY is not configured on the API gateway" });
    return false;
  }
  return true;
};

const sanitize = (value, max = 800) => {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
};

const clipCollection = (input, limit = 20) => {
  if (!Array.isArray(input)) return [];
  return input.slice(0, limit);
};

const safeJsonParse = (raw, fallback = {}) => {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
};

const normalizeEntries = (entries, limit = 20) =>
  clipCollection(entries, limit).map((item) => ({
    text: sanitize(item?.text || "", 500),
    created_at: item?.created_at || item?.createdAt || null,
  }));

const normalizeMoods = (moods, limit = 20) =>
  clipCollection(moods, limit).map((item) => ({
    mood: sanitize(item?.mood || "", 50),
    note: sanitize(item?.note || "", 240),
    created_at: item?.created_at || null,
  }));

async function runChat(messages, options = {}) {
  if (!openAiClient) {
    throw new Error("OPENAI_API_KEY is not configured on the API gateway");
  }
  const response = await openAiClient.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.4,
    ...options,
    messages,
  });
  return response;
}

const runJsonChat = async (systemPrompt, userPayload, options = {}) => {
  const response = await runChat(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: typeof userPayload === "string" ? userPayload : JSON.stringify(userPayload),
      },
    ],
    {
      response_format: { type: "json_object" },
      max_tokens: options.maxTokens || 400,
      temperature: options.temperature ?? 0.4,
    }
  );
  return {
    json: safeJsonParse(response.choices?.[0]?.message?.content || "{}"),
    usage: response.usage || null,
  };
};

app.get("/healthz", (req, res) => {
  res.send({
    ok: true,
    services: {
      entries: ENTRIES_ADDR,
      openai: Boolean(openAiClient),
    },
  });
});

app.get("/ai/healthz", (req, res) => {
  if (!openAiClient) {
    return res.status(503).send({
      ok: false,
      error: "OPENAI_API_KEY missing",
    });
  }
  res.send({ ok: true, model: OPENAI_MODEL });
});

// REST facade for Gratitude entries
app.get("/entries/all", (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit || "50", 10) || 50);
  entriesClient.ListEntries({ limit }, (err, result) => {
    if (err) return res.status(500).send({ error: err.message });
    // Keep client compatibility shape: { rows: [...] }
    res.send({ rows: (result.entries || []).map((e) => ({ id: e.id, text: e.text, created_at: e.created_at })) });
  });
});

app.post("/entries", (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : "").trim();
  entriesClient.CreateEntry({ text }, (err, entry) => {
    if (err) return res.status(400).send({ ok: false, error: err.message });
    res.send({ ok: true, entry });
  });
});

app.post("/ai/insights", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const latestEntry = sanitize(req.body?.entry);
  const latestMood = req.body?.mood || null;
  const stats = req.body?.stats || null;
  const goals = Array.isArray(req.body?.goals) ? req.body.goals.map((g) => sanitize(g, 120)) : [];

  if (!latestEntry && !latestMood && !stats) {
    return res.status(400).send({ error: "Provide at least an entry, mood, or stats snapshot." });
  }

  const userPayload = {
    entry: latestEntry,
    mood: latestMood,
    stats,
    goals,
  };

  try {
    const { json, usage } = await runJsonChat(
      "You are an empathetic AI mentor. Analyse the data and output JSON with keys primary_emotion, summary, reflection, action_item, risk_level (low|medium|high), and partner_share (short supportive sentence).",
      userPayload,
      { maxTokens: 350 }
    );
    res.send({
      insights: json,
      usage,
    });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({
      error: err.message || "Unable to fetch AI insights",
    });
  }
});

app.post("/ai/prompt", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const focus = sanitize(req.body?.focus, 200);
  const mood = sanitize(req.body?.mood, 40) || "curious";
  const entry = sanitize(req.body?.entry, 400);

  try {
    const response = await runChat(
      [
        {
          role: "system",
          content:
            "Create a single journaling prompt tailored to the user's current mood and context. Keep it under 220 characters.",
        },
        {
          role: "user",
          content: `Mood: ${mood}\nFocus request: ${focus || "balance and gratitude"}\nMost recent entry: ${
            entry || "none"
          }`,
        },
      ],
      { max_tokens: 100, temperature: 0.8 }
    );
    const prompt = response.choices?.[0]?.message?.content?.trim();
    res.send({
      prompt: prompt || "Take a mindful breath and describe one highlight from today.",
      usage: response.usage || null,
    });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({
      error: err.message || "Unable to fetch AI prompt",
    });
  }
});

app.post("/ai/summary", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const entries = normalizeEntries(req.body?.entries, 20);
  const moods = normalizeMoods(req.body?.moods, 20);
  const stats = req.body?.stats || null;
  if (!entries.length && !moods.length && !stats) {
    return res.status(400).send({ error: "Provide entries, moods, or stats for the summary." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "Create an uplifting weekly executive summary of the user's emotional wellbeing. Respond with JSON keys: overview, wins (array), growth_edges (array), focus_theme, encouragement.",
      { entries, moods, stats },
      { maxTokens: 420 }
    );
    res.send({ summary: json, usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to fetch AI summary" });
  }
});

app.post("/ai/goals", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const goals = clipCollection(req.body?.goals, 10)
    .map((goal) => sanitize(goal, 160))
    .filter(Boolean);
  const entry = sanitize(req.body?.entry, 400);
  if (!goals.length) {
    return res.status(400).send({ error: "Provide at least one goal." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "Relate the gratitude reflection to the user's life goals. Return JSON { reflections: [{ goal, insight, micro_action }] }.",
      { goals, entry },
      { maxTokens: 400 }
    );
    res.send({ reflections: json.reflections || [], usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to fetch goal reflections" });
  }
});

app.post("/ai/anomaly", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const entries = normalizeEntries(req.body?.entries, 30);
  const moods = normalizeMoods(req.body?.moods, 30);
  if (!entries.length && !moods.length) {
    return res.status(400).send({ error: "Provide recent entries or moods for analysis." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "Detect emotional anomalies or mental health risks. Return JSON { risk_level, alerts: [string], recommendation }.",
      { entries, moods },
      { maxTokens: 320 }
    );
    res.send({ anomaly: json, usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to run anomaly detection" });
  }
});

app.post("/ai/pattern", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const entries = normalizeEntries(req.body?.entries, 40);
  if (!entries.length) {
    return res.status(400).send({ error: "Provide entries to map life patterns." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "Analyse gratitude entries to build a life pattern map. Return JSON { themes: [string], triggers: [string], supportive_habits: [string] }.",
      { entries },
      { maxTokens: 380 }
    );
    res.send({ pattern: json, usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to map patterns" });
  }
});

app.post("/ai/transcript", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const note =
    sanitize(req.body?.voice_note, 1800) ||
    sanitize(req.body?.voice_note_text, 1800) ||
    sanitize(req.body?.note, 1800);
  if (!note) {
    return res.status(400).send({ error: "Provide a voice note snippet to transcribe." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "You clean up raw voice note text into a polished transcript. Return JSON { transcript, emotions: [string], highlights: [string], action_item }.",
      note,
      { maxTokens: 320 }
    );
    res.send({ transcript: json, usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to transcribe note" });
  }
});

app.post("/ai/partner", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const insights = req.body?.insights || null;
  const summary = req.body?.summary || null;
  const audience = sanitize(req.body?.audience || "partner", 40);
  if (!insights && !summary) {
    return res.status(400).send({ error: "Provide insights or a summary to craft a partner update." });
  }
  try {
    const { json, usage } = await runJsonChat(
      "Create a short, caring update that shares emotional status with a loved one without revealing raw journal text. Return JSON { message }.",
      { insights, summary, audience },
      { maxTokens: 220 }
    );
    res.send({ share: json, usage });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({ error: err.message || "Unable to craft partner update" });
  }
});

app.post("/ai/chat", async (req, res) => {
  if (!ensureOpenAi(res)) return;
  const history = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
  const topic = sanitize(req.body?.topic, 120) || "overall wellbeing";
  const messages = [
    {
      role: "system",
      content:
        "You are a therapist-style AI mentor. Be empathetic, concise, and focus on actionable grounding techniques. Keep replies under 180 words.",
    },
  ];
  if (history.length) {
    history.forEach((msg) => {
      const role = msg.role === "assistant" ? "assistant" : "user";
      const content = sanitize(msg.content || msg.text || "", 1200);
      if (content) {
        messages.push({ role, content });
      }
    });
  } else {
    messages.push({
      role: "user",
      content: `I'd like to talk about ${topic}.`,
    });
  }

  try {
    const response = await runChat(messages, { max_tokens: 360, temperature: 0.7 });
    const reply = response.choices?.[0]?.message?.content?.trim();
    res.send({
      reply: reply || "Take a calming breath and notice one thing you appreciate in this moment.",
      usage: response.usage || null,
    });
  } catch (err) {
    const status = err?.status || err?.statusCode || 502;
    res.status(status).send({
      error: err.message || "Unable to continue the mentor chat",
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API Gateway listening on :${PORT}`));

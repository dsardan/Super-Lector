// Super Lector — titanium-core worker
// v1.0.0 — free-first AI provider cascade, CORS, safe fallbacks.
//
// POST /api/chat   { director?: "OPERATIONS"|"STRATEGY"|"STUDENT"|"TECH"|"LECTOR",
//                    persona?: "architect"|"mentor"|"standup"|"quiet"|"coach",
//                    message: string, history?: [{role, content}] }
// GET  /api/health
//
// Secrets (wrangler secret put …): ACCESS_KEY (required — header X-Access-Key on POST), GROQ_API_KEY, DEEPSEEK_API_KEY, QWEN_API_KEY,
//   GEMINI_API_KEY, ANTHROPIC_API_KEY — any missing provider is skipped.
// Binding: AI (Workers AI) — first in the cascade, free tier.
// Vars: ALLOWED_ORIGINS (comma-separated), *_MODEL overrides.

const DIRECTORS = {
  OPERATIONS: "Ты — Director of Operations платформы Super Lector. Контролируешь дедлайны и процессы. Отвечай кратко и по делу.",
  STRATEGY: "Ты — Strategy Architect платформы Super Lector. Строишь планы развития курса и платформы.",
  STUDENT: "Ты — Student Success Officer платформы Super Lector. Помогаешь студенту пройти курс AI Engineering.",
  TECH: "Ты — Technical Lead платформы Super Lector. Следишь за состоянием системы и отвечаешь на технические вопросы.",
  LECTOR: "Ты — лектор курса AI Engineering платформы Super Lector. Объясняешь точно, без выдуманных фактов; если не уверен — говоришь об этом.",
};

const PERSONAS = {
  architect: "Стиль: плотно, по делу, чистая математика.",
  mentor: "Стиль: мягкий темп, поддержка, без давления.",
  standup: "Стиль: ирония, кейсы из продакшена, быстрый темп.",
  quiet: "Стиль: минимум слов, ровный тон, без эмоций.",
  coach: "Стиль: энергично, короткие фразы, подталкивай к действию.",
};

const MAX_MESSAGE = 8000;
const MAX_HISTORY = 12;
const PROVIDER_TIMEOUT_MS = 20000;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok && origin ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

// Constant-time compare for the access key.
function keyOk(given, want) {
  let d = given.length ^ want.length;
  for (let i = 0; i < Math.max(given.length, want.length); i++) d |= (given.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  return d === 0;
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort("timeout"), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// Shared caller for OpenAI-compatible APIs (Groq, DeepSeek, Qwen, Gemini).
async function callOpenAICompatible(url, key, model, messages) {
  const t = withTimeout(PROVIDER_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: t.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.4 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content;
    if (!text) throw new Error("empty response");
    return text;
  } finally {
    t.done();
  }
}

async function callAnthropic(key, model, messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const t = withTimeout(PROVIDER_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: t.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages: rest }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const text = d?.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("empty response");
    return text;
  } finally {
    t.done();
  }
}

function providers(env) {
  const list = [];
  if (env.AI) {
    list.push({
      name: "workers-ai",
      run: async (msgs) => {
        const out = await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: msgs });
        if (!out?.response) throw new Error("empty response");
        return out.response;
      },
    });
  }
  if (env.GROQ_API_KEY)
    list.push({ name: "groq", run: (m) => callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, env.GROQ_MODEL || "llama-3.3-70b-versatile", m) });
  if (env.DEEPSEEK_API_KEY)
    list.push({ name: "deepseek", run: (m) => callOpenAICompatible("https://api.deepseek.com/chat/completions", env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL || "deepseek-chat", m) });
  if (env.QWEN_API_KEY)
    list.push({ name: "qwen", run: (m) => callOpenAICompatible("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", env.QWEN_API_KEY, env.QWEN_MODEL || "qwen-plus", m) });
  if (env.GEMINI_API_KEY)
    list.push({ name: "gemini", run: (m) => callOpenAICompatible("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-2.5-flash", m) });
  if (env.ANTHROPIC_API_KEY)
    list.push({ name: "claude", run: (m) => callAnthropic(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || "claude-haiku-4-5", m) });
  return list;
}

function buildMessages(body) {
  const director = DIRECTORS[body.director] ? body.director : "LECTOR";
  let system = DIRECTORS[director];
  if (body.persona && PERSONAS[body.persona]) system += "\n" + PERSONAS[body.persona];
  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
        .slice(-MAX_HISTORY)
        .map((h) => ({ role: h.role, content: h.content.slice(0, MAX_MESSAGE) }))
    : [];
  return [{ role: "system", content: system }, ...history, { role: "user", content: body.message.slice(0, MAX_MESSAGE) }];
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "titanium-core", version: "1.0.0", providers: providers(env).map((p) => p.name) }, 200, cors);
    }

    if (url.pathname !== "/api/chat" && url.pathname !== "/") return json({ error: "not_found" }, 404, cors);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    // Closed by key: fail closed when ACCESS_KEY is not configured (wrangler secret put ACCESS_KEY).
    if (!env.ACCESS_KEY) return json({ error: "access_key_not_configured" }, 503, cors);
    if (!keyOk(request.headers.get("x-access-key") || "", env.ACCESS_KEY)) {
      await new Promise((r) => setTimeout(r, 400));
      return json({ error: "unauthorized" }, 401, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }
    if (!body || typeof body.message !== "string" || !body.message.trim()) {
      return json({ error: "message_required" }, 400, cors);
    }

    const messages = buildMessages(body);
    const chain = providers(env);
    if (chain.length === 0) return json({ error: "no_providers_configured" }, 503, cors);

    const tried = [];
    for (const p of chain) {
      try {
        const text = await p.run(messages);
        return json({ reply: text, provider: p.name, fallbacks: tried }, 200, cors);
      } catch (e) {
        tried.push({ provider: p.name, error: String(e?.message || e) });
      }
    }
    return json({ error: "all_providers_failed", tried }, 502, cors);
  },
};

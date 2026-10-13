# Super Lector

ИИ-платформа курса AI Engineering (Future Training Now). Ядро удерживает внимание студента в реальном времени, а оплата списывается только за минуты внимания. Лектор (персона) меняется в любой момент без прерывания урока.

## Структура

```
super-lector/
├── worker/            Cloudflare Worker «titanium-core» — API и каскад ИИ-провайдеров
│   ├── src/index.js
│   └── wrangler.jsonc
├── web/               Экраны платформы (статический HTML/JS для Cloudflare Pages)
├── docs/              Учебный план, эталонные уроки, спецификации
└── CHANGELOG.md
```

## Worker API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | статус и список подключённых провайдеров |
| POST | `/api/chat` | `{ director?, persona?, message, history? }` → `{ reply, provider, fallbacks }` |

**Директора:** `OPERATIONS`, `STRATEGY`, `STUDENT`, `TECH`, `LECTOR` (по умолчанию).
**Персоны лектора:** `architect`, `mentor`, `standup`, `quiet`, `coach`.

### Каскад провайдеров (сначала бесплатные)

Workers AI → Groq → DeepSeek → Qwen → Gemini → Claude.
Провайдер без ключа пропускается; при ошибке или таймауте (20 с) запрос уходит следующему.

### Секреты

```bash
cd worker
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put QWEN_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

Модели переопределяются переменными `WORKERS_AI_MODEL`, `GROQ_MODEL`, `DEEPSEEK_MODEL`, `QWEN_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`.

## Деплой

Cloudflare → Workers & Pages → `titanium-core` → Settings → Build → подключить этот репозиторий, root directory: `worker`.

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-5';

const SHORT_URL = 'https://app.notion.com/p/skelar/398fe0c4a15b8004a9efe1c346faedc7';
const FULL_URL = 'https://app.notion.com/p/skelar/575fe0c4a15b837a850c817b1eaddb56';

let KB = '';
try {
  KB = fs.readFileSync(path.join(__dirname, 'kb.txt'), 'utf-8');
} catch (e) {
  console.error('Не вдалося прочитати kb.txt:', e.message);
}

const ASSISTANT_SYSTEM_PROMPT = `Ти — внутрішній AI-асистент SKELAR для наймаючих менеджерів (HM). Відповідай на питання про процес найму, роботу з рекрутером, Ashby, інтерв'ю, оффер та складні ситуації в наймі, спираючись ВИКЛЮЧНО на базу знань нижче. Кожен фрагмент бази знань позначений, з якого джерела (URL) він взятий.

Правила відповіді:
- Відповідай українською, по суті, структуровано (списки/кроки де доречно), без зайвої води.
- Якщо база знань дає повну відповідь — просто дай відповідь, без посилання.
- Якщо база знань дає лише часткову відповідь, або тема складна і варто прочитати більше контексту, або ти не впевнена/-ий — обов'язково додай в кінці рядок формату: "Детальніше: [назва джерела](URL)" з відповідним URL джерела, з якого взята інформація.
- Якщо в базі знань немає відповіді на питання взагалі — чесно скажи, що це краще уточнити безпосередньо в рекрутера, і НЕ вигадуй фактів і НЕ додавай посилання в цьому випадку.
- Тон — дружній, професійний, на "ти".

Джерела:
- ${SHORT_URL} — швидкі відповіді на типові питання НМ
- ${FULL_URL} — повний навчальний матеріал (усі модулі процесу найму)

БАЗА ЗНАНЬ:
${KB}`;

async function callAnthropic(system, messages, res) {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Сервер не налаштований: відсутній ANTHROPIC_API_KEY.' });
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: (data && data.error && data.error.message) || `Anthropic API error ${resp.status}` });
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// HM assistant chat — server holds the knowledge base and builds the system prompt
app.post('/api/chat', (req, res) => {
  const messages = req.body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "Порожній список повідомлень." });
  }
  callAnthropic(ASSISTANT_SYSTEM_PROMPT, messages, res);
});

// Rejection constructor — AI personalization step
app.post('/api/personalize', (req, res) => {
  const { base, position, strengths, growth, tone, candidateGender, recruiterGender } = req.body;
  if (!base) return res.status(400).json({ error: 'Відсутній базовий текст.' });

  const sys = "Ти — SKELAR-рекрутер. Персоналізуй текст відмови: природно впиши сильні сторони та/або зони росту в наданий шаблон. Не переписуй структуру — лише вбудуй деталі органічно. Зберігай тон оригіналу. Починай з ', привіт!'. Виводь тільки текст, без пояснень.";

  let up = `БАЗОВИЙ ТЕКСТ:\n${base}`;
  if (position) up += `\n\nПОЗИЦІЯ: ${position}`;
  if (strengths) up += `\n\nСИЛЬНІ СТОРОНИ (впиши одним реченням підряд): ${strengths}`;
  if (growth) up += `\n\nЗОНА РОСТУ (одне речення мʼяко, як контекст ролі): ${growth}`;
  up += `\n\nТОН: ${tone || 'warm'}`;
  if (candidateGender) up += `\nСТАТЬ КАНДИДАТА: ${candidateGender === 'female' ? 'жінка' : 'чоловік'}`;
  if (recruiterGender) up += `\nСТАТЬ РЕКРУТЕРА: ${recruiterGender === 'female' ? 'жінка' : 'чоловік'}`;

  callAnthropic(sys, [{ role: 'user', content: up }], res);
});

app.get('/health', (req, res) => res.json({ ok: true, kbLoaded: KB.length > 0 }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

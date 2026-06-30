// ============================================================
// MEMORY.JS — SCORPION AI PERSISTENT MEMORY v1.0
// ============================================================
// Stores and retrieves long-term memory for Scorpion AI
// using Vercel KV (Redis). Memory is injected into every
// chat request so Scorpion remembers who you are, what you
// trade, and what matters to you across all sessions.
//
// Storage key: scorpion_memory (single JSON object)
//
// Memory shape:
//   {
//     user_facts: string[],           // discovered facts about user
//     conversation_summaries: string[], // rolling 10-entry log
//     watched_assets: string[],       // symbols mentioned >1 time
//     asset_mention_counts: {},       // tracks mention frequency
//     last_updated: string            // ISO timestamp
//   }
//
// Functions:
//   readMemory()  — fetch + format for system prompt injection
//   writeMemory() — extract + merge new facts after a reply
//
// Author  : Dr. Davie Mwangi
// Version : 1.0.0
// ============================================================

import { kv } from '@vercel/kv';

const MEMORY_KEY    = 'scorpion_memory';
const MAX_SUMMARIES = 10;
const MAX_FACTS     = 30;
const MAX_ASSETS    = 20;

// ── EMPTY MEMORY TEMPLATE ───────────────────────────────────
function emptyMemory() {
  return {
    user_facts:              [],
    conversation_summaries:  [],
    watched_assets:          [],
    asset_mention_counts:    {},
    last_updated:            new Date().toISOString()
  };
}

// ── READ MEMORY ─────────────────────────────────────────────
// Called at the start of every chat request.
// Returns a formatted string ready to inject into system prompt.
// Fails silently — if KV is down, chat still works without memory.
export async function readMemory() {
  try {
    const raw = await kv.get(MEMORY_KEY);
    if (!raw) return '';

    const mem = typeof raw === 'string' ? JSON.parse(raw) : raw;

    let block = '';

    if (mem.user_facts?.length) {
      block += 'KNOWN USER FACTS:\n';
      mem.user_facts.forEach(f => { block += '- ' + f + '\n'; });
      block += '\n';
    }

    if (mem.watched_assets?.length) {
      block += 'ASSETS USER MONITORS: ' + mem.watched_assets.join(', ') + '\n\n';
    }

    if (mem.conversation_summaries?.length) {
      block += 'RECENT CONVERSATION HISTORY (newest last):\n';
      mem.conversation_summaries.forEach((s, i) => {
        block += '[' + (i + 1) + '] ' + s + '\n';
      });
      block += '\n';
    }

    return block.trim()
      ? '=== SCORPION MEMORY (from past sessions) ===\n' + block.trim() + '\n\n'
      : '';

  } catch (e) {
    console.error('[memory.js] readMemory error:', e.message);
    return '';
  }
}

// ── WRITE MEMORY ────────────────────────────────────────────
// Called AFTER the response has been streamed — does not block.
// Sends the exchange through Cerebras to extract memorable facts,
// then merges into existing memory and writes back to KV.
//
// Skips trivial exchanges (greetings, short messages, YouTube plays).
export async function writeMemory(userMessage, assistantReply, cerebrasKey) {
  try {
    // ── Skip trivial exchanges ──────────────────────────────
    const msg = (userMessage || '').toLowerCase().trim();
    const SKIP_PATTERNS = [
      /^(hello|hi|hey|thanks|thank you|bye|goodbye|good morning|good evening|good night)/,
      /^(stop|pause|resume|next|previous|mute|unmute|volume)/,
      /^play\s+/,
      /^(what time|what's the time|current time)/
    ];
    if (msg.length < 8 || SKIP_PATTERNS.some(p => p.test(msg))) return;

    // ── Load existing memory ────────────────────────────────
    let mem = emptyMemory();
    try {
      const raw = await kv.get(MEMORY_KEY);
      if (raw) mem = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // ensure all fields exist on old memory objects
      mem.user_facts             = mem.user_facts             || [];
      mem.conversation_summaries = mem.conversation_summaries || [];
      mem.watched_assets         = mem.watched_assets         || [];
      mem.asset_mention_counts   = mem.asset_mention_counts   || {};
    } catch (e) { /* start fresh */ }

    // ── Extract assets mentioned in this exchange ───────────
    const ASSET_PATTERNS = [
      /\b(XAU\/USD|XAUUSD|gold)\b/gi,
      /\b(XAG\/USD|XAGUSD|silver)\b/gi,
      /\b(NAS100|NASDAQ|US100)\b/gi,
      /\b(BTC|bitcoin)\b/gi,
      /\b(ETH|ethereum)\b/gi,
      /\b(R_10|R_25|R_50|R_75|R_100|1HZ10V|1HZ25V|1HZ50V|1HZ75V|1HZ100V)\b/gi,
      /\b(EUR\/USD|EURUSD)\b/gi,
      /\b(GBP\/USD|GBPUSD)\b/gi,
      /\b(USD\/KES|USDKES|KES)\b/gi,
      /\b(SOL|solana)\b/gi,
      /\b(XRP|ripple)\b/gi
    ];

    const combinedText = userMessage + ' ' + assistantReply;
    ASSET_PATTERNS.forEach(pattern => {
      const matches = combinedText.match(pattern) || [];
      matches.forEach(match => {
        const key = match.toUpperCase().replace(/\s+/g, '');
        mem.asset_mention_counts[key] = (mem.asset_mention_counts[key] || 0) + 1;
        if (mem.asset_mention_counts[key] >= 2 && !mem.watched_assets.includes(key)) {
          mem.watched_assets.push(key);
          if (mem.watched_assets.length > MAX_ASSETS) mem.watched_assets.shift();
        }
      });
    });

    // ── Ask Cerebras to extract memorable facts ─────────────
    if (cerebrasKey) {
      try {
        const extractSystem = `You are a memory extraction system for Scorpion AI.
Analyse this conversation exchange and extract ONLY facts worth remembering long-term about the user.
Examples of worth remembering: trading instruments, location, preferences, job, goals, recurring topics.
Examples of NOT worth remembering: one-off questions, prices (they change), news, weather.

Output ONLY valid JSON, nothing else. No markdown, no backticks.

JSON shape:
{
  "new_facts": ["fact 1", "fact 2"],
  "summary": "2-3 sentence summary of this exchange"
}

If nothing worth remembering, return: {"new_facts": [], "summary": ""}`;

        const extractUser = `USER MESSAGE: ${userMessage.slice(0, 500)}\n\nASSISTANT REPLY: ${assistantReply.slice(0, 500)}`;

        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cerebrasKey },
          body: JSON.stringify({
            model: 'llama3.1-8b',
            temperature: 0,
            max_tokens: 300,
            messages: [
              { role: 'system', content: extractSystem },
              { role: 'user',   content: extractUser   }
            ]
          })
        });

        const data = await r.json();
        const raw  = data.choices?.[0]?.message?.content?.trim();

        if (raw) {
          const cleaned  = raw.replace(/```json|```/g, '').trim();
          const extracted = JSON.parse(cleaned);

          // Merge new facts — deduplicate by checking similarity
          if (extracted.new_facts?.length) {
            extracted.new_facts.forEach(fact => {
              const factLower = fact.toLowerCase();
              const alreadyKnown = mem.user_facts.some(f =>
                f.toLowerCase().slice(0, 30) === factLower.slice(0, 30)
              );
              if (!alreadyKnown) {
                mem.user_facts.push(fact);
              }
            });
            // Cap at MAX_FACTS — drop oldest
            if (mem.user_facts.length > MAX_FACTS) {
              mem.user_facts = mem.user_facts.slice(-MAX_FACTS);
            }
          }

          // Add summary to rolling window
          if (extracted.summary && extracted.summary.trim()) {
            const timestamp = new Date().toLocaleString('en-US', {
              timeZone: 'Africa/Nairobi',
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit', hour12: true
            });
            mem.conversation_summaries.push('[' + timestamp + '] ' + extracted.summary.trim());
            // Keep rolling window of MAX_SUMMARIES
            if (mem.conversation_summaries.length > MAX_SUMMARIES) {
              mem.conversation_summaries = mem.conversation_summaries.slice(-MAX_SUMMARIES);
            }
          }
        }
      } catch (e) {
        console.error('[memory.js] extraction error:', e.message);
        // Still proceed to save asset data even if extraction failed
      }
    }

    // ── Write updated memory back to KV ─────────────────────
    mem.last_updated = new Date().toISOString();
    await kv.set(MEMORY_KEY, JSON.stringify(mem));

  } catch (e) {
    console.error('[memory.js] writeMemory error:', e.message);
    // Silent fail — never block the chat flow
  }
}

// ── WIPE MEMORY ─────────────────────────────────────────────
// Called when user says "forget everything" or "clear your memory"
export async function wipeMemory() {
  try {
    await kv.set(MEMORY_KEY, JSON.stringify(emptyMemory()));
    return true;
  } catch (e) {
    console.error('[memory.js] wipeMemory error:', e.message);
    return false;
  }
}

// ── API HANDLER ─────────────────────────────────────────────
// Direct endpoint — GET to read, DELETE to wipe
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-scorpion-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Auth check ──────────────────────────────────────────
  const SECRET = process.env.APP_SECRET;
  if (SECRET && req.headers['x-scorpion-key'] !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const raw = await kv.get(MEMORY_KEY);
      const mem = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : emptyMemory();
      return res.status(200).json(mem);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    const success = await wipeMemory();
    return res.status(200).json({ success, message: success ? 'Memory wiped, Sir.' : 'Wipe failed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = { runtime: 'edge' };

// ============================================================
//  LOGGING HELPERS — color-coded, timestamped, structured
// ============================================================
const _ts = () => new Date().toISOString();
const log = {
  info:  (...a) => console.log(  `[${_ts()}] ℹ️  INFO `, ...a),
  ok:    (...a) => console.log(  `[${_ts()}] ✅  OK   `, ...a),
  warn:  (...a) => console.warn( `[${_ts()}] ⚠️  WARN `, ...a),
  error: (...a) => console.error(`[${_ts()}] ❌  ERROR`, ...a),
  debug: (...a) => console.log(  `[${_ts()}] 🐛  DEBUG`, ...a),
  api:   (...a) => console.log(  `[${_ts()}] 🌐  API  `, ...a),
};

export default async function handler(req) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const debugLog = [];              // accumulate per-request debug trail
  const pushDebug = (entry) => { debugLog.push({ t: _ts(), ...entry }); };

  log.info(`[${requestId}] ── NEW REQUEST ─────────────────────────`);
  log.debug(`[${requestId}] Method: ${req.method}  URL: ${req.url}`);

  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    log.info(`[${requestId}] CORS preflight — returning 200`);
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    // ── Parse body ──
    let body;
    try {
      body = await req.json();
      log.debug(`[${requestId}] Parsed body:`, JSON.stringify(body).slice(0, 500));
      pushDebug({ step: 'parse_body', ok: true, keys: Object.keys(body) });
    } catch (parseErr) {
      log.error(`[${requestId}] Body parse failed:`, parseErr.message);
      pushDebug({ step: 'parse_body', ok: false, error: parseErr.message });
      return new Response(JSON.stringify({
        reply: 'Invalid request body — expected JSON with { "message": "..." }',
        debug: debugLog,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { message } = body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      log.warn(`[${requestId}] Empty or missing "message" field`);
      pushDebug({ step: 'validate_message', ok: false, received: typeof message });
      return new Response(JSON.stringify({
        reply: 'Missing "message" field in request body.',
        debug: debugLog,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    log.info(`[${requestId}] User message (${message.length} chars): "${message.slice(0, 120)}…"`);
    pushDebug({ step: 'validate_message', ok: true, len: message.length });

    // ── API key check ──
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      log.error(`[${requestId}] 🔑 GOOGLE_GEMINI_API_KEY is NOT set in environment!`);
      pushDebug({ step: 'api_key_check', ok: false });
      return new Response(JSON.stringify({
        reply: 'Server config error: GOOGLE_GEMINI_API_KEY is not set. Add it in Vercel → Settings → Environment Variables.',
        debug: debugLog,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const maskedKey = apiKey.slice(0, 6) + '…' + apiKey.slice(-4);
    log.ok(`[${requestId}] 🔑 API key present (${maskedKey}), length=${apiKey.length}`);
    pushDebug({ step: 'api_key_check', ok: true, masked: maskedKey, len: apiKey.length });

    // ── Model cascade ──
    const models = [
      'gemini-2.5-flash-preview-04-17',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ];
    log.info(`[${requestId}] Will try ${models.length} models: ${models.join(' → ')}`);

    let lastError = '';

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const attempt = i + 1;
      log.api(`[${requestId}] ── Attempt ${attempt}/${models.length}  model=${model}`);
      pushDebug({ step: 'model_attempt', attempt, model });

      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        log.debug(`[${requestId}] POST ${apiUrl.replace(apiKey, '***')}`);

        const payload = {
          contents: [{ parts: [{ text: message }] }],
        };
        log.debug(`[${requestId}] Payload size: ${JSON.stringify(payload).length} bytes`);

        const t0 = Date.now();
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const elapsed = Date.now() - t0;

        log.api(`[${requestId}] Response: status=${response.status} (${elapsed}ms)`);
        pushDebug({ step: 'api_response', model, status: response.status, ms: elapsed });

        let data;
        try {
          data = await response.json();
          log.debug(`[${requestId}] Response keys: ${Object.keys(data).join(', ')}`);
        } catch (jsonErr) {
          log.error(`[${requestId}] Failed to parse API JSON:`, jsonErr.message);
          pushDebug({ step: 'api_json_parse', model, ok: false, error: jsonErr.message });
          lastError = `JSON parse error from ${model}`;
          continue;
        }

        // ── Success? ──
        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          const replyText = data.candidates[0].content.parts[0].text;
          log.ok(`[${requestId}] ✅ SUCCESS with model=${model}  reply_length=${replyText.length}  latency=${elapsed}ms`);
          pushDebug({ step: 'success', model, reply_len: replyText.length, ms: elapsed });

          return new Response(JSON.stringify({
            reply: replyText,
            model_used: model,
            latency_ms: elapsed,
            debug: debugLog,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ── Failure detail ──
        lastError = data.error?.message || JSON.stringify(data).slice(0, 300);
        log.warn(`[${requestId}] Model ${model} rejected: ${lastError}`);
        pushDebug({ step: 'model_rejected', model, error: lastError });

        if (data.error?.status === 'RESOURCE_EXHAUSTED') {
          log.warn(`[${requestId}] Rate-limited on ${model} — trying next`);
        }
        if (data.error?.code === 403) {
          log.error(`[${requestId}] 403 Forbidden on ${model} — key may lack access`);
        }

        continue; // next model

      } catch (fetchErr) {
        log.error(`[${requestId}] Fetch exception on model=${model}:`, fetchErr.message);
        pushDebug({ step: 'fetch_exception', model, error: fetchErr.message });
        lastError = fetchErr.message;
        continue;
      }
    }

    // ── All models exhausted ──
    log.error(`[${requestId}] ❌ ALL ${models.length} MODELS FAILED.  Last error: ${lastError}`);
    pushDebug({ step: 'all_models_failed', error: lastError });

    return new Response(JSON.stringify({
      reply: `All models failed. Last error: ${lastError}`,
      debug: debugLog,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    log.error(`[${requestId}] 💥 UNHANDLED EXCEPTION:`, err.message, err.stack);
    pushDebug({ step: 'unhandled_exception', error: err.message, stack: err.stack });
    return new Response(JSON.stringify({
      reply: `Server error: ${err.message}`,
      debug: debugLog,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

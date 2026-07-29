export const config = { runtime: 'edge' };

const CHAT_MODEL = 'gemini-2.0-flash';
const IMAGE_MODEL = 'gemini-3.1-flash-image';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ASPECT_RATIO_MAP = {
  '1:1': 'ASPECT_RATIO_1_1',
  '16:9': 'ASPECT_RATIO_16_9',
  '9:16': 'ASPECT_RATIO_9_16',
  '4:3': 'ASPECT_RATIO_4_3',
  '3:4': 'ASPECT_RATIO_3_4',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function normalizeRole(role) {
  return role === 'assistant' ? 'model' : 'user';
}

function buildChatContents(message, history = []) {
  const contents = Array.isArray(history)
    ? history
        .filter(
          (item) =>
            item &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0 &&
            (item.role === 'user' || item.role === 'assistant')
        )
        .slice(-12)
        .map((item) => ({
          role: normalizeRole(item.role),
          parts: [{ text: item.content.trim() }],
        }))
    : [];

  const trimmedMessage = String(message || '').trim();

  const last = contents[contents.length - 1];
  const lastText = last?.parts?.[0]?.text?.trim();
  const lastRole = last?.role;

  // Avoid duplicating the current user message if frontend already included it in history
  if (!last || lastRole !== 'user' || lastText !== trimmedMessage) {
    contents.push({
      role: 'user',
      parts: [{ text: trimmedMessage }],
    });
  }

  return contents;
}

async function callGemini(model, payload) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GOOGLE_GEMINI_API_KEY is not set in Vercel environment variables.'
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Gemini request failed with status ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

function extractTextAndImage(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];

  let text = '';
  let image = null;

  for (const part of parts) {
    if (!text && typeof part?.text === 'string') {
      text = part.text;
    }

    const inline = part?.inlineData || part?.inline_data;
    if (!image && inline?.data) {
      image = {
        data: inline.data,
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
      };
    }
  }

  return { text, image };
}

async function handleChat(message, history) {
  const payload = {
    system_instruction: {
      parts: [
        {
          text:
            'You are a helpful, concise, accurate AI assistant. Use markdown when helpful. Be direct and useful.',
        },
      ],
    },
    contents: buildChatContents(message, history),
    generation_config: {
      temperature: 0.7,
    },
  };

  const data = await callGemini(CHAT_MODEL, payload);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text =
    parts.find((p) => typeof p?.text === 'string')?.text ||
    'No response text returned.';

  return { reply: text };
}

async function handleImage(prompt, aspectRatio) {
  const mappedAspectRatio =
    ASPECT_RATIO_MAP[aspectRatio] || 'ASPECT_RATIO_1_1';

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(prompt || '').trim() }],
      },
    ],
    generation_config: {
      response_modalities: ['TEXT', 'IMAGE'],
      response_format: {
        image: {
          // THIS is the fix: Gemini expects enum values, not "1:1"
          aspect_ratio: mappedAspectRatio,
        },
      },
    },
  };

  const data = await callGemini(IMAGE_MODEL, payload);
  const { text, image } = extractTextAndImage(data);

  if (!image?.data) {
    throw new Error('Image generation succeeded but no image data was returned.');
  }

  return {
    text: text || 'Here is your generated image.',
    image,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const mode = body.mode === 'image' ? 'image' : 'chat';

    if (mode === 'image') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      const aspectRatio =
        typeof body.aspectRatio === 'string' ? body.aspectRatio : '1:1';

      if (!prompt) {
        return json({ error: 'Missing image prompt.' }, 400);
      }

      const result = await handleImage(prompt, aspectRatio);
      return json(result);
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];

    if (!message) {
      return json({ error: 'Missing message.' }, 400);
    }

    const result = await handleChat(message, history);
    return json(result);
  } catch (error) {
    return json(
      {
        error: error?.message || 'Unexpected server error.',
      },
      500
    );
  }
}

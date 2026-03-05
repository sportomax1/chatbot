import OpenAI from "openai";

export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    const prompt = body.prompt;
    const model = body.model || "gemini"; // Default to Gemini (free), can be "openai"

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    console.log(`[${model.toUpperCase()}] Sending prompt:`, prompt);

    if (model === "openai") {
      return await handleOpenAI(prompt, res);
    } else if (model === "gemini") {
      return await handleGemini(prompt, res);
    } else {
      return res.status(400).json({ error: "Invalid model. Use 'openai' or 'gemini'" });
    }

  } catch (err) {

    console.error("API Error:", err);

    res.status(500).json({
      error: err.message,
      details: err.toString()
    });

  }

}

async function handleOpenAI(prompt, res) {
  
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY not set in environment" });
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: prompt }
    ],
    max_tokens: 500
  });

  const reply = completion.choices[0].message.content;
  console.log("[OPENAI] Success:", reply);

  res.status(200).json({
    reply: reply,
    model: "openai"
  });

}

async function handleGemini(prompt, res) {

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return res.status(500).json({ error: "GOOGLE_GEMINI_API_KEY not set in environment" });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[GEMINI] API Error:", data);
    return res.status(response.status).json({ 
      error: data.error?.message || "Gemini API error" 
    });
  }

  const reply = data.candidates[0].content.parts[0].text;
  console.log("[GEMINI] Success:", reply);

  res.status(200).json({
    reply: reply,
    model: "gemini"
  });

}

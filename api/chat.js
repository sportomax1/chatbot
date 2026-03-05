export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { message } = await req.json();
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ reply: "Error: Config missing (API Key)." }), { status: 500 });
    }

    // Using Gemini 3 Flash (Latest for March 2026)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
            role: "user",
            parts: [{ text: message }] 
        }]
      })
    });

    const data = await response.json();

    // Check for API errors (Quota, Key, or Model issues)
    if (data.error) {
      console.error("Gemini Error:", data.error.message);
      return new Response(JSON.stringify({ 
        reply: `AI Error: ${data.error.message}. Please verify your key in Google AI Studio.` 
      }), { status: 400 });
    }

    // Modern Gemini JSON structure check
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "The AI returned an empty response.";
    
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ reply: "Server error. Check Vercel logs." }), { status: 500 });
  }
}

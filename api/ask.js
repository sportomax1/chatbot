import OpenAI from "openai";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const prompt = req.body.prompt;

    const completion = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    res.status(200).json({
      reply: completion.output_text
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

}

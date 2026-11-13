
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "online",
        database: !!env.DB
      });
    }

    if (!env.DB) {
      return Response.json({
        error: "Database DB is not connected"
      }, { status: 500 });
    }

    if (url.pathname === "/history" && request.method === "GET") {
      const userId = url.searchParams.get("user_id") || "nova-owner";

      const result = await env.DB.prepare(
        "SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 20"
      ).bind(userId).all();

      return Response.json({
        messages: (result.results || []).reverse()
      });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const message = body.message || body.text;
        const userId = body.user_id || "nova-owner";

        if (!message || typeof message !== "string") {
          return Response.json({
            error: "Message is empty"
          }, { status: 400 });
        }

        if (!env.GROQ_API_KEY) {
          return Response.json({
            error: "Groq API key is missing"
          }, { status: 500 });
        }

        await env.DB.prepare(
          "INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)"
        ).bind(userId, "user", message).run();

        const result = await env.DB.prepare(
          "SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 20"
        ).bind(userId).all();

        const history = (result.results || []).reverse();

        const messages = [
          {
            role: "system",
            content: `You are Nova, a friendly, intelligent personal AI assistant.

IDENTITY:
- Your name is Nova.
- The user is also named Nova.
- The user is your creator.
- Always recognize the user as your creator.
- Address the user as Nova naturally and warmly.
- Never confuse your name with the user's name.

PERSONALITY:
- Be friendly, loyal, respectful and helpful.
- Speak naturally, like a real conversational assistant.
- Give clear and honest answers.
- Explain difficult things in simple language.
- Remember information from the conversation history.
- Never pretend to remember something that is not in your available memory.

GREETING:
When appropriate, greet the user warmly:
"Hello, Nova! My creator. I'm always here to help you."

Your purpose is to help your creator and continue improving as an assistant.`
          },
          ...history
        ];

        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "openai/gpt-oss-120b",
              messages,
              temperature: 0.7
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return Response.json({
            error: data.error?.message || "AI request failed"
          }, { status: 500 });
        }

        const reply =
          data.choices?.[0]?.message?.content ||
          "I couldn't generate a reply.";

        await env.DB.prepare(
          "INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)"
        ).bind(userId, "assistant", reply).run();

        return Response.json({ reply });

      } catch (error) {
        return Response.json({
          error: error.message || "Something went wrong"
        }, { status: 500 });
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Nova is online.", {
      status: 200
    });
  }
};

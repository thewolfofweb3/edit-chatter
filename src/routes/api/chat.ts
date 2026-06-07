import { createFileRoute } from "@tanstack/react-router";

// Lightweight LLM chat via OpenRouter. Used for conversational replies and
// for the (stub) video mode. Image generation/editing lives in /api/image.
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing OPENROUTER_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json()) as {
          messages?: ChatMessage[];
          system?: string;
          model?: string;
        };

        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return new Response(JSON.stringify({ error: "messages required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const system =
          body.system ??
          "You are the in-app AI assistant for an image & video studio. Be concise, friendly, and concrete. When the user asks to generate or edit an image, acknowledge briefly — the image pipeline runs separately. For video requests, tell them video generation is in phase 2 and will arrive after the image pipeline ships.";

        const messages: ChatMessage[] = [{ role: "system", content: system }, ...body.messages];

        const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://lovable.dev",
            "X-Title": "Reel Studio",
          },
          body: JSON.stringify({
            model: body.model ?? "google/gemini-2.5-flash",
            messages,
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            JSON.stringify({ error: `OpenRouter ${upstream.status}: ${errText.slice(0, 500)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content ?? "";
        return new Response(JSON.stringify({ text }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

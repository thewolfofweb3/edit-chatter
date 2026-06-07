import { createFileRoute } from "@tanstack/react-router";

// Image generation + editing via OpenRouter's Gemini image model
// (google/gemini-2.5-flash-image-preview, aka Nano Banana). Supports:
//   - generate: prompt only
//   - edit:     prompt + base image + (optional) mask image; the client
//               composites the original pixels back outside the mask, so
//               this endpoint just needs to return a coherent edit.
type ImageRequest = {
  prompt: string;
  mode: "generate" | "edit";
  imageBase64?: string; // raw base64, no data: prefix
  maskBase64?: string;  // white = edit region, black = keep
};

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            Allow: "POST, OPTIONS",
          },
        });
      },
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: { Allow: "POST, OPTIONS" },
        });
      },
      POST: async ({ request }) => {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing OPENROUTER_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json()) as ImageRequest;
        if (!body.prompt || typeof body.prompt !== "string") {
          return new Response(JSON.stringify({ error: "prompt required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const userContent: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [];

        if (body.mode === "edit" && body.imageBase64) {
          userContent.push({
            type: "text",
            text:
              "Edit the provided image. The second image (if present) is a mask: WHITE pixels indicate the region the user wants changed; BLACK pixels must stay identical. Change ONLY the masked region. User instruction: " +
              body.prompt,
          });
          userContent.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${body.imageBase64}` },
          });
          if (body.maskBase64) {
            userContent.push({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${body.maskBase64}` },
            });
          }
        } else {
          userContent.push({ type: "text", text: body.prompt });
        }

        const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://lovable.dev",
            "X-Title": "Reel Studio",
          },
          body: JSON.stringify({
            model: "google/gemini-3-pro-image-preview",
            modalities: ["image", "text"],
            messages: [{ role: "user", content: userContent }],
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            JSON.stringify({ error: `OpenRouter ${upstream.status}: ${errText.slice(0, 600)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as {
          choices?: {
            message?: {
              content?: string;
              images?: { image_url?: { url?: string } }[];
            };
          }[];
        };

        const msg = data.choices?.[0]?.message;
        const url = msg?.images?.[0]?.image_url?.url;
        if (!url || !url.startsWith("data:image/")) {
          return new Response(
            JSON.stringify({
              error: "No image returned by model",
              text: msg?.content ?? "",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        // Pass through the data URL; client will decode + (for edits) composite.
        return new Response(JSON.stringify({ dataUrl: url, text: msg?.content ?? "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

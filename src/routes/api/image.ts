import { createFileRoute } from "@tanstack/react-router";

// Image generation + editing via OpenAI GPT Image.
// Keep this route server-only: the API key is read from process.env here,
// never sent to the browser.
type ImageRequest = {
  prompt: string;
  mode: "generate" | "edit";
  imageBase64?: string; // raw base64, no data: prefix
  maskBase64?: string;  // white = edit region, black = keep
  size?: { width: number; height: number; ratio?: string; label?: string };
};

function openAiImageSize(size?: ImageRequest["size"]): "1024x1024" | "1024x1536" | "1536x1024" | "auto" {
  if (!size?.width || !size?.height) return "auto";
  const ratio = size.width / size.height;
  if (ratio > 1.12) return "1536x1024";
  if (ratio < 0.9) return "1024x1536";
  return "1024x1024";
}

function animationPrompt(prompt: string, size?: ImageRequest["size"]) {
  return [
    "Create a stylized animation/digital art image only. No photorealism, no live-action camera look, no realistic human skin, no documentary/photo aesthetic.",
    "Use clean digital illustration, anime/cinematic animation language, graphic lighting, strong silhouettes, readable composition, and polished production-art detail.",
    "Maintain style consistency across related assets and preserve referenced visual identity when editing or reframing.",
    size?.label ? `Target composition: ${size.label}.` : "",
    `User request: ${prompt}`,
  ].filter(Boolean).join("\n");
}

function base64ToFile(base64: string, name: string, type = "image/png") {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type });
}

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
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY. Add it to .env or Codespaces secrets, then restart the dev server." }), {
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

        const size = openAiImageSize(body.size);
        const prompt = animationPrompt(body.prompt, body.size);
        const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

        if (body.mode === "edit" && body.imageBase64) {
          const form = new FormData();
          form.set("model", imageModel);
          form.set("prompt", [
            prompt,
            "Edit the provided image. If a mask is present, regenerate only the white masked area and blend it naturally into the animation frame.",
          ].join("\n"));
          form.set("size", size);
          form.set("quality", process.env.OPENAI_IMAGE_QUALITY || "high");
          form.set("image", base64ToFile(body.imageBase64, "source.png"));
          if (body.maskBase64) {
            form.set("mask", base64ToFile(body.maskBase64, "mask.png"));
          }

          const upstream = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
          });

          if (!upstream.ok) {
            const errText = await upstream.text();
            return new Response(
              JSON.stringify({ error: `OpenAI ${upstream.status}: ${errText.slice(0, 600)}` }),
              { status: upstream.status, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await upstream.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
          const b64 = data.data?.[0]?.b64_json;
          if (!b64) {
            return new Response(JSON.stringify({ error: "No image returned by OpenAI" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ dataUrl: `data:image/png;base64,${b64}`, text: data.data?.[0]?.revised_prompt ?? "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const upstream = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: imageModel,
            prompt,
            size,
            quality: process.env.OPENAI_IMAGE_QUALITY || "high",
            output_format: "png",
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            JSON.stringify({ error: `OpenAI ${upstream.status}: ${errText.slice(0, 600)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) {
          return new Response(JSON.stringify({ error: "No image returned by OpenAI" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ dataUrl: `data:image/png;base64,${b64}`, text: data.data?.[0]?.revised_prompt ?? "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

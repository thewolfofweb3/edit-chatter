// Client-side image utilities for the marked-region edit pipeline.
// The mask tells the image model what the user pointed at; the model returns
// a coherent full-frame edit so shadows, outlines, and style can blend.

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// Build an alpha mask PNG at the given output dimensions. Opaque white marks
// the user's highlighted/painted focus area; transparent pixels stay context.
// `strokes` are in canvas-display coordinates; we scale them to output dims.
export function buildMaskDataUrl(
  strokes: { x: number; y: number }[][],
  displayW: number,
  displayH: number,
  outW: number,
  outH: number,
  brushRadiusDisplay = 18,
  selections: { x: number; y: number; w: number; h: number }[] = [],
): string {
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, outW, outH);

  const sx = outW / Math.max(1, displayW);
  const sy = outH / Math.max(1, displayH);
  const radius = brushRadiusDisplay * Math.max(sx, sy);

  // GPT Image masks need alpha. Transparent pixels are unmarked context;
  // opaque white pixels are the user-highlighted edit focus.
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = radius * 2;

  for (const r of selections) {
    ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
  }

  for (const s of strokes) {
    if (s.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].x * sx, s[0].y * sy);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x * sx, s[i].y * sy);
    ctx.stroke();
    // Cap with circles so single-point strokes still register.
    for (const p of s) {
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c.toDataURL("image/png");
}

export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

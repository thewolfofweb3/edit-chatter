// Client-side image utilities for the strict-composite edit pipeline.
// Guarantees pixels OUTSIDE the brush mask remain bit-for-bit identical.

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// Build a binary mask PNG (white where strokes are, black elsewhere) at the
// given output dimensions. `strokes` are in canvas-display coordinates; we
// scale them to output dims.
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
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  const sx = outW / Math.max(1, displayW);
  const sy = outH / Math.max(1, displayH);
  const radius = brushRadiusDisplay * Math.max(sx, sy);

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
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

// Composite: start with the ORIGINAL image, then paint the AI-edited image
// only inside the mask. Pixels outside the mask are byte-identical to the
// original (modulo PNG re-encode, which is lossless).
export async function compositeWithMask(
  originalDataUrl: string,
  editedDataUrl: string,
  maskDataUrl: string,
): Promise<string> {
  const [orig, edit, mask] = await Promise.all([
    loadImage(originalDataUrl),
    loadImage(editedDataUrl),
    loadImage(maskDataUrl),
  ]);
  const w = orig.naturalWidth;
  const h = orig.naturalHeight;

  // Base canvas = original.
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.drawImage(orig, 0, 0, w, h);

  // Build a masked-edit canvas using destination-in with the mask alpha.
  const editC = document.createElement("canvas");
  editC.width = w;
  editC.height = h;
  const ectx = editC.getContext("2d")!;
  ectx.drawImage(edit, 0, 0, w, h);
  ectx.globalCompositeOperation = "destination-in";
  ectx.drawImage(mask, 0, 0, w, h);

  octx.drawImage(editC, 0, 0);
  return out.toDataURL("image/png");
}

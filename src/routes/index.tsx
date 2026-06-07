import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film, Layers, Wand2, Settings,
  Folder, Download, Upload, Send, ChevronDown,
  MessageSquarePlus, History, Paperclip,
  SquareDashedMousePointer, MousePointer2, Plus, Brush,
  ArrowLeft, Pencil, Trash2, X, FileText, MessageSquare,
  LayoutGrid, Library, Sparkles, Clock, Save, LayoutTemplate, GraduationCap,
  Target,
} from "lucide-react";
import { buildMaskDataUrl, compositeWithMask, dataUrlToBase64, loadImage } from "@/lib/imageOps";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reel — AI Video Studio" },
      { name: "description", content: "An AI video & image studio. Chat to create, edit, and refine." },
    ],
  }),
  component: Studio,
});

type Attachment = { id: number; name: string; type: string; url?: string };
type Msg = { id: number; role: "user" | "ai"; text: string; attachments?: Attachment[] };
type Chat = { id: number; name: string; messages: Msg[]; updatedAt: number };
type Sel = { x: number; y: number; w: number; h: number };
type Tool = "move" | "select" | "brush";
type Pt = { x: number; y: number };
type Stroke = Pt[];
type Preset = { label: string; w: number; h: number; ratio: string };
type PanelView = "chat" | "history";

const SIZE_PRESETS: Preset[] = [
  { label: "Landscape · 1920×1080", w: 1920, h: 1080, ratio: "16 / 9" },
  { label: "Portrait · 1080×1920", w: 1080, h: 1920, ratio: "9 / 16" },
  { label: "Square · 1080×1080", w: 1080, h: 1080, ratio: "1 / 1" },
  { label: "Vertical 4:5 · 1080×1350", w: 1080, h: 1350, ratio: "4 / 5" },
  { label: "Cinema 21:9 · 2560×1080", w: 2560, h: 1080, ratio: "21 / 9" },
  { label: "4K · 3840×2160", w: 3840, h: 2160, ratio: "16 / 9" },
];
const FPS_PRESETS = [24, 30, 60];



function Studio() {
  const [chats, setChats] = useState<Chat[]>([
    { id: 1, name: "Untitled chat", messages: [], updatedAt: Date.now() },
  ]);
  const [currentChatId, setCurrentChatId] = useState<number>(1);
  const [panelView, setPanelView] = useState<PanelView>("chat");
  const [activeTab, setActiveTab] = useState<string>("workspace");
  
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [projectName, setProjectName] = useState("untitled-project");
  const [projectRenaming, setProjectRenaming] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"video" | "photo">("photo");
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeOpen) return;
    function onDown(e: MouseEvent) {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modeOpen]);

  useEffect(() => {
    if (!plusOpen) return;
    function onDown(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const [input, setInput] = useState("");
  const [chatWidth, setChatWidth] = useState(380);
  const [shellWidth, setShellWidth] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [fps, setFps] = useState(30);
  const [menu, setMenu] = useState<null | "size" | "fps">(null);

  const currentChat = chats.find((c) => c.id === currentChatId) ?? chats[0];
  const messages = currentChat?.messages ?? [];

  const [selection, setSelection] = useState<Sel | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);

  // Preview image (the AI-generated / edited image shown in the canvas).
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  const draggingRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Tool dock dragging
  const [dockPos, setDockPos] = useState({ x: 0, y: 0 });
  const [dockDragging, setDockDragging] = useState(false);
  const dockPressRef = useRef<{ mx: number; my: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dockSuppressClickRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const p = dockPressRef.current;
      if (!p) return;
      const dx = e.clientX - p.mx;
      const dy = e.clientY - p.my;
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      dockSuppressClickRef.current = true;
      setDockDragging(true);
      setDockPos({ x: p.ox + dx, y: p.oy + dy });
    }
    function onUp() {
      if (dockPressRef.current) {
        dockPressRef.current = null;
        setDockDragging(false);
        // clear suppression after the click event has fired
        setTimeout(() => { dockSuppressClickRef.current = false; }, 0);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      // Available space for chat (rail = 48px, handle = 4px)
      const available = Math.max(0, rect.width - 48 - 4);
      const raw = rect.right - e.clientX;
      const MIN_CHAT = 280;
      const MIN_PREVIEW = 320;
      const SNAP_CLOSE = 140;
      let next = Math.max(0, Math.min(available, raw));
      // Snap chat closed when dragged past the close threshold
      if (raw < SNAP_CLOSE) {
        next = 0;
      } else if (raw < MIN_CHAT) {
        // Resist at minimum chat width
        next = MIN_CHAT;
      } else if (available - raw < SNAP_CLOSE) {
        // Snap preview closed (chat takes full width)
        next = available;
      } else if (available - raw < MIN_PREVIEW) {
        // Resist at minimum preview width
        next = available - MIN_PREVIEW;
      }
      setChatWidth(next);
    }
    function onUp() {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Track shell width so we can hide overlay controls when the preview collapses
  useEffect(() => {
    if (!shellRef.current) return;
    const el = shellRef.current;
    const update = () => setShellWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const previewWidth = Math.max(0, shellWidth - 48 - 4 - chatWidth);
  const previewCollapsed = shellWidth > 0 && previewWidth < 240;



  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function updateChat(id: number, updater: (c: Chat) => Chat) {
    setChats((cs) => cs.map((c) => (c.id === id ? updater(c) : c)));
  }

  function pushMessage(role: "user" | "ai", text: string, attachments?: Attachment[]) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    updateChat(currentChatId, (c) => ({
      ...c,
      updatedAt: Date.now(),
      messages: [...c.messages, { id, role, text, attachments }],
    }));
    return id;
  }

  async function send() {
    const t = input.trim();
    if ((!t && pendingAttachments.length === 0) || isThinking) return;

    // Snapshot any masked region as a chat attachment so the user can SEE
    // exactly what the AI is being shown.
    const hasStrokes = strokes.length > 0 && !!previewImage;
    const userAtts: Attachment[] = [...pendingAttachments];
    let maskDataUrl: string | null = null;

    if (hasStrokes && previewImage && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      try {
        const img = await loadImage(previewImage);
        maskDataUrl = buildMaskDataUrl(
          strokes,
          rect.width,
          rect.height,
          img.naturalWidth,
          img.naturalHeight,
          18,
        );
        // Build a visual preview chip = original w/ red stroke overlay.
        const chip = document.createElement("canvas");
        chip.width = img.naturalWidth;
        chip.height = img.naturalHeight;
        const cctx = chip.getContext("2d")!;
        cctx.drawImage(img, 0, 0);
        const maskImg = await loadImage(maskDataUrl);
        cctx.globalAlpha = 0.55;
        cctx.globalCompositeOperation = "source-over";
        // Tint the mask red.
        const tint = document.createElement("canvas");
        tint.width = chip.width; tint.height = chip.height;
        const tctx = tint.getContext("2d")!;
        tctx.drawImage(maskImg, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = "rgba(239, 68, 68, 1)";
        tctx.fillRect(0, 0, tint.width, tint.height);
        cctx.drawImage(tint, 0, 0);
        cctx.globalAlpha = 1;
        userAtts.push({
          id: Date.now(),
          name: "highlighted-region.png",
          type: "image/png",
          url: chip.toDataURL("image/png"),
        });
      } catch (e) {
        console.error("mask snapshot failed", e);
      }
    }

    pushMessage("user", t, userAtts.length ? userAtts : undefined);
    setInput("");
    setPendingAttachments([]);
    setIsThinking(true);

    try {
      // Build conversation history for the orchestrator.
      const history = [...messages, { role: "user" as const, text: t }].map((m) => ({
        role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
        content: m.text || "(no text)",
      }));

      // Step 1 — orchestrator decides: chat reply vs image action.
      const routeRes = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          hasImage: !!previewImage,
          hasMask: hasStrokes,
          mode,
        }),
      });
      const decision = await routeRes.json();
      if (!routeRes.ok) {
        pushMessage("ai", `⚠️ ${decision.error || "Orchestrator failed"}`);
        return;
      }

      // Video mode is still a stub — always chat.
      if (mode === "video" || decision.action === "chat") {
        pushMessage("ai", decision.reply || "…");
        return;
      }

      // Step 2 — image action. Announce, then run the pipeline.
      if (decision.reply) pushMessage("ai", decision.reply);

      const isEdit = !!decision.isEdit && !!previewImage && hasStrokes;
      const imgPrompt: string = decision.prompt || t;

      const r = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt,
          mode: isEdit ? "edit" : "generate",
          imageBase64: isEdit && previewImage ? dataUrlToBase64(previewImage) : undefined,
          maskBase64: isEdit && maskDataUrl ? dataUrlToBase64(maskDataUrl) : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.dataUrl) {
        const detail = data.text ? ` — model said: "${data.text.trim()}"` : "";
        pushMessage("ai", `⚠️ ${data.error || "Image generation failed"}${detail}\n\nTip: image models often refuse copyrighted characters (e.g. Bart Simpson, Iron Man). Try a descriptive prompt instead.`);
        return;
      }

      let finalDataUrl: string = data.dataUrl;
      if (isEdit && previewImage && maskDataUrl) {
        try {
          finalDataUrl = await compositeWithMask(previewImage, data.dataUrl, maskDataUrl);
        } catch (e) {
          console.error("composite failed, using raw edit", e);
        }
      }

      setPreviewImage(finalDataUrl);
      setStrokes([]);
      setCurrentStroke(null);
      pushMessage("ai", isEdit ? "Edited the highlighted region." : "Done.", [
        { id: Date.now(), name: isEdit ? "edited.png" : "generated.png", type: "image/png", url: finalDataUrl },
      ]);
    } catch (e) {
      console.error(e);
      pushMessage("ai", `⚠️ ${e instanceof Error ? e.message : "Request failed"}`);
    } finally {
      setIsThinking(false);
    }
  }


  function newChat() {
    const id = Date.now();
    setChats((cs) => {
      const existing = new Set(cs.map((c) => c.name));
      let name = "Untitled chat";
      let n = 2;
      while (existing.has(name)) name = `Untitled chat ${n++}`;
      return [{ id, name, messages: [], updatedAt: Date.now() }, ...cs];
    });
    setCurrentChatId(id);
    setPanelView("chat");
    setInput("");
    setPendingAttachments([]);
    setRenaming(false);
    setPlusOpen(false);
    setMenu(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  }


  function openChat(id: number) {
    setCurrentChatId(id);
    setPanelView("chat");
  }

  function deleteChat(id: number) {
    setChats((cs) => {
      const next = cs.filter((c) => c.id !== id);
      if (next.length === 0) {
        const nid = Date.now();
        const fresh = { id: nid, name: "Untitled chat", messages: [], updatedAt: Date.now() };
        setCurrentChatId(nid);
        return [fresh];
      }
      if (id === currentChatId) setCurrentChatId(next[0].id);
      return next;
    });
  }

  function startRename() {
    setRenameValue(currentChat.name);
    setRenaming(true);
  }
  function commitRename() {
    const v = renameValue.trim() || "Untitled chat";
    updateChat(currentChatId, (c) => ({ ...c, name: v }));
    setRenaming(false);
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const next: Attachment[] = Array.from(files).map((f, i) => ({
      id: Date.now() + i,
      name: f.name,
      type: f.type,
      url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setPendingAttachments((p) => [...p, ...next]);
    e.target.value = "";
  }
  function removePending(id: number) {
    setPendingAttachments((p) => p.filter((a) => a.id !== id));
  }

  // Canvas pointer handlers (select = drag rect, brush = free-draw stroke)
  function canvasPoint(e: React.MouseEvent): Pt | null {
    if (!canvasRef.current) return null;
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onCanvasDown(e: React.MouseEvent) {
    const p = canvasPoint(e);
    if (!p) return;
    if (tool === "select") {
      setDrawing(p);
      setSelection(null);
    } else if (tool === "brush") {
      setCurrentStroke([p]);
    }
  }
  function onCanvasMove(e: React.MouseEvent) {
    const p = canvasPoint(e);
    if (!p) return;
    if (tool === "select" && drawing) {
      setSelection({
        x: Math.min(drawing.x, p.x),
        y: Math.min(drawing.y, p.y),
        w: Math.abs(p.x - drawing.x),
        h: Math.abs(p.y - drawing.y),
      });
    } else if (tool === "brush" && currentStroke) {
      setCurrentStroke((prev) => (prev ? [...prev, p] : prev));
    }
  }
  function onCanvasUp() {
    if (drawing && selection && (selection.w < 8 || selection.h < 8)) {
      setSelection(null);
    }
    setDrawing(null);
    if (currentStroke) {
      if (currentStroke.length > 1) setStrokes((prev) => [...prev, currentStroke]);
      setCurrentStroke(null);
    }
  }

  const cursorClass = tool === "select" || tool === "brush" ? "cursor-crosshair" : "cursor-default";

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-border bg-panel text-sm">
        <div className="flex items-center gap-3">
          <button className="text-muted-foreground hover:text-foreground transition-colors">
            Workspace
          </button>
          <span className="text-muted-foreground/60">/</span>
          {projectRenaming ? (
            <input
              autoFocus
              value={projectRenameValue}
              onChange={(e) => setProjectRenameValue(e.target.value)}
              onBlur={() => {
                setProjectName(projectRenameValue.trim() || "untitled-project");
                setProjectRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setProjectName(projectRenameValue.trim() || "untitled-project");
                  setProjectRenaming(false);
                } else if (e.key === "Escape") {
                  setProjectRenaming(false);
                }
              }}
              className="h-7 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 min-w-0"
            />
          ) : (
            <button
              onClick={() => {
                setProjectRenameValue(projectName);
                setProjectRenaming(true);
              }}
              title="Rename project"
              className="h-7 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 group"
            >
              <span className="truncate">{projectName}</span>
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 font-medium">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <div ref={shellRef} className="relative flex-1 flex min-h-0">
        {/* Left icon rail */}
        <aside className="w-12 bg-rail border-r border-border flex flex-col items-center py-2 gap-1">
          {[
            { id: "workspace", Icon: LayoutGrid, label: "Workspace" },
            { id: "projects", Icon: Folder, label: "Projects" },
            { id: "assets", Icon: Library, label: "Assets" },
            { id: "templates", Icon: LayoutTemplate, label: "Templates" },
            { id: "tutorials", Icon: GraduationCap, label: "Tutorials" },
          ].map(({ id, Icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setActiveTab(id)}
              className={`h-9 w-9 grid place-items-center rounded-md transition-colors ${
                activeTab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          <div className="flex-1" />
          <button className="h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60">
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </aside>

        {/* Workspace */}
        <main className="flex-1 flex flex-col min-w-0 bg-canvas overflow-hidden">
          <div className="relative flex-1 flex flex-col items-center justify-center p-6 pb-4 min-h-0 gap-3">
            {previewCollapsed ? null : (
            <>

            {/* Floating tool dock */}
            <div
              onMouseDown={(e) => {
                dockPressRef.current = { mx: e.clientX, my: e.clientY, ox: dockPos.x, oy: dockPos.y, moved: false };
              }}
              style={{ transform: `translate(calc(-50% + ${dockPos.x}px), ${dockPos.y}px)` }}
              className={`absolute top-4 left-1/2 z-10 flex items-center gap-0.5 p-1 rounded-lg bg-panel/90 border border-border backdrop-blur shadow-lg select-none ${dockDragging ? "cursor-grabbing" : "cursor-grab"}`}
            >
              {[
                { id: "move", Icon: MousePointer2, label: "Move" },
                { id: "select", Icon: SquareDashedMousePointer, label: "Highlight area" },
                { id: "brush", Icon: Brush, label: "Brush (free draw)" },
              ].map(({ id, Icon, label }) => (
                <button
                  key={id}
                  title={label}
                  onClick={() => {
                    if (dockSuppressClickRef.current) return;
                    setTool(id as Tool);
                  }}
                  className={`h-8 w-8 grid place-items-center rounded-md transition-colors cursor-pointer ${
                    tool === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>

            <div
              ref={canvasRef}
              onMouseDown={onCanvasDown}
              onMouseMove={onCanvasMove}
              onMouseUp={onCanvasUp}
              onMouseLeave={onCanvasUp}
              onDoubleClick={() => { setStrokes([]); setCurrentStroke(null); }}
              style={{ aspectRatio: SIZE_PRESETS[sizeIdx].ratio }}
              className={`relative w-full max-w-6xl max-h-full rounded-lg overflow-hidden border border-border shadow-2xl bg-[oklch(0.08_0.003_270)] select-none ${cursorClass}`}
            >
              {previewImage ? (
                <img
                  src={previewImage}
                  alt="Preview"
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-center px-6 pointer-events-none">
                  <div>
                    <p className="text-foreground/80 text-base font-medium">Preview</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Ask the AI to generate an image. Then use the brush to highlight what to change.
                    </p>
                  </div>
                </div>
              )}

              {selection && (
                <div
                  className="absolute border border-primary bg-primary/10 pointer-events-none"
                  style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
                />
              )}

              {(strokes.length > 0 || currentStroke) && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {strokes.map((s, i) => (
                    <polyline
                      key={i}
                      points={s.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                    />
                  ))}
                  {currentStroke && currentStroke.length > 0 && (
                    <polyline
                      points={currentStroke.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                    />
                  )}
                </svg>
              )}
            </div>

            {/* Canvas settings toolbar */}
            <div className="flex items-center gap-1 text-[11px] shrink-0">
              <button
                onClick={() => setActiveTab("assets")}
                title="Save current preview to Assets"
                className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 flex items-center gap-1.5"
              >
                <Save className="h-3 w-3" /> Save to Assets
              </button>
              <span className="text-muted-foreground/50">·</span>
              <div className="relative">
                <button
                  onClick={() => setMenu(menu === "size" ? null : "size")}
                  className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 flex items-center gap-1"
                >
                  {SIZE_PRESETS[sizeIdx].w} × {SIZE_PRESETS[sizeIdx].h}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {menu === "size" && (
                  <div className="absolute bottom-full right-0 mb-1 w-56 rounded-md border border-border bg-panel shadow-lg py-1 z-20">
                    {SIZE_PRESETS.map((p, i) => (
                      <button
                        key={p.label}
                        onClick={() => { setSizeIdx(i); setMenu(null); }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent ${i === sizeIdx ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-muted-foreground/50">·</span>
              <div className="relative">
                <button
                  onClick={() => setMenu(menu === "fps" ? null : "fps")}
                  className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 flex items-center gap-1"
                >
                  {fps}fps
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {menu === "fps" && (
                  <div className="absolute bottom-full right-0 mb-1 w-32 rounded-md border border-border bg-panel shadow-lg py-1 z-20">
                    {FPS_PRESETS.map((f) => (
                      <button
                        key={f}
                        onClick={() => { setFps(f); setMenu(null); }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent ${f === fps ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {f} fps
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </>
            )}
          </div>
        </main>


        {/* Resize handle */}
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/60 transition-colors shrink-0"
        />

        {/* Right: AI chat */}
        <aside style={{ width: chatWidth }} className="bg-panel border-l border-border flex flex-col min-h-0 shrink-0 overflow-hidden">
          <div className="h-11 px-2 flex items-center justify-between border-b border-border gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => setPanelView(panelView === "history" ? "chat" : "history")}
                title={panelView === "history" ? "Back to chat" : "Project chats"}
                className={`h-8 w-8 grid place-items-center rounded-md shrink-0 ${
                  panelView === "history" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {panelView === "history" ? <ArrowLeft className="h-4 w-4" /> : <History className="h-4 w-4" />}
              </button>
              {panelView === "chat" ? (
                renaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    className="h-8 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 min-w-0 flex-1"
                  />
                ) : (
                  <button
                    onClick={startRename}
                    title="Rename chat"
                    className="h-8 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 min-w-0 group"
                  >
                    <span className="truncate">{currentChat.name}</span>
                    <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
                  </button>
                )
              ) : (
                <span className="px-2 text-sm text-foreground/90">Chat history</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={newChat} title="New chat" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {panelView === "history" ? (
            <div className="flex-1 overflow-y-auto py-2">
              {chats.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No chats yet.</div>
              )}
              {[...chats].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => {
                const last = c.messages[c.messages.length - 1];
                const preview = last?.text || (last?.attachments?.length ? `📎 ${last.attachments[0].name}` : "");
                const active = c.id === currentChatId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-l-2 ${
                      active ? "bg-accent/60 border-primary" : "border-transparent hover:bg-accent/40"
                    }`}
                    onClick={() => openChat(c.id)}
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground/90 truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{preview || "No messages yet"}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                      title="Delete chat"
                      className="opacity-0 group-hover:opacity-100 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div key={currentChatId} ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 animate-fade-in">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-accent text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {m.attachments.map((a) => (
                            a.url ? (
                              <img key={a.id} src={a.url} alt={a.name} className="max-h-32 rounded-md border border-border/40" />
                            ) : (
                              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/20 text-xs">
                                <FileText className="h-3 w-3" /> {a.name}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {m.text && <div>{m.text}</div>}
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm bg-accent px-3.5 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                      <span className="thinking-shimmer">Thinking</span>
                      <span className="inline-flex gap-0.5">
                        <span className="thinking-dot" style={{ animationDelay: "0ms" }}>.</span>
                        <span className="thinking-dot" style={{ animationDelay: "150ms" }}>.</span>
                        <span className="thinking-dot" style={{ animationDelay: "300ms" }}>.</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onPickFiles}
                />
                {previewImage && strokes.length > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-xs text-foreground">
                    <Target className="h-3 w-3 text-primary" />
                    <span>Editing highlighted region — your next message edits only the brushed area.</span>
                  </div>
                )}
                <div className="rounded-xl bg-input/60 border border-border focus-within:border-primary/60 transition-colors">
                  {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-2 border-b border-border/60">
                      {pendingAttachments.map((a) => (
                        <div key={a.id} className="group relative flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-background/40 border border-border/60 text-xs">
                          {a.url ? (
                            <img src={a.url} alt={a.name} className="h-5 w-5 object-cover rounded" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          <span className="max-w-[140px] truncate">{a.name}</span>
                          <button
                            onClick={() => removePending(a.id)}
                            className="h-4 w-4 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={2}
                    placeholder="Type here — ask the AI to edit, generate, or refine…"
                    className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <div className="flex items-center justify-between px-2 pb-2">
                    <div className="relative" ref={plusRef}>
                      <button
                        onClick={() => setPlusOpen((v) => !v)}
                        className={`p-1.5 rounded-md hover:bg-accent ${plusOpen ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"}`}
                        title="Add"
                      >
                        <Plus className={`h-4 w-4 transition-transform ${plusOpen ? "rotate-45" : ""}`} />
                      </button>
                      {plusOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-border bg-popover shadow-lg p-1 z-50">
                          <button
                            onClick={() => { setPlusOpen(false); fileInputRef.current?.click(); }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
                          >
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                            <span>Attach file</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="relative" ref={modeRef}>
                        <button
                          onClick={() => setModeOpen((v) => !v)}
                          className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-accent border border-border"
                          title="Mode"
                        >
                          {mode === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          <span className="capitalize">{mode}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform ${modeOpen ? "rotate-180" : ""}`} />
                        </button>
                        {modeOpen && (
                          <div className="absolute bottom-full right-0 mb-2 w-44 rounded-lg border border-border bg-popover shadow-lg p-1 z-50">
                            <button
                              onClick={() => { setMode("video"); setModeOpen(false); }}
                              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent ${mode === "video" ? "bg-accent" : ""}`}
                            >
                              <Film className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                              <div>
                                <div className="text-xs font-medium">Video</div>
                                <div className="text-[10px] text-muted-foreground">Generate & edit videos</div>
                              </div>
                            </button>
                            <button
                              onClick={() => { setMode("photo"); setModeOpen(false); }}
                              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent ${mode === "photo" ? "bg-accent" : ""}`}
                            >
                              <ImageIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                              <div>
                                <div className="text-xs font-medium">Photo</div>
                                <div className="text-[10px] text-muted-foreground">Generate & edit images</div>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={send}
                        className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                        disabled={isThinking || (!input.trim() && pendingAttachments.length === 0)}
                      >
                        Send <Send className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

      </div>


      {/* Status bar */}
      <footer className="h-6 border-t border-border bg-rail text-[11px] text-muted-foreground flex items-center px-3 gap-4">
        <span>● Ready</span>
        <span>Project: untitled-project</span>
        <div className="flex-1" />
        <span>v0.1</span>
      </footer>
    </div>
  );
}

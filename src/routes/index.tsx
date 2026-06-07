import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film, Layers, Wand2, Settings,
  Folder, Download, Upload, Send, ChevronDown,
  MessageSquarePlus, PanelRightClose, PanelRightOpen, History, Paperclip,
  SquareDashedMousePointer, MousePointer2,
  ArrowLeft, Pencil, Trash2, X, FileText, MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reel — AI Video Studio" },
      { name: "description", content: "An AI video & image studio. Chat to create, edit, and refine." },
    ],
  }),
  component: Studio,
});

type Msg = { id: number; role: "user" | "ai"; text: string };
type Sel = { x: number; y: number; w: number; h: number };
type Tool = "move" | "select";
type Preset = { label: string; w: number; h: number; ratio: string };

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
  const [messages, setMessages] = useState<Msg[]>([
    { id: 1, role: "ai", text: "Drop an image or video on the canvas, or just tell me what you want to make. Highlight any area of the preview to ask about just that part." },
  ]);
  const [input, setInput] = useState("");
  const [chatWidth, setChatWidth] = useState(380);
  const [tool, setTool] = useState<Tool>("select");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [fps, setFps] = useState(30);
  const [menu, setMenu] = useState<null | "size" | "fps">(null);

  const [selection, setSelection] = useState<Sel | null>(null);
  
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);

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
      setChatWidth(Math.min(640, Math.max(280, rect.right - e.clientX)));
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send() {
    const t = input.trim();
    if (!t) return;
    const id = Date.now();
    setMessages((m) => [...m, { id, role: "user", text: t }]);
    setInput("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        { id: id + 1, role: "ai", text: "Got it — working on that." },
      ]);
    }, 500);
  }

  // Selection drawing on canvas
  function onCanvasDown(e: React.MouseEvent) {
    if (tool !== "select" || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    setDrawing({ x: e.clientX - r.left, y: e.clientY - r.top });
    setSelection(null);
  }
  function onCanvasMove(e: React.MouseEvent) {
    if (!drawing || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    setSelection({
      x: Math.min(drawing.x, cx),
      y: Math.min(drawing.y, cy),
      w: Math.abs(cx - drawing.x),
      h: Math.abs(cy - drawing.y),
    });
  }
  function onCanvasUp() {
    if (drawing && selection && (selection.w < 8 || selection.h < 8)) {
      setSelection(null);
    }
    setDrawing(null);
  }

  const cursorClass = tool === "select" ? "cursor-crosshair" : "cursor-default";

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-border bg-panel text-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.65_0.18_25)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.78_0.14_85)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.7_0.14_150)]" />
          </div>
          <button className="text-muted-foreground hover:text-foreground">Projects</button>
          <span className="text-muted-foreground/60">/</span>
          <span className="flex items-center gap-1 text-foreground/90">
            untitled-project <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </span>
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

      <div ref={shellRef} className="flex-1 flex min-h-0">
        {/* Left icon rail */}
        <aside className="w-12 bg-rail border-r border-border flex flex-col items-center py-2 gap-1">
          {[
            { Icon: ImageIcon, active: true, label: "Images" },
            { Icon: Film, label: "Clips" },
            { Icon: Layers, label: "Layers" },
            { Icon: Folder, label: "Assets" },
            { Icon: Wand2, label: "Effects" },
          ].map(({ Icon, active, label }) => (
            <button
              key={label}
              title={label}
              className={`h-9 w-9 grid place-items-center rounded-md transition-colors ${
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
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
        <main className="flex-1 flex flex-col min-w-0 bg-canvas">
          <div className="relative flex-1 flex flex-col items-center justify-center p-6 pb-4 min-h-0 gap-3">
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
              onMouseLeave={() => setDrawing(null)}
              style={{ aspectRatio: SIZE_PRESETS[sizeIdx].ratio }}
              className={`relative w-full max-w-6xl max-h-full rounded-lg overflow-hidden border border-border shadow-2xl bg-[oklch(0.08_0.003_270)] select-none ${cursorClass}`}
            >
              <div className="absolute inset-0 grid place-items-center text-center px-6 pointer-events-none">
                <div>
                  <p className="text-foreground/80 text-base font-medium">Preview</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Your image or video will appear here. Use the highlight tool to ask about a specific area.
                  </p>
                </div>
              </div>

              {selection && (
                <div
                  className="absolute border border-primary bg-primary/10 pointer-events-none"
                  style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
                />
              )}
            </div>

            {/* Canvas settings toolbar */}
            <div className="flex items-center gap-1 text-[11px] shrink-0">
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
          </div>
        </main>

        {/* Resize handle */}
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/60 transition-colors"
        />

        {/* Right: AI chat */}
        <aside style={{ width: chatWidth }} className="bg-panel border-l border-border flex flex-col min-h-0 shrink-0">
          <div className="h-11 px-2 flex items-center justify-between border-b border-border gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <button title="Project chats" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0">
                <History className="h-4 w-4" />
              </button>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 min-w-0">
                <span className="truncate">Untitled chat</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
              </button>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="New chat" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button title="Hide panel" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-accent text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.text && <div>{m.text}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-border">
            <div className="rounded-xl bg-input/60 border border-border focus-within:border-primary/60 transition-colors">
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
                <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" title="Attach">
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  onClick={send}
                  className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                  disabled={!input.trim()}
                >
                  Send <Send className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
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

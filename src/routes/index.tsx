import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film, Layers, Wand2, Settings,
  Folder, Download, Upload, Send, ChevronDown,
  MessageSquarePlus, PanelRightClose, History, Paperclip,
  SquareDashedMousePointer, MousePointer2, Hand, X,
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

type Msg = { id: number; role: "user" | "ai"; text: string; selection?: Sel };
type Sel = { x: number; y: number; w: number; h: number };
type Tool = "move" | "select" | "hand";

function Studio() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: 1, role: "ai", text: "Drop an image or video on the canvas, or just tell me what you want to make. Highlight any area of the preview to ask about just that part." },
  ]);
  const [input, setInput] = useState("");
  const [chatWidth, setChatWidth] = useState(380);
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Sel | null>(null);
  const [pendingSel, setPendingSel] = useState<Sel | null>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);

  const draggingRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
    if (!t && !pendingSel) return;
    const id = Date.now();
    setMessages((m) => [...m, { id, role: "user", text: t, selection: pendingSel ?? undefined }]);
    setInput("");
    setPendingSel(null);
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
    if (drawing && selection && selection.w > 8 && selection.h > 8) {
      setPendingSel(selection);
      setTimeout(() => composerRef.current?.focus(), 0);
    }
    setDrawing(null);
  }

  const cursorClass =
    tool === "select" ? "cursor-crosshair" : tool === "hand" ? "cursor-grab" : "cursor-default";

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
          {/* Floating tool dock */}
          <div className="relative flex-1 flex items-center justify-center p-6 min-h-0">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 p-1 rounded-lg bg-panel/90 border border-border backdrop-blur shadow-lg">
              {[
                { id: "move", Icon: MousePointer2, label: "Move" },
                { id: "select", Icon: SquareDashedMousePointer, label: "Highlight area" },
                { id: "hand", Icon: Hand, label: "Pan" },
              ].map(({ id, Icon, label }) => (
                <button
                  key={id}
                  title={label}
                  onClick={() => setTool(id as Tool)}
                  className={`h-8 w-8 grid place-items-center rounded-md transition-colors ${
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
              className={`relative aspect-video w-full max-w-6xl max-h-full rounded-lg overflow-hidden border border-border shadow-2xl bg-[oklch(0.08_0.003_270)] select-none ${cursorClass}`}
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

            <div className="absolute bottom-4 right-6 text-[11px] text-muted-foreground/70">
              1920 × 1080 · 30fps
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
                  {m.selection && (
                    <div className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] px-1.5 py-0.5 rounded ${
                      m.role === "user" ? "bg-primary-foreground/15" : "bg-foreground/10"
                    }`}>
                      <SquareDashedMousePointer className="h-3 w-3" />
                      highlighted area
                    </div>
                  )}
                  {m.text && <div>{m.text}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-border">
            <div className="rounded-xl bg-input/60 border border-border focus-within:border-primary/60 transition-colors">
              {pendingSel && (
                <div className="px-3 pt-2.5">
                  <div className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-primary/15 text-primary border border-primary/30">
                    <SquareDashedMousePointer className="h-3.5 w-3.5" />
                    Highlighted area attached
                    <button onClick={() => setPendingSel(null)} className="hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
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
                placeholder={pendingSel ? "Ask about the highlighted area…" : "Type here — ask the AI to edit, generate, or refine…"}
                className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" title="Attach">
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  onClick={send}
                  className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                  disabled={!input.trim() && !pendingSel}
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

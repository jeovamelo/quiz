import { useEffect, useRef, useState } from "react";
import { Brain, Send, Trash2 } from "lucide-react";
import { localAI, historyDB, type ConversationEntry, type ModelProgress } from "@/lib/local-ai";
import { ModelLoader } from "./ModelLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// Per-hostname session key so history is isolated per environment
const SESSION_ID =
  typeof window !== "undefined" ? `ai-chat-${window.location.hostname}` : "ai-chat-default";

export function LocalAIChat() {
  const [modelProgress, setModelProgress] = useState<ModelProgress>(
    localAI.getProgress(),
  );
  const [messages, setMessages] = useState<ConversationEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [answering, setAnswering] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to model progress updates
  useEffect(() => localAI.subscribe(setModelProgress), []);

  // Load history from IndexedDB on mount (browser only)
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    historyDB.getBySession(SESSION_ID).then(setMessages).catch(() => {});
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, answering]);

  async function handleLoad() {
    try {
      await localAI.load();
    } catch {
      toast.error("Falha ao carregar o modelo. Verifique sua conexão e tente novamente.");
    }
  }

  async function handleSend() {
    if (!question.trim() || answering) return;
    const q = question.trim();
    setQuestion("");
    setAnswering(true);

    // Optimistic user message in UI
    const optimistic: ConversationEntry = {
      sessionId: SESSION_ID,
      role: "user",
      text: q,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await localAI.generateResponse({
        question: q,
        context: context.trim(),
        sessionId: SESSION_ID,
        maxTokens: 200,
      });
      // Refresh from DB to get the saved assistant reply
      const history = await historyDB.getBySession(SESSION_ID);
      setMessages(history);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar resposta.";
      toast.error(msg);
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m !== optimistic));
    } finally {
      setAnswering(false);
    }
  }

  async function handleClear() {
    await historyDB.clearSession(SESSION_ID);
    setMessages([]);
    toast.success("Histórico da sessão limpo.");
  }

  return (
    <Card className="bg-[#161A23] border-[#262D3D] text-white flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-md font-bold flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#F68B1F]" />
            IA Local (Offline)
          </CardTitle>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-[#9CA3AF] hover:text-red-400 gap-1.5"
            >
              <Trash2 className="size-3.5" />
              Limpar
            </Button>
          )}
        </div>
        <CardDescription className="text-[#9CA3AF] text-xs">
          Responde perguntas da plateia sem enviar dados para servidores externos.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 flex-1">
        <ModelLoader {...modelProgress} onStart={handleLoad} />

        {modelProgress.status === "ready" && (
          <>
            {/* Context input */}
            <div className="space-y-1.5">
              <Label className="text-xs text-[#9CA3AF]">
                Contexto dos slides (opcional)
              </Label>
              <Textarea
                rows={2}
                placeholder="Cole o tema ou trecho do slide atual para a IA ter contexto…"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                className="bg-[#0E1015] border-[#262D3D] text-white text-sm resize-none"
              />
            </div>

            {/* Chat window */}
            <div className="flex flex-col gap-2 h-52 overflow-y-auto rounded-lg border border-[#262D3D] p-3 bg-[#0E1015]">
              {messages.length === 0 && !answering ? (
                <p className="text-xs text-[#6B7280] text-center m-auto">
                  Faça uma pergunta para iniciar.
                </p>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-[#F68B1F] text-white"
                          : "bg-[#262D3D] text-[#E5E7EB]"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))
              )}

              {answering && (
                <div className="flex justify-start">
                  <div className="bg-[#262D3D] rounded-xl px-3 py-2 text-sm text-[#9CA3AF] flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#F68B1F] animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-[#F68B1F] animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-[#F68B1F] animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                placeholder="Faça uma pergunta da plateia…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                disabled={answering}
                className="bg-[#0E1015] border-[#262D3D] text-white text-sm"
              />
              <Button
                onClick={handleSend}
                disabled={!question.trim() || answering}
                size="icon"
                className="bg-[#F68B1F] hover:bg-[#F26B1F] text-white shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, CalendarPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/event/new")({
  head: () => ({ meta: [{ title: "Novo Evento — QuizBini" }] }),
  component: NewEvent,
});

function NewEvent() {
  const navigate = useNavigate();
  const { user } = useRequireSpeaker();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [threshold, setThreshold] = useState(70);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!user) return;
    if (!title.trim()) {
      toast.error("Informe o nome do evento");
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase.from("events") as any)
      .insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate ? new Date(startDate).toISOString() : null,
        completion_threshold: Math.min(100, Math.max(0, threshold)) / 100,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error("Falha ao criar evento");
      return;
    }
    toast.success("Evento criado");
    navigate({ to: "/event/$id", params: { id: data.id } });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold">Novo Evento</h1>
          <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
            Cancelar
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="space-y-5 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <CalendarPlus className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Crie o seu evento</h2>
              <p className="text-sm text-muted-foreground">
                Um evento agrupa várias apresentações em sequência. O participante mantém a mesma pontuação acumulada ao longo de todas as palestras.
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="title">Nome do Evento</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Encontro Anual de Inovação"
            />
          </div>
          <div>
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Resumo curto do evento"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="startDate">Data de início (opcional)</Label>
              <Input
                id="startDate"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="threshold">
                Meta de aproveitamento para certificado (%)
              </Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 0)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Participantes que atingirem ou ultrapassarem este percentual de
                acertos poderão baixar o certificado automaticamente.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar Evento
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
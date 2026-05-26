import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, CalendarPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GLOBAL_USER_ID } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/event/new")({
  head: () => ({ meta: [{ title: "Novo Evento — QuizPulse" }] }),
  component: NewEvent,
});

function NewEvent() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!title.trim()) {
      toast.error("Informe o nome do evento");
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase.from("events") as any)
      .insert({ user_id: GLOBAL_USER_ID, title: title.trim() })
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
              placeholder="Ex: Encontro Anual de Inovação BNB"
            />
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
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/voz")({
  component: VozPage,
});

function VozPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
      <Mic className="size-12 text-primary mb-4" />
      <h1 className="text-2xl font-bold mb-2">Teste de Página: /voz</h1>
      <p className="text-muted-foreground mb-6 text-center max-w-md">
        Se você está vendo esta página, o roteamento está funcionando corretamente. 
        Aguarde enquanto restauramos a funcionalidade completa da ElevenLabs.
      </p>
      <Link to="/dashboard">
        <Button variant="outline" className="gap-2">
          <ArrowLeft className="size-4" />
          Voltar ao Dashboard
        </Button>
      </Link>
    </div>
  );
}

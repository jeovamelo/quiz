import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/quiz/$id/edit")({
  head: () => ({ meta: [{ title: "Editar Quiz — QuizPulse" }] }),
  component: () => (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Edição avançada em breve</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Por enquanto, crie um novo quiz para alterar perguntas e PDF.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-primary underline">
          Voltar ao painel
        </Link>
      </div>
    </div>
  ),
});

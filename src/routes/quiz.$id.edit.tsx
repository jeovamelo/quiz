import { createFileRoute, Link, useSearch } from "@tanstack/react-router";

export const Route = createFileRoute("/quiz/$id/edit")({
  head: () => ({ meta: [{ title: "Editar Quiz — QuizPulse" }] }),
  component: EditQuizPage,
});

function EditQuizPage() {
  const { redirect_to_event } = Route.useSearch() as {
    redirect_to_event?: string;
  };

  const backTo = redirect_to_event
    ? { to: "/event/$id" as const, params: { id: redirect_to_event } }
    : { to: "/dashboard" as const };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Edição avançada em breve</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Por enquanto, crie um novo quiz para alterar perguntas e PDF.
        </p>
        <Link
          {...backTo}
          className="mt-4 inline-block text-sm text-primary underline"
        >
          {redirect_to_event ? "Voltar ao evento" : "Voltar ao painel"}
        </Link>
      </div>
    </div>
  );
}

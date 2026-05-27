import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useRequireSpeaker } from "@/hooks/use-auth";

export const Route = createFileRoute("/present/$id/pair")({
  head: () => ({ meta: [{ title: "Apresentação — QuizPulse" }] }),
  component: PairRedirect,
});

// A tela dedicada de pareamento foi substituída por um frame flutuante
// dentro da própria apresentação. Esta rota apenas redireciona para
// /present/$id, onde o overlay de cadastro de controles aparece
// automaticamente quando nenhum controle está pareado.
function PairRedirect() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/present/$id", params: { id }, replace: true });
  }, [id, navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Abrindo apresentação...
    </div>
  );
}

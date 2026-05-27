import { createFileRoute } from "@tanstack/react-router";
import { Present } from "./-present.$id.component";

export const Route = createFileRoute("/present/$id")({
  head: () => ({ meta: [{ title: "Apresentação ao vivo — QuizPulse" }] }),
  component: Present,
});

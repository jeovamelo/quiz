import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/voz")({
  component: () => <div className="min-h-screen bg-background" />,
});

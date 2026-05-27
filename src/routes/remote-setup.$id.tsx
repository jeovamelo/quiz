import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/remote-setup/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/remote/$id/join", params: { id: params.id } });
  },
});
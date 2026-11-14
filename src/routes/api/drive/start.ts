import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/drive/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { beginUrl, publicOrigin, stateCookie } = await import("@/lib/photobook/drive.server");
          const origin = publicOrigin(request);
          const state = crypto.randomUUID();
          const secure = origin.startsWith("https:");
          return new Response(null, {
            status: 302,
            headers: {
              Location: beginUrl(origin, state),
              "Set-Cookie": stateCookie(state, secure),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not start Google Drive.";
          return new Response(message, { status: 500 });
        }
      },
    },
  },
});
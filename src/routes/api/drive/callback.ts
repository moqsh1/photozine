import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { clearStateCookie, exchangeCode, publicOrigin, readState, sessionCookie } = await import("@/lib/photobook/drive.server");
        const origin = publicOrigin(request);
        const secure = origin.startsWith("https:");
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const failure = url.searchParams.get("error");
        if (failure || !code || state !== readState(request)) {
          return new Response(null, { status: 302, headers: { Location: "/?drive=denied" } });
        }
        try {
          const refresh = await exchangeCode(origin, code);
          const headers = new Headers();
          headers.append("Set-Cookie", sessionCookie(refresh, secure));
          headers.append("Set-Cookie", clearStateCookie(secure));
          headers.set("Location", "/?drive=connected");
          return new Response(null, { status: 302, headers });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Google Drive connection failed.";
          return new Response(message, { status: 500 });
        }
      },
    },
  },
});
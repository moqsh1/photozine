import { getRequest } from "@tanstack/react-start/server";

const COOKIE = "pz_drive";
const STATE = "pz_drive_state";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

type Session = { refresh: string };

export function publicOrigin(request: Request): string {
  const host = (request.headers.get("x-forwarded-host") ?? new URL(request.url).host).split(",")[0]?.trim();
  const proto = (request.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Vercel, then redeploy.");
  return { id, secret };
}

export function redirectUri(origin: string) {
  return `${origin}/api/drive/callback`;
}

export function beginUrl(origin: string, state: string) {
  const { id } = creds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function stateCookie(state: string, secure: boolean) {
  return `${STATE}=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function sessionCookie(refresh: string, secure: boolean) {
  const value = encodeURIComponent(JSON.stringify({ refresh } satisfies Session));
  return `${COOKIE}=${value}; HttpOnly; Path=/; Max-Age=15552000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearStateCookie(secure: boolean) {
  return `${STATE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function readCookie(header: string | null, name: string) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function readState(request: Request) {
  return readCookie(request.headers.get("cookie"), STATE);
}

function readSession(request: Request): Session | null {
  const raw = readCookie(request.headers.get("cookie"), COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Session;
    return parsed.refresh ? parsed : null;
  } catch {
    return null;
  }
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as { access_token?: string; refresh_token?: string; error?: string };
  if (!response.ok || !json.access_token) throw new Error(json.error || "Google did not return a token.");
  return json;
}

export async function exchangeCode(origin: string, code: string) {
  const { id, secret } = creds();
  const json = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  );
  if (!json.refresh_token) throw new Error("Google did not allow offline access. Connect again.");
  return json.refresh_token;
}

async function accessToken(refresh: string) {
  const { id, secret } = creds();
  const json = await tokenRequest(
    new URLSearchParams({
      refresh_token: refresh,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  );
  return json.access_token as string;
}

async function ensureFolder(token: string) {
  const query = "appProperties has { key='photozine' and value='book' } and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const listed = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const found = (await listed.json()) as { files?: { id: string }[]; error?: { message: string } };
  if (!listed.ok) throw new Error(found.error?.message || "Could not open Google Drive.");
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Photozine",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { photozine: "book" },
    }),
  });
  const folder = (await created.json()) as { id?: string; error?: { message: string } };
  if (!created.ok || !folder.id) throw new Error(folder.error?.message || "Could not create the Photozine folder.");
  return folder.id;
}

export async function driveAccess() {
  const request = getRequest();
  const session = readSession(request);
  if (!session) throw new Error("Connect Google Drive first.");
  const token = await accessToken(session.refresh);
  const folderId = await ensureFolder(token);
  return { accessToken: token, folderId };
}

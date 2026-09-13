import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type OAuthPaths = { clientPath: string; tokenPath: string };

type OAuthClient = { client_id: string; client_secret: string };
type OAuthToken = { access_token: string; expires_at: number; refresh_token: string };

const AUTHORIZATION_TIMEOUT_MS = 30 * 60_000;

/**
 * Compares two Google addresses as Google itself resolves them: gmail.com
 * ignores dots in the local part, and googlemail.com is an alias for it.
 */
export function sameGoogleAccount(left: string, right: string): boolean {
  const canonical = (email: string) => {
    const [local, domain] = email.trim().toLowerCase().split("@");
    if (!local || !domain) return email.trim().toLowerCase();
    const googleDomain = domain === "googlemail.com" ? "gmail.com" : domain;
    return `${googleDomain === "gmail.com" ? local.replace(/\./g, "") : local}@${googleDomain}`;
  };
  return canonical(left) === canonical(right);
}

async function writePrivateJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function oauthClient(contents: unknown): OAuthClient {
  const source = contents as { installed?: OAuthClient; web?: OAuthClient };
  const client = source.installed ?? source.web;
  if (!client?.client_id || !client.client_secret) throw new Error("Invalid Google OAuth client JSON");
  return client;
}

async function postForm(url: string, values: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OAuth request failed (${response.status}): ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Runs the installed-app OAuth flow with PKCE against a loopback redirect,
 * printing the consent URL and waiting for the browser to come back.
 *
 * @example
 * await authorize({
 *   sourcePath: "~/Downloads/client_secret_x.json",
 *   paths: { clientPath, tokenPath },
 *   scopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
 *   expectedAccount: "you@gmail.com",
 * });
 */
export async function authorize(options: {
  sourcePath: string;
  paths: OAuthPaths;
  scopes: string[];
  expectedAccount: string;
}): Promise<{ account: string }> {
  const { sourcePath, paths, scopes, expectedAccount } = options;
  await mkdir(path.dirname(paths.clientPath), { recursive: true });
  const client = oauthClient(JSON.parse(await readFile(path.resolve(sourcePath), "utf8")));
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");

  const authorization = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const incoming = new URL(request.url ?? "/", "http://127.0.0.1");
      if (incoming.pathname !== "/oauth2callback") return;
      if (incoming.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid OAuth state.");
        reject(new Error("Google OAuth state mismatch"));
      } else if (incoming.searchParams.get("error")) {
        response.writeHead(400).end("Authorization was not granted. You can close this tab.");
        reject(new Error(`Google authorization failed: ${incoming.searchParams.get("error")}`));
      } else {
        const code = incoming.searchParams.get("code");
        if (!code) return;
        response
          .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Google authorization complete. You can close this tab.");
        resolve({
          code,
          redirectUri: `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth2callback`,
        });
      }
      server.close();
    });
    server.listen(0, "127.0.0.1", () => {
      const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth2callback`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: ["openid", "email", ...scopes].join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      console.log(`Open this URL to authorize Google:\n${url}`);
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Google authorization timed out after 30 minutes"));
    }, AUTHORIZATION_TIMEOUT_MS).unref();
  });

  const payload = await postForm("https://oauth2.googleapis.com/token", {
    client_id: client.client_id,
    client_secret: client.client_secret,
    code: authorization.code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: authorization.redirectUri,
  });
  if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
    throw new Error("Google did not return an access and refresh token");
  }

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${payload.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const profile = (await profileResponse.json()) as { email?: string };
  if (!profileResponse.ok || !profile.email) throw new Error("Google did not return the authorized account email");
  if (!sameGoogleAccount(profile.email, expectedAccount)) {
    throw new Error(`Wrong Google account selected (${profile.email}). Expected ${expectedAccount}.`);
  }

  const resolvedSourcePath = path.resolve(sourcePath);
  if (resolvedSourcePath !== paths.clientPath) await copyFile(resolvedSourcePath, paths.clientPath);
  await chmod(paths.clientPath, 0o600);
  await writePrivateJson(paths.tokenPath, {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  } satisfies OAuthToken);

  return { account: profile.email };
}

/** Returns a valid access token, refreshing and re-persisting it when stale. */
export async function accessToken(paths: OAuthPaths): Promise<string> {
  const token = await readJson<OAuthToken>(paths.tokenPath);
  if (token.expires_at > Date.now() + 60_000) return token.access_token;

  const client = oauthClient(await readJson(paths.clientPath));
  const payload = await postForm("https://oauth2.googleapis.com/token", {
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });
  if (typeof payload.access_token !== "string") throw new Error("Google token refresh did not return an access token");

  const refreshed = {
    access_token: payload.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  };
  await writePrivateJson(paths.tokenPath, refreshed);
  return refreshed.access_token;
}

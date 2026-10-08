// One-time OAuth consent for the studio's Google account → GOOGLE_REFRESH_TOKEN in .env.local.
// Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from an OAuth client of type "Desktop app".
// Usage: npm run google:auth   (opens a browser; the token is written to .env.local, never printed)
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}

const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const redirectUri = `http://127.0.0.1:${port}/callback`;
const client = new OAuth2Client({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri });
// offline + consent: Google only returns a refresh token on a fresh consent.
const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

console.log("Opening Google sign-in. Sign in as the STUDIO account that owns the consultations calendar.");
console.log("If nothing opens, paste this URL into a browser:\n" + url);
execFile("open", [url], () => {});

const code = await new Promise<string>((resolve, reject) => {
  server.on("request", (req, res) => {
    const u = new URL(req.url ?? "/", redirectUri);
    if (u.pathname !== "/callback") return void res.end();
    const err = u.searchParams.get("error");
    const c = u.searchParams.get("code");
    res.setHeader("content-type", "text/html");
    res.end(err ? `<p>Google returned: ${err}. You can close this tab.</p>` : "<p>Done. You can close this tab and return to the terminal.</p>");
    err || !c ? reject(new Error(err ?? "no code")) : resolve(c);
  });
});
server.close();

const { tokens } = await client.getToken(code);
if (!tokens.refresh_token) {
  console.error("No refresh token returned. Remove the app's access at myaccount.google.com/permissions and run again.");
  process.exit(1);
}
const granted = (tokens.scope ?? "").split(" ");
const missing = SCOPES.filter((s) => !granted.includes(s));
if (missing.length) console.warn("Warning: consent did not include " + missing.join(", "));

const envFile = ".env.local";
const lines = readFileSync(envFile, "utf8").split("\n");
const i = lines.findIndex((l) => l.startsWith("GOOGLE_REFRESH_TOKEN="));
const line = `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
if (i >= 0) lines[i] = line;
else lines.push(line);
writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
console.log("✓ GOOGLE_REFRESH_TOKEN written to .env.local (not printed). Scopes: " + granted.join(", "));

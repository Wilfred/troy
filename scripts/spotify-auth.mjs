#!/usr/bin/env node

// Tiny local server that runs the Spotify OAuth2 authorization code flow
// and prints your refresh token.
//
// Usage:
//   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/spotify-auth.mjs

import { createServer } from "node:http";

const PORT = 8888;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SCOPES = "user-modify-playback-state user-read-playback-state";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables.",
  );
  process.exit(1);
}

const authorizeUrl =
  `https://accounts.spotify.com/authorize?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(`Authorization failed: ${error || "no code received"}`);
      server.close();
      return;
    }

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();

    if (data.refresh_token) {
      console.log("\n✅ Success! Set this environment variable:\n");
      console.log(`SPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<h2>Done!</h2><p>Your refresh token has been printed in the terminal. You can close this tab.</p>",
      );
    } else {
      console.error("\nToken exchange failed:", data);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Token exchange failed. Check the terminal for details.");
    }

    server.close();
    return;
  }

  // For any other path, redirect to the Spotify authorize page
  res.writeHead(302, { Location: authorizeUrl });
  res.end();
});

server.listen(PORT, () => {
  console.log(`Open this URL in your browser:\n\n  http://localhost:${PORT}\n`);
});

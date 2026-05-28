// Userinfo shim for the `custom:lichess` Supabase OAuth2 provider.
//
// Why this exists: Supabase's native custom OAuth2 provider calls a `userinfo`
// endpoint and expects OIDC-shaped claims (notably a `sub`). Lichess's
// /api/account returns `id`/`username` (no `sub`) and types some fields (e.g.
// `profile`) as objects that collide with GoTrue's claim struct, so pointing
// the provider straight at Lichess fails with "Error getting user profile from
// external provider". This function reshapes the response into the minimal
// claims GoTrue needs.
//
// Supabase calls this with the user's Lichess access token as a Bearer header
// (it never sends a Supabase JWT here), so the function MUST be deployed with
// JWT verification DISABLED. It holds no secrets — it only forwards the token
// the caller already presented to Lichess.

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'missing bearer token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const accountRes = await fetch('https://lichess.org/api/account', {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!accountRes.ok) {
    const body = await accountRes.text();
    return new Response(
      JSON.stringify({ error: 'lichess account fetch failed', status: accountRes.status, body }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const account = (await accountRes.json()) as { id?: string; username?: string };
  if (!account.id) {
    return new Response(JSON.stringify({ error: 'lichess account has no id' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Minimal OIDC-shaped claims. `sub` is the stable Lichess id (lowercased
  // username); `preferred_username` carries the display-cased username that the
  // app reads into profiles.lichess_username (see authService.getOrCreateProfile).
  const claims = {
    sub: account.id,
    preferred_username: account.username ?? account.id,
    name: account.username ?? account.id,
  };

  return new Response(JSON.stringify(claims), {
    headers: { 'Content-Type': 'application/json' },
  });
});

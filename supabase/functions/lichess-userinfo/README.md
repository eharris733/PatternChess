# lichess-userinfo edge function

Userinfo shim for the `custom:lichess` Supabase OAuth2 provider. Supabase's
native custom OAuth2 provider expects OIDC-shaped claims (a `sub`), but Lichess's
`/api/account` returns `id`/`username` with no `sub` and an object-typed
`profile` field that breaks GoTrue's parser. This function sits in as the
`userinfo_url`, forwards the Lichess access token Supabase presents, and returns
`{ sub, preferred_username, name }`.

It holds no secrets and only proxies the token the caller already has.

## Deploy

JWT verification MUST be off — Supabase calls this with the user's *Lichess*
token, not a Supabase JWT.

CLI:

```
supabase functions deploy lichess-userinfo --no-verify-jwt
```

Or Dashboard → Edge Functions → create `lichess-userinfo`, paste `index.ts`,
toggle **Verify JWT off**.

Resulting URL:
`https://ydfwppthwnlgxnntzrvg.supabase.co/functions/v1/lichess-userinfo`

## Configure the provider (Auth → Providers → `custom:lichess`)

- **Userinfo URL** → the function URL above
- **email_optional** → `true` (Lichess returns no email)

The app side (`signInWithLichess`, profile username mapping) is already wired in
`src/services/authService.ts`.

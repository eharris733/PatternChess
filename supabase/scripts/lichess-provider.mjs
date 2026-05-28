// One-off admin script to configure the custom:lichess OAuth2 provider.
// The Supabase dashboard URL-encodes the ':' in the identifier on update/delete
// (sends custom%3Alichess), which the server rejects. The auth-js admin SDK does
// NOT encode the path segment, so this works where the dashboard doesn't.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/lichess-provider.mjs list
//   SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/lichess-provider.mjs update
//
// The service-role key is in Supabase Dashboard → Settings → API. Never commit it.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ydfwppthwnlgxnntzrvg.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cp = supabase.auth.admin.customProviders;
const cmd = process.argv[2] ?? 'list';

if (cmd === 'list') {
  const { data, error } = await cp.listProviders();
  if (error) throw error;
  console.dir(data, { depth: null });
} else if (cmd === 'update') {
  const { data, error } = await cp.updateProvider('custom:lichess', {
    userinfo_url: `${SUPABASE_URL}/functions/v1/lichess-userinfo`,
    email_optional: true,
  });
  if (error) throw error;
  console.log('Updated:');
  console.dir(data, { depth: null });
} else {
  console.error(`Unknown command: ${cmd} (use "list" or "update")`);
  process.exit(1);
}

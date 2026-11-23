// One-off: lists your Buffer organizations and channels so you can copy the
// Instagram and TikTok channel ids into the GitHub variables
// BUFFER_INSTAGRAM_CHANNEL_ID / BUFFER_TIKTOK_CHANNEL_ID (and .env.local).
//
//   BUFFER_API_KEY=… node scripts/social/buffer-channels.ts
import { listChannels } from './buffer.ts';

for (const c of await listChannels()) {
  console.log(`${c.service.padEnd(10)} ${c.id}  ${c.name}  (${c.organization})${c.paused ? '  [queue paused]' : ''}`);
}

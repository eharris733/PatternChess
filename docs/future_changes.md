Future: use time limits instead of depth for more predictable behavior

When pulling from lichess or chess.com api, make sure we only pull new games we don't currently have. Not sure how this can be done. There is a question of scalability. How does this service scale up to 10,000 active users? If 10,000 of them start requesting analysis on their games, then how do we pull the right data? 


Fix auth http://localhost:8080/?code=fda5b05b-c022-4bd5-b00c-ccebe46f06e1 we get this callback and the authservice doesn't know how to handle it


note on batch requests for lichess: # Bad: Multiple requests
for game_id in game_ids:
    curl https://lichess.org/game/export/{game_id}

# Good: Single batch request
curl -X POST https://lichess.org/api/games/export/_ids \
  -d "game1,game2,game3"



  Monitor your usage

Track X-RateLimit-Remaining headers and adjust request frequency before hitting limits.


Higher Limits
Established accounts in good standing
Verified bot accounts
Apps with prior approval (rare, contact support)


IP-Based Limits
Limits also apply per IP address:
Protects against DDoS attacks
Shared hosting may affect multiple users
VPNs/proxies share limits with other users
Cloud providers (AWS, GCP, Azure) may have shared reputation
Using multiple accounts to bypass rate limits violates Lichess Terms of Service and may result in permanent bans.

if the request comes from a user that is logged in with lichess, does that help?
https://www.mintlify.com/lichess-org/lila/api/games/export we can export batch games with time stamps, but it still doesn't solve the problem of thousands of people hitting analyze my game at once. We can have an automatic sync while users do warmup, but this still doesn't solve the scaling issue.

can also export user's puzzle data


currently RLS is disabled on the tables in supabase, so it's a big security concern. 
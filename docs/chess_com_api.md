# Chess.com Public API

## Fetch Player Games

**Endpoint:** `GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}`

Returns all games for a player in a given month.

### Response Format (JSON)

```json
{
  "games": [
    {
      "url": "https://www.chess.com/game/live/12345",
      "pgn": "[Event \"Live Chess\"]...",
      "time_control": "600",
      "rated": true,
      "end_time": 1620000000,
      "white": { "username": "player1", "rating": 1500 },
      "black": { "username": "player2", "rating": 1600 },
      "rules": "chess"
    }
  ]
}
```

### Key Notes
- CORS-friendly: works from browser without proxy
- No authentication required
- PGN includes `{[%clk H:MM:SS]}` clock annotations per move
- `time_control` is in seconds (e.g., "600" = 10 min, "180+2" = 3+2)
- `rated` is a boolean
- `end_time` is Unix timestamp

### Monthly Archives List

`GET https://api.chess.com/pub/player/{username}/games/archives`

Returns list of monthly archive URLs:
```json
{
  "archives": [
    "https://api.chess.com/pub/player/{username}/games/2024/01",
    "https://api.chess.com/pub/player/{username}/games/2024/02"
  ]
}
```

Use this to discover which months have games, then fetch the most recent.

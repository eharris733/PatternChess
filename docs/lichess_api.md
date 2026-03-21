# Lichess API

## Fetch Player Games

**Endpoint:** `GET https://lichess.org/api/games/user/{username}`

### Query Parameters
| Param | Type | Description |
|-------|------|-------------|
| `max` | int | Maximum number of games to return |
| `rated` | bool | Filter by rated games only |
| `perfType` | string | Filter by time control: `ultraBullet`, `bullet`, `blitz`, `rapid`, `classical`, `correspondence` |
| `clocks` | bool | Include `%clk` clock annotations in PGN |
| `evals` | bool | Include `%eval` engine eval annotations in PGN |
| `opening` | bool | Include opening name in PGN tags |

### Headers
- `Accept: application/x-chess-pgn` — returns PGN format (one game per PGN block, separated by blank lines)
- `Accept: application/x-ndjson` — returns NDJSON format

### Example Request
```
GET https://lichess.org/api/games/user/DrNykterstein?max=10&rated=true&perfType=blitz&clocks=true&evals=true
Accept: application/x-chess-pgn
```

### Key Notes
- CORS-friendly for web
- No authentication required for public games
- Response is streamed — for PGN format, games are separated by double newlines
- PGN includes `{[%clk H:MM:SS]}` and optionally `{[%eval #3]}` or `{[%eval 1.42]}` annotations
- Rate limit: generous for anonymous requests

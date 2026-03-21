# Chessground Usage (v9.0.0)

## Interactive Board Pattern

```dart
import 'package:chessground/chessground.dart';
import 'package:dartchess/dartchess.dart';
import 'package:fast_immutable_collections/fast_immutable_collections.dart';

// State
Position position = Chess.initial;
String fen = kInitialBoardFEN;
Move? lastMove;
NormalMove? promotionMove;
ValidMoves validMoves = makeLegalMoves(position);

// Build board
Chessboard(
  size: boardSize,
  orientation: Side.white,
  fen: fen,
  lastMove: lastMove,
  game: GameData(
    playerSide: PlayerSide.white,  // which side user controls
    validMoves: validMoves,        // IMap<Square, ISet<Square>>
    sideToMove: position.turn == Side.white ? Side.white : Side.black,
    isCheck: position.isCheck,
    promotionMove: promotionMove,
    onMove: _onMove,               // (Move move, {bool? viaDragAndDrop}) => void
    onPromotionSelection: _onPromotionSelection,
  ),
  settings: ChessboardSettings(
    pieceAssets: PieceSet.gioco.assets,
    colorScheme: ChessboardColorScheme.brown,
    animationDuration: Duration(milliseconds: 200),
    pieceShiftMethod: PieceShiftMethod.either,
  ),
)
```

## Key APIs

### `makeLegalMoves(Position)` -> `ValidMoves`
Returns `IMap<Square, ISet<Square>>` of all legal moves from each square.

### `GameData`
- `playerSide`: `PlayerSide.white`, `.black`, or `.both`
- `validMoves`: legal moves map
- `onMove`: callback when user makes a move
- `sideToMove`: current turn
- `isCheck`: highlight king if in check
- `promotionMove`: set to show promotion dialog

### Move Handling
```dart
void _onMove(Move move, {bool? viaDragAndDrop}) {
  if (move is NormalMove && _isPromotionPawnMove(move)) {
    setState(() => promotionMove = move);
  } else if (position.isLegal(move)) {
    setState(() {
      position = position.playUnchecked(move);
      lastMove = move;
      fen = position.fen;
      validMoves = makeLegalMoves(position);
    });
  }
}
```

### Promotion Handling
```dart
void _onPromotionSelection(Role? role) {
  if (role != null && promotionMove != null) {
    _onMove(promotionMove!.withPromotion(role));
  }
  setState(() => promotionMove = null);
}
```

## Board Sizing
Use `LayoutBuilder` to get available space, then pass `min(width, height)` as size.
For fixed-size non-interactive boards, use `Chessboard.fixed(size: s, fen: f, orientation: o)`.

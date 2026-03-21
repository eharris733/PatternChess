import 'package:dartchess/dartchess.dart';

class ParsedPosition {
  final String fen;
  final String? sanMove;
  final String? uciMove;
  final int moveNumber;
  final String sideToMove;

  ParsedPosition({
    required this.fen,
    this.sanMove,
    this.uciMove,
    required this.moveNumber,
    required this.sideToMove,
  });
}

class PgnParserService {
  /// Parse a PGN string and return a list of positions with their FENs.
  /// Each position includes the FEN before the move was played.
  static List<ParsedPosition> parseGame(String pgn) {
    final game = PgnGame.parsePgn(pgn);
    Position position = PgnGame.startingPosition(game.headers);
    final positions = <ParsedPosition>[];

    // Add the starting position
    positions.add(ParsedPosition(
      fen: position.fen,
      moveNumber: 1,
      sideToMove: position.turn == Side.white ? 'white' : 'black',
    ));

    int moveNumber = 1;
    for (final node in game.moves.mainline()) {
      final sideToMove = position.turn == Side.white ? 'white' : 'black';
      final move = position.parseSan(node.san);
      if (move == null) break;

      final uciMove = _moveToUci(move);

      // Record the position BEFORE the move with the move that was played
      positions.last = ParsedPosition(
        fen: positions.last.fen,
        sanMove: node.san,
        uciMove: uciMove,
        moveNumber: moveNumber,
        sideToMove: sideToMove,
      );

      position = position.play(move);

      // Add the position AFTER the move
      if (position.turn == Side.white) moveNumber++;
      positions.add(ParsedPosition(
        fen: position.fen,
        moveNumber: moveNumber,
        sideToMove: position.turn == Side.white ? 'white' : 'black',
      ));
    }

    return positions;
  }

  /// Extract headers from a PGN string.
  static Map<String, String> extractHeaders(String pgn) {
    final game = PgnGame.parsePgn(pgn);
    return Map<String, String>.from(game.headers);
  }

  static String _moveToUci(Move move) {
    if (move is NormalMove) {
      final from = move.from.name;
      final to = move.to.name;
      final promo = move.promotion != null ? _roleToChar(move.promotion!) : '';
      return '$from$to$promo';
    }
    return move.toString();
  }

  static String _roleToChar(Role role) {
    switch (role) {
      case Role.queen:
        return 'q';
      case Role.rook:
        return 'r';
      case Role.bishop:
        return 'b';
      case Role.knight:
        return 'n';
      default:
        return '';
    }
  }
}

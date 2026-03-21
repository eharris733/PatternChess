import 'dart:math';

import 'package:flutter/material.dart';
import 'package:chessground/chessground.dart';
import 'package:dartchess/dartchess.dart' as dc;
import 'package:dartchess/dartchess.dart' show Move, NormalMove;
import 'package:fast_immutable_collections/fast_immutable_collections.dart';

class ChessBoardPanel extends StatelessWidget {
  final String fen;
  final dc.Side orientation;
  final PlayerSide playerSide;
  final ValidMoves validMoves;
  final dc.Side sideToMove;
  final bool isCheck;
  final Move? lastMove;
  final NormalMove? promotionMove;
  final void Function(Move move, {bool? viaDragAndDrop})? onMove;
  final void Function(dc.Role? role)? onPromotionSelection;
  final ISet<Shape>? shapes;

  const ChessBoardPanel({
    super.key,
    required this.fen,
    this.orientation = dc.Side.white,
    this.playerSide = PlayerSide.white,
    this.validMoves = const IMapConst({}),
    this.sideToMove = dc.Side.white,
    this.isCheck = false,
    this.lastMove,
    this.promotionMove,
    this.onMove,
    this.onPromotionSelection,
    this.shapes,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = min(constraints.maxWidth, constraints.maxHeight);
        return Center(
          child: Chessboard(
            size: size,
            orientation: orientation,
            fen: fen,
            lastMove: lastMove,
            game: onMove != null
                ? GameData(
                    playerSide: playerSide,
                    validMoves: validMoves,
                    sideToMove: sideToMove,
                    isCheck: isCheck,
                    promotionMove: promotionMove,
                    onMove: onMove!,
                    onPromotionSelection: onPromotionSelection ?? (_) {},
                  )
                : null,
            shapes: shapes,
            settings: const ChessboardSettings(
              colorScheme: ChessboardColorScheme.brown,
              animationDuration: Duration(milliseconds: 200),
              pieceShiftMethod: PieceShiftMethod.either,
              enableCoordinates: true,
            ),
          ),
        );
      },
    );
  }
}

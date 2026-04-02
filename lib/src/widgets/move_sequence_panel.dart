import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class MovePair {
  final int moveNumber;
  final String? whiteMove;
  final String? blackMove;
  final String? whiteLabel;
  final String? blackLabel;
  final Color? whiteLabelColor;
  final Color? blackLabelColor;

  MovePair({
    required this.moveNumber,
    this.whiteMove,
    this.blackMove,
    this.whiteLabel,
    this.blackLabel,
    this.whiteLabelColor,
    this.blackLabelColor,
  });
}

class MoveSequencePanel extends StatelessWidget {
  final List<MovePair> moves;
  final int? activeIndex;
  final void Function(int index)? onTap;

  const MoveSequencePanel({
    super.key,
    required this.moves,
    this.activeIndex,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListView.builder(
        padding: const EdgeInsets.all(8),
        itemCount: moves.length,
        itemBuilder: (context, index) {
          final pair = moves[index];
          return _buildMoveRow(pair, index);
        },
      ),
    );
  }

  Widget _buildMoveRow(MovePair pair, int index) {
    final isWhiteActive = activeIndex != null && activeIndex == index * 2;
    final isBlackActive = activeIndex != null && activeIndex == index * 2 + 1;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: Text(
              '${pair.moveNumber}.',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: _moveCell(
              pair.whiteMove,
              pair.whiteLabel,
              isWhiteActive,
              () => onTap?.call(index * 2),
              pair.whiteLabelColor,
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: _moveCell(
              pair.blackMove,
              pair.blackLabel,
              isBlackActive,
              () => onTap?.call(index * 2 + 1),
              pair.blackLabelColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _moveCell(
      String? move, String? label, bool active, VoidCallback onTap,
      [Color? labelColor]) {
    if (move == null) return const SizedBox();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: active ? AppTheme.accent.withValues(alpha: 0.3) : null,
          borderRadius: BorderRadius.circular(4),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              move,
              style: TextStyle(
                color: active ? AppTheme.textPrimary : AppTheme.textSecondary,
                fontWeight: active ? FontWeight.bold : FontWeight.normal,
                fontSize: 14,
              ),
            ),
            if (label != null) ...[
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: labelColor ??
                      (label == 'Blunder'
                          ? AppTheme.incorrect
                          : label == 'Mistake'
                              ? AppTheme.mistake
                              : label == 'Inaccuracy'
                                  ? AppTheme.inaccuracy
                                  : AppTheme.correct),
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

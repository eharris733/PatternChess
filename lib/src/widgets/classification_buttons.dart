import 'package:flutter/material.dart';

import '../models/game_annotation.dart';
import '../theme/app_theme.dart';

class ClassificationButtons extends StatelessWidget {
  final MoveGrade? current;
  final void Function(MoveGrade grade) onSelect;

  const ClassificationButtons({
    super.key,
    this.current,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (final grade in MoveGrade.values) ...[
          if (grade != MoveGrade.values.first) const SizedBox(width: 8),
          _buildButton(grade),
        ],
      ],
    );
  }

  Widget _buildButton(MoveGrade grade) {
    final isActive = current == grade;

    return Tooltip(
      message: '${grade.label} (${grade.shortLabel})',
      child: Material(
        color: isActive ? grade.color.withValues(alpha: 0.3) : AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => onSelect(grade),
          child: Container(
            width: 56,
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isActive ? grade.color : AppTheme.surfaceLight,
                width: isActive ? 2 : 1,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  grade.shortLabel,
                  style: TextStyle(
                    color: isActive ? grade.color : AppTheme.textSecondary,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  grade.label,
                  style: TextStyle(
                    color: isActive ? grade.color : AppTheme.textSecondary,
                    fontSize: 9,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

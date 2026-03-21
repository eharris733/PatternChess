import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ProgressDisplay extends StatelessWidget {
  final String label;
  final double value;
  final String? valueText;

  const ProgressDisplay({
    super.key,
    required this.label,
    required this.value,
    this.valueText,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                valueText ?? '${(value * 100).toInt()}%',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: value.clamp(0.0, 1.0),
              backgroundColor: AppTheme.surfaceLight,
              valueColor: AlwaysStoppedAnimation(
                value >= 0.8
                    ? AppTheme.correct
                    : value >= 0.5
                        ? AppTheme.accentLight
                        : AppTheme.incorrect,
              ),
              minHeight: 6,
            ),
          ),
        ],
      ),
    );
  }
}

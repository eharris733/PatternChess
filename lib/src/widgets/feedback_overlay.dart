import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class FeedbackOverlay extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String? subtitle;
  final List<Widget>? actions;

  const FeedbackOverlay({
    super.key,
    required this.icon,
    required this.iconColor,
    required this.title,
    this.subtitle,
    this.actions,
  });

  factory FeedbackOverlay.correct({String? subtitle, List<Widget>? actions}) {
    return FeedbackOverlay(
      icon: Icons.check_circle,
      iconColor: AppTheme.correct,
      title: 'SOLUTION CORRECT',
      subtitle: subtitle,
      actions: actions,
    );
  }

  factory FeedbackOverlay.incorrect({String? subtitle, List<Widget>? actions}) {
    return FeedbackOverlay(
      icon: Icons.cancel,
      iconColor: AppTheme.incorrect,
      title: 'INCORRECT',
      subtitle: subtitle,
      actions: actions,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppTheme.background.withValues(alpha: 0.85),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: iconColor),
            const SizedBox(height: 16),
            Text(
              title,
              style: TextStyle(
                color: iconColor,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle!,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 14,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            if (actions != null && actions!.isNotEmpty) ...[
              const SizedBox(height: 20),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: actions!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

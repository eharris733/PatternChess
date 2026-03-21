import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ControlConfig {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool enabled;

  ControlConfig({
    required this.icon,
    required this.label,
    this.onTap,
    this.enabled = true,
  });
}

class BoardControls extends StatelessWidget {
  final List<ControlConfig> controls;

  const BoardControls({super.key, required this.controls});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: controls.map((config) {
          return Expanded(
            child: InkWell(
              onTap: config.enabled ? config.onTap : null,
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      config.icon,
                      color: config.enabled
                          ? AppTheme.textPrimary
                          : AppTheme.textSecondary.withValues(alpha: 0.4),
                      size: 22,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      config.label,
                      style: TextStyle(
                        color: config.enabled
                            ? AppTheme.textSecondary
                            : AppTheme.textSecondary.withValues(alpha: 0.4),
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

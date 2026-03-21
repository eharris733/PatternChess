import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class AppShell extends StatelessWidget {
  final Widget center;
  final Widget? leftPanel;
  final Widget? rightPanel;

  const AppShell({
    super.key,
    required this.center,
    this.leftPanel,
    this.rightPanel,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Row(
          children: [
            if (leftPanel != null)
              SizedBox(
                width: 240,
                child: leftPanel!,
              ),
            Expanded(child: center),
            if (rightPanel != null)
              SizedBox(
                width: 300,
                child: rightPanel!,
              ),
          ],
        ),
      ),
    );
  }
}

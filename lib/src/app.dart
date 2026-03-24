import 'package:flutter/material.dart';

import 'theme/app_theme.dart';
import 'screens/import_screen.dart';
import 'screens/analysis_screen.dart';
import 'screens/training_screen.dart';
import 'screens/benchmark_screen.dart';

class PatternChessApp extends StatelessWidget {
  const PatternChessApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PatternChess',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      initialRoute: '/',
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case '/':
            return MaterialPageRoute(
              builder: (_) => const ImportScreen(),
            );
          case '/analysis':
            final args = settings.arguments as Map<String, dynamic>;
            return MaterialPageRoute(
              builder: (_) => AnalysisScreen(
                gameIds: args['gameIds'] as List<String>,
              ),
            );
          case '/training':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => TrainingScreen(
                gameIds: args?['gameIds'] as List<String>?,
              ),
            );
          case '/benchmark':
            return MaterialPageRoute(
              builder: (_) => const BenchmarkScreen(),
            );
          default:
            return MaterialPageRoute(
              builder: (_) => const ImportScreen(),
            );
        }
      },
    );
  }
}

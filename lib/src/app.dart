import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'theme/app_theme.dart';
import 'screens/dashboard_screen.dart';
import 'screens/vault_screen.dart';
import 'screens/import_screen.dart';
import 'screens/analysis_screen.dart';
import 'screens/training_screen.dart';
import 'screens/benchmark_screen.dart';
import 'screens/login_screen.dart';
import 'screens/profile_screen.dart';
import 'services/auth_service.dart';

class PatternChessApp extends StatefulWidget {
  const PatternChessApp({super.key});

  @override
  State<PatternChessApp> createState() => _PatternChessAppState();
}

class _PatternChessAppState extends State<PatternChessApp> {
  @override
  void initState() {
    super.initState();
    AuthService.authStateChanges.listen((data) {
      if (data.event == AuthChangeEvent.signedIn) {
        AuthService.getOrCreateProfile();
      }
      if (mounted) setState(() {});
    });
  }

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
              builder: (_) => const DashboardScreen(),
            );
          case '/vault':
            return MaterialPageRoute(
              builder: (_) => const VaultScreen(),
            );
          case '/import':
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
          case '/profile':
            return MaterialPageRoute(
              builder: (_) => const ProfileScreen(),
            );
          case '/login':
            return MaterialPageRoute(
              builder: (_) => const LoginScreen(),
            );
          case '/benchmark':
            return MaterialPageRoute(
              builder: (_) => const BenchmarkScreen(),
            );
          default:
            return MaterialPageRoute(
              builder: (_) => const DashboardScreen(),
            );
        }
      },
    );
  }
}

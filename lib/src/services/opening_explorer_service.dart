import 'dart:convert';

import 'package:http/http.dart' as http;

import 'supabase_service.dart';

class ExplorerMove {
  final String uci;
  final String san;
  final int white;
  final int draws;
  final int black;
  final int? averageRating;

  ExplorerMove({
    required this.uci,
    required this.san,
    required this.white,
    required this.draws,
    required this.black,
    this.averageRating,
  });

  int get total => white + draws + black;

  double get whitePercent => total > 0 ? white / total * 100 : 0;
  double get drawPercent => total > 0 ? draws / total * 100 : 0;
  double get blackPercent => total > 0 ? black / total * 100 : 0;

  factory ExplorerMove.fromJson(Map<String, dynamic> json) {
    return ExplorerMove(
      uci: json['uci'] as String,
      san: json['san'] as String,
      white: json['white'] as int,
      draws: json['draws'] as int,
      black: json['black'] as int,
      averageRating: json['averageRating'] as int?,
    );
  }
}

class ExplorerResult {
  final int white;
  final int draws;
  final int black;
  final List<ExplorerMove> moves;

  ExplorerResult({
    required this.white,
    required this.draws,
    required this.black,
    required this.moves,
  });

  int get total => white + draws + black;

  bool get isEmpty => total == 0;

  factory ExplorerResult.fromJson(Map<String, dynamic> json) {
    return ExplorerResult(
      white: json['white'] as int? ?? 0,
      draws: json['draws'] as int? ?? 0,
      black: json['black'] as int? ?? 0,
      moves: (json['moves'] as List?)
              ?.map(
                  (e) => ExplorerMove.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class OpeningExplorerService {
  static final Map<String, ExplorerResult> _memoryCache = {};

  static bool isBookMove(ExplorerResult result, String uci) {
    return result.moves.any((m) => m.uci == uci);
  }

  static Future<ExplorerResult?> fetchMasters(String fen) async {
    // Check in-memory cache first
    if (_memoryCache.containsKey(fen)) {
      return _memoryCache[fen];
    }

    // Check Supabase cache
    try {
      final cached = await SupabaseService.getCachedExplorerResult(fen);
      if (cached != null) {
        final result = ExplorerResult.fromJson(cached);
        _memoryCache[fen] = result;
        return result;
      }
    } catch (_) {
      // Cache miss or error, continue to API
    }

    // Fetch from Lichess masters API
    try {
      final uri = Uri.parse(
          'https://explorer.lichess.org/masters?fen=${Uri.encodeComponent(fen)}');
      final response = await http.get(uri);

      if (response.statusCode != 200) return null;

      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final result = ExplorerResult.fromJson(json);

      // Cache in memory
      _memoryCache[fen] = result;

      // Cache in Supabase (fire and forget)
      try {
        await SupabaseService.cacheExplorerResult(fen, json);
      } catch (_) {
        // Non-critical — cache write failure is ok
      }

      return result;
    } catch (_) {
      return null;
    }
  }
}

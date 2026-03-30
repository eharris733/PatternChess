import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/game_record.dart';
import '../models/blunder.dart';

class SupabaseService {
  static SupabaseClient get _client => Supabase.instance.client;

  static String? get _currentUserId => _client.auth.currentUser?.id;

  // --- Games ---

  static Future<List<GameRecord>> insertGames(
      List<Map<String, dynamic>> games) async {
    final userId = _currentUserId;
    if (userId != null) {
      for (final game in games) {
        game['user_id'] = userId;
      }
    }

    final response = await _client
        .from('games')
        .insert(games)
        .select();

    return (response as List)
        .map((e) => GameRecord.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<GameRecord>> getGames({String? userId}) async {
    var query = _client
        .from('games')
        .select();

    if (userId != null) {
      query = query.eq('user_id', userId);
    }

    final response = await query.order('played_at', ascending: false);

    return (response as List)
        .map((e) => GameRecord.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<GameRecord> getGame(String id) async {
    final response = await _client
        .from('games')
        .select()
        .eq('id', id)
        .single();

    return GameRecord.fromJson(response);
  }

  // --- Blunders ---

  static Future<void> insertBlunders(List<Map<String, dynamic>> blunders) async {
    if (blunders.isEmpty) return;
    final userId = _currentUserId;
    if (userId != null) {
      for (final blunder in blunders) {
        blunder['user_id'] = userId;
      }
    }
    await _client.from('blunders').insert(blunders);
  }

  static Future<List<Blunder>> getBlundersForGames(List<String> gameIds) async {
    final response = await _client
        .from('blunders')
        .select()
        .inFilter('game_id', gameIds)
        .order('move_number');

    return (response as List)
        .map((e) => Blunder.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<Blunder>> getDueBlunders({String? userId}) async {
    final now = DateTime.now().toIso8601String();
    var query = _client
        .from('blunders')
        .select()
        .lte('next_drill_at', now);

    if (userId != null) {
      query = query.eq('user_id', userId);
    }

    final response = await query.order('next_drill_at');

    return (response as List)
        .map((e) => Blunder.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> appendCorrectMove(
      String blunderId, List<CorrectMove> updatedMoves) async {
    await _client.from('blunders').update({
      'correct_moves': updatedMoves.map((e) => e.toJson()).toList(),
    }).eq('id', blunderId);
  }

  static Future<void> updateBlunderAfterDrill(Blunder blunder) async {
    await _client.from('blunders').update({
      'cycle_number': blunder.cycleNumber,
      'last_drilled_at': DateTime.now().toIso8601String(),
      'next_drill_at': blunder.nextDrillDate.toIso8601String(),
      'times_correct': blunder.timesCorrect,
      'times_attempted': blunder.timesAttempted,
    }).eq('id', blunder.id);
  }
}

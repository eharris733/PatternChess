import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/game_record.dart';
import '../models/blunder.dart';

class SupabaseService {
  static SupabaseClient get _client => Supabase.instance.client;

  // --- Games ---

  static Future<List<GameRecord>> insertGames(
      List<Map<String, dynamic>> games) async {
    final response = await _client
        .from('games')
        .insert(games)
        .select();

    return (response as List)
        .map((e) => GameRecord.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<GameRecord>> getGames() async {
    final response = await _client
        .from('games')
        .select()
        .order('played_at', ascending: false);

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

  static Future<List<Blunder>> getDueBlunders() async {
    final now = DateTime.now().toIso8601String();
    final response = await _client
        .from('blunders')
        .select()
        .lte('next_drill_at', now)
        .order('next_drill_at');

    return (response as List)
        .map((e) => Blunder.fromJson(e as Map<String, dynamic>))
        .toList();
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

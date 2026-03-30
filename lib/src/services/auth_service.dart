import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/user_profile.dart';

class AuthService {
  static SupabaseClient get _client => Supabase.instance.client;

  static User? get currentUser => _client.auth.currentUser;
  static bool get isLoggedIn => currentUser != null;
  static Stream<AuthState> get authStateChanges =>
      _client.auth.onAuthStateChange;

  static Future<void> signInWithGoogle() async {
    await _client.auth.signInWithOAuth(
      OAuthProvider.google,
      redirectTo: kIsWeb ? Uri.base.origin : null,
    );
  }

  static Future<void> signOut() async {
    await _client.auth.signOut();
  }

  static Future<UserProfile> getOrCreateProfile() async {
    final user = currentUser;
    if (user == null) throw Exception('Not authenticated');

    final response = await _client
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();

    if (response != null) {
      return UserProfile.fromJson(response);
    }

    final metadata = user.userMetadata ?? {};
    final profile = UserProfile(
      id: user.id,
      displayName: metadata['full_name'] as String? ??
          metadata['name'] as String? ??
          user.email?.split('@').first,
      avatarUrl: metadata['avatar_url'] as String? ??
          metadata['picture'] as String?,
      createdAt: DateTime.now(),
    );

    await _client.from('profiles').insert(profile.toInsertJson());
    return profile;
  }

  static Future<UserProfile?> getProfile() async {
    final user = currentUser;
    if (user == null) return null;

    final response = await _client
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();

    if (response == null) return null;
    return UserProfile.fromJson(response);
  }

  static Future<void> updateProfile(UserProfile profile) async {
    await _client.from('profiles').update({
      'display_name': profile.displayName,
      'avatar_url': profile.avatarUrl,
      'lichess_username': profile.lichessUsername,
      'chesscom_username': profile.chesscomUsername,
    }).eq('id', profile.id);
  }

  static Future<void> claimAnonymousData(String username) async {
    final user = currentUser;
    if (user == null) return;

    await _client
        .from('games')
        .update({'user_id': user.id})
        .eq('username', username)
        .isFilter('user_id', null);

    await _client.rpc('claim_blunders_for_user', params: {
      'p_user_id': user.id,
      'p_username': username,
    }).catchError((_) async {
      // Fallback: claim blunders through their games
      final games = await _client
          .from('games')
          .select('id')
          .eq('user_id', user.id);
      final gameIds = (games as List).map((g) => g['id'] as String).toList();
      if (gameIds.isNotEmpty) {
        await _client
            .from('blunders')
            .update({'user_id': user.id})
            .inFilter('game_id', gameIds)
            .isFilter('user_id', null);
      }
    });
  }
}

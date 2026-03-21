import 'dart:convert';
import 'package:http/http.dart' as http;

class ChessApiService {
  /// Fetch games from chess.com for a given username.
  /// Returns a list of game maps with pgn, metadata, etc.
  static Future<List<Map<String, dynamic>>> fetchChessComGames(
    String username, {
    int maxGames = 10,
    bool ratedOnly = false,
    String? timeControl,
  }) async {
    // Get archive list
    final archivesUrl =
        Uri.parse('https://api.chess.com/pub/player/$username/games/archives');
    final archivesResponse = await http.get(archivesUrl);
    if (archivesResponse.statusCode != 200) {
      throw Exception('Failed to fetch archives for $username');
    }

    final archivesJson =
        jsonDecode(archivesResponse.body) as Map<String, dynamic>;
    final archives = (archivesJson['archives'] as List<dynamic>)
        .map((e) => e as String)
        .toList()
      ..sort((a, b) => b.compareTo(a)); // Most recent first

    final List<Map<String, dynamic>> allGames = [];

    for (final archiveUrl in archives) {
      if (allGames.length >= maxGames) break;

      final response = await http.get(Uri.parse(archiveUrl));
      if (response.statusCode != 200) continue;

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final games = (data['games'] as List<dynamic>)
          .map((e) => e as Map<String, dynamic>)
          .toList()
        ..sort((a, b) =>
            (b['end_time'] as int).compareTo(a['end_time'] as int));

      for (final game in games) {
        if (allGames.length >= maxGames) break;
        if (game['pgn'] == null) continue;
        if (ratedOnly && game['rated'] != true) continue;
        if (timeControl != null && game['time_control'] != timeControl) {
          continue;
        }

        final white = game['white'] as Map<String, dynamic>;
        final black = game['black'] as Map<String, dynamic>;
        final isWhite = (white['username'] as String).toLowerCase() ==
            username.toLowerCase();

        allGames.add({
          'platform': 'chess.com',
          'username': username,
          'opponent': isWhite
              ? black['username'] as String
              : white['username'] as String,
          'pgn': game['pgn'] as String,
          'time_control': game['time_control'] as String?,
          'rated': game['rated'] as bool? ?? false,
          'result': isWhite
              ? white['result'] as String?
              : black['result'] as String?,
          'played_at': game['end_time'] != null
              ? DateTime.fromMillisecondsSinceEpoch(
                      (game['end_time'] as int) * 1000)
                  .toIso8601String()
              : null,
        });
      }
    }

    return allGames;
  }

  /// Fetch games from lichess for a given username.
  /// Returns PGN text which needs to be split into individual games.
  static Future<List<Map<String, dynamic>>> fetchLichessGames(
    String username, {
    int maxGames = 10,
    bool ratedOnly = false,
    String? perfType,
  }) async {
    final params = <String, String>{
      'max': maxGames.toString(),
      'clocks': 'true',
      'evals': 'true',
      'opening': 'true',
    };
    if (ratedOnly) params['rated'] = 'true';
    if (perfType != null) params['perfType'] = perfType;

    final url = Uri.parse(
            'https://lichess.org/api/games/user/$username')
        .replace(queryParameters: params);

    final response = await http.get(url, headers: {
      'Accept': 'application/x-chess-pgn',
    });

    if (response.statusCode != 200) {
      throw Exception('Failed to fetch lichess games for $username');
    }

    final pgnText = response.body;
    if (pgnText.trim().isEmpty) return [];

    // Split PGN text into individual games (separated by double newlines after result)
    final gameTexts = _splitPgnGames(pgnText);
    final List<Map<String, dynamic>> games = [];

    for (final pgn in gameTexts) {
      final headers = _extractPgnHeaders(pgn);
      final white = headers['White'] ?? '';
      final black = headers['Black'] ?? '';
      final isWhite = white.toLowerCase() == username.toLowerCase();

      games.add({
        'platform': 'lichess',
        'username': username,
        'opponent': isWhite ? black : white,
        'pgn': pgn,
        'time_control': headers['TimeControl'],
        'rated': headers['Event']?.contains('Rated') ?? false,
        'result': headers['Result'],
        'played_at': headers['UTCDate'] != null && headers['UTCTime'] != null
            ? _parseLichessDateTime(headers['UTCDate']!, headers['UTCTime']!)
            : null,
      });
    }

    return games;
  }

  static List<String> _splitPgnGames(String pgnText) {
    final games = <String>[];
    final lines = pgnText.split('\n');
    final buffer = StringBuffer();

    for (final line in lines) {
      buffer.writeln(line);
      // A result marker at end of a line indicates game end
      if (RegExp(r'(1-0|0-1|1/2-1/2|\*)\s*$').hasMatch(line) &&
          !line.startsWith('[')) {
        final game = buffer.toString().trim();
        if (game.isNotEmpty) games.add(game);
        buffer.clear();
      }
    }

    // Handle any remaining content
    final remaining = buffer.toString().trim();
    if (remaining.isNotEmpty) games.add(remaining);

    return games;
  }

  static Map<String, String> _extractPgnHeaders(String pgn) {
    final headers = <String, String>{};
    final headerRegex = RegExp(r'\[(\w+)\s+"([^"]*)"\]');
    for (final match in headerRegex.allMatches(pgn)) {
      headers[match.group(1)!] = match.group(2)!;
    }
    return headers;
  }

  static String? _parseLichessDateTime(String date, String time) {
    // date: "2024.01.15", time: "12:30:45"
    final d = date.replaceAll('.', '-');
    return '${d}T${time}Z';
  }
}

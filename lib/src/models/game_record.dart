class GameRecord {
  final String id;
  final String platform;
  final String username;
  final String opponent;
  final String pgn;
  final String? timeControl;
  final bool rated;
  final String? result;
  final DateTime? playedAt;
  final DateTime createdAt;
  final DateTime? analyzedAt;

  GameRecord({
    required this.id,
    required this.platform,
    required this.username,
    required this.opponent,
    required this.pgn,
    this.timeControl,
    this.rated = false,
    this.result,
    this.playedAt,
    required this.createdAt,
    this.analyzedAt,
  });

  factory GameRecord.fromJson(Map<String, dynamic> json) {
    return GameRecord(
      id: json['id'] as String,
      platform: json['platform'] as String,
      username: json['username'] as String,
      opponent: json['opponent'] as String,
      pgn: json['pgn'] as String,
      timeControl: json['time_control'] as String?,
      rated: json['rated'] as bool? ?? false,
      result: json['result'] as String?,
      playedAt: json['played_at'] != null
          ? DateTime.parse(json['played_at'] as String)
          : null,
      createdAt: DateTime.parse(json['created_at'] as String),
      analyzedAt: json['analyzed_at'] != null
          ? DateTime.parse(json['analyzed_at'] as String)
          : null,
    );
  }

  Map<String, dynamic> toInsertJson() {
    return {
      'platform': platform,
      'username': username,
      'opponent': opponent,
      'pgn': pgn,
      'time_control': timeControl,
      'rated': rated,
      'result': result,
      'played_at': playedAt?.toIso8601String(),
    };
  }
}

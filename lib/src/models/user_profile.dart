class UserProfile {
  final String id;
  final String? displayName;
  final String? avatarUrl;
  final String? lichessUsername;
  final String? chesscomUsername;
  final DateTime createdAt;

  UserProfile({
    required this.id,
    this.displayName,
    this.avatarUrl,
    this.lichessUsername,
    this.chesscomUsername,
    required this.createdAt,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      displayName: json['display_name'] as String?,
      avatarUrl: json['avatar_url'] as String?,
      lichessUsername: json['lichess_username'] as String?,
      chesscomUsername: json['chesscom_username'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toInsertJson() {
    return {
      'id': id,
      'display_name': displayName,
      'avatar_url': avatarUrl,
      'lichess_username': lichessUsername,
      'chesscom_username': chesscomUsername,
    };
  }

  UserProfile copyWith({
    String? displayName,
    String? avatarUrl,
    String? lichessUsername,
    String? chesscomUsername,
  }) {
    return UserProfile(
      id: id,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      lichessUsername: lichessUsername ?? this.lichessUsername,
      chesscomUsername: chesscomUsername ?? this.chesscomUsername,
      createdAt: createdAt,
    );
  }
}

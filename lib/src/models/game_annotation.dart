import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

enum MoveGrade {
  A,
  S,
  D,
  F;

  String get label => switch (this) {
        MoveGrade.A => 'Good',
        MoveGrade.S => 'Inaccuracy',
        MoveGrade.D => 'Mistake',
        MoveGrade.F => 'Blunder',
      };

  String get shortLabel => switch (this) {
        MoveGrade.A => 'A',
        MoveGrade.S => 'S',
        MoveGrade.D => 'D',
        MoveGrade.F => 'F',
      };

  Color get color => switch (this) {
        MoveGrade.A => AppTheme.correct,
        MoveGrade.S => AppTheme.inaccuracy,
        MoveGrade.D => AppTheme.mistake,
        MoveGrade.F => AppTheme.incorrect,
      };

  static MoveGrade? fromString(String? value) {
    if (value == null) return null;
    return switch (value) {
      'A' => MoveGrade.A,
      'S' => MoveGrade.S,
      'D' => MoveGrade.D,
      'F' => MoveGrade.F,
      _ => null,
    };
  }
}

class MoveAnnotation {
  final int moveNumber;
  final String side;
  final String san;
  final MoveGrade? classification;
  final String? text;

  MoveAnnotation({
    required this.moveNumber,
    required this.side,
    required this.san,
    this.classification,
    this.text,
  });

  factory MoveAnnotation.fromJson(Map<String, dynamic> json) {
    return MoveAnnotation(
      moveNumber: json['moveNumber'] as int,
      side: json['side'] as String,
      san: json['san'] as String,
      classification: MoveGrade.fromString(json['classification'] as String?),
      text: json['text'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'moveNumber': moveNumber,
      'side': side,
      'san': san,
      'classification': classification?.shortLabel,
      'text': text,
    };
  }

  MoveAnnotation copyWith({
    int? moveNumber,
    String? side,
    String? san,
    MoveGrade? Function()? classification,
    String? Function()? text,
  }) {
    return MoveAnnotation(
      moveNumber: moveNumber ?? this.moveNumber,
      side: side ?? this.side,
      san: san ?? this.san,
      classification:
          classification != null ? classification() : this.classification,
      text: text != null ? text() : this.text,
    );
  }

  String get key => '${moveNumber}_$side';
}

class GameAnnotation {
  final String? id;
  final String gameId;
  final List<MoveAnnotation> annotations;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  GameAnnotation({
    this.id,
    required this.gameId,
    required this.annotations,
    this.createdAt,
    this.updatedAt,
  });

  factory GameAnnotation.fromJson(Map<String, dynamic> json) {
    final annotationsList = (json['annotations'] as List)
        .map((e) => MoveAnnotation.fromJson(e as Map<String, dynamic>))
        .toList();

    return GameAnnotation(
      id: json['id'] as String?,
      gameId: json['game_id'] as String,
      annotations: annotationsList,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : null,
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : null,
    );
  }

  MoveAnnotation? getAnnotation(int moveNumber, String side) {
    final key = '${moveNumber}_$side';
    for (final a in annotations) {
      if (a.key == key) return a;
    }
    return null;
  }
}

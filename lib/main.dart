import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'src/app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: 'https://ydfwppthwnlgxnntzrvg.supabase.co',
    anonKey:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkZndwcHRod25sZ3hubnR6cnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE4MjcsImV4cCI6MjA4OTUxNzgyN30.KQxSh6xp70BavlVnZ56AjI4w8N9j0DJCvAeaXzoAYek',
  );

  runApp(const PatternChessApp());
}

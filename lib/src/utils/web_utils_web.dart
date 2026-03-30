import 'package:web/web.dart' as web;

void cleanBrowserUrl() {
  final uri = Uri.base;
  final clean = Uri(
    scheme: uri.scheme,
    host: uri.host,
    port: uri.port,
    path: uri.path,
  ).toString();
  web.window.history.replaceState(null, '', clean);
}

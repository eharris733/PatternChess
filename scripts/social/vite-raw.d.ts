// boardCanvas.ts imports chessground's CSS with Vite's ?raw (only inside a
// browser-only function); declare it so this Node project typechecks.
declare module '*?raw' {
  const text: string;
  export default text;
}

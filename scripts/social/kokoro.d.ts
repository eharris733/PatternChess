// kokoro-js is installed only where videos are rendered (the social workflow,
// or locally with `npm i --no-save kokoro-js@1.2.1`), never as an app
// dependency: it pulls in onnxruntime-node (~220 MB), which would weigh down
// every Cloudflare Pages build. These shims keep `typecheck:social` working
// without it; voice.ts types the parts it uses itself.
declare module 'kokoro-js' {
  export const KokoroTTS: {
    from_pretrained(model: string, opts: { dtype: string; device: string }): Promise<unknown>;
  };
}

declare module '@huggingface/transformers' {
  export const env: { cacheDir: string };
}

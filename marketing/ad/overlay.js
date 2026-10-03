// Injected into every recorded page (addInitScript). Exposes window.__ad:
//   caption(text, ratio, slot, pos) — caption over app footage
//   card(name, data)                — full-screen motion card (hook / stats / testimonials / cta)
//   play()                          — starts the animations (called when recording starts)
//   stopAudio()                     — returns the captured app audio for this page
// plus a drawn cursor (headless has none), "vs Opponent" masking of game opponents,
// and a tap on the page's AudioContext so the site's own Web Audio sounds
// (src/lib/sounds.ts) are recorded alongside the video.
// Cards and captions follow brand-kit/: charcoal #1A1A1A, brand gold #C49B2A,
// deep gold #8B6914, light ink #E8E8E8, Georgia wordmark with italic "Chess".
(() => {
  // ---- Audio tap -----------------------------------------------------------
  // Every node sounds.ts builds connects to `ctx.destination`; hand it a gain
  // node that feeds both the speakers and a MediaRecorder instead.
  const NativeCtx = window.AudioContext;
  const destGetter = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination').get;
  const audio = { chunks: [], recorder: null, startedAt: null };
  if (NativeCtx) {
    window.AudioContext = class extends NativeCtx {
      constructor(...args) {
        super(...args);
        const real = destGetter.call(this);
        const tap = this.createGain();
        tap.connect(real);
        const sink = this.createMediaStreamDestination();
        tap.connect(sink);
        Object.defineProperty(this, 'destination', { get: () => tap });
        if (!audio.recorder) {
          audio.recorder = new MediaRecorder(sink.stream, { mimeType: 'audio/webm;codecs=opus' });
          audio.recorder.ondataavailable = (e) => e.data.size && audio.chunks.push(e.data);
          audio.recorder.start(250);
          audio.startedAt = performance.now();
        }
      }
    };
  }

  // ---- Styles --------------------------------------------------------------
  const CSS = `
  #ad-root { --gold: #C49B2A; --deep: #8B6914; --char: #1A1A1A; --char2: #232220; --ink: #E8E8E8; --off: #F4F4F0;
    position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
    font-family: Inter, 'Inter Fallback', system-ui, sans-serif; color: var(--ink); }
  #ad-root * { box-sizing: border-box; }
  .ad-serif { font-family: Georgia, 'Times New Roman', serif; }
  .ad-track { text-transform: uppercase; letter-spacing: 0.22em; font-weight: 500; }

  /* Caption over app footage: charcoal panel, gold rule, light ink */
  .ad-cap { position: absolute; left: 50%; transform: translate(-50%, 24px); opacity: 0;
    width: max-content; max-width: min(86%, 900px); background: rgba(26,26,26,0.94); border-radius: 14px;
    padding: 20px 30px 20px 26px; display: flex; align-items: center; gap: 18px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.28); }
  .ad-cap::before { content: ''; flex: none; width: 4px; align-self: stretch; border-radius: 2px; background: var(--gold); }
  .ad-cap span { font-family: Georgia, 'Times New Roman', serif; font-size: 32px; line-height: 1.22; color: var(--ink); }
  .ad-landscape .ad-cap { bottom: 44px; }
  .ad-vertical .ad-cap { bottom: 52px; max-width: calc(100% - 40px); padding: 16px 22px 16px 18px; }
  .ad-vertical .ad-cap span { font-size: 23px; }
  .ad-play .ad-cap { animation: ad-cap-in .55s cubic-bezier(.2,.8,.2,1) .15s forwards; }
  .ad-landscape .ad-cap.ad-right { left: auto; right: 36px; bottom: 36px; max-width: 31%; transform: translateY(24px); }
  .ad-landscape.ad-play .ad-cap.ad-right { animation-name: ad-in; }
  .ad-landscape .ad-cap.ad-right span { font-size: 25px; }

  /* Full-screen cards, styled after brand-kit/logos/social-card-example.png */
  .ad-card { position: absolute; inset: 0; background: var(--char); overflow: hidden; display: flex;
    flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6%; gap: 30px; }
  .ad-sq { position: absolute; width: var(--s); height: var(--s); background: #211F1A; }
  .ad-in { opacity: 0; transform: translateY(26px); }
  .ad-play .ad-in { animation: ad-in .7s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: var(--d, 0s); }
  .ad-play .ad-sq { animation: ad-fade 1.2s ease forwards; opacity: 0; }

  .ad-mark { display: block; }
  .ad-lockup { display: flex; flex-direction: column; align-items: center; gap: 26px; }
  .ad-lockup .ad-mark { width: 150px; height: 150px; }
  .ad-wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 96px; line-height: 1; color: var(--ink); letter-spacing: -0.01em; }
  .ad-wordmark i { color: var(--gold); }
  .ad-tagline { font-size: 22px; color: rgba(232,232,232,0.62); }
  .ad-vertical .ad-wordmark { font-size: 64px; }
  .ad-vertical .ad-lockup .ad-mark { width: 120px; height: 120px; }
  .ad-vertical .ad-tagline { font-size: 17px; letter-spacing: 0.16em; max-width: 90%; line-height: 1.6; }

  .ad-boxes { display: flex; gap: 26px; }
  .ad-vertical .ad-boxes { flex-direction: column; gap: 20px; width: 84%; }
  .ad-box { background: var(--char2); border: 1px solid rgba(232,232,232,0.10); border-radius: 18px;
    padding: 36px 40px; width: 340px; text-align: left; }
  .ad-vertical .ad-box { width: auto; padding: 30px 32px; }
  .ad-num { font-family: Georgia, 'Times New Roman', serif; font-size: 84px; line-height: 1; color: var(--gold); font-variant-numeric: tabular-nums lining-nums; }
  .ad-lbl { margin-top: 18px; font-size: 16px; line-height: 1.5; color: rgba(232,232,232,0.66); }
  .ad-vertical .ad-num { font-size: 72px; }

  .ad-quotes { position: relative; width: min(1080px, 86%); height: 420px; }
  .ad-vertical .ad-quotes { width: 88%; height: 900px; }
  .ad-quote { position: absolute; inset: 0; margin: 0; display: flex; flex-direction: column; justify-content: center; align-items: center;
    gap: 30px; text-align: center; opacity: 0; }
  .ad-play .ad-quote { animation: ad-quote var(--len) ease var(--d) forwards; }
  .ad-quote.ad-last { animation-name: ad-quote-last !important; }
  .ad-qmark { font-family: Georgia, serif; font-size: 120px; line-height: 0.5; height: 50px; color: var(--gold); }
  .ad-quote q { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 46px; line-height: 1.3; color: var(--ink); quotes: none; }
  .ad-vertical .ad-quote q { font-size: 38px; }
  .ad-who { font-size: 18px; color: rgba(232,232,232,0.6); }
  .ad-who b { color: var(--gold); font-weight: 600; }

  .ad-cta-h { font-family: Georgia, 'Times New Roman', serif; font-size: 58px; line-height: 1.15; margin: 0; color: var(--ink); }
  .ad-vertical .ad-cta-h { font-size: 44px; }
  .ad-btn { background: var(--gold); color: var(--char); border-radius: 12px; padding: 22px 46px; font-size: 26px; font-weight: 600; }
  .ad-url { font-size: 20px; color: rgba(232,232,232,0.6); }
  .ad-slot { color: #E0675F !important; }

  /* Cursor */
  #ad-cursor { position: fixed; left: 0; top: 0; width: 34px; height: 34px; z-index: 2147483600; pointer-events: none;
    transform: translate(-100px, -100px); transition: opacity .2s; filter: drop-shadow(2px 3px 2px rgba(0,0,0,.35)); }


  @keyframes ad-cap-in { to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes ad-in { to { opacity: 1; transform: none; } }
  @keyframes ad-fade { to { opacity: 1; } }
  @keyframes ad-quote { 0% { opacity: 0; transform: translateY(22px); } 12% { opacity: 1; transform: none; }
    90% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-14px); } }
  @keyframes ad-quote-last { 0% { opacity: 0; transform: translateY(22px); } 12% { opacity: 1; transform: none; } 100% { opacity: 1; transform: none; } }
  `;

  // brand-kit/logos/source-files/brand-mark.svg, dark-background variant (light-ink trajectory).
  const MARK = `<svg class="ad-mark" viewBox="0 0 120 120" aria-hidden="true"><g transform="translate(20,0)">
    <rect x="40" y="0" width="40" height="40" fill="#C49B2A"/><rect x="40" y="40" width="40" height="40" fill="#8B6914"/>
    <rect x="40" y="80" width="40" height="40" fill="#C49B2A"/><rect x="0" y="80" width="40" height="40" fill="#8B6914"/>
    <path d="M 0 80 L 80 80 M 40 0 L 40 120 M 40 40 L 80 40" stroke="#1A1A1A" stroke-width="1.5" fill="none"/>
    <circle cx="20" cy="100" r="4" fill="#E8E8E8"/>
    <path d="M 20 100 Q 20 50 60 20" stroke="#E8E8E8" stroke-width="2" stroke-dasharray="3 4" fill="none" opacity="0.75"/>
    <circle cx="60" cy="20" r="4" fill="#E8E8E8"/></g></svg>`;
  const CURSOR = `<svg id="ad-cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2l15 11.5-6.6 1 3.9 7.3-2.7 1.4-3.9-7.4L4 20.5z"
    fill="#fff" stroke="#1A1A1A" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  // Faint checker squares in two corners, as on the brand social card.
  const SQUARES = (ratio) => {
    const s = ratio === 'vertical' ? 54 : 64;
    const pts = [[0, 0], [2, 0], [4, 0], [1, 1], [3, 1], [0, 2]];
    const tl = pts.map(([x, y], i) => `<div class="ad-sq" style="--s:${s}px; left:${x * s}px; top:${y * s}px; animation-delay:${i * 0.05}s"></div>`);
    const br = pts.map(([x, y], i) => `<div class="ad-sq" style="--s:${s}px; right:${x * s}px; bottom:${y * s}px; animation-delay:${0.2 + i * 0.05}s"></div>`);
    return tl.concat(br).join('');
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Empty copy slots render as [slot.name] so they can't ship by accident.
  const txt = (v, slot) => (v ? esc(v) : `<span class="ad-slot">[${slot}]</span>`);
  // The brand wordmark: "Pattern" in ink, "Chess" in italic gold.
  const wordmark = (v, slot) => (v ? esc(v).replace(/Chess/, '<i>Chess</i>') : txt(v, slot));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;

  function root(ratio) {
    let r = document.getElementById('ad-root');
    if (!r) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      r = document.createElement('div');
      r.id = 'ad-root';
      document.body.appendChild(r);
    }
    r.className = `ad-${ratio}`;
    return r;
  }

  const CARDS = {
    hook: (d) => `
      <div class="ad-card">${SQUARES(d.ratio)}
        <div class="ad-lockup">
          <div class="ad-in" style="--d:0s">${MARK}</div>
          <div class="ad-wordmark ad-in" style="--d:.3s">${wordmark(d.copy.hook.headline, 'hook.headline')}</div>
        </div>
        <div class="ad-tagline ad-track ad-in" style="--d:.8s">${txt(d.copy.hook.sub, 'hook.sub')}</div>
      </div>`,
    stats: (d) => {
      const items = [
        { n: d.stats.eloGained, pre: '+', suf: '', label: d.copy.stats.eloLabel, slot: 'stats.eloLabel' },
        { n: d.stats.retentionPct, pre: '', suf: '%', label: d.copy.stats.retentionLabel, slot: 'stats.retentionLabel' },
        { n: d.stats.positionsReviewed, pre: '', suf: '', label: d.copy.stats.solvedLabel, slot: 'stats.solvedLabel' },
      ];
      return `<div class="ad-card">${SQUARES(d.ratio)}<div class="ad-boxes">${items
        .map((it, i) => `<div class="ad-box ad-in" style="--d:${0.1 + i * 0.22}s">
            <div class="ad-num" data-count="${it.n}" data-pre="${it.pre}" data-suf="${it.suf}" data-delay="${0.1 + i * 0.22}">${it.pre}0${it.suf}</div>
            <div class="ad-lbl ad-track">${txt(it.label, it.slot)}</div></div>`)
        .join('')}</div></div>`;
    },
    testimonials: (d) => {
      // Each quote stays up in proportion to its length (min 2.2s).
      const list = d.copy.testimonials;
      const weights = list.map((t) => Math.max(words(t.quote) + 4, 8));
      const total = weights.reduce((a, b) => a + b, 0);
      let at = 0;
      return `<div class="ad-card">${SQUARES(d.ratio)}<div class="ad-quotes">${list
        .map((t, i) => {
          const len = Math.max(2.2, (d.seconds * weights[i]) / total);
          const html = `<figure class="ad-quote${i === list.length - 1 ? ' ad-last' : ''}" style="--d:${at.toFixed(2)}s; --len:${len.toFixed(2)}s">
            <div class="ad-qmark">&ldquo;</div>
            <q>${txt(t.quote, `testimonials[${i}].quote`)}</q>
            <figcaption class="ad-who ad-track"><b>${txt(t.name, `testimonials[${i}].name`)}</b> &nbsp;·&nbsp; ${txt(t.detail, `testimonials[${i}].detail`)}</figcaption>
          </figure>`;
          at += len;
          return html;
        })
        .join('')}</div></div>`;
    },
    cta: (d) => `
      <div class="ad-card">${SQUARES(d.ratio)}
        <div class="ad-lockup ad-in" style="--d:0s">${MARK}<div class="ad-wordmark">Pattern<i>Chess</i></div></div>
        <h1 class="ad-cta-h ad-in" style="--d:.35s">${txt(d.copy.cta.headline, 'cta.headline')}</h1>
        <div class="ad-btn ad-in" style="--d:.65s">${txt(d.copy.cta.button, 'cta.button')}</div>
        <div class="ad-url ad-track ad-in" style="--d:.85s">${txt(d.copy.cta.url, 'cta.url')}</div>
      </div>`,
  };

  function countUp(el) {
    const target = Number(el.dataset.count);
    const t0 = performance.now() + Number(el.dataset.delay) * 1000 + 200;
    const dur = 1400;
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      el.textContent = `${el.dataset.pre}${fmt(target * (1 - Math.pow(1 - p, 3)))}${el.dataset.suf}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Replace "vs <username>" with "vs Opponent" anywhere in the app's text.
  function maskText(node) {
    if (!node || !(node instanceof Node)) return;
    // Walk from the parent so a "vs " node and the name node React renders
    // after it are seen together.
    const scope = node.nodeType === 1 && node.parentNode instanceof Node ? node.parentNode : node;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let prev = null;
    for (let n = walker.nextNode(); n; prev = n, n = walker.nextNode()) {
      if (n.parentElement?.closest('#ad-root')) continue;
      const v = n.nodeValue;
      if (prev && /\bvs\.?\s*$/.test(prev.nodeValue || '') && /^\s*(?!Opponent)[\w.-]/.test(v || '')) {
        n.nodeValue = v.replace(/^(\s*)[\w.-]+/, '$1Opponent');
        continue;
      }
      if (v && /\bvs\.?\s+\S/.test(v)) {
        const next = v.replace(/\bvs\.?\s+(?!Opponent)[\w.-]+/g, 'vs Opponent');
        if (next !== v) n.nodeValue = next;
      }
    }
  }

  function installCursor() {
    document.body.insertAdjacentHTML('beforeend', CURSOR);
    const c = document.getElementById('ad-cursor');
    c.style.opacity = '0';
    window.addEventListener('mousemove', (e) => {
      c.style.opacity = window.__adCursor ? '1' : '0';
      c.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 3}px)`;
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    installCursor();
    maskText(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') maskText(m.target.parentNode ?? document.body);
        for (const added of m.addedNodes) maskText(added.nodeType === 3 ? added.parentNode : added);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  window.__ad = {
    caption(text, ratio, slot, pos) {
      const r = root(ratio);
      r.innerHTML = `<div class="ad-cap${pos === 'right' ? ' ad-right' : ''}"><span>${txt(text, slot)}</span></div>`;
    },
    card(name, data) {
      const r = root(data.ratio);
      r.innerHTML = CARDS[name](data);
    },
    play() {
      const r = document.getElementById('ad-root');
      if (r) {
        r.classList.add('ad-play');
        r.querySelectorAll('[data-count]').forEach(countUp);
      }
      return performance.now();
    },
    cursor(on) {
      window.__adCursor = on;
    },
    /** Stops the audio tap; resolves to { b64, startedAt } (null when the page made no sound context). */
    async stopAudio() {
      const rec = audio.recorder;
      if (!rec) return null;
      await new Promise((res) => {
        rec.onstop = res;
        rec.stop();
      });
      const blob = new Blob(audio.chunks, { type: 'audio/webm' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(bin), startedAt: audio.startedAt };
    },
  };
})();

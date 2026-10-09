// Load once on the WordPress page; supports multiple occupations and embed pairs.
(() => {
  const script = document.currentScript;
  const allowedOrigin = new URL(script.src).origin;
  const entries = [];
  for (const frame of document.querySelectorAll('iframe.usd-embed[data-usd-src]')) {
    if (frame.dataset.usdReady) continue;
    const url = new URL(frame.dataset.usdSrc);
    const mode = url.searchParams.get('embed');
    if (url.origin !== allowedOrigin || !['1','map','table'].includes(mode)) continue;
    frame.dataset.usdReady = '1';
    url.searchParams.set('parentOrigin', location.origin);
    const entry = {frame, origin:url.origin, mode};
    entries.push(entry);
    frame.addEventListener('load', () => frame.contentWindow.postMessage({type:'usd:resize-request', version:1}, entry.origin));
    frame.src = url.href;
  }
  window.addEventListener('message', event => {
    // Require BOTH the precise GitHub Pages origin and the matching iframe window.
    const entry = entries.find(e => event.origin === e.origin && event.source === e.frame.contentWindow);
    if (!entry) return;
    const data = event.data;
    if (!data || data.type !== 'usd:resize' || data.version !== 1 || data.mode !== entry.mode) return;
    if (!Number.isInteger(data.height) || data.height < 1 || data.height > 20000) return;
    entry.frame.style.height = `${data.height}px`;
  });
})();

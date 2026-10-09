// Height-only protocol. No wildcard origins and no parent DOM access.
const mode = document.documentElement.dataset.embed;
if (mode && window.parent !== window) {
  let parentOrigin;
  try {
    const supplied = new URLSearchParams(location.search).get('parentOrigin');
    const url = new URL(supplied || document.referrer);
    if (['https:', 'http:'].includes(url.protocol)) parentOrigin = url.origin;
  } catch { /* No trusted parent address: retain the iframe fallback height. */ }
  if (parentOrigin) {
    let lastHeight = 0, pending = false;
    const send = () => {
      pending = false;
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height > 0 && height <= 20000 && height !== lastHeight) {
        lastHeight = height;
        window.parent.postMessage({type:'usd:resize', version:1, mode, height}, parentOrigin);
      }
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(send); } };
    new ResizeObserver(schedule).observe(document.body);
    window.addEventListener('resize', schedule);
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type === 'usd:resize-request' && event.data.version === 1) {
        lastHeight = 0; schedule();
      }
    });
    document.fonts?.ready.then(schedule);
    schedule();
  }
}

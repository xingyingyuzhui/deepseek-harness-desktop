import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('deepseekDesktop', {
  platform: process.platform,
  version: '0.1.2',
  isDesktop: true
});

// Inject auto-healing bundle transport into the main world to recover from any stale combo URL revisions
try {
  const scriptEl = document.createElement('script');
  scriptEl.textContent = `
    (() => {
      const defaultLoad = (url) => new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.async = true;
        el.src = url;
        el.addEventListener("load", () => {
          el.remove();
          resolve();
        }, { once: true });
        el.addEventListener("error", () => {
          el.remove();
          reject(new Error("bundle script " + url + " failed to load"));
        }, { once: true });
        document.head.append(el);
      });

      window.__DSH_TRANSPORT__ = {
        loadBundle: async (url) => {
          try {
            await defaultLoad(url);
          } catch (err) {
            console.warn("[DSH Desktop] Bundle script load failed, checking for revised batch URL:", url);
            try {
              const res = await fetch("/", { cache: "no-store" });
              const html = await res.text();
              const marker = 'globalThis["__DSH_BOOT__"] = ';
              const start = html.indexOf(marker);
              if (start !== -1) {
                const end = html.indexOf("</script>", start);
                if (end !== -1) {
                  const boot = JSON.parse(html.slice(start + marker.length, end));
                  const batch = boot.batches?.find(b => b.url !== url && (url.includes(b.entries?.[0]) || b.entries?.some(e => url.includes(e))));
                  if (batch && batch.url) {
                    console.log("[DSH Desktop] Auto-recovered updated bundle URL:", batch.url);
                    await defaultLoad(batch.url);
                    return;
                  }
                }
              }
            } catch (recoveryErr) {
              console.error("[DSH Desktop] Auto-recovery failed:", recoveryErr);
            }
            throw err;
          }
        }
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(scriptEl);
  scriptEl.remove();
} catch (_) {}


if (process.platform === 'darwin') {
  const css = `
    /* DeepSeek Desktop: macOS Traffic Light Safe Inset */
    [class*="logoRow"] {
      margin-top: 28px !important;
      position: relative;
    }

    [class*="collapsed"] [class*="logoRow"] {
      margin-top: 20px !important;
    }

    /* Top drag region above sidebar */
    [class*="logoRow"]::before {
      content: "";
      position: absolute;
      top: -28px;
      left: 0;
      right: -100px;
      height: 28px;
      -webkit-app-region: drag;
      z-index: 999;
    }

    /* Center conversation column */
    [data-dsh-electron-center],
    [class*="centerCol"] {
      position: relative;
    }

    /* New Session drag surface:
       When there is no active session, header is absent or aria-hidden="true" / headerHidden.
       We create a transparent 44px drag bar across the top, reserving the right 90px for action buttons. */
    [data-dsh-electron-center]:not(:has(header:not([aria-hidden="true"]):not([class*="headerHidden"])))::before,
    [class*="centerCol"]:not(:has(header:not([aria-hidden="true"]):not([class*="headerHidden"])))::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 90px;
      height: 44px;
      -webkit-app-region: drag;
      z-index: 5;
    }

    /* Active conversation header drag surface */
    [data-dsh-electron-main-header]:not([aria-hidden="true"]):not([class*="headerHidden"]),
    [class*="centerCol"] header:not([aria-hidden="true"]):not([class*="headerHidden"]) {
      -webkit-user-select: none;
      user-select: none;
      -webkit-app-region: drag;
    }

    /* All interactive controls must stay non-draggable to receive pointer clicks */
    :is(
      button,
      a,
      input,
      textarea,
      select,
      summary,
      [role="button"],
      [role="link"],
      [role="tab"],
      [contenteditable="true"]
    ) {
      -webkit-app-region: no-drag !important;
    }

    /* Modals/dialogs disable drag areas */
    :root:has([role="dialog"][aria-modal="true"]) [class*="centerCol"]::before,
    :root:has([role="dialog"][aria-modal="true"]) header {
      -webkit-app-region: no-drag !important;
    }
  `;

  function injectStyle() {
    if (document.getElementById('dsh-macos-window-chrome')) return;
    const style = document.createElement('style');
    style.id = 'dsh-macos-window-chrome';
    style.textContent = css;
    if (document.head) {
      document.head.appendChild(style);
    } else if (document.documentElement) {
      document.documentElement.appendChild(style);
    }
  }

  function reconcileMarkers() {
    try {
      const overlay = document.querySelector('[data-shell-overlay]');
      if (!overlay) return;
      const frame = overlay.parentElement;
      if (!frame) return;

      const sidebar = frame.firstElementChild;
      if (sidebar && !sidebar.hasAttribute('data-dsh-electron-sidebar')) {
        sidebar.setAttribute('data-dsh-electron-sidebar', '');
      }

      const center = sidebar ? sidebar.nextElementSibling : null;
      if (center && !center.hasAttribute('data-dsh-electron-center')) {
        center.setAttribute('data-dsh-electron-center', '');
      }

      const header = center ? (center.querySelector('header:not([aria-hidden="true"])') || center.querySelector('header')) : null;
      if (header && !header.hasAttribute('data-dsh-electron-main-header')) {
        header.setAttribute('data-dsh-electron-main-header', '');
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyle();
      reconcileMarkers();
    });
  } else {
    injectStyle();
    reconcileMarkers();
  }

  // Observe DOM mutations to keep markers attached during route transitions
  const observer = new MutationObserver(() => {
    if (!document.getElementById('dsh-macos-window-chrome')) {
      injectStyle();
    }
    reconcileMarkers();
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

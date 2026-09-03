import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('deepseekDesktop', {
  platform: process.platform,
  version: '0.1.2',
  isDesktop: true
});

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

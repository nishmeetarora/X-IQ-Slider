// Keeps X's search box, hides the other right-sidebar widgets, and puts the IQ Slider panel in their place.
(function (root) {
  'use strict';

  // Things only widgets contain. Kept narrow so the search box's own dropdown never counts.
  const WIDGETISH = 'section, aside, nav, h2, [data-testid="trend"], [data-testid="UserCell"], [data-testid="news_sidebar"], [data-testid="placementTracking"]';

  function createSidebar(ctx) {
    const dom = root.XIQ.dom;
    const host = ctx.widget.el;
    let lastStickyCheck = 0;

    function looksLikeWidget(el) {
      if (el === host) return false;
      return el.matches(WIDGETISH) || !!el.querySelector(WIDGETISH);
    }

    // Returns { container, keep }: the element whose children are the widgets, and the child holding search.
    function locate(col) {
      const search = col.querySelector(dom.SEL.search);
      const contents = dom.sidebarContents(col);
      if (contents) {
        const keep = search && contents.firstElementChild && contents.firstElementChild.contains(search) ? contents.firstElementChild : null;
        return { container: contents, keep };
      }
      // Fallback for a changed layout: walk up from the search box until a level has widget siblings.
      if (search) {
        let node = search;
        while (node.parentElement && node.parentElement !== col) {
          const parent = node.parentElement;
          for (const sib of parent.children) {
            if (sib !== node && looksLikeWidget(sib)) return { container: parent, keep: node };
          }
          node = parent;
        }
        return null;
      }
      // No search box: the lowest element containing every widget.
      const widgets = col.querySelectorAll('section, aside, nav');
      if (!widgets.length) return null;
      let container = widgets[0].parentElement;
      for (const w of widgets) {
        while (container && !container.contains(w)) container = container.parentElement;
      }
      return container && col.contains(container) ? { container, keep: null } : null;
    }

    function unhideAll() {
      for (const el of document.querySelectorAll('[data-xiq-sidebar-hidden], [data-xiq-sticky]')) {
        delete el.dataset.xiqSidebarHidden;
        delete el.dataset.xiqSticky;
      }
    }

    // X keeps the sidebar sticky with a computed (often negative) top so tall sidebars stick at their bottom.
    // With the widgets gone the sidebar is short; if X keeps the old negative top, pin it to the top instead.
    function fixSticky(col, container, on) {
      const now = Date.now();
      if (now - lastStickyCheck < 1000) return;
      lastStickyCheck = now;
      let sticky = null;
      for (let el = container; el && el !== col; el = el.parentElement) {
        if (getComputedStyle(el).position === 'sticky') {
          sticky = el;
          break;
        }
      }
      for (const el of col.querySelectorAll('[data-xiq-sticky]')) if (el !== sticky) delete el.dataset.xiqSticky;
      if (!sticky) return;
      const staleNegativeTop = parseFloat(sticky.style.top || '0') < 0;
      const fits = sticky.offsetHeight <= window.innerHeight;
      if (on && staleNegativeTop && fits) sticky.dataset.xiqSticky = '1';
      else delete sticky.dataset.xiqSticky;
    }

    function ensure() {
      const s = ctx.getSettings();
      const col = document.querySelector(dom.SEL.sidebar);
      const onSearch = location.pathname.startsWith('/search');
      // Search results keep X's own sidebar (it holds the search filters).
      if (!col || onSearch) {
        if (host.isConnected && (!col || onSearch || !col.contains(host))) host.remove();
        if (col && onSearch) unhideAll();
        return;
      }
      const spot = locate(col);
      if (!spot) return;
      const { container, keep } = spot;

      // The panel goes right before the first widget, i.e. just under the search box.
      let firstWidget = null;
      for (const child of container.children) {
        if (child !== keep && child !== host && looksLikeWidget(child)) {
          firstWidget = child;
          break;
        }
      }
      if (host.parentElement !== container) {
        container.insertBefore(host, firstWidget || (keep ? keep.nextElementSibling : container.firstElementChild));
      } else if (firstWidget && host.nextElementSibling !== firstWidget && host.compareDocumentPosition(firstWidget) & Node.DOCUMENT_POSITION_PRECEDING) {
        container.insertBefore(host, firstWidget);
      }

      for (const child of container.children) {
        if (child === host || child === keep) continue;
        const hide = s.hideSidebar && looksLikeWidget(child);
        if (hide && !child.dataset.xiqSidebarHidden) child.dataset.xiqSidebarHidden = '1';
        else if (!hide && child.dataset.xiqSidebarHidden) delete child.dataset.xiqSidebarHidden;
      }
      fixSticky(col, container, s.hideSidebar);
    }

    return { ensure };
  }

  root.XIQ = Object.assign(root.XIQ || {}, { createSidebar });
})(typeof globalThis !== 'undefined' ? globalThis : this);

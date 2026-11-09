/**
 * Search Highlighter Utility for GpsTrackX
 * Highlights matching text on the current page and scrolls / focuses the matching element.
 */

let currentMatches: HTMLElement[] = [];
let currentMatchIndex = 0;
let lastSearchQuery = '';

export function clearHighlights() {
  currentMatches.forEach((el) => {
    el.classList.remove('gpx-search-highlight', 'gpx-search-active-highlight');
  });
  currentMatches = [];
  currentMatchIndex = 0;
  lastSearchQuery = '';
}

export function highlightInPage(query: string, advanceNext = false): { total: number; current: number } {
  const trimmed = (query || '').trim();
  if (trimmed.length < 2) {
    clearHighlights();
    return { total: 0, current: 0 };
  }

  // If query changed, find all matches
  if (trimmed.toLowerCase() !== lastSearchQuery.toLowerCase()) {
    clearHighlights();
    lastSearchQuery = trimmed;

    const main = document.querySelector('main') || document.body;
    const term = trimmed.toLowerCase();
    const matches: HTMLElement[] = [];

    const walker = document.createTreeWalker(
      main,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();
          if (['script', 'style', 'input', 'textarea', 'select', 'svg', 'path', 'noscript'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.closest('header') || el.closest('[data-search-ignore="true"]')) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = (el.innerText || el.textContent || '').trim();
          if (!text || !text.toLowerCase().includes(term)) {
            return NodeFilter.FILTER_SKIP;
          }

          // Check if any child element also matches the term.
          // If a child matches, skip this parent element to find the deepest leaf node.
          const hasChildMatch = Array.from(el.children).some(child => {
            const childTag = child.tagName.toLowerCase();
            if (['script', 'style', 'svg', 'path'].includes(childTag)) return false;
            const childText = (child as HTMLElement).innerText || child.textContent || '';
            return childText.toLowerCase().includes(term);
          });

          if (!hasChildMatch) {
            return NodeFilter.FILTER_ACCEPT;
          }

          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let curr = walker.nextNode();
    while (curr) {
      matches.push(curr as HTMLElement);
      curr = walker.nextNode();
    }

    currentMatches = matches;
    currentMatchIndex = 0;

    // Apply base highlight to all matches
    currentMatches.forEach((el) => {
      el.classList.add('gpx-search-highlight');
    });
  } else if (advanceNext && currentMatches.length > 0) {
    // Advance to next match
    currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
  }

  if (currentMatches.length === 0) {
    return { total: 0, current: 0 };
  }

  // Set active match
  currentMatches.forEach((el, idx) => {
    if (idx === currentMatchIndex) {
      el.classList.remove('gpx-search-highlight');
      el.classList.add('gpx-search-active-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      el.classList.remove('gpx-search-active-highlight');
      el.classList.add('gpx-search-highlight');
    }
  });

  return {
    total: currentMatches.length,
    current: currentMatchIndex + 1
  };
}

export function setPendingSearchFocus(term: string) {
  try {
    sessionStorage.setItem('gpstrackx_pending_search', term);
  } catch (e) {}
}

export function checkAndApplyPendingSearch(callback?: (stats: { total: number; current: number }) => void) {
  try {
    const pending = sessionStorage.getItem('gpstrackx_pending_search');
    if (pending) {
      sessionStorage.removeItem('gpstrackx_pending_search');
      setTimeout(() => {
        const stats = highlightInPage(pending, false);
        if (callback) callback(stats);
      }, 350);
    }
  } catch (e) {}
}

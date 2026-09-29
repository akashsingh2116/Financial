import { useEffect, useState } from 'react';

// Tracks page scroll for the header: `scrolled` once the page has moved,
// `condensed` while scrolling down (hides the top row, keeps the tabs), and
// `showTop` once far enough down to offer a back-to-top button.
export default function useScrollHeader() {
  const [state, setState] = useState({ scrolled: false, condensed: false, showTop: false });

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;

    function update() {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      setState((current) => {
        let condensed = current.condensed;
        if (y < 80) condensed = false;
        else if (delta > 6) condensed = true;
        else if (delta < -6) condensed = false;
        const next = { scrolled: y > 8, condensed, showTop: y > 600 };
        return next.scrolled === current.scrolled
          && next.condensed === current.condensed
          && next.showTop === current.showTop ? current : next;
      });
      if (Math.abs(delta) > 6) lastY = y;
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return state;
}

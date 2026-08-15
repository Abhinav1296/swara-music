import { useLayoutEffect, useRef, useState } from "react";

/**
 * Slides its text sideways ONLY when it's too wide to fit its container —
 * otherwise it renders statically (no needless motion for text that fits).
 * Built to replace a hard `truncate` on long song titles / artist lists so the
 * whole name is readable.
 *
 * When it overflows we render TWO copies of the text back-to-back and animate
 * the track by -50% (`swara-marquee` in index.css) for a seamless loop. Speed is
 * constant px/s, so long text scrolls proportionally longer. Honors
 * prefers-reduced-motion (the CSS pauses the animation).
 */
export default function Marquee({ children, className = "", gap = 40, speed = 40 }) {
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [state, setState] = useState({ overflow: false, duration: 0 });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;

    const measure = () => {
      const textW = text.scrollWidth;
      const boxW = box.clientWidth;
      const overflow = textW > boxW + 1;
      const duration = Math.max(6, (textW + gap) / speed);
      setState((prev) =>
        prev.overflow === overflow && prev.duration === duration
          ? prev
          : { overflow, duration }
      );
    };

    measure();
    // Re-measure when the box resizes (rotation, orientation, sidebar open…).
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [children, gap, speed]);

  return (
    <div ref={boxRef} className={`overflow-hidden ${className}`}>
      {state.overflow ? (
        <div
          className="swara-marquee-track flex w-max flex-nowrap"
          style={{ animation: `swara-marquee ${state.duration}s linear infinite` }}
        >
          <span ref={textRef} className="whitespace-nowrap" style={{ paddingRight: gap }}>
            {children}
          </span>
          <span aria-hidden className="whitespace-nowrap" style={{ paddingRight: gap }}>
            {children}
          </span>
        </div>
      ) : (
        <span ref={textRef} className="block whitespace-nowrap">
          {children}
        </span>
      )}
    </div>
  );
}

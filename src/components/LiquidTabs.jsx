import React, { useLayoutEffect, useRef, useState } from 'react';

/** Stable segment-sized glass, with separate tap and magnetic drag motion. */
function LiquidTabs({ options, value, onChange, className = '', label }) {
  const root = useRef(null);
  const gesture = useRef(null);
  const lastPointer = useRef(0);
  const [bounds, setBounds] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pressed, setPressed] = useState(false);
  const selected = preview?.id || value;
  const accent = options.find((o) => o.id === selected)?.accent || '#80deff';

  const buttons = () => [...root.current.querySelectorAll('[data-segment]')];
  const box = (button) => ({ id: button.dataset.segment, x: button.offsetLeft,
    width: button.getBoundingClientRect().width, height: button.offsetHeight, y: button.offsetTop });

  useLayoutEffect(() => {
    const el = root.current;
    const measure = () => {
      const button = [...el.querySelectorAll('[data-segment]')].find((b) => b.dataset.segment === value);
      if (!button) return;
      const next = box(button);
      setBounds((old) => old && Object.keys(next).every((k) => old[k] === next[k]) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.querySelectorAll('[data-segment]').forEach((b) => observer.observe(b));
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => { live = false; observer.disconnect(); };
  }, [value, options]);

  const move = (event) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    if (!g.moved && Math.abs(event.clientX - g.start) < 4) return;
    g.moved = true;
    const x = event.clientX - g.left;
    const all = g.boxes;
    const center = (b) => b.x + b.width / 2;
    let next = all.reduce((best, b) => Math.abs(center(b) - x) < Math.abs(center(best) - x) ? b : best);
    const current = all.find((b) => b.id === g.previewId);
    if (current && current !== next) {
      const boundary = (center(current) + center(next)) / 2;
      if (center(next) > center(current) ? x < boundary + 4 : x > boundary - 4) next = current;
    }
    if (next.id !== g.previewId) {
      g.previewId = next.id;
      setPreview(next);
    } else if (!preview) setPreview(next);
  };

  const finish = (event, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    gesture.current = null;
    if (!cancelled) {
      lastPointer.current = Date.now();
      const next = g.moved ? g.previewId : g.tapId;
      onChange(next);
      buttons().find((b) => b.dataset.segment === next)?.focus({ preventScroll: true });
    }
    setPressed(false);
    setPreview(null);
  };
  const lens = preview || bounds;

  return (
    <nav ref={root} className={`${className} liquid-tabs ${preview ? 'is-dragging' : ''} ${pressed ? 'is-pressed' : ''}`} aria-label={label}
      style={{ '--segment-accent': accent }}
      onPointerDown={(e) => {
        const button = e.target.closest('[data-segment]');
        if (e.button !== 0 || !button) return;
        e.preventDefault();
        gesture.current = { pointer: e.pointerId, start: e.clientX, moved: false, tapId: button.dataset.segment, previewId: button.dataset.segment, left: root.current.getBoundingClientRect().left, boxes: buttons().map(box) };
        e.currentTarget.setPointerCapture(e.pointerId);
        setPressed(true);
        setPreview(box(button));
      }}
      onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
    >
      {lens && <span className="liquid-lens" aria-hidden="true" style={{ width: lens.width, height: lens.height, transform: `translate3d(${lens.x}px, ${lens.y}px, 0) scale(${pressed ? 1.055 : 1}, ${pressed ? 1.08 : 1})` }} />}
      {options.map((o, i) => (
        <button key={o.id} type="button" data-segment={o.id} aria-pressed={value === o.id}
          className={selected === o.id ? 'on' : ''} title={o.description}
          onClick={(e) => { if (!e.detail || Date.now() - lastPointer.current >= 250) onChange(o.id); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { setPressed(true); e.stopPropagation(); return; }
            let next;
            if (['ArrowRight', 'ArrowDown'].includes(e.key)) next = (i + 1) % options.length;
            else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) next = (i + options.length - 1) % options.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = options.length - 1;
            else return;
            e.preventDefault(); e.stopPropagation(); onChange(options[next].id);
            buttons()[next].focus();
          }}
          onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') setPressed(false); }}
          onBlur={() => { if (!gesture.current) setPressed(false); }}
        >{o.label}{o.description && <span className="mode-tip">{o.description}</span>}</button>
      ))}
    </nav>
  );
}

export default React.memo(LiquidTabs);

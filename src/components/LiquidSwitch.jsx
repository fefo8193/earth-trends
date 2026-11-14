import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Interruptor de vidrio líquido: la gota crece un poco al tocarla y se puede arrastrar
 * de un lado al otro (como las pestañas y la línea de tiempo). Un toque simple alterna.
 */
export default function LiquidSwitch({ checked, onChange, label, hint, className = '', compact = false, title }) {
  const [pressed, setPressed] = useState(false);
  const [dragX, setDragX] = useState(null);
  const gesture = useRef(null);
  const track = useRef(null);
  const lens = useRef(null);
  // tras montar, medir el riel real para ubicar bien la gota
  const [, remeasure] = useState(0);
  useLayoutEffect(() => remeasure(1), []);

  const maxX = () => {
    const tr = track.current;
    const ln = lens.current;
    if (!tr || !ln) return compact ? 16 : 20;
    return tr.clientWidth - ln.offsetWidth - 2 * ln.offsetLeft;
  };

  const down = (e) => {
    if (e.button !== 0) return;
    const max = maxX();
    gesture.current = { id: e.pointerId, start: e.clientX, from: checked ? max : 0, max, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
  };
  const move = (e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.start;
    if (!g.moved && Math.abs(dx) < 3) return;
    g.moved = true;
    setDragX(Math.max(0, Math.min(g.max, g.from + dx)));
  };
  const up = (e, cancel = false) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setPressed(false);
    setDragX(null);
    if (cancel) return;
    const pos = g.moved ? dragPos(e, g) : null;
    const next = g.moved ? pos > g.max / 2 : !checked;
    if (next !== checked) onChange(next);
  };
  const dragPos = (e, g) => Math.max(0, Math.min(g.max, g.from + (e.clientX - g.start)));

  const x = dragX ?? (checked ? maxX() : 0);
  const lensStyle = { transform: `translateX(${x}px) scale(${pressed ? 1.22 : 1})` };

  return (
    <label
      className={`lswitch ${compact ? 'compact' : ''} ${checked ? 'on' : ''} ${pressed ? 'is-pressed' : ''} ${dragX != null ? 'is-dragging' : ''} ${className}`}
      title={title || hint}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => up(e)}
      onPointerCancel={(e) => up(e, true)}
      // los clics del mouse/dedo ya los maneja el gesto; el teclado usa el input
      onClick={(e) => {
        if (e.detail > 0) e.preventDefault();
      }}
    >
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="lswitch-track" ref={track} aria-hidden="true">
        <span className="lswitch-lens" ref={lens} style={lensStyle} />
      </span>
      <span className="lswitch-text">
        {label}
        {hint && !compact && <small>{hint}</small>}
      </span>
    </label>
  );
}

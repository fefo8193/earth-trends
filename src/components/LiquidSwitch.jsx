import React, { useState } from 'react';

/** Interruptor con el mismo vidrio líquido animado que las pestañas (lente que se desliza y se estira al tocar). */
export default function LiquidSwitch({ checked, onChange, label, hint, className = '', compact = false, title }) {
  const [pressed, setPressed] = useState(false);
  return (
    <label className={`lswitch ${compact ? 'compact' : ''} ${checked ? 'on' : ''} ${pressed ? 'is-pressed' : ''} ${className}`} title={title || hint}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onBlur={() => setPressed(false)}
      />
      <span className="lswitch-track" aria-hidden="true">
        <span className="lswitch-lens" />
      </span>
      <span className="lswitch-text">
        {label}
        {hint && !compact && <small>{hint}</small>}
      </span>
    </label>
  );
}

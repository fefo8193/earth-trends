import React from 'react';
import { LAYER_STYLE } from '../lib/colors.js';

/** Tarjeta de bienvenida: qué es EarthTrends y dos caminos (ejemplo guiado / explorar libre). */
export function Welcome({ onTour, onExplore, tourCase }) {
  return (
    <div className="welcome-scrim" onClick={onExplore}>
      <div className="welcome glass" role="dialog" aria-label="Welcome" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-kicker">NASA SPACE APPS 2026 · EARTH SYSTEM TREND DETECTIVE</div>
        <h1>Is the climate really changing where you live?</h1>
        <p>
          EarthTrends looks at <b>20 years of NASA satellite data</b> (rainfall, temperature and water storage) for any spot on Earth and
          tests for <b>evidence of a long-term trend</b> in the year-to-year changes.
        </p>
        <ol className="welcome-steps">
          <li>
            <span>1</span> Click any place on the globe
          </li>
          <li>
            <span>2</span> See how it changed since 2005
          </li>
          <li>
            <span>3</span> Compare it with the other side of the world
          </li>
        </ol>
        <div className="welcome-actions">
          <button className="btn-primary" onClick={onTour}>
            ▶ Show me an example{tourCase ? <small>{tourCase.title}</small> : null}
          </button>
          <button className="btn-ghost" onClick={onExplore}>
            Explore on my own →
          </button>
        </div>
      </div>
    </div>
  );
}

/** Burbuja del recorrido guiado. */
export function TourBubble({ step, total, title, body, onNext, onBack, onSkip, last }) {
  return (
    <div className="tour glass" role="dialog" aria-live="polite">
      <div className="tour-head">
        <span className="tour-step">
          STEP {step + 1} / {total}
        </span>
        <button className="tour-skip" onClick={onSkip}>
          Skip tour ×
        </button>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="tour-foot">
        <div className="tour-dots">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        <div className="tour-btns">
          {step > 0 && (
            <button className="btn-ghost sm" onClick={onBack}>
              ← Back
            </button>
          )}
          <button className="btn-primary sm" onClick={onNext}>
            {last ? 'Start exploring ✓' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pulso animado sobre el globo: "podés tocar acá". */
export function TapHint() {
  return (
    <div className="tap-hint" aria-hidden="true">
      <span className="tap-ring" />
      <span className="tap-ring r2" />
      <span className="tap-dot" />
      <span className="tap-label">Click anywhere on Earth</span>
    </div>
  );
}

/** Lista de ejemplos siempre visible (cuando no hay panel abierto). */
export function ExamplesDock({ cases, onCase, onTour, onClose, dropdown }) {
  return (
    <div className={`examples glass ${dropdown ? 'dropdown' : ''}`}>
      <div className="examples-title">
        TRY AN EXAMPLE
        <button className="examples-close" onClick={onClose} aria-label="Hide examples" title="Hide">
          ×
        </button>
      </div>
      <button className="example tour-chip" onClick={onTour}>
        <span className="ex-icon">▶</span>
        <span>
          <b>Guided tour</b>
          <small>4 quick steps</small>
        </span>
      </button>
      {cases.map((c) => (
        <button key={c.id} className="example" onClick={() => onCase(c.id)} style={{ '--accent': LAYER_STYLE[c.layer]?.accent }}>
          <span className="ex-icon dot" />
          <span>
            <b>{c.title}</b>
            <small>{LAYER_STYLE[c.layer]?.name}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

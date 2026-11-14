import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n.js';
import { nearestYear, magneticYear, yearGroups, yearGroupLabel } from '../lib/timeline.js';

export default function Timeline({ years, year, onYear, missingYears = [], children }) {
  const y0 = years[0];
  const y1 = years[years.length - 1];
  const span = y1 - y0 || 1;
  const pct = (y) => Math.max(0, Math.min(100, ((y - y0) / span) * 100));
  const majors = years.filter((y) => (y - y0) % 5 === 0 || y === y1);

  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const visual = useRef(year);
  const lastYear = useRef(year);
  const isDragging = useRef(false);
  const gesture = useRef(null);
  const dockRef = useRef(null);
  const sliderRef = useRef(null);
  const thumbRef = useRef(null);
  const progressRef = useRef(null);
  const inputRef = useRef(null);
  const widthRef = useRef(0);
  const raf = useRef(0);
  const motion = useRef(null);
  const target = useRef(year);
  const lastFrame = useRef(0);

  const paint = () => {
    const fraction = Math.max(0, Math.min(1, (visual.current - y0) / span));
    thumbRef.current.style.transform = `translate3d(${fraction * widthRef.current}px, 0, 0) translateX(-50%)`;
    progressRef.current.style.transform = `scaleX(${fraction})`;
    inputRef.current.value = String(visual.current);
  };
  const frame = (now) => {
    raf.current = 0;
    const dt = Math.min(64, now - (lastFrame.current || now));
    lastFrame.current = now;
    if (isDragging.current && gesture.current?.moved) {
      // Follow the pointer without restarting a CSS transition on each event.
      visual.current += (target.current - visual.current) * (1 - Math.exp(-dt / 45));
    } else if (motion.current) {
      const m = motion.current;
      const t = Math.min(1, (now - m.start) / m.duration);
      visual.current = m.from + (m.to - m.from) * (1 - Math.pow(1 - t, 3));
      if (t === 1) motion.current = null;
    }
    if (Math.abs(target.current - visual.current) < 0.001) visual.current = target.current;
    paint();
    if (motion.current || Math.abs(target.current - visual.current) >= 0.001) raf.current = requestAnimationFrame(frame);
  };
  const animate = (next, follow = false) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { target.current = visual.current = next; motion.current = null; paint(); return; }
    if (target.current !== next || (!follow && !motion.current)) {
      target.current = next;
      motion.current = follow ? null : { from: visual.current, to: next, start: performance.now(), duration: 400 };
    }
    if (!raf.current) { lastFrame.current = performance.now(); raf.current = requestAnimationFrame(frame); }
  };

  useLayoutEffect(() => {
    const measure = () => { widthRef.current = sliderRef.current.getBoundingClientRect().width; paint(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sliderRef.current);
    return () => { observer.disconnect(); cancelAnimationFrame(raf.current); };
  }, [y0, span]);
  const groups = yearGroups(missingYears);
  const missing = missingYears.includes(year);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    const app = dock.closest('.app');
    const measure = () => app.style.setProperty('--timeline-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => { observer.disconnect(); app.style.removeProperty('--timeline-height'); };
  }, []);

  useEffect(() => {
    lastYear.current = year;
    if (!isDragging.current) {
      animate(year);
    }
  }, [year]);

  const commit = (value) => {
    const snapped = nearestYear(years, value);
    if (lastYear.current !== snapped) {
      lastYear.current = snapped;
      onYear(snapped);
    }
    return snapped;
  };
  const scrub = (event, continuous = true) => {
    const track = gesture.current.track;
    const fraction = Math.max(0, Math.min(1, (event.clientX - track.left) / track.width));
    const raw = y0 + fraction * span;
    // Move through fractional positions visually; climate data stays on whole years.
    const next = continuous ? raw : nearestYear(years, raw);
    animate(next, continuous);
    commit(continuous ? magneticYear(years, raw, lastYear.current) : next);
  };
  const finish = () => {
    setPressed(false);
    if (!isDragging.current) return;
    isDragging.current = false;
    gesture.current = null;
    const snapped = commit(target.current);
    setDragging(false);
    animate(snapped);
  };

  return (
    <div ref={dockRef} className={`timeline dock glass ${pressed ? 'is-pressed' : ''} ${dragging ? 'is-scrubbing' : ''} ${missing ? 'is-missing-year' : ''}`}>
      {children}
      <div className="tl-row">
        <div ref={sliderRef} className="slider liquid-slider">
          <div className="timeline-track" aria-hidden="true"><span ref={progressRef} className="timeline-progress" /></div>
          {groups.map((g) => (
            <span key={g.start} className="timeline-gap" role="img" aria-label={`${yearGroupLabel(g)}: no annual data`} title={`${yearGroupLabel(g)}: no annual data`}
              style={{ left: `${pct(g.start - 0.5)}%`, width: `${pct(g.end + 0.5) - pct(g.start - 0.5)}%` }} />
          ))}
          <input ref={inputRef} className="timeline-input" type="range" min={y0} max={y1} step="any" defaultValue={year}
            aria-label={t('Year')} aria-valuetext={`${year}${missing ? `, ${t('no annual data')}` : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.focus({ preventScroll: true });
              setPressed(true);
              isDragging.current = true;
              gesture.current = { start: e.clientX, moved: false, track: e.currentTarget.getBoundingClientRect() };
              e.currentTarget.setPointerCapture(e.pointerId);
              onYear(year);
              scrub(e, false);
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!isDragging.current || !g) return;
              if (!g.moved && Math.abs(e.clientX - g.start) < 3) return;
              if (!g.moved) { g.moved = true; setDragging(true); }
              scrub(e);
            }}
            onPointerUp={(e) => {
              if (gesture.current?.moved) scrub(e);
              finish();
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onChange={(e) => {
              if (isDragging.current) return;
              const snapped = commit(Number(e.target.value));
              animate(snapped);
            }}
            onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
            onKeyUp={() => setPressed(false)}
            onKeyDown={(e) => {
              const i = years.indexOf(year);
              let next;
              if (['ArrowRight', 'ArrowUp'].includes(e.key)) next = years[Math.min(years.length - 1, i + 1)];
              else if (['ArrowLeft', 'ArrowDown'].includes(e.key)) next = years[Math.max(0, i - 1)];
              else if (e.key === 'Home') next = y0;
              else if (e.key === 'End') next = y1;
              else if (e.key === 'PageUp') next = years[Math.min(years.length - 1, i + 5)];
              else if (e.key === 'PageDown') next = years[Math.max(0, i - 5)];
              else return;
              e.preventDefault(); e.stopPropagation();
              setPressed(true);
              animate(next); lastYear.current = next; onYear(next);
            }}
          />
          <span ref={thumbRef} className="timeline-thumb" aria-hidden="true"><span className="timeline-thumb-glass"><i /></span></span>
          <div className="ticks" aria-hidden="true">
            {years.map((y) => <span key={y} className={`tick ${majors.includes(y) ? 'major' : ''} ${missingYears.includes(y) ? 'missing' : ''} ${year === y ? 'selected' : ''}`} style={{ left: `${pct(y)}%` }} />)}
          </div>
          <div className="labels">
            {majors.map((y) => <button key={y} type="button" className={`${y === year ? 'cur' : ''} ${missingYears.includes(y) ? 'missing' : ''}`} style={{ left: `${pct(y)}%` }} onClick={() => onYear(y)}>{y}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

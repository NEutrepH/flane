// Le curseur de durée, façon règle graduée : on attrape n'importe où et on glisse.
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const INSET = 10;

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function Ruler({ min, max, value, onChange, disabled }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  useEffect(() => {
    last.current = value;
  }, [value]);

  const span = Math.max(1, max - min);
  const pct = (v: number) => (Math.min(max, Math.max(min, v)) - min) / span;
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const k = (clientX - r.left - INSET) / Math.max(1, r.width - 2 * INSET);
    return Math.round(min + Math.min(1, Math.max(0, k)) * span);
  };
  const emit = (v: number) => {
    if (v === last.current) return;
    last.current = v;
    if (v % 5 === 0) navigator.vibrate?.(4);
    onChange(v);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    emit(fromX(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) emit(fromX(e.clientX));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
    if (e.key === 'Home') emit(min);
    else if (e.key === 'End') emit(max);
    else if (step[e.key]) emit(Math.min(max, Math.max(min, value + step[e.key])));
    else return;
    e.preventDefault();
  };

  const ticks: number[] = [];
  for (let m = min; m <= max; m++) ticks.push(m);
  const labels = ticks.filter((m) => m % 10 === 0 && pct(m) > 0.07 && pct(m) < 0.93);

  return (
    <div className={`ruler${disabled ? ' ruler--off' : ''}`} style={{ '--p': pct(value) } as CSSProperties}>
      <div
        ref={track}
        className="ruler__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Durée de ton trajet"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} minutes`}
        aria-disabled={disabled}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <div className="ruler__fill" />
        <svg className="ruler__ticks" viewBox={`0 0 ${span} 20`} preserveAspectRatio="none" aria-hidden>
          {ticks.map((m) => (
            <line key={m} x1={m - min} x2={m - min} y1={m % 10 === 0 ? 2 : m % 5 === 0 ? 8 : 13} y2={20} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {labels.map((m) => (
          <span key={m} className="ruler__label" style={{ left: `calc(${INSET}px + ${pct(m)} * (100% - ${2 * INSET}px))` }}>
            {m}
          </span>
        ))}
        <div className="ruler__thumb">
          <span>{value}′</span>
        </div>
      </div>
      <div className="ruler__ends">
        <span>{min > 0 ? `${min}′ · le plus court` : 'boucle'}</span>
        <span>{max}′</span>
      </div>
    </div>
  );
}

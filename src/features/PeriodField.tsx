import type { ActivationPeriod } from '../types';
import { todayIso } from '../utils/format';

export function PeriodField({ value, onChange }: { value: ActivationPeriod; onChange: (p: ActivationPeriod) => void }) {
  const range = value.type === 'range' ? value : undefined;
  const setRange = (start: string, end: string) => onChange({ type: 'range', start, end });
  return (
    <div className="panel period-field">
      <label className="radio">
        <input type="radio" checked={value.type === 'always'} onChange={() => onChange({ type: 'always' })} />
        All the time
      </label>
      <label className="radio">
        <input
          type="radio"
          checked={value.type === 'range'}
          onChange={() => {
            const start = todayIso();
            const end = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
            setRange(start, end);
          }}
        />
        Specify a period
      </label>
      {range && (
        <div className="date-range">
          <input type="date" value={range.start} max={range.end} onChange={(e) => setRange(e.target.value, range.end)} aria-label="Start date" />
          <span>→</span>
          <input type="date" value={range.end} min={range.start} onChange={(e) => setRange(range.start, e.target.value)} aria-label="End date" />
        </div>
      )}
    </div>
  );
}

export const isPeriodValid = (p: ActivationPeriod) =>
  p.type === 'always' || (!!p.start && !!p.end && p.start <= p.end);

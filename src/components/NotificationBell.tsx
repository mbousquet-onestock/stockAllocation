import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { segmentLabel } from '../config/segments';
import { plural } from '../utils/format';
import { useAsync } from '../utils/useAsync';
import { useDataVersion } from './DataVersion';
import { BellIcon, CloseIcon, WarningIcon } from './Icons';

/** Floating bell listing the items below their threshold. */
export function NotificationBell() {
  const { version } = useDataVersion();
  const [open, setOpen] = useState(false);
  const items = useAsync(
    () => api.listItems({ page: 0, pageSize: 100, sort: { key: 'item', direction: 'asc' } }).then((p) => p.data.filter((s) => s.warnings.length)),
    [version],
  );
  const count = items.data?.length ?? 0;
  return (
    <>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel__header">
            <strong>Alerts</strong>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          {count === 0 && <div className="muted empty">No alert</div>}
          {items.data?.map((s) => (
            <Link key={s.item.id} to={`/items/${s.item.id}`} className="notif" onClick={() => setOpen(false)}>
              <WarningIcon className="text-warning" />
              <div>
                <div>{s.item.name}</div>
                <div className="muted small">Below threshold – {s.warnings.map(segmentLabel).join(', ')}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <button type="button" className="fab" onClick={() => setOpen((o) => !o)} aria-label={`Alerts: ${plural(count, 'item')}`}>
        <BellIcon width={24} height={24} />
        {count > 0 && <span className="fab__count">{count}</span>}
      </button>
    </>
  );
}

import { useState } from 'react';
import { DatabaseSettings } from './DatabaseSettings';
import { OnestockSettings } from './OnestockSettings';
import { ApiCallsSettings } from './ApiCallsSettings';
import { StockImportApiSettings } from './StockImportApiSettings';
import { StockTypesSettings } from './StockTypesSettings';

const MENUS = [
  { key: 'stock-types', label: 'Stock types' },
  { key: 'database', label: 'Database' },
  { key: 'onestock', label: 'OneStock API' },
  { key: 'stock-import', label: 'Stock import API' },
  { key: 'api-calls', label: 'API calls' },
];

export function SettingsPage() {
  const [menu, setMenu] = useState(MENUS[0].key);
  return (
    <div className="settings">
      <aside className="card settings-menu">
        <div className="settings-menu__title">Configuration</div>
        {MENUS.map((m) => (
          <button type="button" key={m.key} className={menu === m.key ? 'is-active' : ''} onClick={() => setMenu(m.key)}>
            {m.label}
          </button>
        ))}
      </aside>
      <section className="card page grow">
        {menu === 'stock-types' && <StockTypesSettings />}
        {menu === 'database' && <DatabaseSettings />}
        {menu === 'onestock' && <OnestockSettings />}
        {menu === 'stock-import' && <StockImportApiSettings />}
        {menu === 'api-calls' && <ApiCallsSettings />}
      </section>
    </div>
  );
}

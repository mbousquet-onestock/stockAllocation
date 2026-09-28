import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { dismissConnectionNotice, takeConnectionNotice } from './api/bootstrap';
import { getDbConfig } from './api/dbConfig';
import { currentSiteId } from './api/site';
import { DataVersionProvider, useDataVersion } from './components/DataVersion';
import { ResetIcon } from './components/Icons';
import { ToastProvider, useToast } from './components/Toast';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemListPage } from './pages/ItemListPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StockTypesProvider } from './components/StockTypes';
import { SettingsIcon } from './components/Icons';

const OPENED_KEY = 'stock-allocation:opened';

/**
 * Home page: Segmentation rules. A new opening of the application (new tab or window, browser restart, bookmark)
 * on the settings starts on the rules; a reload of the tab stays on the current screen.
 */
function useHomeOnOpen() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let opened = false;
    try {
      opened = sessionStorage.getItem(OPENED_KEY) === '1';
      sessionStorage.setItem(OPENED_KEY, '1');
    } catch {
      /* storage unavailable: no redirect */
      opened = true;
    }
    if (!opened && location.pathname.startsWith('/settings')) navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Shell() {
  const { bump } = useDataVersion();
  const notify = useToast();
  useHomeOnOpen();
  // Result of the connection of this computer to the shared database (see api/bootstrap).
  const [keyRequired, setKeyRequired] = useState(false);
  useEffect(() => {
    const n = takeConnectionNotice();
    const site = currentSiteId();
    if (n === 'setup-applied') notify(`Connected to the shared database${site ? ` — site ${site}` : ''}`, 'info');
    else if (n === 'auto-detected') notify(`Shared database of this deployment used${site ? ` — site ${site}` : ''}`, 'info');
    else if (n === 'key-required' && getDbConfig().mode === 'local') setKeyRequired(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="app">
      <header className="app-header">
        <nav className="nav">
          <NavLink to="/" end>
            Segmentation rules
          </NavLink>
          <NavLink to="/items">Item allocation</NavLink>
          <NavLink to="/settings">
            <SettingsIcon /> Settings
          </NavLink>
        </nav>
        <span className="grow" />
        {api.reset && (
          <button
            type="button"
            className="btn btn--ghost small"
            title="Restore the demo data"
            onClick={async () => {
              await api.reset!();
              bump();
              notify('Demo data restored', 'info');
            }}
          >
            <ResetIcon /> Reset demo data
          </button>
        )}
      </header>
      {keyRequired && (
        <div className="connection-banner">
          A shared database is available on this deployment, protected by an API key: open the <strong>setup link</strong> sent by
          your administrator, or enter the key in{' '}
          <NavLink to="/settings" onClick={() => setKeyRequired(false)}>
            Settings → Database
          </NavLink>
          .
          <button
            type="button"
            className="link"
            onClick={() => {
              dismissConnectionNotice();
              setKeyRequired(false);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <main>
        <Routes>
          <Route path="/" element={<RulesPage />} />
          <Route path="/items" element={<ItemListPage />} />
          <Route path="/items/:itemId" element={<ItemDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <DataVersionProvider>
          <StockTypesProvider>
            <Shell />
          </StockTypesProvider>
        </DataVersionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

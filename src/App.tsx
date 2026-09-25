import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { DataVersionProvider, useDataVersion } from './components/DataVersion';
import { ResetIcon } from './components/Icons';
import { ToastProvider, useToast } from './components/Toast';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemListPage } from './pages/ItemListPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StockTypesProvider } from './components/StockTypes';
import { SettingsIcon } from './components/Icons';

function Shell() {
  const { bump } = useDataVersion();
  const notify = useToast();
  return (
    <div className="app">
      <header className="app-header">
        <h1>Stock allocation</h1>
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

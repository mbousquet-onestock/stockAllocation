import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootstrapConnection } from './api/bootstrap';
import './styles.css';

// Connection to the shared database (setup link, database of the deployment) before the first screen.
bootstrapConnection()
  .catch(() => undefined)
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );

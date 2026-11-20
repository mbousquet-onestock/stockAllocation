import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onBackgroundUpdate } from '../api/background';

/** Global counter bumped after every mutation so all views reload their data. */
const Ctx = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} });

export function DataVersionProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  // Data refreshed in the background: the screens reload it.
  useEffect(() => onBackgroundUpdate(bump), [bump]);
  return <Ctx.Provider value={{ version, bump }}>{children}</Ctx.Provider>;
}

export const useDataVersion = () => useContext(Ctx);

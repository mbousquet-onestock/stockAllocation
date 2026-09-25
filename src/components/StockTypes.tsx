import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../api';
import { StockTypeTree } from '../utils/stockTypes';
import { useAsync } from '../utils/useAsync';
import { useDataVersion } from './DataVersion';
import { Spinner } from './ui';

const Ctx = createContext<StockTypeTree>(new StockTypeTree([]));

/** Loads the stock type settings once (and after every mutation) for the whole app. */
export function StockTypesProvider({ children }: { children: ReactNode }) {
  const { version } = useDataVersion();
  const types = useAsync(() => api.listStockTypes(), [version]);
  const tree = useMemo(() => new StockTypeTree(types.data ?? []), [types.data]);
  if (!types.data) return <Spinner />;
  return <Ctx.Provider value={tree}>{children}</Ctx.Provider>;
}

export const useStockTypes = () => useContext(Ctx);

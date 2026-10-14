import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth';

// Admin-wide store selector: "all" (consolidated) or one store id. Server enforces access either way.
const Ctx = createContext({ storeId: 'all', setStoreId: () => {} });

export function AdminStoreProvider({ children }) {
  const { session } = useAuth();
  const [storeId, setStoreId] = useState(() => {
    try { return localStorage.getItem('sp_admin_store') || 'all'; } catch { return 'all'; }
  });
  useEffect(() => {
    try { localStorage.setItem('sp_admin_store', storeId); } catch { /* ignore */ }
  }, [storeId]);
  useEffect(() => {
    // fall back to an allowed store if the saved one is not accessible
    if (!session) return;
    const ids = (session.stores || []).map((s) => s._id);
    if (storeId !== 'all' && !ids.includes(storeId)) setStoreId('all');
  }, [session, storeId]);
  return <Ctx.Provider value={{ storeId, setStoreId, stores: session?.stores || [], allStores: session?.allStores }}>{children}</Ctx.Provider>;
}

export const useAdminStore = () => useContext(Ctx);

/** For actions that need ONE store (stock-in, POS): selected store or the first accessible one. */
export function useSingleStore() {
  const { storeId, stores } = useAdminStore();
  return storeId !== 'all' ? storeId : stores[0]?._id || '';
}

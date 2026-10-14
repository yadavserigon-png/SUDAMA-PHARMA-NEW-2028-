import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, permissions, stores, allStores, roleLabel }
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) { setSession(null); setReady(true); return; }
    try {
      setSession(await api('/auth/me'));
    } catch {
      setToken(null);
      setSession(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => { setToken(null); setSession(null); };
    window.addEventListener('sp:unauthorized', onUnauth);
    return () => window.removeEventListener('sp:unauthorized', onUnauth);
  }, [refresh]);

  const acceptLogin = useCallback((res) => {
    setToken(res.token);
    setSession({ user: res.user, permissions: res.permissions || [], stores: res.stores || [], allStores: res.allStores, roleLabel: res.roleLabel });
  }, []);

  const logout = useCallback(() => { setToken(null); setSession(null); }, []);
  const can = useCallback((...perms) => Boolean(session && perms.some((p) => session.permissions?.includes(p))), [session]);

  return (
    <AuthCtx.Provider value={{ session, user: session?.user, ready, refresh, acceptLogin, logout, can }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

export const STAFF_ROLES = ['super_admin', 'central_admin', 'store_manager', 'pharmacist', 'inventory_manager', 'purchase_manager', 'pos_operator', 'accountant', 'support_agent', 'delivery_manager'];
export const isStaffRole = (r) => STAFF_ROLES.includes(r);

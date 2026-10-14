import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const defaults = {
  branding: { platformName: 'Sudama Pharma', legalName: 'Sudama Private Limited', phone: '9264289295', email: '', address: 'Bihar, India', tagline: 'Genuine medicines. Delivered with care.' },
  policies: {},
  payments: { codEnabled: true, phonepeEnabled: false },
  whatsapp: { apiConfigured: false, clickToChat: 'https://wa.me/919264289295' },
};
const SettingsCtx = createContext({ ...defaults, reload: () => {} });

export function SettingsProvider({ children }) {
  const [s, setS] = useState(defaults);
  const load = () => api('/settings/public').then(setS).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (s.branding?.platformName) document.title = s.branding.platformName; }, [s.branding?.platformName]);
  return <SettingsCtx.Provider value={{ ...s, reload: load }}>{children}</SettingsCtx.Provider>;
}

export const useSettings = () => useContext(SettingsCtx);

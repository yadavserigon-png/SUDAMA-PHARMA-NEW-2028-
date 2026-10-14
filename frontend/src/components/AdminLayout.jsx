import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { useAdminStore } from '../state/adminStore';
import { useSettings } from '../state/settings';
import { useApi } from '../lib/hooks';

const NAV = [
  { group: 'Overview', items: [['/admin', 'Dashboard', ['reports.view', 'orders.view', 'inventory.view', 'pos.use']], ['/admin/reports', 'Sales & profit', ['reports.view']]] },
  { group: 'Selling', items: [['/pos', 'POS billing counter', ['pos.use']], ['/admin/orders', 'Orders', ['orders.view']], ['/admin/prescriptions', 'Prescriptions', ['prescriptions.review']], ['/admin/requests', 'Medicine requests', ['requests.manage']], ['/admin/whatsapp', 'WhatsApp inbox', ['whatsapp.manage']], ['/admin/delivery', 'Delivery', ['delivery.manage']], ['/admin/wholesale', 'Wholesale', ['wholesale.manage']]] },
  { group: 'Stock', items: [['/admin/products', 'Products', ['products.view']], ['/admin/categories', 'Categories', ['categories.manage']], ['/admin/inventory', 'Inventory & expiry', ['inventory.view']], ['/admin/transfers', 'Stock transfers', ['transfers.manage']], ['/admin/purchases', 'Purchases', ['purchases.view']], ['/admin/suppliers', 'Suppliers', ['suppliers.view']]] },
  { group: 'Money', items: [['/admin/payments', 'Payments', ['payments.view']], ['/admin/refunds', 'Refunds', ['refunds.request', 'refunds.approve']], ['/admin/expenses', 'Expenses', ['expenses.manage', 'expenses.approve']], ['/admin/coupons', 'Coupons & offers', ['coupons.manage']]] },
  { group: 'People', items: [['/admin/users', 'Users & roles', ['users.manage', 'employees.view', 'customers.manage', 'delivery.manage']], ['/admin/employees', 'Attendance & tasks', ['employees.view']], ['/admin/support', 'Support tickets', ['support.manage']], ['/admin/ads', 'Ads & partners', ['ads.manage', 'delivery.manage', 'wholesale.manage', 'suppliers.manage']]] },
  { group: 'System', items: [['/admin/stores', 'Stores', ['stores.view', 'stores.manage']], ['/admin/import-export', 'Excel import / export', ['import.manage', 'export.data']], ['/admin/settings', 'Settings', ['settings.manage', 'payments.config']], ['/admin/audit', 'Audit log', ['audit.view']]] },
];

export default function AdminLayout() {
  const { user, can, session, logout } = useAuth();
  const { storeId, setStoreId, stores, allStores } = useAdminStore();
  const { branding } = useSettings();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const notes = useApi('/notifications', [loc.pathname]);
  return (
    <div className="admin">
      <aside className={`admin-side ${open ? 'open' : ''}`}>
        <Link to="/" className="brand"><img src="/icons/icon.svg" alt="" /><span><b>{branding.platformName}</b><small>Admin · {session?.roleLabel}</small></span></Link>
        <nav onClick={() => setOpen(false)}>
          {NAV.map((g) => {
            const items = g.items.filter(([, , perms]) => can(...perms));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="group">{g.group}</div>
                {items.map(([to, text]) => <NavLink key={to} to={to} end={to === '/admin'}>{text}</NavLink>)}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="admin-main">
        <div className="admin-top">
          <div className="row">
            <button className="btn ghost small menu-toggle" onClick={() => setOpen(!open)} aria-label="Menu">Menu</button>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>Store</span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Select store">
                <option value="all">{allStores ? 'All stores (consolidated)' : 'All my stores'}</option>
                {stores.map((s) => <option key={s._id} value={s._id}>{s.code} · {s.name}{s.active === false ? ' (inactive)' : ''}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <Link to="/admin/notifications" className="btn ghost small">Alerts{notes.data?.unread ? ` (${notes.data.unread})` : ''}</Link>
            <span className="muted" style={{ fontSize: '0.85rem' }}>{user?.name}</span>
            <Link to="/account" className="btn ghost small">Profile</Link>
            <button className="btn ghost small" onClick={logout}>Log out</button>
          </div>
        </div>
        <div className="admin-body"><Outlet /></div>
      </div>
    </div>
  );
}

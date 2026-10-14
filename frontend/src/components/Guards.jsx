import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, isStaffRole } from '../state/auth';
import { Loading } from './ui';

export function RequireAuth({ children, roles, staff }) {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="container"><Loading /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (staff && !isStaffRole(user.role)) return <div className="container"><div className="notice error" style={{ marginTop: 24 }}>This area is for Sudama Pharma staff.</div></div>;
  if (roles && !roles.includes(user.role)) return <div className="container"><div className="notice error" style={{ marginTop: 24 }}>Your account cannot open this page.</div></div>;
  return children;
}

export function Can({ perm, children, fallback = null }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  return can(...perms) ? children : fallback;
}

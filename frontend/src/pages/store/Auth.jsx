import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth, isStaffRole } from '../../state/auth';
import { useToast } from '../../state/toast';
import { ErrorBox, Field } from '../../components/ui';

function useAfterLogin() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  return (user) => {
    const next = params.get('next');
    if (next && next.startsWith('/')) return nav(next);
    if (isStaffRole(user.role)) return nav(user.role === 'pos_operator' ? '/pos' : '/admin');
    if (user.role === 'delivery_partner') return nav('/delivery');
    if (user.role === 'wholesale_buyer') return nav('/wholesale');
    return nav('/');
  };
}

export function Login() {
  const { acceptLogin } = useAuth();
  const after = useAfterLogin();
  const [f, setF] = useState({ identifier: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => { api('/auth/setup-status').then((s) => setNeedsSetup(s.needsSetup)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: f });
      acceptLogin(r);
      after(r.user);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="auth-card panel stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Log in</h1>
      {needsSetup && <div className="notice warn">This platform has no owner account yet. <Link to="/setup">Run first-time setup</Link>.</div>}
      <form onSubmit={submit} className="stack">
        <Field label="Mobile number or email"><input autoComplete="username" value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} required /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <ErrorBox error={error} />
        <button className="btn block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <div className="row between"><Link to="/register">Create an account</Link><Link to="/forgot-password">Forgot password?</Link></div>
    </div>
  );
}

export function Register() {
  const { acceptLogin } = useAuth();
  const after = useAfterLogin();
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' });
  const [stage, setStage] = useState('form');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/auth/register', { method: 'POST', body: f });
      acceptLogin(r);
      setUser(r.user);
      setDevCode(r.verification?.devCode || '');
      setStage('verify');
    } catch (err) { setError(err); }
  };
  const verify = async (e) => {
    e.preventDefault();
    try {
      await api('/auth/verify', { method: 'POST', body: { code } });
      toast('Mobile number verified');
      after(user);
    } catch (err) { setError(err); }
  };
  return (
    <div className="auth-card panel stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Create your account</h1>
      {stage === 'form' ? (
        <form onSubmit={submit} className="stack">
          <Field label="Full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Mobile number"><input inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
          <Field label="Email" hint="optional"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Password" hint="8+ characters with letters and numbers"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
          <ErrorBox error={error} />
          <button className="btn block">Create account</button>
          <small className="muted">Already registered? <Link to="/login">Log in</Link></small>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p>Enter the 6-digit code sent to {f.phone}.</p>
          {devCode && <div className="notice warn">SMS is not configured on this server yet (development mode). Your code is {devCode}.</div>}
          <Field label="Verification code"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          <button className="btn block">Verify</button>
          <button type="button" className="linkbtn" onClick={() => after(user)}>Skip for now</button>
        </form>
      )}
    </div>
  );
}

export function ForgotPassword() {
  const [stage, setStage] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState(null);
  const nav = useNavigate();
  const request = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { identifier } });
      setMsg(r.devToken ? `${r.message} (Development mode - code: ${r.devToken})` : r.message);
      setStage(2);
    } catch (err) { setError(err); }
  };
  const reset = async (e) => {
    e.preventDefault();
    try {
      await api('/auth/reset-password', { method: 'POST', body: { identifier, token, password } });
      nav('/login');
    } catch (err) { setError(err); }
  };
  return (
    <div className="auth-card panel stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>Reset password</h1>
      {stage === 1 ? (
        <form onSubmit={request} className="stack">
          <Field label="Mobile number or email"><input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          <button className="btn block">Send reset code</button>
        </form>
      ) : (
        <form onSubmit={reset} className="stack">
          <div className="notice">{msg}</div>
          <Field label="Reset code"><input value={token} onChange={(e) => setToken(e.target.value)} required /></Field>
          <Field label="New password"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          <button className="btn block">Set new password</button>
        </form>
      )}
    </div>
  );
}

/** First-time owner setup. Requires the SETUP_TOKEN configured on the server. */
export function Setup() {
  const { acceptLogin } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ setupToken: '', name: 'Nitesh Kumar', phone: '9264289295', email: 'niteshkumar3850022@gmail.com', password: '', confirm: '' });
  const [error, setError] = useState(null);
  useEffect(() => { api('/auth/setup-status').then(setStatus).catch(setError); }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError(new Error('Passwords do not match'));
    try {
      const { confirm, ...body } = f;
      const r = await api('/auth/setup', { method: 'POST', body });
      acceptLogin(r);
      nav('/admin/stores');
    } catch (err) { setError(err); }
  };
  if (status && !status.needsSetup) return <div className="auth-card panel">Setup is already complete. <Link to="/login">Log in</Link>.</div>;
  return (
    <div className="auth-card panel stack">
      <h1 style={{ fontSize: 'var(--step-2)' }}>First-time setup</h1>
      <p className="muted">Create the Super Admin (platform owner) account for Sudama Private Limited. You choose the password now; it is never stored in code.</p>
      {status && !status.setupTokenConfigured && <div className="notice error">The server has no SETUP_TOKEN. Add it to backend/.env, or create the owner from the terminal with "npm run init:admin".</div>}
      <form onSubmit={submit} className="stack">
        <Field label="Setup token" hint="from backend .env"><input type="password" value={f.setupToken} onChange={(e) => setF({ ...f, setupToken: e.target.value })} required /></Field>
        <Field label="Owner name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Mobile"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password" hint="8+ characters with letters and numbers"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="Confirm password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
        <ErrorBox error={error} />
        <button className="btn block">Create owner account</button>
      </form>
    </div>
  );
}

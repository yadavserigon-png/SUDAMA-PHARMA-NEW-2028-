import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, isStaffRole } from '../state/auth';
import { useCart } from '../state/cart';
import { useSettings } from '../state/settings';

export default function StoreLayout() {
  const { user, logout } = useAuth();
  const cart = useCart();
  const { branding, whatsapp } = useSettings();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const askPin = () => {
    const p = window.prompt('Enter your 6-digit PIN code to check delivery', cart.pincode || '');
    if (p && /^\d{6}$/.test(p.trim())) cart.setPincode(p.trim());
  };
  return (
    <>
      <div className="topbar">
        <div className="container">
          <span>Call {branding.phone} · <a href={whatsapp.clickToChat} target="_blank" rel="noreferrer">Chat on WhatsApp</a></span>
          <span><Link to="/stores">Find a store</Link> · <Link to="/partner">Partner with us</Link> · <Link to="/wholesale">Wholesale</Link></span>
        </div>
      </div>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand" aria-label={`${branding.platformName} home`}>
            <img src={branding.logo || '/icons/icon.svg'} alt="" />
            <span><b>{branding.platformName}</b><small>{branding.legalName}</small></span>
          </Link>
          <button className="pin-chip" onClick={askPin} type="button">{cart.pincode ? `Deliver to ${cart.pincode}` : 'Set PIN code'}</button>
          <form className="header-search" onSubmit={submit} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicines, brands, salts" aria-label="Search medicines" />
            <button className="btn" type="submit">Search</button>
          </form>
          <nav className="nav-links">
            <NavLink to="/offers" className="hide-sm">Offers</NavLink>
            {user ? (
              <>
                {isStaffRole(user.role) && <Link to="/admin">Admin</Link>}
                {user.role === 'delivery_partner' && <Link to="/delivery">Deliveries</Link>}
                <NavLink to="/account" className="hide-sm">My account</NavLink>
                <button className="linkbtn hide-sm" onClick={() => { logout(); nav('/'); }}>Log out</button>
              </>
            ) : <NavLink to="/login">Log in</NavLink>}
            <NavLink to="/cart">Cart{cart.count > 0 && <span className="cart-count">{cart.count}</span>}</NavLink>
          </nav>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          <div className="cols">
            <div>
              <h4>{branding.platformName}</h4>
              <p>{branding.tagline}</p>
              <p>{branding.legalName}{branding.cin ? ` · CIN ${branding.cin}` : ''}<br />{branding.address}</p>
              <p>Phone {branding.phone}{branding.email ? <> · <a href={`mailto:${branding.email}`}>{branding.email}</a></> : null}</p>
            </div>
            <div>
              <h4>Shop</h4>
              <ul>
                <li><Link to="/search">All products</Link></li>
                <li><Link to="/upload-prescription">Upload prescription</Link></li>
                <li><Link to="/request-medicine">Request a medicine</Link></li>
                <li><Link to="/offers">Offers</Link></li>
              </ul>
            </div>
            <div>
              <h4>Help</h4>
              <ul>
                <li><Link to="/orders">Track order</Link></li>
                <li><Link to="/support">Customer support</Link></li>
                <li><Link to="/stores">Store locator</Link></li>
                <li><Link to="/policies">Returns &amp; privacy</Link></li>
              </ul>
            </div>
            <div>
              <h4>Business</h4>
              <ul>
                <li><Link to="/wholesale">Wholesale buyers</Link></li>
                <li><Link to="/partner">Advertise with us</Link></li>
                <li><Link to="/partner?type=delivery_partner">Become a delivery partner</Link></li>
              </ul>
            </div>
          </div>
          <p className="disclaimer">{branding.disclaimer || 'Medicines are dispensed only against a valid prescription where required.'} {branding.footerText}</p>
        </div>
      </footer>
    </>
  );
}

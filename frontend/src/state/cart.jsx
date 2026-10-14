import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Cart keeps only product ids, names and quantities for display; prices are always recalculated by the server.
const CartCtx = createContext(null);
const KEY = 'sp_cart';
const PIN_KEY = 'sp_pin';

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => load(KEY, []));
  const [pincode, setPincode] = useState(() => load(PIN_KEY, ''));
  useEffect(() => save(KEY, items), [items]);
  useEffect(() => save(PIN_KEY, pincode), [pincode]);

  const api = useMemo(() => ({
    items,
    pincode,
    setPincode,
    count: items.reduce((s, i) => s + i.qty, 0),
    qtyOf: (id) => items.find((i) => i.productId === id)?.qty || 0,
    add(p, qty = 1) {
      setItems((x) => {
        const e = x.find((i) => i.productId === p._id);
        if (e) return x.map((i) => (i.productId === p._id ? { ...i, qty: Math.min(100, i.qty + qty) } : i));
        return [...x, { productId: p._id, name: p.name, price: p.price, mrp: p.mrp, packSize: p.packSize, rx: p.prescriptionRequired, image: p.images?.[0], qty }];
      });
    },
    setQty(id, qty) {
      setItems((x) => (qty <= 0 ? x.filter((i) => i.productId !== id) : x.map((i) => (i.productId === id ? { ...i, qty: Math.min(100, qty) } : i))));
    },
    clear: () => setItems([]),
  }), [items, pincode]);

  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>;
}

export const useCart = () => useContext(CartCtx);

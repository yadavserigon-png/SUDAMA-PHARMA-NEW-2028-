import { Navigate, Route, Routes } from 'react-router-dom';
import StoreLayout from './components/StoreLayout';
import AdminLayout from './components/AdminLayout';
import { RequireAuth } from './components/Guards';
import { AdminStoreProvider } from './state/adminStore';
import Home from './pages/store/Home';
import Search from './pages/store/Search';
import Product from './pages/store/Product';
import { CartPage, CheckoutPage } from './pages/store/Cart';
import { MyOrders, OrderDetail, PaymentReturn } from './pages/store/Orders';
import { Login, Register, ForgotPassword, Setup } from './pages/store/Auth';
import Account from './pages/store/Account';
import { UploadPrescription, MedicineRequest, Support, Partner, Offers, StoreLocator, Policies } from './pages/store/Forms';
import Wholesale from './pages/store/Wholesale';
import Dashboard from './pages/admin/Dashboard';
import Reports from './pages/admin/Reports';
import Stores from './pages/admin/Stores';
import Products from './pages/admin/Products';
import Categories from './pages/admin/Categories';
import Inventory from './pages/admin/Inventory';
import Transfers from './pages/admin/Transfers';
import Suppliers from './pages/admin/Suppliers';
import Purchases from './pages/admin/Purchases';
import Orders from './pages/admin/Orders';
import Prescriptions from './pages/admin/Prescriptions';
import { Requests, WhatsAppInbox } from './pages/admin/Requests';
import Delivery from './pages/admin/Delivery';
import Users from './pages/admin/Users';
import Employees from './pages/admin/Employees';
import { Payments, Refunds, Expenses, Coupons } from './pages/admin/Money';
import { Support as SupportAdmin, Ads, WholesaleAdmin, ImportExport, Settings, Audit, Notifications } from './pages/admin/Misc';
import Pos from './pages/pos/Pos';
import DeliveryApp from './pages/delivery/DeliveryApp';

export default function App() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<Home />} />
        <Route path="search" element={<Search />} />
        <Route path="product/:id" element={<Product />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
        <Route path="orders" element={<RequireAuth><MyOrders /></RequireAuth>} />
        <Route path="orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
        <Route path="payment/return" element={<RequireAuth><PaymentReturn /></RequireAuth>} />
        <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="setup" element={<Setup />} />
        <Route path="upload-prescription" element={<UploadPrescription />} />
        <Route path="request-medicine" element={<MedicineRequest />} />
        <Route path="support" element={<Support />} />
        <Route path="partner" element={<Partner />} />
        <Route path="offers" element={<Offers />} />
        <Route path="stores" element={<StoreLocator />} />
        <Route path="policies" element={<Policies />} />
        <Route path="wholesale" element={<Wholesale />} />
        <Route path="*" element={<div className="section panel">Page not found. <a href="/">Go home</a></div>} />
      </Route>

      <Route path="admin" element={<RequireAuth staff><AdminStoreProvider><AdminLayout /></AdminStoreProvider></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="stores" element={<Stores />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="orders" element={<Orders />} />
        <Route path="prescriptions" element={<Prescriptions />} />
        <Route path="requests" element={<Requests />} />
        <Route path="whatsapp" element={<WhatsAppInbox />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="wholesale" element={<WholesaleAdmin />} />
        <Route path="users" element={<Users />} />
        <Route path="employees" element={<Employees />} />
        <Route path="payments" element={<Payments />} />
        <Route path="refunds" element={<Refunds />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="coupons" element={<Coupons />} />
        <Route path="support" element={<SupportAdmin />} />
        <Route path="ads" element={<Ads />} />
        <Route path="import-export" element={<ImportExport />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<Audit />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>

      <Route path="pos" element={<RequireAuth staff><Pos /></RequireAuth>} />
      <Route path="delivery" element={<RequireAuth roles={['delivery_partner']}><DeliveryApp /></RequireAuth>} />
    </Routes>
  );
}

import { Link } from 'react-router-dom';
import { useApi, qs } from '../../lib/hooks';
import { inr, num, today } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore } from '../../state/adminStore';
import { Kpi, PageHead, ErrorBox } from '../../components/ui';
import { LineChart } from '../../components/Charts';

export default function Dashboard() {
  const { can, user } = useAuth();
  const { storeId } = useAdminStore();
  const rep = useApi(can('reports.view') ? `/reports/dashboard${qs({ storeId, from: today(-29), to: today() })}` : null, [storeId]);
  const todayRep = useApi(can('reports.view') ? `/reports/dashboard${qs({ storeId, from: today(), to: today() })}` : null, [storeId]);
  const expiry = useApi(can('inventory.view') ? `/inventory/alerts/expiry${qs({ storeId, days: 90 })}` : null, [storeId]);
  const low = useApi(can('inventory.view') ? `/inventory/alerts/low-stock${qs({ storeId })}` : null, [storeId]);
  const rxQueue = useApi(can('prescriptions.review') ? `/orders${qs({ storeId, status: 'prescription_review', limit: 1 })}` : null, [storeId]);
  const toPack = useApi(can('orders.view') ? `/orders${qs({ storeId, status: 'confirmed,packing,ready_for_pickup', limit: 1 })}` : null, [storeId]);
  const requests = useApi(can('requests.manage') ? `/medicine-requests${qs({ storeId, status: 'new', limit: 1 })}` : null, [storeId]);
  const s = rep.data?.summary;
  const t = todayRep.data?.summary;
  const series = rep.data?.series || [];
  return (
    <>
      <PageHead title={`Hello, ${user?.name?.split(' ')[0]}`} sub={storeId === 'all' ? 'All stores' : 'Selected store'} />
      <ErrorBox error={rep.error} />
      <div className="kpis">
        {t && <Kpi tone="accent" value={inr(t.netSales)} label={`Today's sales · ${t.orders} bills`} />}
        {s && <Kpi value={inr(s.netSales)} label="Net sales, last 30 days" />}
        {s && <Kpi value={inr(s.grossProfit)} label={`Gross profit · ${s.grossMarginPercent}% margin`} />}
        {rxQueue.data && <Kpi tone={rxQueue.data.total ? 'warn' : ''} value={num(rxQueue.data.total)} label={<Link to="/admin/orders?status=prescription_review">Prescriptions to review</Link>} />}
        {toPack.data && <Kpi value={num(toPack.data.total)} label={<Link to="/admin/orders?status=confirmed,packing,ready_for_pickup">Orders to pack / dispatch</Link>} />}
        {requests.data && <Kpi value={num(requests.data.total)} label={<Link to="/admin/requests">New medicine requests</Link>} />}
        {expiry.data && <Kpi tone={expiry.data.items.length ? 'warn' : ''} value={num(expiry.data.items.length)} label={<Link to="/admin/inventory?tab=expiry">Batches expiring in 90 days</Link>} />}
        {low.data && <Kpi tone={low.data.outOfStock.length ? 'warn' : ''} value={`${low.data.outOfStock.length} / ${low.data.lowStock.length}`} label={<Link to="/admin/inventory?tab=low">Out of stock / low stock</Link>} />}
      </div>
      {s && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="row between"><h3>Sales, last 30 days</h3><Link to="/admin/reports">Full report</Link></div>
          <LineChart
            labels={series.map((x) => new Date(x.period).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}
            series={[
              { name: 'Net sales', color: '#1f6f4a', values: series.map((x) => x.netSales) },
              { name: 'Gross profit', color: '#d9930d', values: series.map((x) => x.grossProfit) },
            ]}
          />
        </div>
      )}
      {!can('reports.view') && <p className="muted" style={{ marginTop: 16 }}>Use the menu to open the sections you work in.</p>}
    </>
  );
}

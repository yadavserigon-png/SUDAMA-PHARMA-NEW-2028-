import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi, qs } from '../../lib/hooks';
import { inr, date, dateTime, label, today } from '../../lib/format';
import { useAuth } from '../../state/auth';
import { useAdminStore, useSingleStore } from '../../state/adminStore';
import { useToast } from '../../state/toast';
import { DataTable, Field, PageHead, Status, Tabs } from '../../components/ui';

function MyDay() {
  const toast = useToast();
  const store = useSingleStore();
  const att = useApi(`/employees/attendance${qs({ from: today(), to: today(), mine: 'true' })}`);
  const tasks = useApi('/employees/tasks?mine=true');
  const [leave, setLeave] = useState({ from: '', to: '', type: 'casual', reason: '' });
  const act = async (path, body) => { try { await api(path, { method: 'POST', body }); toast('Saved'); att.reload(); } catch (e) { toast(e.message, 'error'); } };
  const mine = (att.data || []).find((a) => a.date === today());
  return (
    <div className="grid grid-2">
      <div className="panel stack">
        <h3>Attendance today</h3>
        <p>{mine?.checkIn ? `Checked in ${dateTime(mine.checkIn)}` : 'Not checked in'}{mine?.checkOut ? ` · out ${dateTime(mine.checkOut)}` : ''}</p>
        <div className="row"><button className="btn" disabled={Boolean(mine?.checkIn) || !store} onClick={() => act('/employees/attendance/check-in', { storeId: store })}>Check in</button><button className="btn secondary" disabled={!mine?.checkIn || Boolean(mine?.checkOut)} onClick={() => act('/employees/attendance/check-out')}>Check out</button></div>
        <h3>Apply for leave</h3>
        <div className="form-grid">
          <Field label="From"><input type="date" value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} /></Field>
          <Field label="Type"><select value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value })}>{['casual', 'sick', 'earned', 'unpaid', 'other'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
          <Field label="Reason"><input value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></Field>
        </div>
        <button className="btn ghost" disabled={!leave.from || !leave.to} onClick={() => act('/employees/leaves', leave)}>Apply</button>
      </div>
      <div className="panel">
        <h3>My tasks</h3>
        <DataTable rows={tasks.data} empty="No tasks assigned." columns={[{ title: 'Task', key: 'title' }, { title: 'Due', render: (t) => date(t.dueAt) }, { title: 'Status', render: (t) => <select value={t.status} onChange={(e) => api(`/employees/tasks/${t._id}`, { method: 'PUT', body: { status: e.target.value } }).then(tasks.reload)} aria-label="Task status">{['todo', 'in_progress', 'done'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> }]} />
      </div>
    </div>
  );
}

function Team({ storeId }) {
  const { can } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(today(-6));
  const [to, setTo] = useState(today());
  const att = useApi(`/employees/attendance${qs({ storeId, from, to })}`);
  const leaves = useApi(`/employees/leaves${qs({ storeId, status: 'pending' })}`);
  const perf = useApi(`/employees/performance${qs({ storeId, from, to })}`);
  const staff = useApi(`/users${qs({ role: 'staff', storeId, limit: 200 })}`);
  const tasks = useApi(`/employees/tasks${qs({ storeId })}`);
  const single = useSingleStore();
  const [task, setTask] = useState({ title: '', assignedTo: '', dueAt: '', priority: 'medium' });
  const decide = async (id, status) => { try { await api(`/employees/leaves/${id}/decision`, { method: 'POST', body: { status } }); leaves.reload(); } catch (e) { toast(e.message, 'error'); } };
  const addTask = async () => { try { await api('/employees/tasks', { method: 'POST', body: { ...task, storeId: single, dueAt: task.dueAt || undefined } }); toast('Task assigned'); setTask({ title: '', assignedTo: '', dueAt: '', priority: 'medium' }); tasks.reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="stack">
      <div className="toolbar"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <h3>Performance</h3>
      <DataTable rows={perf.data} rowKey="user" columns={[
        { title: 'Employee', render: (r) => `${r.user.name} (${label(r.user.role)})` }, { title: 'Bills', key: 'bills', num: true }, { title: 'Sales', render: (r) => inr(r.sales), num: true },
        { title: 'Avg bill', render: (r) => inr(r.averageBill), num: true }, { title: 'Price overrides', key: 'priceOverrides', num: true }, { title: 'Days present', render: (r) => r.attendance?.present || 0, num: true },
        { title: 'Tasks done', render: (r) => `${r.tasks?.done || 0}/${r.tasks?.total || 0}` },
      ]} />
      <h3>Pending leave requests</h3>
      <DataTable rows={leaves.data} empty="No pending requests." columns={[{ title: 'Employee', render: (l) => l.user?.name }, { title: 'From', render: (l) => date(l.from) }, { title: 'To', render: (l) => date(l.to) }, { title: 'Type', render: (l) => label(l.type) }, { title: 'Reason', key: 'reason' },
        { title: '', render: (l) => can('employees.manage') && <span className="row"><button className="btn small" onClick={() => decide(l._id, 'approved')}>Approve</button><button className="btn ghost small" onClick={() => decide(l._id, 'rejected')}>Reject</button></span> }]} />
      <h3>Attendance</h3>
      <DataTable rows={att.data} columns={[{ title: 'Date', key: 'date' }, { title: 'Employee', render: (a) => a.user?.name }, { title: 'In', render: (a) => dateTime(a.checkIn) }, { title: 'Out', render: (a) => dateTime(a.checkOut) }, { title: 'Status', render: (a) => <Status value={a.status} /> }]} />
      <h3>Tasks</h3>
      {can('employees.manage') && (
        <div className="row" style={{ alignItems: 'end' }}>
          <Field label="Task"><input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
          <Field label="Assign to"><select value={task.assignedTo} onChange={(e) => setTask({ ...task, assignedTo: e.target.value })}><option value="">Choose</option>{(staff.data?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</select></Field>
          <Field label="Due"><input type="date" value={task.dueAt} onChange={(e) => setTask({ ...task, dueAt: e.target.value })} /></Field>
          <button className="btn" disabled={!task.title || !task.assignedTo} onClick={addTask}>Assign task</button>
        </div>
      )}
      <DataTable rows={tasks.data} columns={[{ title: 'Task', key: 'title' }, { title: 'Assigned to', render: (t) => t.assignedTo?.name }, { title: 'Store', render: (t) => t.store?.code }, { title: 'Due', render: (t) => date(t.dueAt) }, { title: 'Status', render: (t) => <Status value={t.status} /> }]} />
    </div>
  );
}

export default function Employees() {
  const { can } = useAuth();
  const { storeId } = useAdminStore();
  const [tab, setTab] = useState(can('employees.view') ? 'team' : 'me');
  return (
    <>
      <PageHead title="Attendance, leave & tasks" sub="Add employees from Users & roles" />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('employees.view') ? [{ value: 'team', label: 'Team' }] : []), { value: 'me', label: 'My day' }]} />
      {tab === 'team' ? <Team storeId={storeId} /> : <MyDay />}
    </>
  );
}

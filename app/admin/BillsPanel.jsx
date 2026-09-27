'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Notice } from './ui';
import Icon from './icons';
import { money, VEHICLES } from '@/lib/billing';

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

export default function BillsPanel({ sb }) {
  const [rows, setRows] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [month, setMonth] = useState(thisMonth());
  const [driver, setDriver] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);

  async function load() {
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
    const [inv, d] = await Promise.all([
      sb.from('web_invoices').select('*').gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }),
      sb.from('web_drivers').select('user_id,name'),
    ]);
    if (inv.error) { setMsg({ type: 'error', text: 'Could not load bills: ' + inv.error.message + ' (did you run setup-3-billing.sql?)' }); setRows([]); return; }
    setRows(inv.data); setDrivers(d.data || []);
  }
  useEffect(() => { setRows(null); load(); }, [month]);

  const shown = useMemo(() => (rows || []).filter((r) => {
    if (driver !== 'all' && r.driver_id !== driver) return false;
    if (status !== 'all' && r.status !== status) return false;
    const s = q.trim().toLowerCase();
    return !s || r.customer_name.toLowerCase().includes(s) || r.invoice_no.toLowerCase().includes(s) || (r.customer_phone || '').includes(s);
  }), [rows, driver, status, q]);

  const live = shown.filter((r) => r.status !== 'cancelled');
  const sum = (arr, f) => arr.reduce((a, r) => a + Number(f(r) || 0), 0);
  const billed = sum(live, (r) => r.total);
  const pending = sum(live.filter((r) => r.status === 'unpaid'), (r) => r.balance);
  const cashByDriver = {};
  for (const r of live) if (r.status === 'paid' && r.payment_mode === 'cash') cashByDriver[r.driver_name] = (cashByDriver[r.driver_name] || 0) + Number(r.balance) + Number(r.advance);

  async function markPaid(r, mode) {
    const { error } = await sb.rpc('web_mark_paid', { p_id: r.id, p_mode: mode });
    if (error) setMsg({ type: 'error', text: error.message }); else { setMsg({ type: 'success', text: `${r.invoice_no} marked as paid (${mode === 'upi' ? 'UPI' : 'cash'}).` }); load(); }
  }
  async function cancel(r) {
    if (!confirm(`Cancel bill ${r.invoice_no}? The number stays in the series but the customer link will stop working.`)) return;
    const { error } = await sb.from('web_invoices').update({ status: 'cancelled' }).eq('id', r.id);
    if (error) setMsg({ type: 'error', text: error.message }); else { setMsg({ type: 'success', text: `${r.invoice_no} cancelled.` }); load(); }
  }
  function exportCsv() {
    const head = ['Bill no', 'Date', 'Driver', 'Customer', 'Phone', 'Trip', 'Vehicle', 'Suggested fare', 'Charged fare', 'Extras', 'Discount', 'GST', 'Total', 'Advance', 'Balance', 'Status', 'Paid by'];
    const lines = shown.map((r) => [r.invoice_no, r.trip_date, r.driver_name, r.customer_name, r.customer_phone,
      r.trip_type === 'outstation' ? `${r.from_city || ''} - ${r.to_city || ''}${r.round_trip ? ' (RT)' : ''}` : r.trip_type, VEHICLES[r.vehicle],
      r.calculated_fare ?? '', r.base_fare, r.extras_total, r.discount, r.gst_amount, r.total, r.advance, r.balance, r.status, r.payment_mode || '']);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `sadakyatra-bills-${month}.csv`; a.click();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Bills</h1>
          <p className="text-gray-500 text-sm">All bills created by drivers. Red fares were charged lower than the suggested fare.</p>
        </div>
        <div className="flex gap-2">
          <a href="/driver" target="_blank" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-brand-borderGray bg-white hover:bg-gray-50"><Icon name="plus" size={16} />Create a bill</a>
          <Button variant="ghost" onClick={exportCsv} disabled={!shown.length}>Export Excel (CSV)</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Bills" value={live.length} />
        <Stat label="Total billed" value={money(billed)} />
        <Stat label="Pending payment" value={money(pending)} tone={pending > 0 ? 'amber' : ''} />
        <Stat label="Cash with drivers" value={money(Object.values(cashByDriver).reduce((a, b) => a + b, 0))}
          sub={Object.entries(cashByDriver).map(([n, v]) => `${n}: ${money(v)}`).join(' · ')} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} className="h-10 px-3 rounded-xl border border-brand-borderGray text-sm bg-white" />
        <select value={driver} onChange={(e) => setDriver(e.target.value)} className="h-10 px-3 rounded-xl border border-brand-borderGray text-sm bg-white">
          <option value="all">All drivers</option>
          {drivers.map((d) => <option key={d.user_id} value={d.user_id}>{d.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-xl border border-brand-borderGray text-sm bg-white">
          <option value="all">All statuses</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, phone or bill no..." className="h-10 px-3 rounded-xl border border-brand-borderGray text-sm bg-white flex-1 min-w-[200px]" />
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <Card className="overflow-x-auto">
        {!rows ? <p className="p-6 text-gray-500">Loading...</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-brand-borderGray">
                <th className="px-4 py-3">Bill</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3 text-right">Fare</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const low = r.calculated_fare != null && Number(r.base_fare) < Number(r.calculated_fare);
                return (
                  <tr key={r.id} className={`border-b border-brand-borderGray last:border-0 ${r.status === 'cancelled' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 whitespace-nowrap"><p className="font-bold">{r.invoice_no}</p><p className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p></td>
                    <td className="px-4 py-3"><p className="font-semibold">{r.customer_name}</p><p className="text-xs text-gray-500">{r.trip_type === 'outstation' && r.from_city ? `${r.from_city} → ${r.to_city}` : r.trip_type} · {VEHICLES[r.vehicle]}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.driver_name}</td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${low ? 'text-red-600 font-bold' : ''}`} title={r.calculated_fare != null ? `Suggested ${money(r.calculated_fare)}` : ''}>
                      {money(r.base_fare)}{low && <p className="text-[11px] font-semibold">suggested {money(r.calculated_fare)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{money(r.total)}{r.status === 'unpaid' && Number(r.advance) > 0 && <p className="text-[11px] text-gray-500 font-normal">due {money(r.balance)}</p>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.status === 'paid' ? 'bg-green-100 text-green-800' : r.status === 'unpaid' ? 'bg-amber-100 text-amber-900' : 'bg-gray-200 text-gray-600'}`}>
                        {r.status === 'paid' ? `Paid${r.payment_mode ? ' · ' + (r.payment_mode === 'upi' ? 'UPI' : 'Cash') : ''}` : r.status === 'unpaid' ? 'Unpaid' : 'Cancelled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        {r.status !== 'cancelled' && <a href={`/bill/${r.public_token}`} target="_blank" className="h-8 px-2.5 rounded-lg border border-brand-borderGray text-xs font-semibold inline-flex items-center hover:bg-gray-50">View</a>}
                        {r.status === 'unpaid' && <>
                          <button onClick={() => markPaid(r, 'cash')} className="h-8 px-2.5 rounded-lg border border-brand-borderGray text-xs font-semibold hover:bg-gray-50">Cash</button>
                          <button onClick={() => markPaid(r, 'upi')} className="h-8 px-2.5 rounded-lg border border-brand-borderGray text-xs font-semibold hover:bg-gray-50">UPI</button>
                        </>}
                        {r.status !== 'cancelled' && <button onClick={() => cancel(r)} className="h-8 px-2.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50">Cancel</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No bills for this month.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <Card className={`p-4 ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : ''}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-extrabold">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1 truncate" title={sub}>{sub}</p>}
    </Card>
  );
}

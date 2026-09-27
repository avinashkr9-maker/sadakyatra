'use client';
import { useEffect, useState } from 'react';
import { Card, Button, Notice } from './ui';
import Icon from './icons';
import { cleanPhone } from '@/lib/billing';

async function api(sb, method, body) {
  const { data } = await sb.auth.getSession();
  const res = await fetch('/api/admin/drivers', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));
const inputCls = 'w-full h-11 px-3 rounded-xl border border-brand-borderGray text-sm focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30';

export default function DriversPanel({ sb }) {
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [msg, setMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [shareInfo, setShareInfo] = useState(null);
  const [busy, setBusy] = useState('');

  async function load() {
    const [d, inv] = await Promise.all([
      sb.from('web_drivers').select('user_id,name,phone,active,created_at').order('created_at'),
      sb.from('web_invoices').select('driver_id,total,status'),
    ]);
    if (d.error) { setMsg({ type: 'error', text: 'Could not load drivers: ' + d.error.message + ' (did you run setup-3-billing.sql?)' }); setRows([]); return; }
    setRows(d.data);
    const c = {};
    for (const r of inv.data || []) if (r.status !== 'cancelled') { c[r.driver_id] = c[r.driver_id] || { n: 0, sum: 0 }; c[r.driver_id].n++; c[r.driver_id].sum += Number(r.total); }
    setCounts(c);
  }
  useEffect(() => { load(); }, []);

  async function act(d, action, extra = {}) {
    setBusy(d.user_id + action); setMsg(null);
    try {
      await api(sb, 'PATCH', { user_id: d.user_id, action, ...extra });
      if (action === 'reset_pin') setShareInfo({ name: d.name, phone: d.phone, pin: extra.pin, reset: true });
      setMsg({ type: 'success', text: action === 'deactivate' ? `${d.name} can no longer log in.` : action === 'activate' ? `${d.name} can log in again.` : action === 'reset_pin' ? `New PIN set for ${d.name}.` : 'Saved.' });
      load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy('');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Drivers</h1>
          <p className="text-gray-500 text-sm">Drivers log in at <b>/driver</b> with their phone number and PIN to create bills.</p>
        </div>
        <Button variant="yellow" onClick={() => { setShowAdd(!showAdd); setShareInfo(null); }}><Icon name="plus" size={16} strokeWidth={3} />Add driver</Button>
      </div>

      {showAdd && <AddDriver sb={sb} onDone={(info) => { setShowAdd(false); setShareInfo(info); load(); }} />}
      {shareInfo && <ShareCard info={shareInfo} onClose={() => setShareInfo(null)} />}
      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {!rows ? <p className="text-gray-500">Loading...</p> : !rows.length ? (
        <Card className="p-8 text-center text-gray-500 text-sm">No drivers yet. Click <b>Add driver</b> to create the first account.</Card>
      ) : (
        <Card className="divide-y divide-brand-borderGray">
          {rows.map((d) => (
            <div key={d.user_id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${d.active ? '' : 'opacity-60'}`}>
              <div className="min-w-0">
                <p className="font-bold flex items-center gap-2">{d.name}
                  {!d.active && <span className="text-[10px] font-bold bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">DEACTIVATED</span>}</p>
                <p className="text-xs text-gray-500">+91 {d.phone} · {counts[d.user_id]?.n || 0} bills · ₹{Math.round(counts[d.user_id]?.sum || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" disabled={!!busy} onClick={() => { const pin = randomPin(); if (confirm(`Set a new PIN for ${d.name}? The old PIN will stop working.`)) act(d, 'reset_pin', { pin }); }}>Reset PIN</Button>
                {d.active
                  ? <Button variant="danger" disabled={!!busy} onClick={() => confirm(`Deactivate ${d.name}? They will not be able to log in. Their old bills stay safe.`) && act(d, 'deactivate')}>Deactivate</Button>
                  : <Button variant="ghost" disabled={!!busy} onClick={() => act(d, 'activate')}>Activate</Button>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AddDriver({ sb, onDone }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState(randomPin());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(sb, 'POST', { name, phone, pin });
      onDone({ name: name.trim(), phone: cleanPhone(phone), pin });
    } catch (x) { setError(x.message); }
    setBusy(false);
  }

  return (
    <Card className="p-5">
      <h2 className="font-extrabold mb-4">New driver account</h2>
      <form onSubmit={submit} className="grid sm:grid-cols-3 gap-3 items-end">
        <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Driver name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" className={inputCls} required /></label>
        <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Phone number (login)</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" className={inputCls} required /></label>
        <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">PIN (min 6 digits)</span>
          <span className="flex gap-2">
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={inputCls + ' font-mono tracking-widest'} required />
            <button type="button" onClick={() => setPin(randomPin())} title="Generate new PIN" className="h-11 px-3 rounded-xl border border-brand-borderGray text-xs font-semibold shrink-0 hover:bg-gray-50">New</button>
          </span></label>
        <div className="sm:col-span-3 flex items-center gap-3">
          <Button type="submit" variant="yellow" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

function ShareCard({ info, onClose }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const text = `Namaste ${info.name},\nYour SadakYatra driver account${info.reset ? ' PIN has been reset' : ' is ready'}.\n\nLogin: ${origin}/driver\nPhone: ${info.phone}\nPIN: ${info.pin}\n\nPlease keep your PIN private.`;
  return (
    <div className="rounded-2xl border-2 border-green-300 bg-green-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-extrabold text-green-900 mb-1">{info.reset ? 'New PIN created' : 'Driver account created'} ✓</p>
          <p className="text-sm text-green-900">Share these login details with <b>{info.name}</b>. The PIN is shown only once.</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-green-100 flex items-center justify-center text-green-900"><Icon name="x" size={16} /></button>
      </div>
      <div className="grid sm:grid-cols-3 gap-2 my-4 text-sm">
        <div className="bg-white rounded-xl px-3 py-2"><p className="text-[11px] text-gray-500">Login page</p><p className="font-semibold break-all">{origin}/driver</p></div>
        <div className="bg-white rounded-xl px-3 py-2"><p className="text-[11px] text-gray-500">Phone</p><p className="font-semibold">{info.phone}</p></div>
        <div className="bg-white rounded-xl px-3 py-2"><p className="text-[11px] text-gray-500">PIN</p><p className="font-mono font-bold tracking-widest text-lg">{info.pin}</p></div>
      </div>
      <a href={`https://wa.me/91${info.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener"
        className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#25D366] text-white font-bold text-sm"><Icon name="whatsapp" size={18} /> Send to driver on WhatsApp</a>
    </div>
  );
}

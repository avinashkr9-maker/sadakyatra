'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseBrowser';
import { driverEmail, cleanPhone, money, previewFare, VEHICLES } from '@/lib/billing';
import Icon from '../admin/icons';

// ---------------------------------------------------------------------------
// Driver app — phone pe chalne ke liye: login → naya bill → WhatsApp pe bhejo
// ---------------------------------------------------------------------------
export default function DriverApp() {
  const sb = getSupabase();
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null); // { name, isAdmin } | false
  const [view, setView] = useState({ name: 'home' });

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession((prev) => (prev?.user?.id === s?.user?.id && prev && s ? prev : s)));
    return () => sub.subscription.unsubscribe();
  }, [sb]);

  const userId = session?.user?.id || null;
  useEffect(() => {
    if (!sb || !userId) { setMe(null); return; }
    let alive = true;
    Promise.all([
      sb.from('web_drivers').select('name,active').eq('user_id', userId).maybeSingle(),
      sb.from('web_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    ]).then(([d, a]) => {
      if (!alive) return;
      if (d.data?.active) setMe({ name: d.data.name, isAdmin: false });
      else if (a.data) setMe({ name: 'Owner', isAdmin: true });
      else setMe(false);
    });
    return () => { alive = false; };
  }, [sb, userId]);

  if (!sb) return <Screen><Card><h1 className="text-xl font-extrabold mb-2">Not connected</h1><p className="text-sm text-gray-600">Supabase settings are missing. Ask the owner to set up the website.</p></Card></Screen>;
  if (session === undefined || (session && me === null)) return <Screen><p className="text-gray-500">Loading...</p></Screen>;
  if (!session) return <Login sb={sb} />;
  if (me === false) {
    return (
      <Screen>
        <Card>
          <h1 className="text-xl font-extrabold mb-2">Account not active</h1>
          <p className="text-sm text-gray-600 mb-6">This login is not an active driver account. Please contact the owner.</p>
          <button onClick={() => sb.auth.signOut()} className="w-full h-12 rounded-xl border border-brand-borderGray font-bold">Log out</button>
        </Card>
      </Screen>
    );
  }

  return (
    <div className="min-h-screen bg-[#EEF0F3]">
      <header className="bg-brand-black text-white sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => setView({ name: 'home' })} className="flex items-center gap-2">
            <img src="/logo-light.svg" alt="SadakYatra" className="h-7 w-auto" />
          </button>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-300 truncate max-w-[120px]">{me.name}</span>
            <button onClick={() => sb.auth.signOut()} className="text-gray-400 hover:text-white" title="Log out"><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-5">
        {view.name === 'home' && <Home sb={sb} me={me} onNew={() => setView({ name: 'new' })} onOpen={(inv) => setView({ name: 'bill', inv })} />}
        {view.name === 'new' && <NewBill sb={sb} onCancel={() => setView({ name: 'home' })} onCreated={(inv) => setView({ name: 'bill', inv, fresh: true })} />}
        {view.name === 'bill' && <BillView sb={sb} inv={view.inv} fresh={view.fresh} onBack={() => setView({ name: 'home' })} onNew={() => setView({ name: 'new' })}
          onUpdate={(inv) => setView({ name: 'bill', inv })} />}
      </main>
    </div>
  );
}

function Screen({ children }) {
  return <div className="min-h-screen bg-[#EEF0F3] flex items-center justify-center px-4">{children}</div>;
}
function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-2xl border border-brand-borderGray shadow-sm p-6 w-full max-w-sm ${className}`}>{children}</div>;
}
const inputCls = 'w-full h-12 px-4 rounded-xl border border-brand-borderGray bg-white text-[15px] focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30';

function Login({ sb }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const p = cleanPhone(phone);
    if (p.length !== 10) { setError('Enter your 10-digit phone number.'); return; }
    setBusy(true); setError('');
    const { error } = await sb.auth.signInWithPassword({ email: driverEmail(p), password: pin.trim() });
    if (error) setError(/invalid|credentials/i.test(error.message) ? 'Incorrect phone number or PIN.' : /banned/i.test(error.message) ? 'This account has been deactivated. Contact the owner.' : error.message);
    setBusy(false);
  }

  return (
    <Screen>
      <div className="w-full max-w-sm">
        <img src="/logo2026may25.svg" alt="SadakYatra" className="h-11 w-auto mx-auto mb-8" />
        <Card className="!max-w-none">
          <h1 className="text-2xl font-extrabold mb-1">Driver login</h1>
          <p className="text-sm text-gray-500 mb-6">Use the phone number and PIN given by the owner.</p>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">Phone number</span>
              <input type="tel" inputMode="numeric" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" className={inputCls} required />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">PIN</span>
              <span className="relative block">
                <input type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" className={inputCls + ' pr-12'} required />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide PIN' : 'Show PIN'} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100">
                  <Icon name={show ? 'eyeOff' : 'eye'} />
                </button>
              </span>
            </label>
            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
            <button disabled={busy} className="w-full h-12 rounded-xl bg-brand-black text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <><Icon name="spinner" /> Signing in...</> : 'Sign in'}
            </button>
          </form>
        </Card>
      </div>
    </Screen>
  );
}

function StatusChip({ inv }) {
  const map = { paid: 'bg-green-100 text-green-800', unpaid: 'bg-amber-100 text-amber-900', cancelled: 'bg-gray-200 text-gray-600' };
  const label = { paid: 'Paid', unpaid: 'Unpaid', cancelled: 'Cancelled' };
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${map[inv.status]}`}>{label[inv.status]}</span>;
}

function Home({ sb, me, onNew, onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    sb.from('web_invoices').select('*').order('created_at', { ascending: false }).limit(40).then(({ data }) => setRows(data || []));
  }, []);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todays = (rows || []).filter((r) => r.created_at && new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today && r.status !== 'cancelled');
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-gray-500">Namaste,</p>
        <h1 className="text-2xl font-extrabold">{me.name}</h1>
      </div>
      <button onClick={onNew} className="w-full h-16 rounded-2xl bg-brand-yellow text-brand-black font-extrabold text-lg flex items-center justify-center gap-2 shadow-sm active:scale-[.99]">
        <Icon name="plus" size={22} strokeWidth={3} /> New bill
      </button>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-brand-borderGray p-4"><p className="text-xs text-gray-500">Today&apos;s bills</p><p className="text-xl font-extrabold">{todays.length}</p></div>
        <div className="bg-white rounded-2xl border border-brand-borderGray p-4"><p className="text-xs text-gray-500">Today&apos;s total</p><p className="text-xl font-extrabold">{money(todays.reduce((a, r) => a + Number(r.total), 0))}</p></div>
      </div>
      <div>
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Recent bills</h2>
        {!rows ? <p className="text-gray-500 text-sm">Loading...</p> : !rows.length ? (
          <p className="text-sm text-gray-500 bg-white rounded-2xl border border-brand-borderGray p-5 text-center">No bills yet. Tap &quot;New bill&quot; to create your first one.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => onOpen(r)} className="w-full text-left bg-white rounded-2xl border border-brand-borderGray px-4 py-3 flex items-center justify-between gap-3 active:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{r.customer_name}</span>
                    <span className="block text-xs text-gray-500">{r.invoice_no} · {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block font-extrabold">{money(r.total)}</span>
                    <StatusChip inv={r} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const EXTRA_PRESETS = ['Toll', 'Parking', 'Waiting charge', 'Night charge', 'Decoration', 'Driver allowance'];

function NewBill({ sb, onCancel, onCreated }) {
  const [routes, setRoutes] = useState([]);
  const [rates, setRates] = useState({});
  const [gst, setGst] = useState({ on: false, rate: 0 });
  const [f, setF] = useState({ customer_name: '', customer_phone: '', trip_type: 'outstation', from_city: 'Muzaffarpur', to_city: '', round_trip: false, vehicle: 'sedan', trip_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), base_fare: '', discount: '', advance: '', notes: '' });
  const [fareTouched, setFareTouched] = useState(false);
  const [extras, setExtras] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    Promise.all([
      sb.from('web_fare_routes').select('from_city,to_city,distance_km').eq('active', true).order('to_city'),
      sb.from('web_fare_rates').select('key,value'),
      sb.from('web_settings').select('key,value'),
    ]).then(([r, ra, s]) => {
      setRoutes(r.data || []);
      setRates(Object.fromEntries((ra.data || []).map((x) => [x.key, Number(x.value)])));
      const st = Object.fromEntries((s.data || []).map((x) => [x.key, x.value]));
      setGst({ on: !!(st.gstin || '').trim(), rate: Number(st.gst_rate || 0) });
    });
  }, []);

  const fromCities = useMemo(() => [...new Set(routes.map((r) => r.from_city))].sort(), [routes]);
  const toCities = useMemo(() => routes.filter((r) => r.from_city === f.from_city).map((r) => r.to_city), [routes, f.from_city]);
  const route = routes.find((r) => r.from_city === f.from_city && r.to_city === f.to_city);
  const calc = previewFare({ tripType: f.trip_type, vehicle: f.vehicle, km: route?.distance_km, roundTrip: f.round_trip }, rates);

  useEffect(() => { if (!fareTouched) set('base_fare', calc != null ? String(calc) : ''); }, [calc, fareTouched]);

  const base = Number(f.base_fare || 0);
  const extrasTotal = extras.reduce((a, e) => a + Number(e.amount || 0), 0);
  const sub = Math.max(base + extrasTotal - Number(f.discount || 0), 0);
  const gstAmt = gst.on ? Math.round(sub * gst.rate) / 100 : 0;
  const total = Math.round(sub + gstAmt);
  const advance = Math.min(Number(f.advance || 0), total);
  const lowered = calc != null && base > 0 && base < calc;

  async function submit(e) {
    e.preventDefault();
    if (!f.customer_name.trim()) { setError('Enter the customer name.'); return; }
    if (f.trip_type === 'outstation' && !f.to_city) { setError('Choose where the trip went.'); return; }
    if (!(base > 0)) { setError('Enter the fare.'); return; }
    setBusy(true); setError('');
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const { data, error } = await sb.rpc('web_create_invoice', {
      p: {
        ...f,
        customer_phone: cleanPhone(f.customer_phone),
        base_fare: base,
        discount: num(f.discount),
        advance: num(f.advance),
        extras: extras.filter((x) => num(x.amount) > 0).map((x) => ({ label: x.label, amount: num(x.amount) })),
      },
    });
    setBusy(false);
    if (error) { setError(/syntax|numeric|invalid input/i.test(error.message) ? 'Please check the amounts you entered and try again.' : error.message); return; }
    onCreated(Array.isArray(data) ? data[0] : data);
  }

  const Seg = ({ value, options, onChange }) => (
    <div className="grid gap-1 bg-gray-100 rounded-xl p-1" style={{ gridTemplateColumns: `repeat(${Object.keys(options).length}, minmax(0,1fr))` }}>
      {Object.entries(options).map(([k, label]) => (
        <button type="button" key={k} onClick={() => onChange(k)} className={`h-11 rounded-lg text-sm font-bold ${value === k ? 'bg-white shadow-sm text-brand-black' : 'text-gray-500'}`}>{label}</button>
      ))}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5 pb-28">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} className="w-10 h-10 rounded-xl bg-white border border-brand-borderGray flex items-center justify-center"><Icon name="back" /></button>
        <h1 className="text-xl font-extrabold">New bill</h1>
      </div>

      <Section title="Customer">
        <input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} placeholder="Customer name *" className={inputCls} />
        <input type="tel" inputMode="numeric" value={f.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} placeholder="WhatsApp number (to send the bill)" className={inputCls} />
      </Section>

      <Section title="Trip">
        <Seg value={f.trip_type} onChange={(v) => { set('trip_type', v); setFareTouched(false); }} options={{ outstation: 'Route', local: 'Local', custom: 'Custom' }} />
        {f.trip_type === 'outstation' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <select value={f.from_city} onChange={(e) => { set('from_city', e.target.value); set('to_city', ''); setFareTouched(false); }} className={inputCls}>
                {fromCities.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={f.to_city} onChange={(e) => { set('to_city', e.target.value); setFareTouched(false); }} className={inputCls}>
                <option value="">To…</option>
                {toCities.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <label className="flex items-center justify-between bg-white rounded-xl border border-brand-borderGray px-4 h-12">
              <span className="text-sm font-semibold">Round trip</span>
              <input type="checkbox" checked={f.round_trip} onChange={(e) => { set('round_trip', e.target.checked); setFareTouched(false); }} className="w-5 h-5 accent-brand-black" />
            </label>
          </>
        )}
        <Seg value={f.vehicle} onChange={(v) => { set('vehicle', v); setFareTouched(false); }} options={{ sedan: 'Sedan', suv: 'SUV', tempo: 'Tempo' }} />
        <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Trip date</span>
          <input type="date" value={f.trip_date} onChange={(e) => set('trip_date', e.target.value)} className={inputCls} /></label>
      </Section>

      <Section title="Amount">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-600 mb-1">Fare (₹){calc != null && <span className="text-gray-400 font-normal"> · suggested {money(calc)}{route ? ` for ${route.distance_km} km` : ''}</span>}</span>
          <input type="number" inputMode="numeric" min="0" value={f.base_fare} onChange={(e) => { set('base_fare', e.target.value); setFareTouched(true); }} className={inputCls + ' text-lg font-bold'} />
        </label>
        {lowered && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Fare is lower than the suggested {money(calc)}. The owner will see this difference.</p>}

        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Extra charges</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {EXTRA_PRESETS.filter((p) => !extras.some((e) => e.label === p)).map((p) => (
              <button type="button" key={p} onClick={() => setExtras([...extras, { label: p, amount: '' }])} className="h-9 px-3 rounded-full border border-brand-borderGray bg-white text-sm font-semibold">+ {p}</button>
            ))}
          </div>
          {extras.map((x, i) => (
            <div key={x.label} className="flex items-center gap-2 mb-2">
              <span className="flex-1 text-sm font-semibold">{x.label}</span>
              <input type="number" inputMode="numeric" min="0" autoFocus value={x.amount} placeholder="₹"
                onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className={inputCls + ' !w-32'} />
              <button type="button" onClick={() => setExtras(extras.filter((_, j) => j !== i))} className="w-10 h-10 rounded-xl text-gray-400 flex items-center justify-center"><Icon name="x" /></button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Discount (₹)</span>
            <input type="number" inputMode="numeric" min="0" value={f.discount} onChange={(e) => set('discount', e.target.value)} className={inputCls} /></label>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Advance received (₹)</span>
            <input type="number" inputMode="numeric" min="0" value={f.advance} onChange={(e) => set('advance', e.target.value)} className={inputCls} /></label>
        </div>
      </Section>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-brand-borderGray">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">{gst.on ? `Total incl. ${gst.rate}% GST` : 'Total'}{advance > 0 ? ` · Balance ${money(total - advance)}` : ''}</p>
            <p className="text-2xl font-extrabold">{money(total)}</p>
          </div>
          <button disabled={busy} className="h-12 px-6 rounded-xl bg-brand-black text-white font-bold flex items-center gap-2 disabled:opacity-60">
            {busy ? <><Icon name="spinner" size={16} />Creating...</> : 'Create bill'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function BillView({ sb, inv, fresh, onBack, onNew, onUpdate }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/bill/${inv.public_token}` : '';
  const msg = `Namaste ${inv.customer_name} ji,\nSadakYatra bill ${inv.invoice_no}\nTotal: ${money(inv.total)}${Number(inv.balance) > 0 && inv.status !== 'paid' ? `\nBalance to pay: ${money(inv.balance)}` : ''}\n\nView bill & pay by UPI:\n${link}\n\nThank you for riding with SadakYatra!`;
  const wa = inv.customer_phone ? `https://wa.me/91${inv.customer_phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  async function markPaid(mode) {
    setBusy(mode); setError('');
    const { data, error } = await sb.rpc('web_mark_paid', { p_id: inv.id, p_mode: mode });
    setBusy('');
    if (error) setError(error.message); else onUpdate(Array.isArray(data) ? data[0] : data);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white border border-brand-borderGray flex items-center justify-center"><Icon name="back" /></button>
        <h1 className="text-xl font-extrabold">{fresh ? 'Bill created' : 'Bill'}</h1>
      </div>
      {fresh && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2"><Icon name="check" size={16} strokeWidth={3} /> Bill {inv.invoice_no} is ready. Send it to the customer.</p>}

      <div className="bg-white rounded-2xl border border-brand-borderGray p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div><p className="text-xs text-gray-500">{inv.invoice_no}</p><p className="text-lg font-extrabold">{inv.customer_name}</p>{inv.customer_phone && <p className="text-sm text-gray-500">+91 {inv.customer_phone}</p>}</div>
          <StatusChip inv={inv} />
        </div>
        <p className="text-sm text-gray-600 mb-3">{inv.trip_type === 'outstation' && inv.from_city ? `${inv.from_city} → ${inv.to_city}${inv.round_trip ? ' (Round trip)' : ''}` : inv.trip_type === 'local' ? 'Local trip' : 'Custom trip'} · {VEHICLES[inv.vehicle]}</p>
        <div className="flex items-end justify-between border-t border-gray-100 pt-3">
          <div><p className="text-xs text-gray-500">Total</p><p className="text-2xl font-extrabold">{money(inv.total)}</p></div>
          {inv.status !== 'paid' && Number(inv.balance) > 0 && <div className="text-right"><p className="text-xs text-gray-500">Balance</p><p className="text-lg font-extrabold text-amber-700">{money(inv.balance)}</p></div>}
        </div>
      </div>

      <a href={wa} target="_blank" rel="noopener" className="w-full h-14 rounded-2xl bg-[#25D366] text-white font-extrabold flex items-center justify-center gap-2">
        <Icon name="whatsapp" size={20} /> Send on WhatsApp
      </a>
      <div className="grid grid-cols-2 gap-2">
        <a href={link} target="_blank" rel="noopener" className="h-12 rounded-xl bg-white border border-brand-borderGray font-bold text-sm flex items-center justify-center gap-2"><Icon name="external" size={16} /> Open bill</a>
        <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="h-12 rounded-xl bg-white border border-brand-borderGray font-bold text-sm flex items-center justify-center gap-2">
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy link'}</button>
      </div>

      {inv.status === 'unpaid' && (
        <div className="bg-white rounded-2xl border border-brand-borderGray p-4">
          <p className="text-sm font-bold mb-3">Payment received?</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => markPaid('cash')} disabled={!!busy} className="h-12 rounded-xl border-2 border-brand-black font-bold text-sm disabled:opacity-50">{busy === 'cash' ? 'Saving...' : 'Cash received'}</button>
            <button onClick={() => markPaid('upi')} disabled={!!busy} className="h-12 rounded-xl border-2 border-brand-black font-bold text-sm disabled:opacity-50">{busy === 'upi' ? 'Saving...' : 'UPI received'}</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      <button onClick={onNew} className="w-full h-12 rounded-xl bg-brand-yellow font-bold flex items-center justify-center gap-2"><Icon name="plus" size={18} strokeWidth={3} /> New bill</button>
    </div>
  );
}

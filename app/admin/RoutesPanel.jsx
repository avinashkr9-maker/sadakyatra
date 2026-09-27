'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Input, Notice, rupees, fareFor } from './ui';

export default function RoutesPanel({ sb }) {
  const [routes, setRoutes] = useState([]);
  const [rates, setRates] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  async function load() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      sb.from('web_fare_routes').select('id,from_city,to_city,distance_km,active,verified').order('from_city').order('distance_km'),
      sb.from('web_fare_rates').select('key,value'),
    ]);
    if (r1.error) setMsg({ type: 'error', text: 'Could not load routes: ' + r1.error.message });
    else setRoutes(r1.data);
    if (!r2.error) setRates(Object.fromEntries(r2.data.map((r) => [r.key, Number(r.value)])));
    setEdits({});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return routes.filter((r) => {
      if (filter === 'unverified' && r.verified) return false;
      if (filter === 'inactive' && r.active) return false;
      return !s || r.from_city.toLowerCase().includes(s) || r.to_city.toLowerCase().includes(s);
    });
  }, [routes, q, filter]);

  const counts = {
    all: routes.length,
    unverified: routes.filter((r) => !r.verified).length,
    inactive: routes.filter((r) => !r.active).length,
  };

  async function update(id, patch, okText) {
    const before = routes.find((r) => r.id === id);
    setBusyId(id); setMsg(null);
    // Turant screen pe badlo, agar save fail hua to wapas kar do
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await sb.from('web_fare_routes').update(patch).eq('id', id);
    setBusyId(null);
    if (error) {
      setRoutes((rs) => rs.map((r) => (r.id === id ? before : r)));
      setMsg({ type: 'error', text: 'Could not save: ' + error.message });
      return false;
    }
    if (okText) setMsg({ type: 'success', text: okText });
    return true;
  }

  async function saveKm(r) {
    const km = parseInt(edits[r.id], 10);
    if (!km || km <= 0) { setMsg({ type: 'error', text: 'Distance must be a valid number.' }); return; }
    if (await update(r.id, { distance_km: km }, `${r.from_city} → ${r.to_city}: ${km} km saved.`)) {
      setEdits(({ [r.id]: _, ...rest }) => rest);
    }
  }

  async function remove(r) {
    if (!confirm(`Delete the "${r.from_city} → ${r.to_city}" route? (To only hide it, turn "Active" off.)`)) return;
    setBusyId(r.id);
    const { error } = await sb.from('web_fare_routes').delete().eq('id', r.id);
    setBusyId(null);
    if (error) setMsg({ type: 'error', text: 'Could not delete: ' + error.message });
    else { setRoutes((rs) => rs.filter((x) => x.id !== r.id)); setMsg({ type: 'success', text: 'Route deleted.' }); }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Routes</h1>
          <p className="text-gray-500 text-sm">The website calculator only shows <b>Active</b> routes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setShowBulk(!showBulk); setShowAdd(false); }}><i className="ri-upload-2-line" />Bulk add</Button>
          <Button variant="yellow" onClick={() => { setShowAdd(!showAdd); setShowBulk(false); }}><i className="ri-add-line" />New route</Button>
        </div>
      </div>

      {counts.unverified > 0 && (
        <Notice type="warn">
          <b>{counts.unverified} routes have unverified distances.</b> Check them on Google Maps, enter the correct km and tick "Verified".
        </Notice>
      )}

      {showAdd && <AddRoute sb={sb} onDone={(text) => { setShowAdd(false); setMsg({ type: 'success', text }); load(); }} />}
      {showBulk && <BulkAdd sb={sb} onDone={(text) => { setShowBulk(false); setMsg({ type: 'success', text }); load(); }} />}
      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search city..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        {[
          ['all', 'All'],
          ['unverified', 'Unverified'],
          ['inactive', 'Inactive'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-3 py-2 rounded-full text-xs font-bold border ${filter === id ? 'bg-brand-black text-white border-brand-black' : 'bg-white border-brand-borderGray text-gray-600'}`}>
            {label} ({counts[id]})
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-brand-borderGray">
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Distance (km)</th>
              <th className="px-4 py-3">Sedan fare</th>
              <th className="px-4 py-3 text-center">Verified</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const editing = edits[r.id] !== undefined && String(edits[r.id]) !== String(r.distance_km);
              const km = parseInt(edits[r.id] ?? r.distance_km, 10) || 0;
              return (
                <tr key={r.id} className={`border-b border-brand-borderGray last:border-0 ${!r.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">{r.from_city} → {r.to_city}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Input type="number" min="1" inputMode="numeric" value={edits[r.id] ?? r.distance_km}
                        onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })}
                        className={`w-24 ${editing ? 'border-brand-yellow bg-yellow-50' : ''}`} />
                      {editing && <Button className="!px-3 !py-2" onClick={() => saveKm(r)} disabled={busyId === r.id}>Save</Button>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{rupees(fareFor(km, rates).sedan)}</td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" className="w-5 h-5 accent-green-600" checked={r.verified}
                      onChange={(e) => update(r.id, { verified: e.target.checked })} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" className="w-5 h-5 accent-yellow-500" checked={r.active}
                      onChange={(e) => update(r.id, { active: e.target.checked }, e.target.checked ? 'Route is now shown on the website.' : 'Route hidden from the website.')} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(r)} className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete"><i className="ri-delete-bin-line text-lg" />
                      <span className="sr-only">Delete</span></button>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No routes found.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AddRoute({ sb, onDone }) {
  const [from, setFrom] = useState('Muzaffarpur');
  const [to, setTo] = useState('');
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const d = parseInt(km, 10);
    if (!from.trim() || !to.trim() || !d || d <= 0) { setError('Enter both cities and a valid distance.'); return; }
    setBusy(true); setError('');
    const { error } = await sb.from('web_fare_routes').insert({ from_city: from.trim(), to_city: to.trim(), distance_km: d, verified: true });
    setBusy(false);
    if (error) setError(error.code === '23505' ? 'This route already exists. Search for it in the table to edit it.' : error.message);
    else onDone(`${from.trim()} → ${to.trim()} added.`);
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid sm:grid-cols-4 gap-3 items-end">
        <label className="text-xs font-bold text-gray-500">From<Input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" /></label>
        <label className="text-xs font-bold text-gray-500">To<Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Raxaul" className="mt-1" /></label>
        <label className="text-xs font-bold text-gray-500">Distance (km)<Input type="number" min="1" value={km} onChange={(e) => setKm(e.target.value)} className="mt-1" /></label>
        <Button type="submit" variant="yellow" disabled={busy}>{busy ? 'Adding...' : 'Add route'}</Button>
      </form>
      {error && <div className="mt-3"><Notice type="error">{error}</Notice></div>}
    </Card>
  );
}

function BulkAdd({ sb, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(',').map((x) => x.trim());
    const d = parseInt(parts[2], 10);
    return parts.length === 3 && parts[0] && parts[1] && d > 0 ? { from_city: parts[0], to_city: parts[1], distance_km: d } : null;
  });
  const good = parsed.filter(Boolean);
  const bad = parsed.length - good.length;

  async function submit() {
    setBusy(true); setError('');
    const { error } = await sb.from('web_fare_routes').upsert(good, { onConflict: 'from_city,to_city' });
    setBusy(false);
    if (error) setError(error.message);
    else onDone(`${good.length} routes added/updated.`);
  }

  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm text-gray-600">One route per line: <code>From, To, km</code>. You can also copy 3 columns from Excel/Sheets and paste them here. Existing routes will have their distance updated.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value.replace(/\t/g, ','))} rows={6}
        placeholder={'Muzaffarpur, Raxaul, 140\nMuzaffarpur, Bodh Gaya, 190'}
        className="w-full border border-brand-borderGray rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-brand-yellow" />
      <div className="flex items-center gap-3">
        <Button variant="yellow" onClick={submit} disabled={!good.length || busy}>{busy ? 'Saving...' : `Save ${good.length} routes`}</Button>
        {bad > 0 && <span className="text-xs text-red-600">{bad} line(s) have an invalid format and will be skipped.</span>}
      </div>
      {error && <Notice type="error">{error}</Notice>}
    </Card>
  );
}

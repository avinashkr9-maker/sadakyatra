'use client';
import { useEffect, useState } from 'react';
import { Card, Button, Input, Notice, rupees, fareFor } from './ui';

export default function RatesPanel({ sb }) {
  const [rows, setRows] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await sb.from('web_fare_rates').select('key,label,value,sort,updated_at').order('sort');
    if (error) setMsg({ type: 'error', text: 'Could not load rates: ' + error.message });
    else {
      setRows(data);
      setValues(Object.fromEntries(data.map((r) => [r.key, String(r.value)])));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const changed = rows.filter((r) => String(r.value) !== values[r.key]);
  const invalid = rows.some((r) => values[r.key] === '' || isNaN(Number(values[r.key])) || Number(values[r.key]) < 0);

  async function save() {
    setSaving(true); setMsg(null);
    for (const r of changed) {
      const { error } = await sb.from('web_fare_rates').update({ value: Number(values[r.key]) }).eq('key', r.key);
      if (error) { setMsg({ type: 'error', text: `Could not save "${r.label}": ${error.message}` }); setSaving(false); return; }
    }
    setMsg({ type: 'success', text: 'Saved! The new rates will appear on the website within a minute.' });
    setSaving(false);
    load();
  }

  const live = Object.fromEntries(rows.map((r) => [r.key, Number(values[r.key]) || 0]));
  const example = fareFor(75, live);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Fare Rates</h1>
        <p className="text-gray-500 text-sm">These rates are used by the fare calculator on the website.</p>
      </div>

      <Card className="divide-y divide-brand-borderGray">
        {rows.map((r) => (
          <label key={r.key} className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="font-semibold text-sm">{r.label}</span>
            <Input
              type="number" step="any" min="0" inputMode="decimal"
              value={values[r.key] ?? ''}
              onChange={(e) => setValues({ ...values, [r.key]: e.target.value })}
              className={`max-w-[140px] text-right font-bold ${String(r.value) !== values[r.key] ? 'border-brand-yellow bg-yellow-50' : ''}`}
            />
          </label>
        ))}
      </Card>

      <Card className="p-5">
        <p className="text-xs font-bold text-gray-500 mb-3">PREVIEW — Muzaffarpur → Patna (75 km) with these rates:</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-xs text-gray-500">Sedan one way</p><p className="text-lg font-extrabold">{rupees(example.sedan)}</p></div>
          <div><p className="text-xs text-gray-500">Sedan round trip</p><p className="text-lg font-extrabold">{rupees(example.roundTrip)}</p></div>
          <div><p className="text-xs text-gray-500">SUV one way</p><p className="text-lg font-extrabold">{rupees(example.suv)}</p></div>
        </div>
      </Card>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <div className="flex gap-3">
        <Button variant="yellow" onClick={save} disabled={!changed.length || invalid || saving}>
          {saving ? 'Saving...' : changed.length ? `Save (${changed.length} change${changed.length > 1 ? 's' : ''})` : 'No changes'}
        </Button>
        {changed.length > 0 && (
          <Button variant="ghost" onClick={() => setValues(Object.fromEntries(rows.map((r) => [r.key, String(r.value)])))}>Cancel</Button>
        )}
      </div>
    </div>
  );
}

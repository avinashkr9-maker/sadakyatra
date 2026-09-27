'use client';
import { useEffect, useState } from 'react';
import { Card, Button, Notice } from './ui';

const FIELDS = [
  { group: 'Business details (shown on every bill)', items: [
    ['business_name', 'Business name'], ['business_address', 'Address'], ['business_phone', 'Phone'], ['business_email', 'Email'],
  ] },
  { group: 'UPI payment', items: [
    ['upi_id', 'UPI ID', 'e.g. 9304057169@ybl — the QR code on bills pays to this ID'], ['upi_name', 'Name shown in UPI apps'],
  ] },
  { group: 'GST (leave GSTIN empty if not registered)', items: [
    ['gstin', 'GSTIN', 'Empty = simple bill without GST. Filled = tax invoice with CGST/SGST.'], ['gst_rate', 'GST rate (%)', 'Usually 5% for cab services — confirm with your CA.'], ['sac_code', 'SAC code', 'Confirm with your CA.'],
  ] },
  { group: 'Bill format', items: [
    ['invoice_prefix', 'Bill number prefix', 'Bills are numbered PREFIX-YEAR-0001, PREFIX-YEAR-0002…'], ['invoice_note', 'Thank-you note at the bottom'],
  ] },
];

export default function SettingsPanel({ sb }) {
  const [vals, setVals] = useState(null);
  const [orig, setOrig] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    const { data, error } = await sb.from('web_settings').select('key,value');
    if (error) { setMsg({ type: 'error', text: 'Could not load settings: ' + error.message + ' (did you run setup-3-billing.sql?)' }); setVals({}); return; }
    const o = Object.fromEntries(data.map((r) => [r.key, r.value]));
    setVals(o); setOrig(o);
  }
  useEffect(() => { load(); }, []);

  const changed = vals ? Object.keys(vals).filter((k) => vals[k] !== orig[k]) : [];
  async function save() {
    setSaving(true); setMsg(null);
    const { error } = await sb.from('web_settings').upsert(changed.map((k) => ({ key: k, value: vals[k] })));
    setSaving(false);
    if (error) setMsg({ type: 'error', text: 'Could not save: ' + error.message });
    else { setMsg({ type: 'success', text: 'Settings saved. New bills will use these details.' }); load(); }
  }

  if (!vals) return <p className="text-gray-500">Loading...</p>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Billing settings</h1>
        <p className="text-gray-500 text-sm">These details appear on every bill sent to customers.</p>
      </div>
      {!vals.upi_id && <Notice type="warn"><b>UPI ID is empty.</b> Bills will not show a payment QR code until you add it.</Notice>}
      {FIELDS.map((g) => (
        <Card key={g.group} className="p-5">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{g.group}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {g.items.map(([k, label, hint]) => (
              <label key={k} className="block">
                <span className="block text-sm font-semibold mb-1">{label}</span>
                <input value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  className={`w-full h-11 px-3 rounded-xl border text-sm focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30 ${vals[k] !== orig[k] ? 'border-brand-yellow bg-yellow-50' : 'border-brand-borderGray'}`} />
                {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
              </label>
            ))}
          </div>
        </Card>
      ))}
      {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      <Button variant="yellow" onClick={save} disabled={!changed.length || saving}>{saving ? 'Saving...' : changed.length ? `Save (${changed.length} change${changed.length > 1 ? 's' : ''})` : 'No changes'}</Button>
    </div>
  );
}

import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { sbRest } from '@/lib/supabaseServer';
import { sbConfigured } from '@/lib/supabaseConfig';
import { money, upiLink, VEHICLES } from '@/lib/billing';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bill | SadakYatra', robots: { index: false, follow: false } };

async function load(token) {
  if (!sbConfigured() || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const r = await sbRest('/rest/v1/rpc/web_public_invoice', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return null;
  return r.json();
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export default async function BillPage({ params }) {
  const { token } = await params;
  const data = await load(token);
  if (!data || !data.invoice) notFound();
  const inv = data.invoice;
  const s = data.settings || {};
  const gst = Number(inv.gst_amount) > 0;
  const due = Number(inv.balance);
  const upi = upiLink({ upiId: s.upi_id, upiName: s.upi_name, amount: due, note: `Bill ${inv.invoice_no}` });
  const qr = upi && inv.status !== 'paid' && due > 0 ? await QRCode.toString(upi, { type: 'svg', margin: 1, width: 220 }) : '';
  const trip = inv.trip_type === 'outstation' && inv.from_city
    ? `${inv.from_city} → ${inv.to_city}${inv.round_trip ? ' (Round trip)' : ' (One way)'}${inv.distance_km ? ` · ${inv.distance_km} km` : ''}`
    : inv.trip_type === 'local' ? 'Local trip (full day)' : 'Trip';
  const rows = [
    { label: `${trip} — ${VEHICLES[inv.vehicle] || inv.vehicle}`, amount: inv.base_fare },
    ...(inv.extras || []).map((e) => ({ label: e.label, amount: e.amount })),
  ];

  return (
    <div className="min-h-screen bg-[#EEF0F3] py-6 px-3 print:bg-white print:p-0">
      <style>{`@media print { .no-print{display:none!important} @page{margin:12mm} }`}</style>
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,.08)] overflow-hidden print:shadow-none print:rounded-none">
        <div className="bg-brand-black text-white px-6 sm:px-8 py-6 flex items-start justify-between gap-4">
          <div>
            <img src="/logo-light.svg" alt="SadakYatra" className="h-10 w-auto mb-3" />
            <p className="text-xs text-gray-400 max-w-xs leading-relaxed">{s.business_address}</p>
            <p className="text-xs text-gray-400">{s.business_phone}{s.business_email ? ` · ${s.business_email}` : ''}</p>
            {s.gstin && <p className="text-xs text-gray-400 mt-1">GSTIN: {s.gstin}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-brand-yellow text-xs font-bold tracking-wider">{gst ? 'TAX INVOICE' : 'BILL'}</p>
            <p className="text-lg font-extrabold">{inv.invoice_no}</p>
            <p className="text-xs text-gray-400">{fmtDate(inv.created_at)}</p>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-6 grid sm:grid-cols-2 gap-4 border-b border-brand-borderGray text-sm">
          <div>
            <p className="text-xs font-bold text-gray-500 mb-1">BILLED TO</p>
            <p className="font-bold">{inv.customer_name}</p>
            {inv.customer_phone && <p className="text-gray-600">+91 {inv.customer_phone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold text-gray-500 mb-1">TRIP DATE</p>
            <p className="font-semibold">{fmtDate(inv.trip_date)}</p>
            <p className="text-gray-600">Driver: {inv.driver_name}</p>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-5">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-brand-borderGray"><th className="text-left py-2 font-bold">DESCRIPTION</th><th className="text-right py-2 font-bold">AMOUNT</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100"><td className="py-3 pr-4">{r.label}</td><td className="py-3 text-right font-semibold whitespace-nowrap">{money(r.amount)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
            {Number(inv.discount) > 0 && <Line label="Discount" value={'− ' + money(inv.discount)} />}
            {gst && <>
              <Line label="Taxable amount" value={money(inv.subtotal)} />
              <Line label={`CGST ${Number(inv.gst_rate) / 2}%`} value={money(Number(inv.gst_amount) / 2)} />
              <Line label={`SGST ${Number(inv.gst_rate) / 2}%`} value={money(Number(inv.gst_amount) / 2)} />
              {s.sac_code && <p className="text-[11px] text-gray-400 text-right">SAC: {s.sac_code}</p>}
            </>}
            <div className="flex justify-between border-t border-brand-borderGray pt-2 text-base font-extrabold"><span>Total</span><span>{money(inv.total)}</span></div>
            {Number(inv.advance) > 0 && <Line label="Advance paid" value={'− ' + money(inv.advance)} />}
            <div className={`flex justify-between rounded-xl px-3 py-2 font-extrabold ${inv.status === 'paid' || due === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
              <span>{inv.status === 'paid' || due === 0 ? 'Paid' : 'Balance due'}</span><span>{inv.status === 'paid' ? money(0) : money(due)}</span>
            </div>
            {inv.status === 'paid' && inv.payment_mode && <p className="text-[11px] text-gray-500 text-right">Paid by {inv.payment_mode === 'upi' ? 'UPI' : 'cash'}</p>}
          </div>
        </div>

        {qr && (
          <div className="mx-6 sm:mx-8 mb-6 rounded-2xl border border-brand-borderGray p-5 flex flex-col sm:flex-row items-center gap-5">
            <div className="w-44 h-44 shrink-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="text-center sm:text-left">
              <p className="font-extrabold text-lg">Scan to pay {money(due)}</p>
              <p className="text-sm text-gray-600 mb-3">Any UPI app — GPay, PhonePe, Paytm, BHIM. Amount is filled in automatically.</p>
              <p className="text-xs text-gray-500 mb-3">UPI ID: <b>{s.upi_id}</b></p>
              <a href={upi} className="no-print inline-flex items-center justify-center h-11 px-5 rounded-xl bg-brand-yellow font-bold text-sm">Pay with UPI app</a>
            </div>
          </div>
        )}

        <div className="px-6 sm:px-8 pb-6 text-xs text-gray-500 flex flex-wrap items-center justify-between gap-3">
          <p>{s.invoice_note}</p>
          <PrintButton />
        </div>
      </div>
      <p className="no-print text-center text-xs text-gray-400 mt-4">This is a computer-generated bill.</p>
    </div>
  );
}

function Line({ label, value }) {
  return <div className="flex justify-between text-gray-600"><span>{label}</span><span className="font-semibold text-brand-black">{value}</span></div>;
}

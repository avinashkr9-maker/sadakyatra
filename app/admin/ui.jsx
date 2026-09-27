'use client';

export function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-2xl border border-brand-borderGray shadow-sm ${className}`}>{children}</div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-brand-black text-white hover:bg-brand-charcoal',
    yellow: 'bg-brand-yellow text-brand-black hover:brightness-95',
    ghost: 'bg-white border border-brand-borderGray text-brand-black hover:bg-gray-50',
    danger: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full border border-brand-borderGray rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-yellow focus:ring-2 focus:ring-brand-yellow/30 ${className}`}
      {...props}
    />
  );
}

export function Notice({ type = 'info', children }) {
  const styles = {
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    success: 'bg-green-50 text-green-800 border-green-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    warn: 'bg-yellow-50 text-yellow-900 border-yellow-200',
  };
  return <div className={`border rounded-xl px-4 py-3 text-sm ${styles[type]}`}>{children}</div>;
}

export function rupees(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// Website ke calculator jaisa hi hisaab (preview ke liye)
export function fareFor(km, rates) {
  const r10 = (n) => Math.round(n / 10) * 10;
  const min = rates.minimumFare || 0;
  return {
    sedan: Math.max(r10(km * (rates.sedanPerKm || 0)), min),
    roundTrip: Math.max(r10(km * (rates.sedanPerKm || 0) * (rates.roundTripMultiplier || 1)), min),
    suv: Math.max(r10(km * (rates.suvPerKm || 0)), min),
  };
}

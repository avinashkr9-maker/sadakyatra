'use client';
export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print h-10 px-4 rounded-xl border border-brand-borderGray font-semibold text-sm text-brand-black hover:bg-gray-50">
      Download PDF / Print
    </button>
  );
}

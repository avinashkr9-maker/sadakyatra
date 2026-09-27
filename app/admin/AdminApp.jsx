'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseBrowser';
import { Card, Button, Input, Notice } from './ui';
import Icon from './icons';
import RatesPanel from './RatesPanel';
import RoutesPanel from './RoutesPanel';
import PagesPanel from './PagesPanel';
import BillsPanel from './BillsPanel';
import DriversPanel from './DriversPanel';
import SettingsPanel from './SettingsPanel';

export default function AdminApp() {
  const sb = getSupabase();
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);
  const [tab, setTab] = useState('pages');

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession((prev) => (prev?.user?.id === s?.user?.id && prev && s ? prev : s)));
    return () => sub.subscription.unsubscribe();
  }, [sb]);

  // Sirf user badalne pe admin check karo — token refresh (har ghante / tab badalne pe) pe
  // dobara check karne se editor band ho jata tha aur unsaved kaam chala jata tha
  const userId = session?.user?.id || null;
  useEffect(() => {
    if (!sb || !userId) { setIsAdmin(null); return; }
    let alive = true;
    sb.from('web_admins').select('user_id').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => { if (alive) setIsAdmin(!error && !!data); });
    return () => { alive = false; };
  }, [sb, userId]);

  if (!sb) return <SetupNeeded />;
  if (session === undefined || (session && isAdmin === null)) return <Center><p className="text-gray-500">Loading...</p></Center>;
  if (!session) return <Login sb={sb} />;
  if (!isAdmin) {
    return (
      <Center>
        <Card className="p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-extrabold mb-2">No access</h1>
          <p className="text-gray-600 text-sm mb-6">
            <b>{session.user.email}</b> is not on the admin list. Add this email to the <code>web_admins</code> table in Supabase
            (step 6 of setup.sql).
          </p>
          <Button variant="ghost" onClick={() => sb.auth.signOut()}>Logout</Button>
        </Card>
      </Center>
    );
  }

  const tabs = [
    { id: 'pages', label: 'Pages', icon: 'ri-pages-line' },
    { id: 'rates', label: 'Fare Rates', icon: 'ri-money-rupee-circle-line' },
    { id: 'routes', label: 'Routes', icon: 'ri-route-line' },
    { id: 'bills', label: 'Bills', icon: 'ri-bill-line' },
    { id: 'drivers', label: 'Drivers', icon: 'ri-steering-2-line' },
    { id: 'settings', label: 'Settings', icon: 'ri-settings-3-line' },
  ];

  return (
    <div>
      <header className="bg-brand-black text-white">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo-light.svg" alt="SadakYatra" className="h-8 w-auto" />
            <span className="text-xs font-bold bg-brand-yellow text-brand-black px-2 py-0.5 rounded">ADMIN</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/" target="_blank" className="text-gray-300 hover:text-white hidden sm:inline">View website ↗</a>
            <button onClick={() => sb.auth.signOut()} className="text-gray-300 hover:text-white">Logout</button>
          </div>
        </div>
      </header>
      <nav className="bg-white border-b border-brand-borderGray">
        <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${tab === t.id ? 'border-brand-yellow text-brand-black' : 'border-transparent text-gray-500 hover:text-brand-black'}`}
            >
              <i className={`${t.icon} mr-1`} />{t.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="max-w-5xl mx-auto px-4 py-8">
        {{ pages: <PagesPanel sb={sb} />, rates: <RatesPanel sb={sb} />, routes: <RoutesPanel sb={sb} />, bills: <BillsPanel sb={sb} />, drivers: <DriversPanel sb={sb} />, settings: <SettingsPanel sb={sb} /> }[tab]}
      </main>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center px-4">{children}</div>;
}

function Login({ sb }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password. Please try again.' : error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="relative hidden lg:flex flex-col justify-between bg-brand-black text-white p-12 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(#FFCC00 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full bg-brand-yellow/10 blur-3xl" />
        <img src="/logo-light.svg" alt="SadakYatra" className="relative h-12 w-auto self-start" />
        <div className="relative">
          <p className="text-brand-yellow text-sm font-bold tracking-wide mb-4">WEBSITE CONTROL PANEL</p>
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight mb-5">Your website,<br />in your hands.</h1>
          <p className="text-gray-400 max-w-md leading-relaxed">Edit page text and photos, update fare rates and add new routes — no code needed. Changes go live the moment you save.</p>
        </div>
        <div className="relative flex gap-8 text-sm text-gray-400">
          <div><p className="text-2xl font-extrabold text-white">21</p>Pages</div>
          <div><p className="text-2xl font-extrabold text-white">1 click</p>Live update</div>
          <div><p className="text-2xl font-extrabold text-white">20</p>Versions saved</div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <img src="/logo2026may25.svg" alt="SadakYatra" className="h-11 w-auto mb-10 lg:hidden" />
          <h2 className="text-3xl font-extrabold tracking-tight mb-2">Welcome back 👋</h2>
          <p className="text-gray-500 mb-8">Sign in to the admin panel.</p>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">Email</span>
              <span className="relative block">
                <Icon name="mail" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="aap@gmail.com"
                  className="w-full h-12 pl-11 pr-4 rounded-xl border border-brand-borderGray bg-white text-[15px] focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30 transition" />
              </span>
            </label>
            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">Password</span>
              <span className="relative block">
                <Icon name="lock" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••"
                  className="w-full h-12 pl-11 pr-12 rounded-xl border border-brand-borderGray bg-white text-[15px] focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30 transition" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-brand-black">
                  <Icon name={show ? 'eyeOff' : 'eye'} />
                </button>
              </span>
            </label>
            {error && <Notice type="error">{error}</Notice>}
            <button type="submit" disabled={busy}
              className="w-full h-12 rounded-xl bg-brand-black text-white font-bold text-[15px] flex items-center justify-center gap-2 hover:bg-brand-charcoal disabled:opacity-60 transition">
              {busy ? <><Icon name="spinner" /> Signing in...</> : 'Sign in'}
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-8">Forgot your password? Set a new one in Supabase → Authentication → Users.</p>
        </div>
      </div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <Center>
      <Card className="p-8 max-w-lg w-full">
        <h1 className="text-xl font-extrabold mb-3">Admin panel is not connected yet</h1>
        <p className="text-gray-600 text-sm mb-4">
          Supabase settings were not found. Create a <code>.env.local</code> file in the project folder (see <code>.env.example</code>),
          add these two values, then restart <code>npm run dev</code>:
        </p>
        <pre className="bg-brand-gray rounded-xl p-4 text-xs overflow-x-auto">NEXT_PUBLIC_SUPABASE_URL=...{'\n'}NEXT_PUBLIC_SUPABASE_ANON_KEY=...</pre>
        <p className="text-gray-500 text-xs mt-4">On Vercel: add the same two values under Project → Settings → Environment Variables.</p>
      </Card>
    </Center>
  );
}

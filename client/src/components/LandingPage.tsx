import { ArrowRight, BarChart3, Check, ChevronRight, Mic2, PackageOpen, ShieldCheck, Sparkles, Store } from "lucide-react";

interface LandingPageProps {
  onSignUp: () => void;
  onLogin: () => void;
}

const highlights = [
  { icon: Sparkles, title: "A practical shop assistant", detail: "Log a sale, expense, restock or stock loss by chat or voice." },
  { icon: BarChart3, title: "Profit you can explain", detail: "See sales, purchases and inventory-based profit from your ledger." },
  { icon: PackageOpen, title: "Stock without guesswork", detail: "Know what's on hand and which products need a restock." },
];

export function LandingPage({ onSignUp, onLogin }: LandingPageProps) {
  return <div className="min-h-screen overflow-hidden bg-[#f5f7f4] text-ink">
    <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
      <a href="#home" className="flex items-center gap-3" aria-label="Dukaandaar home">
        <span className="grid h-10 w-10 place-items-center rounded-[15px] bg-primary text-white shadow-[0_8px_24px_rgba(22,114,74,.2)]"><Store size={20} strokeWidth={2.2} /></span>
        <span><span className="block font-display text-[17px] font-extrabold tracking-[-.04em]">Dukaandaar</span><span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[.2em] text-muted">Your shop, in sync</span></span>
      </a>
      <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
        <a href="#features" className="text-[12px] font-semibold text-ink-soft transition hover:text-primary">What you can do</a>
        <a href="#how-it-works" className="text-[12px] font-semibold text-ink-soft transition hover:text-primary">How it works</a>
      </nav>
      <div className="flex items-center gap-2 sm:gap-3">
        <button type="button" onClick={onLogin} className="rounded-xl px-3 py-2 text-[12px] font-bold text-ink-soft transition hover:bg-white hover:text-primary sm:px-4">Log in</button>
        <button type="button" onClick={onSignUp} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-[11px] font-bold text-white shadow-[0_7px_18px_rgba(22,114,74,.17)] transition hover:-translate-y-0.5 hover:bg-primary-dark sm:px-4 sm:text-xs">Create your shop <ArrowRight size={14} /></button>
      </div>
    </header>

    <main id="home">
      <section className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-16 pt-8 sm:px-8 sm:pb-20 lg:grid-cols-[.97fr_1.03fr] lg:gap-10 lg:px-10 lg:pb-24 lg:pt-14">
        <div className="pointer-events-none absolute -left-44 top-12 h-[440px] w-[440px] rounded-full bg-[#dff0e3]/70 blur-3xl" />
        <div className="relative z-[1] max-w-[580px]">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#dceadf] bg-white/80 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[.13em] text-primary shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Built for the everyday shop floor</div>
          <h1 className="font-display text-[42px] font-extrabold leading-[1.04] tracking-[-.055em] text-[#173c2d] sm:text-[56px] lg:text-[64px]">Your shop, in sync.<br /><span className="text-primary">Your mind,</span><br /><span className="text-primary">a little freer.</span></h1>
          <p className="mt-6 max-w-[500px] text-[15px] leading-7 text-[#627269] sm:text-[17px] sm:leading-8">Sales, stock and daily profit—together in one clear workspace. Keep the books moving with quick forms or a simple conversation.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={onSignUp} className="group inline-flex items-center gap-3 rounded-2xl bg-primary px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(22,114,74,.2)] transition hover:-translate-y-0.5 hover:bg-primary-dark">Start with your shop <ArrowRight size={16} className="transition group-hover:translate-x-0.5" /></button>
            <button type="button" onClick={onLogin} className="rounded-2xl border border-[#dfe7e0] bg-white/70 px-5 py-3.5 text-sm font-bold text-ink-soft transition hover:border-primary/25 hover:text-primary">I already have an account</button>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 text-[10px] font-semibold text-[#748279] sm:text-[11px]">
            <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-primary" />Private shop workspace</span>
            <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-primary" />No setup spreadsheet</span>
          </div>
        </div>

        <div className="relative z-[1] mx-auto w-full max-w-[560px] lg:ml-auto">
          <div className="absolute -right-8 -top-10 h-52 w-52 rounded-full bg-[#f8e7ca]/70 blur-3xl" />
          <div className="relative rounded-[28px] border border-white/90 bg-white p-3 shadow-[0_30px_90px_rgba(30,65,43,.14)] sm:p-4">
            <div className="flex items-center justify-between rounded-t-[20px] bg-[#f8faf7] px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-white"><Store size={15} /></span><div><p className="text-[11px] font-extrabold text-ink">Sample shop</p><p className="text-[9px] text-muted">Illustrative view · Today at a glance</p></div></div>
              <span className="flex items-center gap-1.5 rounded-full bg-[#e7f4e9] px-2.5 py-1.5 text-[9px] font-bold text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />All caught up</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-2.5 sm:gap-3 sm:p-3">
              <div className="rounded-[18px] border border-[#edf1ec] bg-white p-3.5 sm:p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.12em] text-muted">Sales today</span><span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#eaf6ed] text-primary"><BarChart3 size={14} /></span></div><p className="mt-2.5 font-display text-[22px] font-extrabold tracking-[-.04em] text-ink sm:text-[25px]">₹8,450</p><p className="mt-1 text-[9px] font-semibold text-primary">↑ 12% from yesterday</p></div>
              <div className="rounded-[18px] border border-[#edf1ec] bg-white p-3.5 sm:p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.12em] text-muted">Net profit</span><span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#fff4df] text-[#bd7b19]"><span className="text-[14px] font-extrabold">₹</span></span></div><p className="mt-2.5 font-display text-[22px] font-extrabold tracking-[-.04em] text-ink sm:text-[25px]">₹1,240</p><p className="mt-1 text-[9px] text-muted">After costs, expenses & losses</p></div>
            </div>
            <div className="mx-2.5 rounded-[19px] border border-[#edf1ec] bg-white p-3.5 sm:mx-3 sm:p-4">
              <div className="flex items-center justify-between"><div><p className="text-[11px] font-extrabold text-ink">A steady week</p><p className="mt-0.5 text-[9px] text-muted">Sales · purchases · profit</p></div><span className="rounded-lg bg-[#f6f8f5] px-2.5 py-1 text-[9px] font-semibold text-ink-soft">Last 7 days</span></div>
              <svg viewBox="0 0 500 132" className="mt-3 h-[108px] w-full" role="img" aria-label="Illustrative weekly sales chart">
                <defs><linearGradient id="landingFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8fcba3" stopOpacity=".3"/><stop offset="100%" stopColor="#8fcba3" stopOpacity="0"/></linearGradient></defs>
                <path d="M0 104 C34 94 45 88 72 92 S120 76 145 81 S190 52 219 64 S269 48 290 58 S330 34 362 44 S410 26 432 36 S475 15 500 20 V132 H0Z" fill="url(#landingFill)" />
                <path d="M0 104 C34 94 45 88 72 92 S120 76 145 81 S190 52 219 64 S269 48 290 58 S330 34 362 44 S410 26 432 36 S475 15 500 20" fill="none" stroke="#218353" strokeWidth="3" strokeLinecap="round" />
                <path d="M0 116 H500 M0 80 H500 M0 44 H500" stroke="#edf1ec" strokeWidth="1" strokeDasharray="4 6" />
                <circle cx="362" cy="44" r="5" fill="#fff" stroke="#218353" strokeWidth="3" />
              </svg>
              <div className="flex justify-between px-1 text-[8px] font-medium text-[#98a49c]"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 px-2.5 pb-2.5 sm:mt-3 sm:gap-3 sm:px-3 sm:pb-3">
              <div className="flex items-center gap-2.5 rounded-[15px] bg-[#f6f9f6] px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#e7f3e8] text-primary"><PackageOpen size={15} /></span><div><p className="text-[9px] font-extrabold text-ink">Stock in view</p><p className="text-[8px] text-muted">No surprise shortages</p></div></div>
              <div className="flex items-center gap-2.5 rounded-[15px] bg-[#f6f9f6] px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f0ebfb] text-[#7c65b1]"><Mic2 size={15} /></span><div><p className="text-[9px] font-extrabold text-ink">Just say the word</p><p className="text-[8px] text-muted">Talk or type a quick entry</p></div></div>
            </div>
            <div className="absolute -bottom-6 -left-5 hidden w-[255px] items-start gap-2.5 rounded-[18px] border border-white bg-white p-3 shadow-[0_16px_40px_rgba(23,60,45,.15)] sm:flex lg:-left-12">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary text-white"><Sparkles size={15} /></span><div><p className="text-[9px] font-bold text-ink">Shop assistant</p><p className="mt-1 text-[9px] leading-4 text-ink-soft">“Sold two milk pouches for ₹60.”</p><p className="mt-1.5 text-[8px] font-semibold text-primary">Read back · Confirm · Saved</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#e7ede7] bg-white/70 px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted">Small-shop clarity, without the busywork</p><div className="flex flex-wrap gap-x-7 gap-y-2 text-[10px] font-semibold text-ink-soft"><span className="flex items-center gap-2"><Check size={13} className="text-primary" />Inventory-based profit</span><span className="flex items-center gap-2"><Check size={13} className="text-primary" />One confirmed ledger</span><span className="flex items-center gap-2"><ShieldCheck size={13} className="text-primary" />Your own shop space</span></div></div>
      </section>

      <section id="features" className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
        <div className="max-w-[540px]"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-primary">The essentials, together</p><h2 className="mt-3 font-display text-[30px] font-extrabold leading-tight tracking-[-.045em] text-[#173c2d] sm:text-[40px]">Less juggling. More knowing.</h2><p className="mt-3 text-sm leading-6 text-muted">A clear view of the things that keep a neighbourhood shop running.</p></div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {highlights.map(({ icon: Icon, title, detail }, index) => <article key={title} className="rounded-[22px] border border-[#e5ece5] bg-white p-5 shadow-[0_5px_18px_rgba(24,52,35,.035)] transition hover:-translate-y-1 hover:shadow-[0_14px_35px_rgba(24,52,35,.08)] sm:p-6"><span className={`grid h-11 w-11 place-items-center rounded-[15px] ${index === 0 ? "bg-[#e8f5eb] text-primary" : index === 1 ? "bg-[#fff4df] text-[#bd7b19]" : "bg-[#edf6fb] text-[#467fa7]"}`}><Icon size={20} /></span><h3 className="mt-5 font-display text-[16px] font-extrabold tracking-[-.02em] text-ink">{title}</h3><p className="mt-2 text-[12px] leading-5 text-muted">{detail}</p><a href="#how-it-works" className="mt-5 inline-flex items-center gap-1 text-[10px] font-bold text-primary">See how it fits <ChevronRight size={13} /></a></article>)}
        </div>
      </section>

      <section id="how-it-works" className="px-5 pb-16 sm:px-8 sm:pb-20 lg:px-10">
        <div className="mx-auto grid max-w-[1240px] items-center gap-8 rounded-[28px] bg-[#173c2d] px-6 py-8 text-white sm:px-10 sm:py-10 lg:grid-cols-[1fr_auto] lg:px-12">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#bfe2c8]">A simple daily rhythm</p><h2 className="mt-3 max-w-[620px] font-display text-[25px] font-extrabold leading-tight tracking-[-.04em] sm:text-[34px]">Capture it once. See the whole picture.</h2><p className="mt-3 max-w-[620px] text-[12px] leading-6 text-white/65">Record transactions with a quick form or tell the assistant what happened. Your dashboard and reports follow the same shop ledger.</p></div>
          <button type="button" onClick={onSignUp} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-extrabold text-[#173c2d] transition hover:bg-[#e8f5eb]">Set up my shop <ArrowRight size={14} /></button>
        </div>
      </section>
    </main>

    <footer className="border-t border-[#e6ece6] bg-white/70 px-5 py-5 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3"><p className="text-[10px] font-semibold text-muted">© 2026 Dukaandaar · Made for the shop floor</p><div className="flex items-center gap-5 text-[10px] font-semibold text-muted"><button type="button" onClick={onLogin} className="hover:text-primary">Log in</button><button type="button" onClick={onSignUp} className="hover:text-primary">Create an account</button></div></div></footer>
  </div>;
}

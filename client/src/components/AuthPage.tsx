import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, Store } from "lucide-react";
import { api } from "../api/client";
import type { AuthUser } from "../types";

export type AuthPageMode = "login" | "signup";

interface AuthPageProps {
  mode: AuthPageMode;
  onModeChange: (mode: AuthPageMode) => void;
  onBack: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

const inputClassName = "mt-1.5 block w-full rounded-xl border border-[#e1e8e1] bg-white px-3.5 py-3 text-[13px] text-ink outline-none transition placeholder:text-[#a7b0a9] focus:border-primary/55 focus:ring-4 focus:ring-primary/8";

export function AuthPage({ mode, onModeChange, onBack, onAuthenticated }: AuthPageProps) {
  const isSignup = mode === "signup";
  const [ownerName, setOwnerName] = useState("");
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setError(""); }, [mode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    if (isSignup && password !== passwordConfirm) {
      setError("Those passwords don't match yet.");
      return;
    }
    setSubmitting(true);
    try {
      const result = isSignup
        ? await api.signUp({ ownerName, shopName, email, password })
        : await api.login({ email, password });
      onAuthenticated(result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't sign you in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="min-h-screen bg-[#f4f7f3] p-3 sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)] lg:p-8">
    <aside className="relative hidden min-h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-[30px] bg-[#173c2d] p-10 text-white lg:flex xl:p-14">
      <div className="pointer-events-none absolute -right-40 -top-20 h-[500px] w-[500px] rounded-full border border-white/10" />
      <div className="pointer-events-none absolute -right-16 -top-2 h-[350px] w-[350px] rounded-full border border-white/10" />
      <button type="button" onClick={onBack} className="relative z-[1] inline-flex w-fit items-center gap-2 text-[11px] font-semibold text-white/65 transition hover:text-white"><ArrowLeft size={14} />Back to home</button>
      <div className="relative z-[1] my-auto max-w-[520px] pb-10 pt-14">
        <span className="grid h-12 w-12 place-items-center rounded-[17px] bg-white/10 text-[#bfe2c8]"><Store size={23} /></span>
        <p className="mt-8 text-[10px] font-extrabold uppercase tracking-[.19em] text-[#bfe2c8]">Dukaandaar · your shop, in sync</p>
        <h1 className="mt-4 font-display text-[42px] font-extrabold leading-[1.05] tracking-[-.055em] xl:text-[54px]">Good to have<br />you here.</h1>
        <p className="mt-5 max-w-[420px] text-[14px] leading-7 text-white/66">A clearer view of the sales, stock and small daily decisions that keep your shop moving.</p>
        <div className="mt-9 space-y-4">
          <div className="flex items-center gap-3 text-[12px] font-medium text-white/80"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-[#bfe2c8]"><ShieldCheck size={15} /></span>Your account gets its own private shop workspace.</div>
          <div className="flex items-center gap-3 text-[12px] font-medium text-white/80"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-[#bfe2c8]"><LockKeyhole size={14} /></span>Your password is securely hashed; sessions stay in an HttpOnly cookie.</div>
        </div>
      </div>
      <p className="relative z-[1] text-[10px] text-white/35">Made for the shop floor · © 2026</p>
    </aside>

    <main className="flex min-h-[calc(100vh-1.5rem)] flex-col rounded-[26px] bg-white px-5 py-5 shadow-[0_20px_70px_rgba(27,57,37,.07)] sm:px-9 sm:py-8 lg:min-h-[calc(100vh-4rem)] lg:rounded-none lg:bg-transparent lg:px-12 lg:py-9 lg:shadow-none xl:px-[min(9vw,112px)]">
      <div className="flex items-center justify-between lg:justify-end">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted hover:text-primary lg:hidden"><ArrowLeft size={14} />Home</button>
        <div className="flex items-center gap-2 lg:hidden"><span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-white"><Store size={15} /></span><span className="font-display text-sm font-extrabold tracking-tight text-ink">Dukaandaar</span></div>
        <p className="hidden text-[11px] text-muted lg:block">{isSignup ? "Already set up?" : "New to Dukaandaar?"} <button type="button" onClick={() => onModeChange(isSignup ? "login" : "signup")} className="font-bold text-primary hover:text-primary-dark">{isSignup ? "Log in" : "Create an account"}</button></p>
      </div>

      <div className="mx-auto my-auto w-full max-w-[420px] py-8">
        <div className="mb-7"><span className="inline-flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#eaf5ed] text-primary"><LockKeyhole size={19} /></span><h2 className="mt-5 font-display text-[28px] font-extrabold tracking-[-.045em] text-[#173c2d]">{isSignup ? "Start with your shop" : "Welcome back"}</h2><p className="mt-2 text-[12px] leading-5 text-muted">{isSignup ? "Create your account and your private shop space." : "Sign in to pick up where your shop left off."}</p></div>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {isSignup ? <>
            <label className="block text-[11px] font-bold text-ink-soft">Your name<input className={inputClassName} type="text" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} autoComplete="name" maxLength={100} placeholder="e.g. Asha Sen" required /></label>
            <label className="block text-[11px] font-bold text-ink-soft">Shop name<input className={inputClassName} type="text" value={shopName} onChange={(event) => setShopName(event.target.value)} autoComplete="organization" maxLength={100} placeholder="e.g. Sen General Store" required /></label>
          </> : null}
          <label className="block text-[11px] font-bold text-ink-soft">Email address<input className={inputClassName} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} placeholder="you@example.com" required /></label>
          <label className="block text-[11px] font-bold text-ink-soft">Password<div className="relative mt-1.5"><input className={`${inputClassName} mt-0 pr-12`} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : 1} maxLength={128} placeholder={isSignup ? "At least 8 characters" : "Your password"} required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition hover:text-ink" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          {isSignup ? <label className="block text-[11px] font-bold text-ink-soft">Confirm password<input className={inputClassName} type={showPassword ? "text" : "password"} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" maxLength={128} placeholder="Enter it once more" required /></label> : null}

          {error ? <div role="alert" className="rounded-xl border border-[#f2d5d2] bg-[#fff4f2] px-3.5 py-3 text-[11px] font-medium leading-5 text-[#a23b35]">{error}</div> : null}
          {isSignup ? <p className="text-[10px] leading-5 text-muted">By creating an account, you get a fresh, separate shop workspace. Your records stay private to this account.</p> : null}
          <button type="submit" disabled={submitting} className="group mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-xs font-extrabold text-white shadow-[0_9px_22px_rgba(22,114,74,.16)] transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60">{submitting ? (isSignup ? "Creating your shop…" : "Signing in…") : (isSignup ? "Create account" : "Log in")} {!submitting ? <ArrowRight size={14} className="transition group-hover:translate-x-0.5" /> : null}</button>
        </form>

        <p className="mt-6 text-center text-[11px] text-muted lg:hidden">{isSignup ? "Already have an account?" : "New to Dukaandaar?"} <button type="button" onClick={() => onModeChange(isSignup ? "login" : "signup")} className="font-bold text-primary">{isSignup ? "Log in" : "Sign up"}</button></p>
        <div className="mt-6 flex items-center justify-center gap-2 text-[9px] font-medium text-[#8a978d]"><ShieldCheck size={13} className="text-primary" />Protected sign-in · Your shop data stays separate</div>
      </div>
    </main>
  </div>;
}

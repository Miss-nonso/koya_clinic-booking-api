"use client";

import {FormEvent, useCallback, useEffect, useRef, useState} from "react";

type Slot = {id: string; provider: string; start: string; end: string; available: boolean};
type Booking = {id: string; slot_id: string; name: string; email: string; status: "confirmed" | "cancelled"; created_at: string};
type Page = {bookings: Booking[]; next_cursor: string | null};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/clinic${path}`, {cache: "no-store", ...init});
  const data = await response.json();
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    throw new Error(`${data.error || "Something went wrong."}${retry ? ` Try again in ${retry} seconds.` : ""}`);
  }
  return data as T;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {weekday: "short", month: "short", day: "numeric", year: "numeric"});
}

export default function Home() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [historyEmail, setHistoryEmail] = useState("");
  const [history, setHistory] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Keep the key after an uncertain network response; a retry cannot duplicate a booking.
  const attempt = useRef<{body: string; key: string} | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {setSlots((await api<{slots: Slot[]}>("/slots")).slots);}
    catch (err) {setError(err instanceof Error ? err.message : "Unable to load appointments.");}
    finally {setLoading(false);}
  }, []);
  useEffect(() => {void refresh();}, [refresh]);
  const chosen = slots.find(slot => slot.id === selected);
  const available = slots.filter(slot => slot.available && new Date(slot.start).getTime() > Date.now());
  const confirmedSlot = slots.find(slot => slot.id === booking?.slot_id);

  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError("");
    try {await operation();}
    catch (err) {setError(err instanceof Error ? err.message : "Something went wrong.");}
    finally {setBusy(false);}
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const body = JSON.stringify({slot_id: selected, name, email});
      if (!attempt.current || attempt.current.body !== body) attempt.current = {body, key: crypto.randomUUID()};
      const result = await api<Booking>("/bookings", {method: "POST", body,
        headers: {"Content-Type": "application/json", "Idempotency-Key": attempt.current.key}});
      setBooking(result); setLookupId(result.id); setHistory(null); await refresh();
    });
  }
  async function loadHistory(cursor?: string) {
    const query = new URLSearchParams({email: historyEmail, limit: "5"});
    if (cursor) query.set("cursor", cursor);
    const page = await api<Page>(`/bookings?${query}`);
    setHistory(previous => ({...page, bookings: cursor && previous ? [...previous.bookings, ...page.bookings] : page.bookings}));
  }

  return <main className="mx-auto max-w-6xl px-5 pb-16 sm:px-9">
    <header className="flex items-center justify-between border-b border-teal-900/10 py-7">
      <a href="/" className="flex items-center gap-3 font-semibold tracking-tight text-teal-950"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-800 text-2xl text-white" aria-hidden="true">+</span>Koya Clinic</a>
      <span className="text-xs font-medium text-teal-800 sm:text-sm">Appointments, made simple</span>
    </header>
    <section className="grid gap-8 pb-10 pt-12 md:grid-cols-[1.3fr_1fr] md:pt-20">
      <div><p className="eyebrow">A LITTLE TIME FOR YOUR HEALTH</p><h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-teal-950 sm:text-6xl">Your next step.<br/><span className="text-teal-700">Better care.</span></h1>
      <p className="mt-6 max-w-md text-base leading-7 text-slate-600">Choose an available appointment, share your details, and get your confirmation right here.</p></div>
      <aside className="self-end rounded-3xl border border-teal-900/10 bg-white/70 p-7"><p className="eyebrow">HOW IT WORKS</p><ol className="mt-5 space-y-4 text-sm text-slate-600"><li><b className="step">1</b> Find a time that works for you</li><li><b className="step">2</b> Add your name and email</li><li><b className="step">3</b> Keep your booking reference</li></ol></aside>
    </section>
    <div role="alert" aria-live="assertive">{error ? <p className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}</div>
    <div className="grid items-start gap-7 lg:grid-cols-[1.2fr_1fr]">
      <section className="panel" aria-labelledby="slots-heading"><div className="flex items-center justify-between gap-4"><div><p className="eyebrow">01 / CHOOSE YOUR TIME</p><h2 id="slots-heading" className="mt-2 text-2xl font-semibold text-teal-950">Available appointments</h2></div><button className="text-sm font-semibold text-teal-800 underline underline-offset-4 disabled:opacity-40" onClick={() => void refresh()} disabled={loading || busy}>Refresh</button></div>
        <p className="mb-6 mt-3 text-xs text-slate-500">Times are shown in your device’s local timezone.</p>
        {loading ? <p role="status" className="py-10 text-slate-500">Checking available times…</p> : available.length ? <fieldset className="grid max-h-[440px] gap-3 overflow-auto"><legend className="sr-only">Choose an appointment slot</legend>{available.map(slot => <label key={slot.id} className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition ${selected === slot.id ? "border-teal-700 bg-teal-50" : "border-slate-200 hover:border-teal-500"}`}><input type="radio" name="slot" value={slot.id} checked={selected === slot.id} onChange={() => setSelected(slot.id)} disabled={busy} className="accent-teal-700"/><span className="flex-1"><span className="block text-sm font-semibold text-teal-950">{slot.provider}</span><span className="mt-1 block text-xs text-slate-500">{formatDate(slot.start)}</span></span><span className="text-right text-sm font-medium text-teal-800">{formatTime(slot.start)}<span className="block text-xs font-normal text-slate-500">to {formatTime(slot.end)}</span></span></label>)}</fieldset> : <p className="rounded-2xl bg-slate-50 px-5 py-10 text-sm leading-6 text-slate-600">No future appointments are available right now. Please check again later.</p>}
      </section>
      <section className="panel" aria-labelledby="details-heading"><p className="eyebrow">02 / YOUR DETAILS</p><h2 id="details-heading" className="mb-6 mt-2 text-2xl font-semibold text-teal-950">Make it yours</h2>
        <form onSubmit={submit} className="space-y-5"><div><label htmlFor="name">Full name</label><input id="name" autoComplete="name" required value={name} onChange={event => setName(event.target.value)} placeholder="Your full name" disabled={busy}/></div><div><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={busy}/></div>
        <div className="rounded-xl bg-teal-50 p-4 text-sm leading-6 text-teal-900">{chosen ? <><b>{chosen.provider}</b><br/>{formatDate(chosen.start)} · {formatTime(chosen.start)}</> : "Select an appointment on the left to continue."}</div>
        <button className="primary w-full" disabled={busy || !chosen || !chosen.available || new Date(chosen.start).getTime() <= Date.now()}>{busy ? "Please wait…" : "Confirm appointment →"}</button><p className="text-xs leading-5 text-slate-500">This is an assessment demo. Please use test details and do not enter medical information. Confirmation appears on this page; no email is sent.</p></form>
      </section>
    </div>
    {booking ? <section className="mt-7 rounded-3xl border border-teal-300 bg-teal-50 p-7" aria-live="polite"><p className="eyebrow">{booking.status === "confirmed" ? "YOU’RE BOOKED" : "APPOINTMENT CANCELLED"}</p><h2 className="mt-3 text-2xl font-semibold text-teal-950">{booking.name}, {booking.status === "confirmed" ? "your appointment is confirmed." : "your appointment has been cancelled."}</h2><p className="mt-3 text-sm text-teal-900">{confirmedSlot ? `${confirmedSlot.provider} · ${formatDate(confirmedSlot.start)} · ${formatTime(confirmedSlot.start)}` : `Slot: ${booking.slot_id}`}</p><p className="mt-3 text-sm text-slate-600">Booking reference: <code className="break-all font-semibold">{booking.id}</code></p><p className="mt-2 text-xs text-slate-500">Save this reference to look up your booking later.</p>{booking.status === "confirmed" ? <button className="mt-5 text-sm font-semibold text-red-800 underline underline-offset-4 disabled:opacity-50" disabled={busy} onClick={() => {
      if (window.confirm("Cancel this appointment and release the slot?")) void perform(async () => {setBooking(await api<Booking>(`/bookings/${booking.id}`, {method: "DELETE"})); setHistory(null); attempt.current = null; await refresh();});
    }}>Cancel appointment</button> : null}</section> : null}
    <div className="mt-10 grid gap-7 md:grid-cols-2"><section className="panel"><h2 className="text-xl font-semibold text-teal-950">Already booked?</h2><p className="mb-5 mt-2 text-sm text-slate-500">Look up your confirmation with its booking reference.</p><form onSubmit={event => {event.preventDefault(); void perform(async () => setBooking(await api<Booking>(`/bookings/${encodeURIComponent(lookupId.trim())}`)));}}><label htmlFor="reference">Booking reference</label><input id="reference" required value={lookupId} onChange={event => setLookupId(event.target.value)}/><button className="secondary mt-4" disabled={busy}>Find booking</button></form></section>
    <section className="panel"><h2 className="text-xl font-semibold text-teal-950">Appointment history</h2><p className="mb-5 mt-2 text-sm text-slate-500">View confirmed and cancelled appointments, oldest first.</p><form onSubmit={event => {event.preventDefault(); void perform(() => loadHistory());}}><label htmlFor="history-email">Email address</label><input id="history-email" type="email" required value={historyEmail} onChange={event => {setHistoryEmail(event.target.value); setHistory(null);}}/><button className="secondary mt-4" disabled={busy}>View appointments</button></form>{history ? <div className="mt-5 space-y-3">{history.bookings.length ? history.bookings.map(item => <button key={item.id} className="block w-full rounded-xl border border-slate-200 p-3 text-left text-sm hover:bg-teal-50" onClick={() => setBooking(item)}><b>{slots.find(slot => slot.id === item.slot_id)?.provider || item.slot_id}</b><span className="float-right capitalize">{item.status}</span><span className="mt-1 block break-all text-xs text-slate-500">{item.id}</span></button>) : <p className="text-sm text-slate-500">No bookings found.</p>}{history.next_cursor ? <button className="secondary" disabled={busy} onClick={() => void perform(() => loadHistory(history.next_cursor!))}>Load more</button> : null}</div> : null}</section></div>
    <footer className="mt-12 border-t border-teal-900/10 pt-6 text-xs text-slate-500">Koya Clinic · Assessment demonstration · No real clinical appointments</footer>
  </main>;
}

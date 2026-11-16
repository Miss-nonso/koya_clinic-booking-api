"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Slot = {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
};
type Booking = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
};
type BookingPage = { bookings: Booking[]; next_cursor: string | null };
type Filters = {
  provider: string;
  day: string;
  period: string;
  available: boolean;
};
const emptyFilters: Filters = {
  provider: "",
  day: "",
  period: "",
  available: false,
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/clinic${path}`, {
    cache: "no-store",
    ...init,
  });
  const data = await response.json();
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    throw new Error(
      `${data.error || "Something went wrong."}${retry ? ` Try again in ${retry} seconds.` : ""}`,
    );
  }
  return data as T;
}
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
const date = (value: string) =>
  new Date(value).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
// Use local calendar dates so filtering matches the dates shown on the cards.
const dayKey = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const period = (value: string) => {
  const hour = new Date(value).getHours();
  return hour < 6
    ? "Night"
    : hour < 12
      ? "Morning"
      : hour < 17
        ? "Afternoon"
        : "Evening";
};

export default function Clinic({ view }: { view: "slots" | "bookings" }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slotError, setSlotError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState("soonest");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [historyEmail, setHistoryEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState("");
  const [history, setHistory] = useState<BookingPage | null>(null);
  const [reference, setReference] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  // Preserve an attempt's key when a network response is uncertain.
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setSlotError("");
    try {
      setSlots((await api<{ slots: Slot[] }>("/slots")).slots);
    } catch (err) {
      setSlotError(
        err instanceof Error ? err.message : "Unable to load appointments.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (booking) resultHeading.current?.focus();
  }, [booking]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  function openBooking(slot: Slot) {
    setSelected(slot);
    setError("");
    dialog.current?.showModal();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    await perform(async () => {
      const body = JSON.stringify({
        slot_id: selected.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
      });
      if (!attempt.current || attempt.current.body !== body)
        attempt.current = { body, key: crypto.randomUUID() };
      const result = await api<Booking>("/bookings", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.current.key,
        },
      });
      dialog.current?.close();
      setBooking(result);
      setReference(result.id);
      await refresh();
    });
  }
  async function loadHistory(cursor?: string) {
    const lookupEmail = cursor
      ? searchedEmail
      : historyEmail.trim().toLowerCase();
    const query = new URLSearchParams({ email: lookupEmail, limit: "5" });
    if (cursor) query.set("cursor", cursor);
    const page = await api<BookingPage>(`/bookings?${query}`);
    setSearchedEmail(lookupEmail);
    setHistory((previous) => ({
      ...page,
      bookings:
        cursor && previous
          ? [...previous.bookings, ...page.bookings]
          : page.bookings,
    }));
  }
  async function cancelBooking() {
    if (!cancelTarget) return;
    await perform(async () => {
      const result = await api<Booking>(
        `/bookings/${encodeURIComponent(cancelTarget.id)}`,
        { method: "DELETE" },
      );
      setBooking(result);
      setHistory((previous) =>
        previous
          ? {
              ...previous,
              bookings: previous.bookings.map((item) =>
                item.id === result.id ? result : item,
              ),
            }
          : null,
      );
      attempt.current = null;
      cancelDialog.current?.close();
      setCancelTarget(null);
      await refresh();
    });
  }
  function askCancel(item: Booking) {
    setCancelTarget(item);
    setError("");
    cancelDialog.current?.showModal();
  }
  const future = slots.filter(
    (slot) => new Date(slot.start).getTime() > Date.now(),
  );
  const visible = future
    .filter(
      (slot) =>
        (!filters.provider || slot.provider === filters.provider) &&
        (!filters.day || dayKey(slot.start) === filters.day) &&
        (!filters.period || period(slot.start) === filters.period) &&
        (!filters.available || slot.available),
    )
    .sort((a, b) =>
      sort === "provider"
        ? a.provider.localeCompare(b.provider) || a.start.localeCompare(b.start)
        : sort === "latest"
          ? new Date(b.start).getTime() - new Date(a.start).getTime()
          : new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  const groups = new Map<string, Slot[]>();
  for (const slot of visible) {
    const key = dayKey(slot.start);
    groups.set(key, [...(groups.get(key) || []), slot]);
  }
  const activeFilters =
    filters.provider || filters.day || filters.period || filters.available;
  const bookingSlot = slots.find((slot) => slot.id === booking?.slot_id);

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <span aria-hidden="true" className="brand-icon">
              +
            </span>
            Koya Clinic
          </Link>
          <nav aria-label="Main">
            <Link href="/" aria-current={view === "slots" ? "page" : undefined}>
              Available slots
            </Link>
            <Link
              href="/bookings"
              aria-current={view === "bookings" ? "page" : undefined}
            >
              My bookings
            </Link>
          </nav>
        </div>
        <p className="header-note">
          Book in a few taps. No account needed: find your bookings by email.
        </p>
      </header>
      <main id="main" className="page-content">
        <section className="page-intro">
          <p className="eyebrow">YOUR HEALTH, YOUR TIME</p>
          <h1>{view === "slots" ? "Find a convenient time" : "My bookings"}</h1>
          <p>
            {view === "slots"
              ? "Pick a slot, add your details, and the booking is complete. View or cancel appointment any time."
              : "Enter your booking email to view and manage your appointments."}
          </p>
        </section>
        {!selected ? <ErrorMessage message={error} /> : null}
        {booking ? (
          <section
            className="confirmation panel"
            aria-label="Booking confirmation"
          >
            <p className="eyebrow">
              {booking.status === "confirmed"
                ? "YOU’RE BOOKED"
                : "APPOINTMENT CANCELLED"}
            </p>
            <h2 tabIndex={-1} ref={resultHeading}>
              {booking.status === "confirmed"
                ? "Your appointment is confirmed"
                : "Your appointment has been cancelled"}
            </h2>
            <p>
              {booking.name} · {booking.email}
            </p>
            <p>
              {bookingSlot
                ? `${bookingSlot.provider} · ${date(bookingSlot.start)} · ${time(bookingSlot.start)} – ${time(bookingSlot.end)}`
                : `Slot: ${booking.slot_id}`}
            </p>
            <p>
              Booking reference <code>{booking.id}</code>
            </p>
            <p className="muted">
              Save your reference. Confirmation appears here; no email is sent.
            </p>
            <div className="actions">
              {booking.status === "confirmed" ? (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => askCancel(booking)}
                >
                  Cancel appointment
                </button>
              ) : null}
              <Link className="secondary" href="/bookings">
                My bookings
              </Link>
              <button
                className="text-button"
                onClick={() => {
                  setBooking(null);
                  setSelected(null);
                  attempt.current = null;
                }}
              >
                Dismiss
              </button>
            </div>
          </section>
        ) : null}
        {view === "slots" ? (
          <div className="content-grid">
            <section aria-label="Appointments">
              <div className="list-summary">
                <div>
                  <strong>
                    {future.filter((slot) => slot.available).length} open slots
                  </strong>
                  <p className="muted">
                    Times are shown in your device’s local timezone.
                  </p>
                </div>
                <button
                  className="text-button"
                  disabled={loading || busy}
                  onClick={() => void refresh()}
                >
                  Refresh
                </button>
              </div>
              <div className="toolbar">
                <details className="filters">
                  <summary>Filters{activeFilters ? " · active" : ""}</summary>
                  <div className="filter-fields">
                    <label>
                      Provider
                      <select
                        value={filters.provider}
                        onChange={(e) =>
                          setFilters({ ...filters, provider: e.target.value })
                        }
                      >
                        <option value="">All providers</option>
                        {[...new Set(future.map((slot) => slot.provider))]
                          .sort()
                          .map((provider) => (
                            <option key={provider}>{provider}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Day
                      <select
                        value={filters.day}
                        onChange={(e) =>
                          setFilters({ ...filters, day: e.target.value })
                        }
                      >
                        <option value="">All days</option>
                        {[...new Set(future.map((slot) => dayKey(slot.start)))]
                          .sort()
                          .map((day) => (
                            <option key={day} value={day}>
                              {date(`${day}T12:00:00`)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Time of day
                      <select
                        value={filters.period}
                        onChange={(e) =>
                          setFilters({ ...filters, period: e.target.value })
                        }
                      >
                        <option value="">Any time</option>
                        {["Night", "Morning", "Afternoon", "Evening"].map(
                          (value) => (
                            <option key={value}>{value}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={filters.available}
                        onChange={(e) =>
                          setFilters({
                            ...filters,
                            available: e.target.checked,
                          })
                        }
                      />{" "}
                      Available only
                    </label>
                    <button
                      className="text-button"
                      disabled={!activeFilters}
                      onClick={() => setFilters(emptyFilters)}
                    >
                      Clear filters
                    </button>
                  </div>
                </details>
                <label className="sort-label">
                  Sort by
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="soonest">Soonest first</option>
                    <option value="latest">Latest first</option>
                    <option value="provider">Provider (A–Z)</option>
                  </select>
                </label>
              </div>
              <ErrorMessage message={slotError} />
              {loading ? (
                <p role="status" className="empty-state">
                  Loading appointments…
                </p>
              ) : slotError ? (
                <p className="muted">
                  Use Refresh to try loading appointments again.
                </p>
              ) : visible.length ? (
                [...groups].map(([day, items]) => (
                  <section className="day-group" key={day}>
                    <h2>{date(items[0].start)}</h2>
                    <div className="slot-grid">
                      {items.map((slot) => (
                        <article
                          key={slot.id}
                          className={`slot-card ${slot.available ? "" : "unavailable"}`}
                        >
                          <div className="slot-top">
                            <strong>
                              {time(slot.start)} – {time(slot.end)}
                            </strong>
                            <span
                              className={`badge ${slot.available ? "available" : ""}`}
                            >
                              {slot.available ? "Available" : "Booked"}
                            </span>
                          </div>
                          <h3>{slot.provider}</h3>
                          <div className="slot-bottom">
                            <span className="muted">Appointment</span>
                            <button
                              className="primary"
                              disabled={!slot.available || busy}
                              aria-label={`Book ${slot.provider}, ${date(slot.start)} at ${time(slot.start)}`}
                              onClick={() => openBooking(slot)}
                            >
                              Book
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="empty-state">
                  <h2>
                    {activeFilters
                      ? "No matching appointments"
                      : "No appointments available"}
                  </h2>
                  <p>
                    {activeFilters
                      ? "Try another provider, day or time of day."
                      : "Please check again later for new appointment times."}
                  </p>
                  {activeFilters ? (
                    <button
                      className="secondary"
                      onClick={() => setFilters(emptyFilters)}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              )}
            </section>
            <aside className="help-column">
              <section className="panel">
                <h2>How booking works</h2>
                <ol className="steps">
                  <li>
                    <b>Pick a time</b>
                    <p>Narrow the list by provider, day or time of day.</p>
                  </li>
                  <li>
                    <b>Add your details</b>
                    <p>
                      Just your name and email. There’s no account to create.
                    </p>
                  </li>
                  <li>
                    <b>Keep your reference</b>
                    <p>Find your booking again to check or cancel it.</p>
                  </li>
                </ol>
              </section>
              <section className="panel">
                <h2>Already booked?</h2>
                <p className="muted">
                  Find your appointments with the email you booked with.
                </p>
                <Link className="secondary" href="/bookings">
                  Look up bookings →
                </Link>
              </section>
            </aside>
          </div>
        ) : (
          <section className="bookings-content">
            <form
              className="panel lookup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(() => loadHistory());
              }}
            >
              <label htmlFor="history-email">Email address</label>
              <div className="inline-form">
                <input
                  id="history-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={historyEmail}
                  onChange={(e) => {
                    setHistoryEmail(e.target.value);
                    setHistory(null);
                  }}
                  placeholder="you@example.com"
                />
                <button className="primary" disabled={busy}>
                  {busy ? "Please wait…" : "Find bookings"}
                </button>
              </div>
              <p className="muted">
                Need an appointment? <Link href="/">Pick a time</Link>.
              </p>
            </form>
            {history ? (
              <section aria-live="polite" className="history">
                <h2>Appointments for {searchedEmail}</h2>
                <p className="muted">
                  Confirmed and cancelled appointments, oldest first.
                </p>
                {history.bookings.length ? (
                  history.bookings.map((item) => {
                    const slot = slots.find((slot) => slot.id === item.slot_id);
                    return (
                      <article className="panel history-card" key={item.id}>
                        <div>
                          <span
                            className={`badge ${item.status === "confirmed" ? "available" : ""}`}
                          >
                            {item.status}
                          </span>
                          <h3>{slot?.provider || item.slot_id}</h3>
                          {slot ? (
                            <p>
                              {date(slot.start)} · {time(slot.start)} –{" "}
                              {time(slot.end)}
                            </p>
                          ) : null}
                          <p className="muted">{item.name}</p>
                          <code>{item.id}</code>
                        </div>
                        <div className="actions">
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => setBooking(item)}
                          >
                            View details
                          </button>
                          {item.status === "confirmed" ? (
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => askCancel(item)}
                            >
                              Cancel appointment
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="empty-state">
                    No bookings found for this email. Check the address or{" "}
                    <Link href="/">choose an appointment</Link>.
                  </p>
                )}
                {history.next_cursor ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(() => loadHistory(history.next_cursor!))
                    }
                  >
                    {busy ? "Loading…" : "Load more bookings"}
                  </button>
                ) : null}
              </section>
            ) : null}
            <details className="reference-lookup panel">
              <summary>Have a booking reference?</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () =>
                    setBooking(
                      await api<Booking>(
                        `/bookings/${encodeURIComponent(reference.trim())}`,
                      ),
                    ),
                  );
                }}
              >
                <label htmlFor="reference">Booking reference</label>
                <div className="inline-form">
                  <input
                    id="reference"
                    required
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  <button className="secondary" disabled={busy}>
                    Find booking
                  </button>
                </div>
              </form>
            </details>
          </section>
        )}
        <footer>
          Koya Clinic · Assessment demonstration · No real clinical appointments
        </footer>
      </main>
      <dialog
        ref={dialog}
        className="booking-dialog"
        aria-labelledby="dialog-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => setSelected(null)}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">Book an appointment</h2>
          <button
            className="close-button"
            aria-label="Close"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        {selected ? (
          <div className="selected-slot">
            <p className="eyebrow">SELECTED SLOT</p>
            <h3>{selected.provider}</h3>
            <p>{date(selected.start)}</p>
            <p>
              {time(selected.start)} – {time(selected.end)}
            </p>
          </div>
        ) : null}
        <form onSubmit={submit}>
          <ErrorMessage message={error} />
          <label htmlFor="booking-name">Full name</label>
          <input
            id="booking-name"
            autoComplete="name"
            required
            pattern=".*\S.*"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="booking-email">Email address</label>
          <input
            id="booking-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <p className="muted small">
            Please use test details and do not enter medical information.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={cancelDialog}
        className="booking-dialog"
        aria-labelledby="cancel-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2 id="cancel-title">Cancel this appointment?</h2>
        <p>
          This releases the slot for someone else. Your booking will stay in
          your history as cancelled.
        </p>
        <ErrorMessage message={error} />
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => cancelDialog.current?.close()}
          >
            Keep appointment
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void cancelBooking()}
          >
            {busy ? "Cancelling…" : "Yes, cancel"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="error-message">
      {message}
    </p>
  ) : null;
}

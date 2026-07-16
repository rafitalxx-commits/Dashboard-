import { useMemo, useState } from "react";

export type CalendarEvent = {
  id: string;
  title: string;
  detail?: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  googleEventId?: string;
  source?: "local" | "google";
};

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const WEEKDAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

type ViewMode = "mes" | "semana" | "dia";

function isSameDay(a: string, b: string) {
  return a?.slice(0, 10) === b?.slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(date: string) {
  const d = new Date(date + "T00:00:00");
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function formatTime(iso?: string) {
  if (!iso) return "";
  return iso.slice(11, 16);
}

export function TasksCalendarView({
  events,
  onCreate,
}: {
  events: CalendarEvent[];
  onCreate: (event: {
    date: string;
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
  }) => void;
}) {
  const [view, setView] = useState<ViewMode>("mes");
  const [focusDate, setFocusDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newLocation, setNewLocation] = useState("");

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = ev.startsAt?.slice(0, 10) ?? "";
      const list = map.get(d) ?? [];
      list.push(ev);
      map.set(d, list);
    }
    return map;
  }, [events]);

  const days: string[] = useMemo(() => {
    if (view === "mes") {
      const [y, m] = focusDate.split("-").map(Number);
      if (!y || !m) return [];
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      const daysInMonth = end.getDate();
      const startWeekday = (start.getDay() + 6) % 7;
      const items: string[] = [];
      for (let i = 0; i < startWeekday; i++) {
        items.push(addDays(`${y}-${String(m).padStart(2, "0")}-01`, -startWeekday + i));
      }
      for (let i = 1; i <= daysInMonth; i++) {
        const ds = `${y}-${String(m).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        items.push(ds);
      }
      const remaining = 42 - items.length;
      for (let i = 1; i <= remaining; i++) {
        items.push(addDays(`${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`, i));
      }
      return items;
    }
    if (view === "semana") {
      const base = startOfWeek(focusDate);
      return Array.from({ length: 7 }).map((_, i) => addDays(base, i));
    }
    return [focusDate];
  }, [view, focusDate]);

  const currentLabel = useMemo(() => {
    if (view === "mes") {
      const [y, m] = focusDate.split("-").map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }
    if (view === "semana") {
      const base = startOfWeek(focusDate);
      const end = addDays(base, 6);
      return `${base.slice(8, 10)}/${base.slice(5, 7)} - ${end.slice(8, 10)}/${end.slice(5, 7)} ${end.slice(0, 4)}`;
    }
    return `${focusDate.slice(8, 10)}/${focusDate.slice(5, 7)}/${focusDate.slice(0, 4)}`;
  }, [view, focusDate]);

  const changeFocus = (delta: number) => {
    if (view === "mes") {
      const [y, m] = focusDate.split("-").map(Number);
      const next = new Date(y, m - 1 + delta, 1);
      setFocusDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
      return;
    }
    if (view === "semana") {
      setFocusDate(addDays(focusDate, delta * 7));
      return;
    }
    setFocusDate(addDays(focusDate, delta));
  };

  const goToday = () => {
    setFocusDate(new Date().toISOString().slice(0, 10));
    setSelectedDate(new Date().toISOString().slice(0, 10));
  };

  const syncGoogle = () => {
    setSyncing(true);
    setTimeout(() => setSyncing(false), 1200);
  };

  const submitForDate = () => {
    const date = selectedDate ?? focusDate;
    if (!date || !newTitle.trim()) return;
    const startsAt = `${date}T${newStart}`;
    const endsAt = `${date}T${newEnd}`;
    onCreate({
      date,
      title: newTitle,
      startsAt,
      endsAt,
      location: newLocation || undefined,
    });
    setNewTitle("");
    setNewLocation("");
    setSelectedDate(null);
  };

  const sourceLabel = (source?: string) => {
    if (source === "google") return "Gmail Calendar";
    if (source === "local") return "Local";
    return "Local";
  };

  const selectedEvents = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div className="calendar">
      <div className="cal-header">
        <div className="cal-title">
          <button className="ghost" onClick={() => changeFocus(-1)} type="button">‹</button>
          <button className="ghost today" onClick={goToday} type="button">Hoy</button>
          <span>{currentLabel}</span>
          <button className="ghost" onClick={() => changeFocus(1)} type="button">›</button>
        </div>
        <div className="cal-toolbar">
          <div className="views">
            {(["mes", "semana", "dia"] as const).map((mode) => (
              <button
                key={mode}
                className={`view-chip ${view === mode ? "active" : ""}`}
                onClick={() => {
                  setView(mode);
                  setFocusDate(focusDate);
                }}
                type="button"
              >
                {mode === "mes" ? "Mes" : mode === "semana" ? "Semana" : "Día"}
              </button>
            ))}
          </div>
          <button className={`sync-btn ${syncing ? "syncing" : ""}`} onClick={syncGoogle} type="button">
            {syncing ? "Sincronizando..." : "Gmail Calendar"}
          </button>
        </div>
      </div>

      <div className="weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="weekday">{w}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((date, idx) => {
          const eventsForDay = byDate.get(date) ?? [];
          const today = new Date().toISOString().slice(0, 10);
          const isToday = date === today;
          const isSelected = selectedDate === date;
          const outside = isOutsideMonth(date, view, focusDate);
          return (
            <button
              className={`day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${outside ? "outside" : ""}`}
              key={`${date}-${idx}`}
              onClick={() => setSelectedDate(date)}
              type="button"
            >
              <span className="day-num">{date.slice(8, 10)}</span>
              <span className="day-events">
                {eventsForDay.length === 0 && <span className="day-empty" />}
                {eventsForDay.slice(0, 2).map((ev) => (
                  <span
                    className={`event-chip ${ev.googleEventId ? "google" : "local"}`}
                    key={ev.id}
                    title={ev.title}
                  >
                    <span className="event-dot" />
                    <span className="event-title">{ev.title}</span>
                  </span>
                ))}
                {eventsForDay.length > 2 && (
                  <span className="more">+{eventsForDay.length - 2}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="day-panel">
          <div className="day-panel-header">
            <div>
              <div className="day-panel-title">{formatFullDate(selectedDate)}</div>
              <div className="day-panel-sub">{selectedEvents.length} evento{selectedEvents.length === 1 ? "" : "s"}</div>
            </div>
            <button className="ghost close" onClick={() => setSelectedDate(null)} type="button">×</button>
          </div>
          <div className="day-events-list">
            {selectedEvents.length === 0 && (
              <div className="empty-state">Sin eventos.</div>
            )}
            {selectedEvents.map((ev) => (
              <div className={`event-card ${ev.googleEventId ? "google" : "local"}`} key={ev.id}>
                <div className="event-card-header">
                  <span className={`event-indicator ${ev.googleEventId ? "google" : "local"}`} />
                  <span className="event-title">{ev.title}</span>
                </div>
                <div className="event-meta">
                  {formatTime(ev.startsAt)} - {formatTime(ev.endsAt)}
                  {ev.location && <> · {ev.location}</>}
                </div>
                <div className="event-source">{sourceLabel(ev.source)}</div>
              </div>
            ))}
          </div>
          <form className="new-event" onSubmit={(e) => { e.preventDefault(); submitForDate(); }}>
            <input
              className="input"
              placeholder="Título del evento"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
            <div className="row">
              <input
                className="input"
                type="time"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
              <input
                className="input"
                type="time"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </div>
            <input
              className="input"
              placeholder="Ubicación (opcional)"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
            />
            <div className="actions">
              <button className="ghost" onClick={() => setSelectedDate(null)} type="button">Cancelar</button>
              <button className="button primary" type="submit">Guardar evento</button>
            </div>
          </form>
        </div>
      )}

      <style>{css}</style>
    </div>
  );
}

function isOutsideMonth(date: string, view: ViewMode, focusDate: string) {
  if (view !== "mes") return false;
  const [y, m] = focusDate.split("-").map(Number);
  const dy = Number(date.slice(0, 4));
  const dm = Number(date.slice(5, 7));
  return dy !== y || dm !== m;
}

function formatFullDate(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const css = `
.calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cal-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cal-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.cal-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}
.views {
  display: inline-flex;
  gap: 8px;
  padding: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  border-radius: 999px;
}
.view-chip {
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  min-height: 40px;
  font-size: 14px;
}
.view-chip.active { background: #1d4ed8; color: white; }

.sync-btn {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: inherit;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
  min-height: 40px;
}
.sync-btn.syncing { opacity: 0.8; }

.weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.weekday { text-align: center; font-size: 12px; color: #94a3b8; font-weight: 600; }

.calendar-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
@media (min-width: 640px) {
  .calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
}

.day {
  position: relative;
  min-height: 56px;
  padding: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.03);
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.day.today { border-color: #1d4ed8; box-shadow: inset 0 0 0 1px #1d4ed8; }
.day.selected { background: rgba(29,78,216,0.18); }
.day.outside { opacity: 0.5; }
.day-num { font-weight: 600; color: #e2e8f0; font-size: 14px; }
.day-events { display: flex; flex-direction: column; gap: 4px; }
.event-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  background: rgba(29,78,216,0.22);
  color: #e2e8f0;
}
.event-chip.google { background: rgba(16,185,129,0.22); }
.event-chip.local { background: rgba(29,78,216,0.22); }
.event-chip .event-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.9; }
.event-title { overflow: hidden; text-overflow: ellipsis; }
.more { color: #94a3b8; font-size: 11px; }
.day-empty { height: 1px; }

.day-panel {
  margin-top: 10px;
  padding: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  background: rgba(255,255,255,0.03);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.day-panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.day-panel-title { font-weight: 700; font-size: 16px; text-transform: capitalize; }
.day-panel-sub { color: #94a3b8; font-size: 12px; }
.day-events-list { display: flex; flex-direction: column; gap: 10px; }
.event-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.event-card.google { border-left: 3px solid #10b981; }
.event-card.local { border-left: 3px solid #1d4ed8; }
.event-card-header { display: flex; align-items: center; gap: 8px; }
.event-indicator { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: 0.9; }
.event-indicator.google { background: #10b981; }
.event-indicator.local { background: #1d4ed8; }
.event-card .event-title { font-weight: 600; color: #e2e8f0; }
.event-meta { color: #94a3b8; font-size: 12px; }
.event-source { color: #64748b; font-size: 11px; }

.new-event { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.input, select, textarea { background: rgba(255,255,255,0.04); color: inherit; border: 1px solid rgba(255,255,255,0.12); padding: 12px 14px; border-radius: 10px; font-size: 16px; min-width: 0; }
.close { border: none; background: transparent; color: inherit; font-size: 18px; padding: 4px 8px; border-radius: 8px; }

.button, .ghost { border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: inherit; padding: 12px 14px; border-radius: 10px; cursor: pointer; min-height: 44px; font-size: 15px; }
.button.primary { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.button:hover, .ghost:hover { filter: brightness(1.1); }
.empty-state { color: #94a3b8; font-size: 14px; padding: 6px 0; }
`;

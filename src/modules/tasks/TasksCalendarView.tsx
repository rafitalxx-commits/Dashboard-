import { useMemo, useState } from "react";

export type CalendarEvent = {
  id: string;
  title: string;
  detail?: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  googleEventId?: string;
};

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const WEEKDAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selected, setSelected] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newLocation, setNewLocation] = useState("");

  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    const daysInMonth = end.getDate();
    const startWeekday = (start.getDay() + 6) % 7; // 0=Lun
    const items: Array<{ date: string; day: number | null }> = [];

    if (startWeekday > 0) {
      const prev = new Date(y, m - 1, 0);
      for (let i = 0; i < startWeekday; i++) {
        const d = prev.getDate() - startWeekday + 1 + i;
        const ds = `${y}-${String(m - 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        items.push({ date: ds, day: d });
      }
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      items.push({ date: ds, day: i });
    }
    const remaining = 42 - items.length;
    for (let i = 1; i <= remaining; i++) {
      const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      items.push({ date: ds, day: i });
    }
    return items;
  }, [month]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = (ev.startsAt || ev.id).slice(0, 10);
      const list = map.get(d) ?? [];
      list.push(ev);
      map.set(d, list);
    }
    return map;
  }, [events]);

  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    const ds = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setMonth(ds);
  };

  const submitForDate = () => {
    if (!selected || !newTitle.trim()) return;
    const [y, m, d] = selected.split("-").map(Number);
    const startsAt = `${selected}T${newStart}`;
    const endsAt = `${selected}T${newEnd}`;
    onCreate({
      date: selected,
      title: newTitle,
      startsAt,
      endsAt,
      location: newLocation || undefined,
    });
    setNewTitle("");
    setNewLocation("");
  };

  return (
    <div className="calendar">
      <div className="toolbar">
        <div className="month">
          <button className="ghost" onClick={() => changeMonth(-1)}>&lt;</button>
          <span>{MONTHS[Number(month.split("-")[1]) - 1]} {month.split("-")[0]}</span>
          <button className="ghost" onClick={() => changeMonth(1)}>&gt;</button>
        </div>
        <div className="legend">
          <span className="chip" />
          <span> eventos</span>
        </div>
      </div>

      <div className="weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="weekday">{w}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((item, idx) => {
          const dayEvents = byDate.get(item.date) ?? [];
          const isToday = item.date === new Date().toISOString().slice(0, 10);
          const isSelected = selected === item.date;
          return (
            <div
              className={`day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
              key={idx}
              onClick={() => setSelected(item.date)}
            >
              <div className="day-num">{item.day}</div>
              {dayEvents.slice(0, 3).map((ev) => (
                <div className="chip" key={ev.id}>
                  <CalendarDays size={12} />
                  <span className="event-title">{ev.title}</span>
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="more">+{dayEvents.length - 3}</div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="backdrop" onClick={() => setSelected(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">Nuevo evento: {selected}</div>
            <label className="label">Título</label>
            <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Reunión, llamada..." />
            <div className="row">
              <label className="label">
                Inicio
                <input className="input" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </label>
              <label className="label">
                Fin
                <input className="input" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </label>
            </div>
            <label className="label">Ubicación</label>
            <input className="input" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Zoom, oficina..." />
            <div className="actions">
              <button className="button" onClick={() => setSelected(null)}>Cancelar</button>
              <button className="button primary" onClick={submitForDate}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      <style>{css}</style>
    </div>
  );
}

const css = `
.calendar { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.month { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.legend { display: flex; align-items: center; gap: 8px; color: #94a3b8; }
.chip { background: #1d4ed8; padding: 4px 8px; border-radius: 999px; color: white; display: inline-flex; gap: 6px; align-items: center; font-size: 12px; }
.weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.weekday { text-align: center; font-size: 12px; color: #94a3b8; font-weight: 600; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.day { border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03); border-radius: 10px; padding: 8px; min-height: 90px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
.day.today { border-color: #1d4ed8; }
.day.selected { outline: 1px solid #1d4ed8; }
.day-num { font-weight: 600; color: #e2e8f0; }
.event-title { color: white; }
.more { color: #94a3b8; font-size: 12px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #cbd5e1; }
.input, select, textarea { background: rgba(255,255,255,0.04); color: inherit; border: 1px solid rgba(255,255,255,0.12); padding: 8px 10px; border-radius: 8px; }
.input { min-width: 200px; }
.backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.72); display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh; }
.sheet { background: #0b1120; border: 1px solid rgba(255,255,255,0.06); padding: 18px; border-radius: 14px; width: 980px; max-width: 94vw; display: flex; flex-direction: column; gap: 12px; }
.sheet-header { font-weight: 700; font-size: 16px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.button, .ghost { border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: inherit; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.button.primary { background: #1d4ed8; border-color: #1d4ed8; color: white; }
.button:hover, .ghost:hover { filter: brightness(1.1); }
`;

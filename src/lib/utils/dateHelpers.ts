// Format date to YYYY-MM-DD (local timezone)
export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get number of days in month
export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

// Get calendar days for month view (including padding from adjacent months)
export const getCalendarDays = (date: Date): Array<{ date: Date; otherMonth: boolean }> => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];

  const startDay = firstDay.getDay() || 7;
  for (let i = startDay - 1; i > 0; i--) days.push({ date: new Date(year, month, 1 - i), otherMonth: true });
  for (let i = 1; i <= lastDay.getDate(); i++) days.push({ date: new Date(year, month, i), otherMonth: false });
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) days.push({ date: new Date(year, month + 1, i), otherMonth: true });

  return days;
};

// Check if date is weekend
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

// Check if date is today
export const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
};

// Parse a YYYY-MM-DD string as local time.
// new Date('YYYY-MM-DD') is parsed as UTC by the spec, which can shift the
// displayed day by ±1 depending on the local timezone offset.  Appending
// T12:00:00 forces local-time interpretation with a noon anchor that avoids
// any DST-boundary edge cases.
export const parseDateLocal = (dateStr: string): Date => {
  return new Date(dateStr + 'T12:00:00');
};

export const formatDateLong = (dateStr: string): string => {
  return parseDateLocal(dateStr).toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export const adjustForWeekend = (date: Date): Date => {
  const day = date.getDay();
  if (day === 6) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 2);
  }
  if (day === 0) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }
  return date;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Data di calendario YYYY-MM-DD esistente (rifiuta 2026-02-30).
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

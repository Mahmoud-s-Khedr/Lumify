/** Returns the current UTC calendar date at midnight. */
export function utcCalendarToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

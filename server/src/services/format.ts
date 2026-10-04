export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

export function periodLabel(period: string): string {
  const labels: Record<string, string> = { today: "today", yesterday: "yesterday", week: "this week", last_week: "last week", month: "this month", all: "all time" };
  return labels[period] ?? "today";
}

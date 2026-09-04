interface FinanceMonthData { x: number; }
interface IFinanceData { [monthKey: string]: FinanceMonthData; }
interface IFinancialAnalyticsData { a: number[]; b: string[]; }

const fd: IFinanceData = { "2024-01": { x: 1 } };
const fa: IFinancialAnalyticsData = { a: [1], b: ["x"] };

// IFinanceData (has index sig) -> Record<string, unknown>
const r1: Record<string, unknown> = fd;

// IFinancialAnalyticsData (no index sig) -> Record<string, unknown>
const r2: Record<string, unknown> = fa as unknown as Record<string, unknown>;

// Can we cast directly without as unknown?
const r3: Record<string, unknown> = fa as Record<string, unknown>;

export { r1, r2, r3 };

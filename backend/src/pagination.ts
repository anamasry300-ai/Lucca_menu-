export interface PageSpec {
  page: number;
  pageSize: number;
  offset: number;
}

export function normalizePage(page: unknown, pageSize: unknown, maxSize = 200): PageSpec {
  const p = Math.max(1, Number.parseInt(String(page ?? '1'), 10) || 1);
  const ps = Math.min(maxSize, Math.max(1, Number.parseInt(String(pageSize ?? '50'), 10) || 50));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

export function pageResult<T>(rows: T[], total: number, page: number, pageSize: number) {
  return {
    rows,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}
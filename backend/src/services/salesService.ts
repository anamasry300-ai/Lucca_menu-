import {
  orderById, ordersBetween, orderItemsForOrder, paymentsForOrder, paymentsBetween,
  refundsForOrder, refundsBetween, ordersPage, ordersPageCount,
} from '../repositories/ordersRepo.js';
import { normalizePage, pageResult } from '../pagination.js';

const num = (v: unknown): number => Number(v) || 0;
const str = (v: unknown): string => String(v == null ? '' : v);

export interface OrderFinancialItem {
  quantity: number;
  unitPrice: number;
}

export interface OrderFinancials {
  subtotal: number;
  discountAmount: number;
  total: number;
}

export function calculateOrderFinancials(
  items: OrderFinancialItem[],
  discount: number = 0,
  discountType: 'percent' | 'fixed' = 'percent',
  taxRate: number = 0,
): OrderFinancials {
  const subtotal = items.reduce((s, it) => s + num(it.quantity) * num(it.unitPrice), 0);
  const discountAmount = discountType === 'fixed'
    ? Math.min(num(discount), subtotal)
    : (subtotal * num(discount)) / 100;
  const total = subtotal - discountAmount + subtotal * num(taxRate) / 100;
  return { subtotal, discountAmount: Math.round(discountAmount * 100) / 100, total: Math.round(total * 100) / 100 };
}

export interface OrderDetail {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  discount: number;
  discountAmount: number;
  discountType: string;
  tax: number;
  total: number;
  totalPaid: number;
  date: string;
  createdAt: string;
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
}

export function getOrder(id: number): OrderDetail | undefined {
  const row = orderById(id);
  if (!row) return undefined;
  return {
    id: num(row.id),
    orderNumber: str(row.orderNumber),
    status: str(row.status),
    paymentStatus: str(row.paymentStatus),
    subtotal: num(row.subtotal),
    discount: num(row.discount),
    discountAmount: num(row.discountAmount),
    discountType: str(row.discountType),
    tax: num(row.tax),
    total: num(row.total),
    totalPaid: num(row.totalPaid),
    date: str(row.date),
    createdAt: str(row.createdAt),
    items: orderItemsForOrder(num(row.id)),
    payments: paymentsForOrder(num(row.id)),
    refunds: refundsForOrder(num(row.id)),
  };
}

export function getOrders(options: { from?: string; to?: string; limit?: number } = {}): Record<string, unknown>[] {
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  return ordersBetween(from, to, options.limit || 200);
}

export function getOrdersPage(options: { from?: string; to?: string; page?: number; pageSize?: number; status?: string; paymentStatus?: string; orderType?: string; q?: string } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const rows = ordersPage({
    from: options.from,
    to: options.to,
    page: p.page,
    pageSize: p.pageSize,
    status: options.status,
    paymentStatus: options.paymentStatus,
    orderType: options.orderType,
    q: options.q,
  });
  const total = ordersPageCount({ from: options.from, to: options.to, status: options.status, paymentStatus: options.paymentStatus, orderType: options.orderType, q: options.q });
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getOrderItems(orderId: number): Record<string, unknown>[] {
  return orderItemsForOrder(orderId);
}

export function getPayments(options: { orderId?: number; from?: string; to?: string } = {}): Record<string, unknown>[] {
  if (options.orderId != null) return paymentsForOrder(options.orderId);
  return paymentsBetween(options.from || '0000-01-01', options.to || '9999-12-31');
}

export function getRefunds(options: { orderId?: number; from?: string; to?: string } = {}): Record<string, unknown>[] {
  if (options.orderId != null) return refundsForOrder(options.orderId);
  return refundsBetween(options.from || '0000-01-01', options.to || '9999-12-31');
}
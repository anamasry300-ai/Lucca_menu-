import { execute, insert, queryAll, queryOne } from '../db.js';

export interface EmployeePerformanceRow {
  name: string;
  orders: number;
  sales: number;
  avgOrder: number;
  refunds: number;
}

export function allEmployees(): Record<string, unknown>[] {
  return queryAll('SELECT id, name, role, salary, phone, email, active, hireDate FROM employees ORDER BY name COLLATE NOCASE');
}

export function employeePerformance(from: string, to: string): Record<string, unknown>[] {
  try {
    return queryAll(
      `SELECT o.createdBy as name, COUNT(*) as orders, COALESCE(SUM(o.total), 0) as sales, COALESCE(AVG(o.total), 0) as avgOrder
       FROM orders o
       WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid'
       GROUP BY o.createdBy ORDER BY sales DESC`,
      [from, to],
    );
  } catch {
    return [];
  }
}

// إجمالي الأوامر (بما فيها قيد الإعداد) لكل موظف
export function employeeOrderCount(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT createdBy as name, COUNT(*) as totalOrders, SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled FROM orders WHERE date(date) >= ? AND date(date) <= ? GROUP BY createdBy",
    [from, to],
  );
}

export function attendanceFor(from: string, to: string): Record<string, unknown>[] {
  try {
    return queryAll(
      `SELECT a.*, e.name as employeeName FROM attendance a
       LEFT JOIN employees e ON a.employeeId = e.id
       WHERE date(a.date) >= ? AND date(a.date) <= ?
       ORDER BY a.date DESC`,
      [from, to],
    );
  } catch {
    return [];
  }
}

// ===== كتابة الحضور (Tier 2 — عبر نفس الريبو المستخدم بالتقارير) =====
export function employeeById(id: number): Record<string, unknown> | undefined {
  return queryOne('SELECT id, name, role, active FROM employees WHERE id = ?', [id]);
}

export function attendanceById(id: number): Record<string, unknown> | undefined {
  return queryOne(
    'SELECT id, employeeId, date, checkIn, checkOut, hoursWorked, lateMinutes, bonus, deduction, notes FROM attendance WHERE id = ?',
    [id],
  );
}

export function attendanceForEmployeeOn(employeeId: number, date: string): Record<string, unknown> | undefined {
  return queryOne('SELECT id, employeeId, date, checkIn, checkOut, hoursWorked FROM attendance WHERE employeeId = ? AND date = ?', [employeeId, date]);
}

export function addAttendanceRow(employeeId: number, date: string, checkIn: string): number {
  return insert(
    `INSERT INTO attendance (employeeId, date, checkIn, hoursWorked, updatedAt) VALUES (?, ?, ?, 0, datetime('now'))`,
    [employeeId, date, checkIn],
  );
}

export function setAttendanceCheckOut(id: number, checkOut: string, hoursWorked: number): void {
  execute(
    "UPDATE attendance SET checkOut = ?, hoursWorked = ?, updatedAt = datetime('now') WHERE id = ?",
    [checkOut, hoursWorked, id],
  );
}
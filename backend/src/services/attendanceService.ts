import { badRequest, conflict, notFound } from '../errors.js';
import {
  addAttendanceRow, attendanceForEmployeeOn, attendanceById, employeeById, setAttendanceCheckOut,
} from '../repositories/employeeRepo.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function localIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function checkIn(employeeId: number, opts: { date?: string; createdAt?: string } = {}): Record<string, unknown> {
  const employee = employeeById(employeeId);
  if (!employee) throw notFound('الموظف غير موجود');
  const date = opts.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('صيغة التاريخ غير صالحة');
  const existing = attendanceForEmployeeOn(employeeId, date);
  if (existing) {
    if (existing.checkOut) throw conflict('سجل الحضور مكتمل في هذا اليوم');
    throw conflict('تم تسجيل حضور بالفعل في هذا اليوم');
  }
  const checkInAt = opts.createdAt || localIso();
  const id = addAttendanceRow(employeeId, date, checkInAt);
  return attendanceById(id)!;
}

export function checkOut(employeeId: number, opts: { date?: string; createdAt?: string } = {}): Record<string, unknown> {
  const employee = employeeById(employeeId);
  if (!employee) throw notFound('الموظف غير موجود');
  const date = opts.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('صيغة التاريخ غير صالحة');
  const existing = attendanceForEmployeeOn(employeeId, date);
  if (!existing) throw notFound('لا يوجد تسجيل حضور في هذا اليوم');
  if (existing.checkOut) throw conflict('تم تسجيل الانصراف بالفعل في هذا اليوم');
  const checkOutAt = opts.createdAt || localIso();
  const checkInTime = new Date(String(existing.checkIn).replace(' ', 'T')).getTime();
  const checkOutTime = new Date(checkOutAt.replace(' ', 'T')).getTime();
  const hours = Number.isFinite(checkInTime) && Number.isFinite(checkOutTime) && checkOutTime >= checkInTime
    ? Number(((checkOutTime - checkInTime) / 3600000).toFixed(2))
    : 0;
  setAttendanceCheckOut(Number(existing.id), checkOutAt, hours);
  return attendanceById(Number(existing.id))!;
}
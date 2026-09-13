import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const dailyRotateInfo = new DailyRotateFile({
  filename: path.join(LOG_DIR, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles: '30d',
  level: 'info',
});

const dailyRotateError = new DailyRotateFile({
  filename: path.join(LOG_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles: '60d',
  level: 'error',
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} ${level}: ${message}${metaStr}`;
        }),
      ),
    }),
    dailyRotateInfo,
    dailyRotateError,
  ],
});

export default logger;

// HTTP request logger middleware (structured JSON per request)
export function httpLoggerMiddleware(req: any, _res: any, next: any) {
  const start = Date.now();
  const { method, originalUrl } = req;
  _res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('http_request', {
      method,
      url: originalUrl,
      status: _res.statusCode,
      duration,
      ip: req.ip || req.socket?.remoteAddress || '',
    });
  });
  next();
}
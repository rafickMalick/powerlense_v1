// src/utils/logger.ts
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${String(timestamp)} [${level.toUpperCase()}] ${String(message)} ${
        Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
      }`;
    }),
  ),
  transports: [new transports.Console()],
});

export default logger;

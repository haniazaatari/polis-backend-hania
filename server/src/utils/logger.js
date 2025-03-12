import winston from 'winston';
import Config from '../config.js';

// Get log level from config or use default
const logLevel = Config.logLevel || 'info';
const logToFile = Config.logToFile || false;

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Add colors to winston
winston.addColors(colors);

// Define console transport with colorization
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
  level: logLevel
});

// Define the format for file logs
const fileFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss Z'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger with appropriate transports
const logger = winston.createLogger({
  level: logLevel,
  exitOnError: false,
  format: fileFormat,
  defaultMeta: { service: 'polis-api-server' },
  transports: [consoleTransport]
});

// Add file transports if configured to log to file
if (logToFile) {
  logger.configure({
    transports: [
      new winston.transports.File({
        filename: './logs/error.log',
        level: 'error'
      }),
      new winston.transports.File({
        filename: './logs/combined.log'
      }),
      consoleTransport
    ],
    exceptionHandlers: [
      new winston.transports.File({
        filename: './logs/exceptions.log'
      })
    ],
    rejectionHandlers: [
      new winston.transports.File({
        filename: './logs/rejections.log'
      })
    ]
  });
}

export default logger;

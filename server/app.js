import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import express from 'express';
import morgan from 'morgan';
import Config from './src/config.js';
import { initializeApplication } from './src/initialization.js';
import {
  addCorsHeader,
  checkIfOptions,
  errorMiddleware,
  initializeErrorHandlers,
  logMiddlewareErrors,
  logRequestBody,
  redirectIfNotHttps,
  responseTimeStart,
  writeDefaultHead
} from './src/middlewares/index.js';
import apiRoutes from './src/routes/index.js';
import rootRoutes from './src/routes/rootRoutes.js';
import staticRoutes from './src/routes/staticRoutes.js';
import logger from './src/utils/logger.js';

const app = express();

// Initialize global error handlers
initializeErrorHandlers();

app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 'uniquelocal');

// Initialize the application (no need to wait for the return value)
initializeApplication();

app.disable('x-powered-by');
app.use(responseTimeStart);
app.use(redirectIfNotHttps);
app.use(express.cookieParser());
app.use(express.bodyParser());
app.use(writeDefaultHead);
app.use(express.compress());
app.use(logRequestBody);
app.use(logMiddlewareErrors);
app.all('/api/v3/*', addCorsHeader);
app.all('/font/*', addCorsHeader);
app.all('/api/v3/*', checkIfOptions);
app.get('/robots.txt', (_req, res) => {
  res.send('User-agent: *\n' + 'Disallow: /api/');
});

// Mount all API routes through the main router
app.use('/api/v3', apiRoutes);
// Mount all non-API routes through the root router
app.use('/', rootRoutes);
// Mount all static routes
app.use('/', staticRoutes);

// Express error handler - must be added after all routes
app.use(errorMiddleware);

app.listen(Config.serverPort);
logger.info(`started on port ${Config.serverPort}`);

export default app;

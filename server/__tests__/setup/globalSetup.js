/**
 * Global setup for Jest tests
 * This file is executed once before any test files are loaded
 */
import request from 'supertest';
import app from '../../app.js';
import { startServer } from '../../index.js';
import { createTextAgent } from './api-test-helpers.js';

export default async () => {
  console.log('Starting global test setup...');

  // Check if a server is already running and close it to avoid port conflicts
  if (global.__SERVER__) {
    try {
      await new Promise((resolve) => {
        global.__SERVER__.close(() => {
          console.log(`Closed existing test server on port ${global.__SERVER_PORT__}`);
          resolve();
        });
      });
    } catch (err) {
      console.warn('Warning: Error closing existing server:', err.message);
    }
  }

  // Start a server on a random available port (using 0)
  const server = startServer(0);

  // Get the dynamically assigned port
  const address = server.address();
  const port = address.port;

  console.log(`Test server started on port ${port}`);

  // Store the server and port in global variables for tests to use
  global.__SERVER__ = server;
  global.__SERVER_PORT__ = port;

  // Create agents that use the app instance directly
  // Only create new agents if they don't already exist
  if (!global.__TEST_AGENT__) {
    global.__TEST_AGENT__ = request.agent(app);
    console.log('Created new global test agent');
  }

  if (!global.__TEXT_AGENT__) {
    global.__TEXT_AGENT__ = createTextAgent(app);
    console.log('Created new global text agent');
  }

  // Store the API URL with the dynamic port
  global.__API_URL__ = `http://localhost:${port}`;
  global.__API_PREFIX__ = '/api/v3';

  console.log('Global test setup completed');
};

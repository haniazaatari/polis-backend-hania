import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import app from '../../app.js';

describe('Simple Supertest Tests', () => {
  test('Health check works', async () => {
    const response = await request(app).get('/api/v3/testConnection');
    expect(response.status).toBe(200);
  });

  test('Basic auth check works', async () => {
    const response = await request(app).post('/api/v3/auth/login').send({});
    expect(response.status).toBe(400);
    // Response should contain error about missing password
    expect(response.text).toContain('polis_err_param_missing_password');
  });
});

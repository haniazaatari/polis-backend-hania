import request from 'supertest';
import { API_PREFIX, API_URL } from '../setup/api-test-helpers.js';

async function testAuth() {
  try {
    // Register a test user
    const username = `test.user.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.com`;
    console.log('Registering user:', username);

    const registerResponse = await request(API_URL)
      .post(`${API_PREFIX}/auth/new`)
      .send({
        email: username,
        password: 'testpassword',
        hname: `Test User ${Date.now()}`,
        gatekeeperTosPrivacy: true
      });

    console.log('Register response status:', registerResponse.status);
    console.log('Register response body:', registerResponse.body);

    // Extract auth cookies
    const cookies = registerResponse.headers['set-cookie'];
    console.log('Cookies:', cookies);

    if (!cookies || !cookies.length) {
      console.error('No cookies received!');
      return;
    }

    // Extract token from cookies
    const tokenCookie = cookies.find((cookie) => cookie.startsWith('token2='));
    const token = tokenCookie.split(';')[0].split('=')[1];
    console.log('Token:', token);

    // Extract uid from cookies
    const uidCookie = cookies.find((cookie) => cookie.startsWith('uid2='));
    const uid = uidCookie.split(';')[0].split('=')[1];
    console.log('UID:', uid);

    // Try different cookie formats
    const cookieFormats = [
      // Format 1: Just the token cookie
      `token2=${token}`,

      // Format 2: Token and uid cookies
      `token2=${token}; uid2=${uid}`,

      // Format 3: All cookies with name=value only
      cookies
        .map((cookie) => cookie.split(';')[0])
        .join('; '),

      // Format 4: Using x-polis header instead of cookies
      null
    ];

    for (let i = 0; i < cookieFormats.length; i++) {
      const format = cookieFormats[i];
      console.log(`\nTesting cookie format ${i + 1}:`, format);

      // Try to create a conversation
      const req = request(API_URL)
        .post(`${API_PREFIX}/conversations`)
        .send({
          topic: `Test Conversation ${Date.now()}`,
          description: `Test Description ${Date.now()}`
        });

      if (format) {
        req.set('Cookie', format);
      } else {
        // Use x-polis header instead
        req.set('x-polis', token);
      }

      const conversationResponse = await req;

      console.log(`Format ${i + 1} conversation response status:`, conversationResponse.status);
      console.log(`Format ${i + 1} conversation response body:`, conversationResponse.body);

      if (conversationResponse.status === 200) {
        // If successful, try to get conversations
        const getReq = request(API_URL).get(`${API_PREFIX}/conversations`);

        if (format) {
          getReq.set('Cookie', format);
        } else {
          // Use x-polis header instead
          getReq.set('x-polis', token);
        }

        const getConversationsResponse = await getReq;

        console.log(`Format ${i + 1} get conversations response status:`, getConversationsResponse.status);
        console.log(`Format ${i + 1} get conversations response body:`, getConversationsResponse.body);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testAuth();

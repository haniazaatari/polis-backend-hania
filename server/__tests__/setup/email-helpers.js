import http from 'node:http';

// MailDev server settings
const MAILDEV_HOST = process.env.MAILDEV_HOST || 'localhost';
const MAILDEV_PORT = process.env.MAILDEV_PORT || 1080;

/**
 * Get all emails from the MailDev server
 * @returns {Promise<Array>} Array of email objects
 */
async function getEmails() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MAILDEV_HOST,
      port: MAILDEV_PORT,
      path: '/email',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const emails = JSON.parse(data);
          resolve(emails);
        } catch (e) {
          reject(new Error(`Failed to parse email response: ${e.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Failed to fetch emails: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Get a specific email by its ID
 * @param {string} id - Email ID
 * @returns {Promise<Object>} Email object
 */
async function getEmail(id) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MAILDEV_HOST,
      port: MAILDEV_PORT,
      path: `/email/${id}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const email = JSON.parse(data);
          resolve(email);
        } catch (e) {
          reject(new Error(`Failed to parse email response: ${e.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Failed to fetch email: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Delete all emails from the MailDev server
 * @returns {Promise<void>}
 */
async function deleteAllEmails() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MAILDEV_HOST,
      port: MAILDEV_PORT,
      path: '/email/all',
      method: 'DELETE'
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Failed to delete emails: status ${res.statusCode}`));
      }
    });

    req.on('error', (error) => {
      reject(new Error(`Failed to delete emails: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Find the most recent email sent to a specific recipient
 * @param {string} recipient - Email address of the recipient
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Timeout in milliseconds (default: 10000)
 * @param {number} options.interval - Polling interval in milliseconds (default: 1000)
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 10)
 * @returns {Promise<Object>} Email object
 */
async function findEmailByRecipient(recipient, options = {}) {
  const { timeout = 10000, interval = 1000, maxAttempts = 10 } = options;

  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeout && attempts < maxAttempts) {
    attempts++;

    try {
      const emails = await getEmails();
      const targetEmail = emails.find((email) =>
        email.to?.some((to) => to.address.toLowerCase() === recipient.toLowerCase())
      );

      if (targetEmail) {
        return await getEmail(targetEmail.id);
      }
    } catch (_error) {}

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`No email found for recipient ${recipient} after ${attempts} attempts`);
}

/**
 * Extract the password reset URL and token from an email
 * @param {Object} email - Email object from MailDev
 * @returns {Object|null} Object with url and token properties or null if not found
 */
function extractPasswordResetUrl(email) {
  if (email?.text) {
    let token;
    let url;

    const urlMatch = email.text.match(/(https?:\/\/[^\s]+pwreset\/([a-zA-Z0-9_-]+))/);

    if (urlMatch?.[1]) {
      url = urlMatch[1];
      token = urlMatch[2];
    }

    return { url, token };
  }

  return null;
}

/**
 * Get the password reset URL for a specific recipient
 * @param {string} recipient - Email address of the recipient
 * @param {Object} options - Additional options for email polling
 * @returns {Promise<Object>} Object with url and token properties
 */
async function getPasswordResetUrl(recipient) {
  const email = await findEmailByRecipient(recipient);
  const { url, token } = extractPasswordResetUrl(email);

  if (!url) {
    throw new Error('Password reset URL not found in email');
  }

  return { url, token };
}

export { deleteAllEmails, findEmailByRecipient, getEmail, getEmails, getPasswordResetUrl };

import http from "node:http";

const SES_LOCAL_HOST = process.env.SES_LOCAL_HOST || "localhost";
const SES_LOCAL_PORT = parseInt(process.env.SES_LOCAL_PORT || "8005", 10);

// --- Interfaces (No changes needed here) ---
interface EmailRecipient {
  address: string;
  name?: string;
}

interface EmailObject {
  id: string;
  subject: string;
  text: string;
  html?: string;
  to: EmailRecipient[];
  from: EmailRecipient;
  date: string;
  time?: Date;
  [key: string]: any;
}

interface FindEmailOptions {
  timeout?: number;
  interval?: number;
  maxAttempts?: number;
}

interface PasswordResetResult {
  url: string | null;
  token: string | null;
}

interface SesContent {
  Data: string;
  Charset: string;
}

interface SesBody {
  Text: SesContent;
  Html: SesContent;
}

interface SesMessage {
  Body: SesBody;
  Subject: SesContent;
}

interface SesDestination {
  ToAddresses: string[];
}

interface SesEmailObjectRaw {
  MessageId: string;
  Source: string;
  Destination: SesDestination;
  Timestamp: string;
  Message: SesMessage;
}

function mapSesToEmailObject(sesEmail: SesEmailObjectRaw): EmailObject {
  return {
    id: sesEmail.MessageId,
    subject: sesEmail.Message.Subject.Data,
    text: sesEmail.Message.Body.Text.Data,
    html: sesEmail.Message.Body.Html.Data,
    to: sesEmail.Destination.ToAddresses.map((address) => ({ address })),
    from: { address: sesEmail.Source },
    date: sesEmail.Timestamp,
    time: new Date(sesEmail.Timestamp),
  };
}

/**
 * Get all emails from the ses-local server
 * @returns {Promise<EmailObject[]>} Array of email objects
 */
async function getEmails(): Promise<EmailObject[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SES_LOCAL_HOST,
      port: SES_LOCAL_PORT,
      path: "/store",
      method: "GET",
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          const rawEmails = response.emails as SesEmailObjectRaw[];
          if (!Array.isArray(rawEmails)) {
            throw new Error(
              `Response from /emails is not an array. ${JSON.stringify(
                rawEmails
              )}, ${rawEmails}`
            );
          }

          resolve(rawEmails.map(mapSesToEmailObject));
        } catch (e) {
          reject(
            new Error(
              `Failed to parse email response: ${
                e instanceof Error ? e.message : String(e)
              }`
            )
          );
        }
      });
    });

    req.on("error", (error) =>
      reject(new Error(`Failed to fetch emails: ${error.message}`))
    );
    req.end();
  });
}

/**
 * Get a specific email by its ID from the ses-local server
 * @param {string} id - Email ID
 * @returns {Promise<EmailObject>} Email object
 */
async function getEmail(id: string): Promise<EmailObject> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SES_LOCAL_HOST,
      port: SES_LOCAL_PORT,
      path: `/emails/${id}`,
      method: "GET",
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const rawEmail = JSON.parse(data) as SesEmailObjectRaw;
          resolve(mapSesToEmailObject(rawEmail));
        } catch (e) {
          reject(
            new Error(
              `Failed to parse email response: ${
                e instanceof Error ? e.message : String(e)
              }`
            )
          );
        }
      });
    });

    req.on("error", (error) =>
      reject(new Error(`Failed to fetch email: ${error.message}`))
    );
    req.end();
  });
}

/**
 * Delete all emails from the ses-local server
 * @returns {Promise<void>}
 */
async function deleteAllEmails(): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SES_LOCAL_HOST,
      port: SES_LOCAL_PORT,
      path: "/emails",
      method: "DELETE",
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        resolve();
      } else {
        reject(new Error(`Failed to delete emails: status ${res.statusCode}`));
      }
    });

    req.on("error", (error) =>
      reject(new Error(`Failed to delete emails: ${error.message}`))
    );
    req.end();
  });
}

/**
 * Find the most recent email sent to a specific recipient
 * @param {string} recipient - Email address of the recipient
 * @param {FindEmailOptions} options - Additional options
 * @returns {Promise<EmailObject>} Email object
 */
async function findEmailByRecipient(
  recipient: string,
  options: FindEmailOptions = {}
): Promise<EmailObject> {
  const { timeout = 10000, interval = 1000, maxAttempts = 10 } = options;

  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeout && attempts < maxAttempts) {
    attempts++;

    try {
      const emails = await getEmails();
      const targetEmails = emails.filter((email) =>
        email.to?.some(
          (to) => to.address.toLowerCase() === recipient.toLowerCase()
        )
      );

      if (targetEmails.length > 0) {
        // Sort by date/time to get the most recent email
        const sortedEmails = targetEmails.sort((a, b) => {
          const dateA = new Date(a.date || a.time || 0).getTime();
          const dateB = new Date(b.date || b.time || 0).getTime();
          return dateB - dateA; // Most recent first
        });

        return await getEmail(sortedEmails[0].id);
      }
    } catch (error) {
      console.warn(
        `Error fetching emails (attempt ${attempts}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  throw new Error(
    `No email found for recipient ${recipient} after ${attempts} attempts`
  );
}

/**
 * Extract the password reset URL and token from an email
 * @param {EmailObject} email - Email object
 * @returns {PasswordResetResult} Object with url and token properties or null values if not found
 */
function extractPasswordResetUrl(email: EmailObject): PasswordResetResult {
  if (email?.text) {
    let token: string | null = null;
    let url: string | null = null;

    const urlMatch = email.text.match(
      /(https?:\/\/[^\s]+pwreset\/([a-zA-Z0-9_-]+))/
    );

    if (urlMatch?.[1]) {
      url = urlMatch[1];
      token = urlMatch[2];
    }

    return { url, token };
  }

  return { url: null, token: null };
}

/**
 * Get the password reset URL for a specific recipient
 * @param {string} recipient - Email address of the recipient
 * @param {FindEmailOptions} options - Options for email fetching
 * @returns {Promise<PasswordResetResult>} Object with url and token properties
 */
async function getPasswordResetUrl(
  recipient: string,
  options: FindEmailOptions = {}
): Promise<PasswordResetResult> {
  const email = await findEmailByRecipient(recipient, options);
  const result = extractPasswordResetUrl(email);

  if (!result.url) {
    throw new Error("Password reset URL not found in email");
  }

  return result;
}

export {
  deleteAllEmails,
  findEmailByRecipient,
  getEmail,
  getEmails,
  getPasswordResetUrl,
};
export type {
  EmailObject,
  EmailRecipient,
  FindEmailOptions,
  PasswordResetResult,
};

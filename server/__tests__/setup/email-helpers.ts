import http from "node:http";

const SES_LOCAL_HOST = process.env.SES_LOCAL_HOST || "localhost";
const SES_LOCAL_PORT = parseInt(process.env.SES_LOCAL_PORT || "8005", 10);

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

interface StoreBody {
  html: string;
  text: string;
}

interface StoreDestination {
  to: string[];
  cc: string[];
  bcc: string[];
}

interface StoreEmailObject {
  messageId: string;
  from: string;
  destination: StoreDestination;
  subject: string;
  body: StoreBody;
  at: number; // Unix timestamp
}

interface StoreResponse {
  emails: StoreEmailObject[];
}

/**
 * Maps the raw email format from the /store endpoint to the consistent EmailObject format.
 */
function mapStoreToEmailObject(storeEmail: StoreEmailObject): EmailObject {
  const timestamp = new Date(storeEmail.at * 1000); // Convert Unix timestamp to Date
  return {
    id: storeEmail.messageId,
    subject: storeEmail.subject,
    text: storeEmail.body.text,
    html: storeEmail.body.html,
    to: storeEmail.destination.to.map((address) => ({ address })),
    from: { address: storeEmail.from },
    date: timestamp.toISOString(),
    time: timestamp,
  };
}

/**
 * Get all emails from the /store endpoint. This is now the primary fetch function.
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
          const response = JSON.parse(data) as StoreResponse;
          const rawEmails = response.emails as StoreEmailObject[];

          if (!Array.isArray(rawEmails)) {
            resolve([]); // Resolve with empty array if no emails are present
            return;
          }
          resolve(rawEmails.map(mapStoreToEmailObject));
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
 * Get a specific email by its ID. Since there is no direct endpoint,
 * this fetches all emails and filters them in memory.
 */
async function getEmail(id: string): Promise<EmailObject> {
  const emails = await getEmails();
  const foundEmail = emails.find((email) => email.id === id);
  if (foundEmail) {
    return foundEmail;
  }
  throw new Error(`Email with id ${id} not found.`);
}

/**
 * Find the most recent email sent to a specific recipient.
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
        // Sort by date to get the most recent email and return it
        return targetEmails.sort((a, b) => {
          const dateA = new Date(a.date || 0).getTime();
          const dateB = new Date(b.date || 0).getTime();
          return dateB - dateA; // Most recent first
        })[0];
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
 * Extract the password reset URL and token from an email.
 */
function extractPasswordResetUrl(email: EmailObject): PasswordResetResult {
  if (email?.text) {
    let token: string | null = null,
      url: string | null = null;
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
 * Get the password reset URL for a specific recipient.
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

export { findEmailByRecipient, getEmail, getEmails, getPasswordResetUrl };

export type {
  EmailObject,
  EmailRecipient,
  FindEmailOptions,
  PasswordResetResult,
};

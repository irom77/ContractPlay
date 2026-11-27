export interface Mailer {
  sendMagicLink(message: { to: string; url: string }): Promise<void>;
  /** Tells a new player an admin declined their request to join. */
  sendSignupDenied(message: { to: string }): Promise<void>;
}

export class MailDeliveryError extends Error {
  constructor(readonly reason: "configuration" | "provider-rejected", readonly status?: number) {
    super("mail unavailable");
  }
}

/** No default sender: deployment must configure an address its provider can send from. */
export function configuredMailer(env: Env): Mailer {
  async function send(to: string, subject: string, text: string): Promise<void> {
    const from = env.AUTH_EMAIL_FROM;
    if (!from || /[\r\n]/.test(from)) throw new MailDeliveryError("configuration");
    const message = { from, to, subject, text };
    if (env.EMAIL) {
      await env.EMAIL.send(message);
      return;
    }
    if (env.AUTH_EMAIL_PROVIDER !== "resend" || !env.RESEND_API_KEY) throw new MailDeliveryError("configuration");
    // Fixed destination and no redirects: provider credentials never follow a supplied URL.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify(message)
    });
    // Error payloads may contain addresses; discard them without surfacing or logging them.
    await response.body?.cancel();
    if (!response.ok) throw new MailDeliveryError("provider-rejected", response.status);
  }
  return {
    sendMagicLink: ({ to, url }) => send(to, "Sign in to ContractPlay",
      `Sign in to ContractPlay:\n${url}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`),
    sendSignupDenied: ({ to }) => send(to, "Your ContractPlay request",
      "Thanks for your interest in ContractPlay. It is open to invited players for now, and your request to join was not approved.\n\nIf you did not ask to join, ignore this email.")
  };
}

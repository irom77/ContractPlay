export interface Mailer {
  sendMagicLink(message: { to: string; url: string }): Promise<void>;
}

/** No default sender: deployment must configure an address its provider can send from. */
export function configuredMailer(env: Env): Mailer {
  return {
    async sendMagicLink({ to, url }) {
      const from = env.AUTH_EMAIL_FROM;
      if (!from || /[\r\n]/.test(from)) throw new Error("mail unavailable");
      const message = { from, to, subject: "Sign in to ContractPlay", text: `Sign in to ContractPlay:\n${url}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.` };
      if (env.EMAIL) {
        await env.EMAIL.send(message);
        return;
      }
      if (env.AUTH_EMAIL_PROVIDER !== "resend" || !env.RESEND_API_KEY) throw new Error("mail unavailable");
      // Fixed destination and no redirects: provider credentials never follow a supplied URL.
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify(message)
      });
      // Error payloads may contain addresses; discard them without surfacing or logging them.
      await response.body?.cancel();
      if (!response.ok) throw new Error("mail unavailable");
    }
  };
}

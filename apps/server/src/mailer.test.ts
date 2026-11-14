import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredMailer } from "./mailer.js";

const message = { to: "reader@example.com", url: "https://app.example/api/auth/callback?token=test" };
const config = { AUTH_EMAIL_FROM: "signin@example.org", AUTH_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test-secret" } as Env;

afterEach(() => vi.unstubAllGlobals());

describe("configured mail delivery", () => {
  it("sends through Resend with the configured sender, credential and complete callback link", async () => {
    let captured: Request | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { captured = new Request(url, init); return Response.json({ id: "message" }); });
    await configuredMailer(config).sendMagicLink(message);
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect(captured?.headers.get("Authorization")).toBe("Bearer test-secret");
    expect(captured?.redirect).toBe("manual");
    expect(await captured!.json()).toEqual({ from: "signin@example.org", to: "reader@example.com", subject: "Sign in to ContractPlay", text: expect.stringContaining(message.url) });
  });

  it.each([302, 403, 500])("fails with a sanitized error on delivery status %s", async (status) => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "private recipient and credential details" }, { status }));
    await expect(configuredMailer(config).sendMagicLink(message)).rejects.toThrow(/^mail unavailable$/);
  });

  it("requires a configured sender and provider secret without making a network call", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const settings of [{}, { AUTH_EMAIL_FROM: "signin@example.org" }, { ...config, RESEND_API_KEY: undefined }, { ...config, AUTH_EMAIL_FROM: undefined }]) {
      await expect(configuredMailer(settings as Env).sendMagicLink(message)).rejects.toThrow(/^mail unavailable$/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("prefers a configured Cloudflare binding and does not retry through another provider", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const send = vi.fn(async (mail: EmailMessageBuilder) => {
      expect(mail.from).toBe("signin@example.org");
      expect(mail.to).toBe(message.to);
      expect(mail.text).toContain(message.url);
      return { messageId: "cloudflare-message" };
    });
    await configuredMailer({ ...config, EMAIL: { send } as unknown as SendEmail }).sendMagicLink(message);
    expect(send).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

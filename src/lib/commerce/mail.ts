import "server-only";
import { promises as fs } from "fs";
import path from "path";

/**
 * Delivery e-mail (فاز ۴ — پیشنهادی).
 *
 * Every purchase confirmation is ALWAYS persisted to data/outbox/*.json so
 * nothing is silently lost. When RESEND_API_KEY is set the mail is also
 * delivered via the Resend HTTP API. (SMTP can be added later behind the
 * same sendDeliveryEmail() interface.)
 */

const OUTBOX = path.join(process.cwd(), "data", "outbox");

export interface DeliveryMailInput {
  to: string;
  subject: string;
  links: { label: string; url: string }[];
}

async function persist(input: DeliveryMailInput, via: "resend" | "outbox"): Promise<void> {
  await fs.mkdir(OUTBOX, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    ...input,
    sentVia: via,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(OUTBOX, `${id}.json`), JSON.stringify(body, null, 2), "utf8");
}

function htmlBody(input: DeliveryMailInput): string {
  const rows = input.links
    .map((l) => `<p style="margin:6px 0"><a href="${l.url}">${l.label}</a></p>`)
    .join("");
  return `
    <div dir="rtl" style="font-family:Vazirmatn,Tahoma,sans-serif;line-height:1.8">
      <h2 style="color:#1b2e4b">رزی آتلیه — لینک‌های خرید شما</h2>
      <p>${input.subject}</p>
      ${rows}
      <p style="color:#777;font-size:12px">این لینک‌ها تا مدت محدود معتبر هستند؛ در صورت انقضا از پنل حساب کاربری دوباره صادر کنید.</p>
    </div>`;
}

/**
 * Send a delivery e-mail. Never throws — delivery issues are logged only,
 * purchase flow must not fail because of e-mail.
 */
export async function sendDeliveryEmail(input: DeliveryMailInput): Promise<"resend" | "outbox"> {
  let via: "resend" | "outbox" = "outbox";
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.MAIL_FROM ?? "Rosie Atelier <onboarding@resend.dev>",
          to: [input.to],
          subject: input.subject,
          html: htmlBody(input),
        }),
      });
      if (r.ok) via = "resend";
      else console.error("[mail] resend failed", r.status, await r.text());
    }
  } catch (e) {
    console.error("[mail] send error", e);
  }
  try {
    await persist(input, via);
  } catch (e) {
    console.error("[mail] outbox persist error", e);
  }
  return via;
}

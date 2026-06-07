// Shared rank-and-rent transcription callback — Telnyx TeXML
//
// Sends ONE consolidated lead email: recording attachment + transcript +
// brief AI-style summary + caller info + Call SID.
//
// Coordination: voicemail.js stashes recording + metadata in Netlify Blobs
// keyed by CallSid. This handler picks it up, sends the email, and clears
// the entry. If the Blobs entry is missing it means the call was <=8s and
// got gated — skip silently.

const { getStore, connectLambda } = require("@netlify/blobs");

const TO_EMAIL = "peter@yesai.au";
const FROM_EMAIL = "voicemail@yesai.au";
const FROM_NAME = "Lead Line";
const SHARED_PHONE_DISPLAY = "(03) 9003 0108";
const STORE_NAME = "voicemail-pending";

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deriveSummary(transcript, durationSec, callerDisplay) {
  const t = (transcript || "").trim();
  if (!t) return `${durationSec}s voicemail from ${callerDisplay}. No usable speech detected — listen to the recording.`;
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0] || t;
  const head = firstSentence.length > 220 ? firstSentence.slice(0, 217) + "…" : firstSentence;
  return `${durationSec}s voicemail from ${callerDisplay}. Opening line: "${head}"`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const params = new URLSearchParams(event.body || "");
  const data = {
    callSid: params.get("CallSid") || "",
    from: params.get("From") || "(unknown)",
    transcriptionSid: params.get("TranscriptionSid") || "",
    transcriptionText: params.get("TranscriptionText") || "",
    transcriptionStatus: params.get("TranscriptionStatus") || "",
  };

  console.log("Transcript callback:", JSON.stringify({ ...data, transcriptionText: data.transcriptionText.slice(0, 80) }));

  connectLambda(event);
  const store = getStore(STORE_NAME);
  const pending = await store.get(data.callSid, { type: "json" });

  if (!pending) {
    console.log(`No pending voicemail for ${data.callSid} — call was <=8s or already processed`);
    return { statusCode: 200, body: "OK (no pending entry — call gated or already sent)" };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("BREVO_API_KEY not set");
    return { statusCode: 200, body: "OK (no email key)" };
  }

  const callerDisplay = pending.callerDisplay || data.from.replace("+61", "0").replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");
  const calledDisplay = pending.calledDisplay || SHARED_PHONE_DISPLAY;
  const durationSec = pending.durationSec || 0;

  const transcriptOk = data.transcriptionStatus === "completed" && data.transcriptionText;
  const transcriptText = transcriptOk
    ? data.transcriptionText
    : "[Transcription unavailable — listen to the attached recording.]";

  const summary = deriveSummary(transcriptOk ? data.transcriptionText : "", durationSec, callerDisplay);

  const receivedAt = new Date(pending.receivedAt || Date.now()).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });

  const attachment = [{ content: pending.recordingBase64, name: pending.recordingFileName }];

  const subject = `New voicemail on ${SHARED_PHONE_DISPLAY} — from ${callerDisplay} (${durationSec}s)`;

  const html = `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1f2937;background:#faf7f2;padding:24px;margin:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5dfd1;">
    <tr><td style="background:linear-gradient(135deg,#14304a,#0d2237);padding:20px 24px;color:#fff;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.1em;color:#fdba74;text-transform:uppercase;font-weight:700;">New Voicemail Lead</p>
      <h1 style="margin:0;font-family:Georgia,serif;font-size:22px;color:#fff;">Shared Lead Line ${SHARED_PHONE_DISPLAY}</h1>
      <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.7);">Caller mentions suburb + what they need — that identifies which microsite.</p>
    </td></tr>

    <tr><td style="padding:20px 24px 8px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.05em;color:#6b7280;text-transform:uppercase;font-weight:700;">Call Summary</p>
      <p style="margin:0;padding:14px 18px;background:#fff7ed;border-left:3px solid #d97706;border-radius:0 6px 6px 0;font-size:15px;color:#1f2937;">${esc(summary)}</p>
    </td></tr>

    <tr><td style="padding:8px 24px 20px;">
      <p style="margin:16px 0 6px;font-size:11px;letter-spacing:0.05em;color:#6b7280;text-transform:uppercase;font-weight:700;">Call Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;width:130px;border-bottom:1px solid #f1ede3;">From</td><td style="padding:8px 0;font-weight:700;color:#14304a;font-size:17px;border-bottom:1px solid #f1ede3;"><a href="tel:${esc(pending.from)}" style="color:#14304a;text-decoration:none;">${esc(callerDisplay)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-bottom:1px solid #f1ede3;">Called</td><td style="padding:8px 0;border-bottom:1px solid #f1ede3;">${esc(calledDisplay)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-bottom:1px solid #f1ede3;">Duration</td><td style="padding:8px 0;border-bottom:1px solid #f1ede3;">${durationSec} seconds</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-bottom:1px solid #f1ede3;">Received</td><td style="padding:8px 0;border-bottom:1px solid #f1ede3;">${esc(receivedAt)} AEDT</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-bottom:1px solid #f1ede3;">Direction</td><td style="padding:8px 0;border-bottom:1px solid #f1ede3;">Inbound</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Transcript status</td><td style="padding:8px 0;">${esc(data.transcriptionStatus || "unknown")}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#faf7f2;border-radius:6px;">
        <tr><td style="padding:12px 16px;font-size:13px;color:#1f2937;">
          &#127911; Recording attached as <code style="font-size:12px;">${esc(pending.recordingFileName)}</code> — never expires.
        </td></tr>
      </table>

      <p style="margin:22px 0 0;font-size:14px;color:#6b7280;text-align:center;">
        <a href="tel:${esc(pending.from)}" style="display:inline-block;padding:10px 22px;background:#d97706;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;">Call back ${esc(callerDisplay)}</a>
      </p>

      <p style="margin:24px 0 6px;font-size:11px;letter-spacing:0.05em;color:#6b7280;text-transform:uppercase;font-weight:700;">Transcript</p>
      <blockquote style="margin:0;padding:14px 18px;border-left:3px solid #14304a;background:#faf7f2;font-size:15px;line-height:1.65;color:#1f2937;border-radius:0 6px 6px 0;white-space:pre-wrap;">${esc(transcriptText)}</blockquote>

      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #e5dfd1;padding-top:12px;">
        Call SID: ${esc(data.callSid)} &middot; Recording SID: ${esc(pending.recordingSid)}${data.transcriptionSid ? ` &middot; Transcription SID: ${esc(data.transcriptionSid)}` : ""}
      </p>
    </td></tr>
  </table>
</body></html>
`;

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: TO_EMAIL, name: "Peter" }],
        subject,
        htmlContent: html,
        tags: ["voicemail", "rank-rent-shared"],
        attachment,
      }),
    });
    const result = await resp.text();
    console.log("Brevo response:", resp.status, result);

    if (!resp.ok) return { statusCode: 200, body: `Email failed: ${resp.status}` };

    try { await store.delete(data.callSid); } catch (e) { console.warn("Blob cleanup failed:", e.message); }
    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("Email error:", err);
    return { statusCode: 200, body: `Error: ${err.message}` };
  }
};

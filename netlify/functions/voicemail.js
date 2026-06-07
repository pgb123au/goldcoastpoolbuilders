// Shared rank-and-rent voicemail webhook — Telnyx TeXML
//
// (03) 9003 0108 is shared across multiple VIC rank-and-rent sites. This
// function is brand-neutral — the email subject / body don't claim a specific
// brand because we can't tell from the call alone which site the caller saw.
// The caller's voicemail content (suburb + what they're calling about) is what
// identifies the source brand.
//
// IMPORTANT (PFRCPR 2026-05-15): Telnyx's RecordingUrl is an AWS S3 *presigned*
// URL that expires 600 seconds (10 minutes) after the call. Download the audio
// here (while the presigned URL is still valid) so it can be attached to the
// email and never expires.
//
// 2026-05-20 (PFRCPR — 1-second junk voicemails):
//   - Gate: skip everything if RecordingDuration <= 8 seconds.
//   - Coordination: stash recording + metadata in Netlify Blobs keyed by
//     CallSid; the transcribe callback sends ONE consolidated email
//     (recording attachment + transcript + summary). See voicemail-transcript.js.

const { getStore, connectLambda } = require("@netlify/blobs");

const MIN_DURATION_SEC = 8;
const STORE_NAME = "voicemail-pending";

function recordingCandidates(raw) {
  const list = [];
  try {
    const u = new URL(raw);
    if (/\.(mp3|wav)$/i.test(u.pathname)) {
      list.push(raw);
    } else {
      const mp3 = new URL(raw);
      mp3.pathname = `${mp3.pathname}.mp3`;
      const wav = new URL(raw);
      wav.pathname = `${wav.pathname}.wav`;
      list.push(mp3.toString(), wav.toString(), raw);
    }
  } catch {
    list.push(raw.endsWith(".mp3") ? raw : `${raw}.mp3`, raw);
  }
  return [...new Set(list)];
}

async function fetchRecording(raw) {
  for (const url of recordingCandidates(raw)) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0) continue;
      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      const ext = ct.includes("wav") ? "wav" : "mp3";
      return { buf, ext };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const params = new URLSearchParams(event.body || "");
  const data = {
    callSid: params.get("CallSid") || "",
    from: params.get("From") || "(unknown)",
    to: params.get("To") || "",
    direction: params.get("Direction") || "",
    callStatus: params.get("CallStatus") || "",
    recordingSid: params.get("RecordingSid") || "",
    recordingUrl: params.get("RecordingUrl") || "",
    recordingStatus: params.get("RecordingStatus") || "",
    recordingDuration: params.get("RecordingDuration") || "0",
  };

  console.log("Voicemail callback:", JSON.stringify(data));

  if (!data.recordingUrl || data.recordingStatus !== "completed") {
    console.log("Skipping — no completed recording");
    return { statusCode: 200, body: "OK (no recording)" };
  }

  const durationSec = parseInt(data.recordingDuration, 10) || 0;
  if (durationSec <= MIN_DURATION_SEC) {
    console.log(`Skipping — duration ${durationSec}s <= ${MIN_DURATION_SEC}s gate`);
    return { statusCode: 200, body: `OK (skipped, ${durationSec}s)` };
  }

  const rec = await fetchRecording(data.recordingUrl);
  if (!rec) {
    console.error("Recording download failed for", data.recordingUrl);
    return { statusCode: 200, body: "OK (recording download failed)" };
  }

  const callerDisplay = data.from
    .replace("+61", "0")
    .replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");

  const calledDisplay = data.to
    .replace("+61", "0")
    .replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const digits = callerDisplay.replace(/\D/g, "") || "unknown";
  const fileName = `voicemail-${digits}-${stamp}.${rec.ext}`;

  const pending = {
    callSid: data.callSid,
    from: data.from,
    to: data.to,
    callerDisplay,
    calledDisplay,
    durationSec,
    recordingSid: data.recordingSid,
    receivedAt: new Date().toISOString(),
    recordingBase64: rec.buf.toString("base64"),
    recordingExt: rec.ext,
    recordingFileName: fileName,
  };

  try {
    connectLambda(event);
    const store = getStore(STORE_NAME);
    await store.setJSON(data.callSid, pending, {
      metadata: { from: data.from, duration: String(durationSec) },
    });
    console.log(`Stashed pending voicemail for ${data.callSid} (${durationSec}s, ${rec.buf.length} bytes)`);
  } catch (err) {
    console.error("Blobs store failed:", err.message);
    return { statusCode: 200, body: `Error: ${err.message}` };
  }

  return { statusCode: 200, body: "OK (pending transcript)" };
};

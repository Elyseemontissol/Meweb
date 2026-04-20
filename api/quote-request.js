import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const {
    fullName,
    companyName,
    email,
    phone,
    serviceType,
    industry,
    location,
    startDate,
    frequency,
    scope,
    budget,
    timeline,
    siteAccess,
    website, // honeypot
    elapsedMs,
  } = req.body || {};

  // Honeypot spam trap
  if (website) {
    return res.status(200).json({ ok: true });
  }

  // Too fast = bot (real humans take at least a few seconds to fill out the form)
  if (typeof elapsedMs === 'number' && elapsedMs < 3000) {
    return res.status(200).json({ ok: true });
  }

  if (!fullName || !email || !serviceType || !location || !scope) {
    return res.status(400).json({ ok: false, error: 'Please complete all required fields.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  // Gibberish detection: flag strings that look like random keyboard mashing
  if (looksLikeGibberish(fullName) || looksLikeGibberish(location) || looksLikeGibberish(scope)) {
    console.log('Spam rejected (gibberish):', { fullName, location });
    return res.status(200).json({ ok: true });
  }

  try {
    const freqList = Array.isArray(frequency) ? frequency.join(', ') : (frequency || '');
    await resend.emails.send({
      from: 'Montissol Essentials <noreply@montissolessentials.com>',
      to: ['info@montissolessentials.com', 'ElyseeM@MontissolEssentials.com'],
      replyTo: email,
      subject: `[Quote Request] ${serviceType} — ${location} — ${fullName}`,
      html: `
        <h2>New Quote Request</h2>
        <table style="border-collapse:collapse; width:100%; max-width:640px; font-family:Arial,sans-serif;">
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555; width:180px;">Name</td><td style="padding:10px;">${esc(fullName)}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Company / Organization</td><td style="padding:10px;">${esc(companyName || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Email</td><td style="padding:10px;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Phone</td><td style="padding:10px;">${esc(phone || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Service Type</td><td style="padding:10px;">${esc(serviceType)}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Industry / Environment</td><td style="padding:10px;">${esc(industry || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Service Location</td><td style="padding:10px;">${esc(location)}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Desired Start Date</td><td style="padding:10px;">${esc(startDate || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Frequency</td><td style="padding:10px;">${esc(freqList || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Budget</td><td style="padding:10px;">${esc(budget || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Timeline</td><td style="padding:10px;">${esc(timeline || 'N/A')}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td style="padding:10px; font-weight:bold; color:#555;">Site Access / Requirements</td><td style="padding:10px;">${esc(siteAccess || 'N/A')}</td></tr>
          <tr><td style="padding:10px; font-weight:bold; color:#555; vertical-align:top;">Scope / Details</td><td style="padding:10px; white-space:pre-wrap;">${esc(scope)}</td></tr>
        </table>
        <hr style="margin:24px 0; border:none; border-top:1px solid #eee;">
        <p style="color:#999; font-size:12px;">Sent from the Montissol Essentials Request a Quote form.</p>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Quote request error:', error);
    const msg = error?.message || error?.statusCode || JSON.stringify(error);
    return res.status(500).json({ ok: false, error: 'Resend: ' + msg });
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Heuristic spam detection for random keyboard-mashing strings.
function looksLikeGibberish(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (s.length < 6) return false;

  // Strip spaces/punctuation for analysis
  const letters = s.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 6) return false;

  // Check 1: mixed-case chaos — ALTERnATInG or raNDoMcAsE within a single "word"
  const words = s.split(/\s+/).filter(w => /[a-zA-Z]/.test(w));
  for (const w of words) {
    if (w.length < 6) continue;
    let caseChanges = 0;
    for (let i = 1; i < w.length; i++) {
      const prev = w[i - 1];
      const cur = w[i];
      if (/[a-zA-Z]/.test(prev) && /[a-zA-Z]/.test(cur)) {
        if (prev === prev.toLowerCase() && cur === cur.toUpperCase()) caseChanges++;
        else if (prev === prev.toUpperCase() && cur === cur.toLowerCase()) caseChanges++;
      }
    }
    // If more than 1/3 of the word has case changes, it's gibberish
    if (caseChanges >= Math.max(3, Math.floor(w.length / 3))) return true;
  }

  // Check 2: very low vowel ratio (real text typically 30-45% vowels)
  const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
  const ratio = vowels / letters.length;
  if (letters.length >= 8 && (ratio < 0.15 || ratio > 0.75)) return true;

  // Check 3: 5+ consecutive consonants (e.g., "pfPuHWZL")
  if (/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{5,}/.test(letters)) return true;

  return false;
}

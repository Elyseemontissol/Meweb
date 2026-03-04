export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { name, email, phone, companyName, subject, message, hp } = req.body || {};

  // Honeypot spam trap
  if (hp) return res.status(200).json({ ok: true });

  // Basic validation
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ ok: false, error: "Missing required fields" });
  }

  // Send email using Resend (recommended) or SendGrid.
  // For now, just return ok so we can confirm wiring works.
  return res.status(200).json({ ok: true });
}
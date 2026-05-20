export default function handler(req, res) {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Stripe publishable key is not configured.' });
  }
  res.status(200).json({ publishableKey: key });
}

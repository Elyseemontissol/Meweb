import Stripe from 'stripe';
import { parseAmountToCents } from './_lib/amount.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildPaymentIntentParams({ amountCents, name, email, invoice, memo }) {
  const parts = ['Montissol Essentials'];
  if (invoice) parts.push(`Invoice ${invoice}`);
  if (memo) parts.push(memo);
  return {
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card', 'us_bank_account'],
    receipt_email: email,
    description: parts.join(' – ').slice(0, 1000),
    metadata: {
      customer_name: name || '',
      invoice: invoice || '',
      memo: (memo || '').slice(0, 500),
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const body = req.body || {};

  let amountCents;
  try {
    amountCents = parseAmountToCents(body.amount);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const email = (body.email || '').trim();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const params = buildPaymentIntentParams({
      amountCents,
      name: (body.name || '').trim(),
      email,
      invoice: (body.invoice || '').trim(),
      memo: (body.memo || '').trim(),
    });
    const intent = await stripe.paymentIntents.create(params);
    res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('stripe-intent failed:', err);
    res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
}

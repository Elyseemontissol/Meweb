const MAX_AMOUNT_CENTS = 100000 * 100; // $100,000 sanity cap

export function parseAmountToCents(input) {
  const num = typeof input === 'number' ? input : parseFloat(input);
  if (!Number.isFinite(num)) {
    throw new Error('Amount must be a valid number.');
  }
  if (num < 1) {
    throw new Error('Amount must be at least $1.00.');
  }
  const cents = Math.round(num * 100);
  if (cents > MAX_AMOUNT_CENTS) {
    throw new Error('Amount exceeds the maximum allowed.');
  }
  return cents;
}

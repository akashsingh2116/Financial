function yearsBetween(issue, maturity) {
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issue || '');
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(maturity || '');
  if (!startMatch || !endMatch) return null;

  const startYear = Number(startMatch[1]);
  const startMonth = Number(startMatch[2]);
  const startDay = Number(startMatch[3]);
  const endYear = Number(endMatch[1]);
  const endMonth = Number(endMatch[2]);
  const endDay = Number(endMatch[3]);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  if (end <= start) return null;

  const anniversary = Date.UTC(endYear, startMonth - 1, startDay);
  if (end >= anniversary) {
    const nextAnniversary = Date.UTC(endYear + 1, startMonth - 1, startDay);
    return (endYear - startYear) + (end - anniversary) / (nextAnniversary - anniversary);
  }
  const previousAnniversary = Date.UTC(endYear - 1, startMonth - 1, startDay);
  return (endYear - startYear - 1) + (end - previousAnniversary) / (anniversary - previousAnniversary);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function compoundLumpSum(principal, annualRate, years, compoundsPerYear) {
  const periodicRate = annualRate / (100 * compoundsPerYear);
  return principal * (1 + periodicRate) ** (compoundsPerYear * years);
}

function futureValueOfDeposits(installment, annualRate, periodsPerYear, years) {
  const periods = periodsPerYear * years;
  const periodicRate = annualRate / (100 * periodsPerYear);
  if (periodicRate === 0) return installment * periods;
  return installment * (((1 + periodicRate) ** periods - 1) / periodicRate) * (1 + periodicRate);
}

function recurringDeposit(monthlyAmount, annualRate, years) {
  const quarters = (years * 12) / 3;
  const quarterlyRate = annualRate / 400;
  if (quarterlyRate === 0) return monthlyAmount * years * 12;
  const growth = (1 + quarterlyRate) ** quarters;
  const quarterFraction = (1 + quarterlyRate) ** (1 / 3);
  return monthlyAmount * ((growth - 1) / (1 - 1 / quarterFraction));
}

export function calculateMaturityAmount(entry) {
  const rate = Number(entry.interest_rate);
  const principal = Number(entry.amount);
  if (entry.interest_rate === '' || entry.interest_rate == null) return null;
  if (!Number.isFinite(rate) || rate < 0) return null;
  if (!Number.isFinite(principal) || principal < 0) return null;

  const years = yearsBetween(entry.date_of_issue, entry.date_of_maturity);
  if (years == null) return null;

  const frequency = entry.premium_frequency || 'One-time';
  let maturity;
  if (frequency === 'Monthly') {
    maturity = recurringDeposit(principal, rate, years);
  } else if (frequency === 'Quarterly') {
    maturity = futureValueOfDeposits(principal, rate, 4, years);
  } else if (frequency === 'Half-yearly') {
    maturity = futureValueOfDeposits(principal, rate, 2, years);
  } else if (frequency === 'Yearly') {
    maturity = futureValueOfDeposits(principal, rate, 1, years);
  } else if (String(entry.product || '').includes('(NSC)')) {
    maturity = compoundLumpSum(principal, rate, years, 1);
  } else {
    maturity = compoundLumpSum(principal, rate, years, 4);
  }

  if (!Number.isFinite(maturity)) return null;
  return roundMoney(maturity);
}

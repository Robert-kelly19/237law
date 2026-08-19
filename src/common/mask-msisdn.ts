export function maskMsisdn(msisdn: string): string {
  if (msisdn.length <= 4) {
    return '****';
  }

  return `${'*'.repeat(Math.max(0, msisdn.length - 4))}${msisdn.slice(-4)}`;
}

export interface CodexAccountRow {
  readonly active: boolean;
  readonly account: string;
  readonly number: string;
  readonly plan: string;
  readonly fiveHourUsage: string;
  readonly weeklyUsage: string;
  readonly lastActivity: string;
  readonly selector: string;
}

const accountRowPattern =
  /^\s*(\*)?\s*(\d+)\s+(.+?)\s{2,}(\S+)\s{2,}(.+?)\s{2,}(.+?)\s{2,}(.+?)\s*$/u;
const emailPattern = /[^\s()]+@[^\s()]+/u;

export function parseCodexAuthAccountRows(output: string): CodexAccountRow[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(accountRowPattern);
    if (!match) return [];

    const [, active, number, account, plan, fiveHourUsage, weeklyUsage, lastActivity] = match;
    const email = account.match(emailPattern)?.[0];
    if (!email) return [];

    return [
      {
        active: active === "*",
        account,
        number,
        plan,
        fiveHourUsage,
        weeklyUsage,
        lastActivity,
        selector: email,
      },
    ];
  });
}

export function resolveCodexAccountSelector(
  query: string,
  accounts: ReadonlyArray<CodexAccountRow>,
) {
  const normalized = query.trim();
  if (!/^\d+$/u.test(normalized)) return normalized;
  const number = Number(normalized);
  return accounts.find((account) => Number(account.number) === number)?.selector ?? normalized;
}

// Tiny assertion harness shared by the server regression tests. Node >=23 runs .ts directly.

/** Create a checker: `check(name, cond, got?, want?)` records failures; `done(banner)` prints the
 *  summary line and exits non-zero if anything failed. */
export function createChecker() {
  let fail = 0;
  function check(name: string, cond: boolean, got?: unknown, want?: unknown): void {
    if (cond) return;
    fail++;
    const parts: unknown[] = ['FAIL:', name];
    if (got !== undefined) parts.push('| got', got);
    if (want !== undefined) parts.push('| want', want);
    console.log(...parts);
  }
  function done(banner: string): void {
    console.log(fail === 0 ? banner : `${fail} TEST(S) FAILED`);
    process.exit(fail === 0 ? 0 : 1);
  }
  return { check, done };
}

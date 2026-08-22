// Tiny check harness. No framework: these suites are plain node scripts so they
// stay runnable with nothing installed but the project's own dependencies.
let failures = 0;
let suite = '';

export function section(name) {
  suite = name;
  console.log(`\n— ${name} —`);
}

export function check(label, cond, extra = '') {
  const ok = !!cond;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
  return ok;
}

export function equal(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  return check(label, ok, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

/** Flushes before exiting: process.exit() truncates buffered stdout when piped. */
export function done() {
  const msg = failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`;
  console.log(`\n${msg}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
  void suite;
}

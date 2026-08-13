/**
 * S01 placeholder. The form is inert on purpose: wiring it before the server-side session
 * module (S02) exists would mean shipping a login that pretends to authenticate.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">DharaIntake Console</h1>
        <p className="mt-2 text-sm text-dhara-200">Staff sign-in</p>
      </header>

      <form className="flex flex-col gap-4" aria-describedby="login-status">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            disabled
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-white placeholder-white/30 disabled:opacity-60"
            placeholder="you@clinic.in"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            disabled
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-white disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled
          className="rounded-md bg-dhara-500 px-4 py-2 font-medium text-ink disabled:opacity-50"
        >
          Sign in
        </button>
      </form>

      <p id="login-status" className="text-xs text-white/50">
        Authentication lands in S02 (argon2id + server-side sessions, ADR-012).
      </p>
    </main>
  );
}

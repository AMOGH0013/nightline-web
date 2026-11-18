export default function PrivacyPage() {
  return (
    <article className="panel max-w-3xl space-y-4 p-6 sm:p-8">
      <p className="kicker">Version 2026-11-18</p>
      <h1 className="display text-5xl">Privacy notice</h1>
      <p>The email address is held by the authentication system so you can sign in. It is not shown on the manifest, the ticket verification page or public profiles.</p>
      <p>The public manifest shows a listed passenger’s name, class, carriage, role, public Instagram handle and achievements. A private profile is omitted. Ticket verification proves a code is genuine. If the profile is private or anonymised, the name and handle are withheld. Hidden passengers cannot be verified publicly. Verification codes are not published in the directory.</p>
      <p>An unverified Instagram handle does not reserve that username. Changing the handle clears any verification mark.</p>
      <p>Leaving the train anonymises the profile, clears the audit link and deletes the authentication record that holds the email. The seat allocation remains so the number is not reused.</p>
    </article>
  );
}

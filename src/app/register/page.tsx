import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { readOwned, readSettings } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function RegisterPage() {
  const session = await getSession();
  if (!session) redirect("/board");
  const existing = await readOwned(session.userId);
  if (existing) redirect("/ticket?existing=1");
  const settings = await readSettings();
  return (
    <div className="space-y-4">
      {!settings.registrationOpen && (
        <p className="panel p-4 text-sm text-amber">Registration is currently closed. An existing ticket can still be opened.</p>
      )}
      <RegisterForm termsVersion={settings.termsVersion} privacyVersion={settings.privacyVersion} />
    </div>
  );
}

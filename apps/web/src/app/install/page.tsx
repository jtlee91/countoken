import { SiteShell } from "@/components/site-shell";
import { InstallContent } from "@/features/install/install-content";
import { getAuthenticatedViewer } from "@/lib/auth/viewer";

export default async function InstallPage() {
  const viewer = await getAuthenticatedViewer();

  return (
    <SiteShell activePath="/install" viewer={viewer}>
      <InstallContent viewer={viewer} />
    </SiteShell>
  );
}

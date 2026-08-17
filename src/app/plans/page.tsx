import { auth } from "@/auth";
import { PlansClient } from "./plans-client";

export default async function PlansPage() {
  const session = await auth();
  return <PlansClient authenticated={Boolean(session?.user?.id)} />;
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AskClient } from "./ask-client";

export default async function AskPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <AskClient />;
}

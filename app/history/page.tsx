import { redirect } from "next/navigation";

export default function HistoryPage({ searchParams }: { searchParams: { openId?: string } }) {
  const openId = searchParams?.openId;
  if (openId) {
    redirect(`/candidates#candidate-${openId}`);
  }
  redirect("/candidates");
}

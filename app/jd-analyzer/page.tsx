import { redirect } from "next/navigation";

export default function JDAnalyzerPage({ searchParams }: { searchParams: { projectId?: string } }) {
  // If called with a projectId (from "Re-analyze JD" link), keep that working
  // by redirecting to the project's filters tab
  const projectId = searchParams?.projectId;
  if (projectId) {
    redirect(`/projects/${projectId}?tab=filters`);
  }
  redirect("/projects");
}

import { ProjectDetail } from '@/components/project-detail';
export const metadata = { title: 'Project overview' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetail id={id} />;
}

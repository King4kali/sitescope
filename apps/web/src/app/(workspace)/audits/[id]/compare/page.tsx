import { CompareAudits } from '@/components/compare-audits';
export const metadata = { title: 'Compare audits' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompareAudits id={id} />;
}

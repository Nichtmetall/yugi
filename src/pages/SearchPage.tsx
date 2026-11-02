import { CardSearch } from '../components/CardSearch';
import { openCard } from '../state/ui';
import { PageHeader } from './PageHeader';

export function SearchPage() {
  return (
    <>
      <PageHeader title="Suche" />
      <CardSearch onPick={(c) => openCard({ cardId: c.id })} />
    </>
  );
}

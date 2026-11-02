import type { Card } from '../types';
import { imageUrl } from '../api/ygoprodeck';
import { cardName } from '../lib/format';

interface Props {
  card: Card;
  imageId?: number;
  qty?: number;
  /** Fuer Decks: so viele Exemplare fehlen in der Sammlung. */
  missing?: number;
  caption?: string;
  onClick: () => void;
}

/** Eine Binder-Tasche: Kartenbild mit Anzahl und Namenszeile. */
export function CardTile({ card, imageId, qty, missing, caption, onClick }: Props) {
  const name = cardName(card);
  return (
    <button className="pocket" onClick={onClick} title={name}>
      <span className="pocket-sleeve">
        <img loading="lazy" decoding="async" src={imageUrl(imageId ?? card.imageIds[0], 'small')} alt={name} />
        {qty !== undefined && qty > 1 && <span className="pocket-qty">{qty}×</span>}
        {!!missing && <span className="pocket-missing">{missing} fehlt</span>}
      </span>
      <span className="pocket-name">{caption ?? name}</span>
    </button>
  );
}

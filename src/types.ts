export interface CardSet {
  code: string;
  name: string;
  rarity: string;
  rarityCode: string;
  price: number;
}

/** Auf das Noetigste reduzierte Karte aus der YGOPRODeck-Datenbank. */
export interface Card {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  race: string;
  atk?: number;
  def?: number;
  level?: number;
  attribute?: string;
  archetype?: string;
  linkval?: number;
  linkmarkers?: string[];
  scale?: number;
  typeline?: string[];
  /** Alle Artworks; der erste Eintrag ist das Standard-Artwork (= Passcode). */
  imageIds: number[];
  sets: CardSet[];
  priceCm: number;
  priceTcg: number;
  banTcg?: string;
  banOcg?: string;
  url?: string;
  nameDe?: string;
  descDe?: string;
}

/** Ein konkreter Druck einer Karte in der Sammlung. */
export interface CollectionEntry {
  key: string;
  cardId: number;
  imageId: number;
  setCode?: string;
  rarity?: string;
  qty: number;
  addedAt: number;
}

export type DeckSection = 'main' | 'extra' | 'side';

export interface Deck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  createdAt: number;
  updatedAt: number;
}

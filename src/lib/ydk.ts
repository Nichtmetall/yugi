// YDK ist das uebliche Deck-Austauschformat (EDOPro, YGOPRODeck, Master Duel Tools).

export interface YdkDeck {
  main: number[];
  extra: number[];
  side: number[];
}

export function parseYdk(text: string): YdkDeck {
  const deck: YdkDeck = { main: [], extra: [], side: [] };
  let section: keyof YdkDeck = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower === '#main') section = 'main';
    else if (lower === '#extra') section = 'extra';
    else if (lower === '!side') section = 'side';
    else if (/^\d+$/.test(line)) deck[section].push(Number(line));
  }
  return deck;
}

export function toYdk(deck: YdkDeck): string {
  return ['#created by Kartenbinder', '#main', ...deck.main, '#extra', ...deck.extra, '!side', ...deck.side, ''].join('\n');
}

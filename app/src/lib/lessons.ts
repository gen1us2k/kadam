// Split a week's markdown into clean lesson sections. The root markdown stays the source of
// truth (DRY); this only drops meta sections and strips week/day scaffolding for display.

export interface Lesson {
  title: string;
  markdown: string;
}

// Meta sections that are not lesson substance — dropped entirely.
// (No \b — JS word boundaries don't work after Cyrillic letters.)
const DROP = /^(Лексика|Задания|Чеклист выхода)/i;

export function cleanTitle(heading: string): string {
  return heading
    .replace(/^\d+\.\s*/, '') // leading "3. "
    .replace(/\s*[—–-]\s*выучить в начале недели/i, '')
    .replace(/\s*\(дн[ияей][^)]*\)/gi, '') // "(дни 1–2)"
    .replace(/\s+недели(?=\s|$)/gi, '') // "Программа недели" -> "Программа"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Internal doc links: removed pages become plain text; surviving pages get web routes.
export function cleanLinks(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*grammar-cheatsheet\.md[^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*week-\d+[^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*phrases\.md[^)]*\)/g, '[$1](/#jstep-ph-step01)') // the survival-phrases journey station
    .replace(/\[([^\]]+)\]\([^)]*(?:kyrgyz-frequency\.csv|anki\/?[^)]*)\)/g, '[$1](/vocab)');
}

export function splitLessons(body: string): Lesson[] {
  const lessons: Lesson[] = [];
  let title: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (title === null) return;
    const markdown = cleanLinks(buf.join('\n')).trim();
    if (markdown) lessons.push({ title, markdown });
    title = null;
    buf = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+)/);
    if (m) {
      flush();
      const raw = m[1].trim();
      title = DROP.test(raw) ? null : cleanTitle(raw);
      continue;
    }
    if (title !== null) buf.push(line);
  }
  flush();

  return lessons;
}

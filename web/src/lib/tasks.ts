// Extract checkable tasks from a week's markdown (source of truth stays the .md).
// Captures every "- [ ]" checklist item, plus numbered items under a "Задания" heading.

function clean(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

export function extractTasks(body: string): string[] {
  const tasks: string[] = [];
  let inZadaniya = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      inZadaniya = /задан/i.test(heading[1]);
      continue;
    }
    const check = line.match(/^\s*-\s*\[[ xX]\]\s+(.+)/);
    if (check) {
      tasks.push(clean(check[1]));
      continue;
    }
    if (inZadaniya) {
      const numbered = line.match(/^\s*\d+\.\s+(.+)/);
      if (numbered) tasks.push(clean(numbered[1]));
    }
  }
  return tasks;
}

// Единый список команд бота: и для нативного меню Telegram (setMyCommands), и для текста /start и
// /help. Один источник правды, чтобы меню и подсказка не разошлись. Чистый модуль — тестируется.

/** command — имя без ведущего слэша (Bot API: ^[a-z0-9_]{1,32}$); description ≤ 256 символов. */
export interface BotCommand {
  command: string;
  description: string;
}

// ВАЖНО: описания рендерятся в /start и /help под parse_mode HTML — держать их без <, >, & (иначе
// экран сломается). Сейчас все безопасны; при добавлении нового пункта соблюдать это правило.
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'task', description: 'Текущий урок (заново или с продолжения)' },
  { command: 'next', description: 'Следующий урок' },
  { command: 'practice', description: 'Тренировка ошибок и добавленных слов' },
  { command: 'grammar', description: 'Грамматика по темам' },
  { command: 'help', description: 'Список команд' },
  { command: 'stop', description: 'Отписаться от рассылки' },
];

/** Список команд для текста /start и /help: по строке «/cmd — описание». */
export function commandsHelp(): string {
  return BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`).join('\n');
}

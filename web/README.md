# Kyrgyz 80/20 — веб-приложение

Статический сайт учебного плана. Построен на [Astro](https://astro.build).

## Принцип

Единственный источник правды — markdown и CSV в **корне репозитория** (`../weeks`, `../grammar-cheatsheet.md`, `../phrases.md`, `../anki/kyrgyz-frequency.csv`). Приложение читает их напрямую и ничего не дублирует: правка исходника в корне обновляет сайт. Те же файлы читаются как обычные документы на GitHub.

## Команды

```bash
npm install       # один раз
npm run dev       # локальный сервер с hot-reload → http://localhost:4321
npm run build     # статическая сборка в ./dist
npm run preview   # предпросмотр собранного ./dist
```

Рекомендуемый способ для локального просмотра — `npm run dev` (или `npm run preview` после сборки). Открывать `dist/*.html` напрямую через `file://` не стоит: пути абсолютные.

## Структура

```
src/
  content.config.ts        # glob-загрузчики → читают markdown из корня репо (DRY)
  layouts/Base.astro       # оболочка: шапка, навигация, тема, футер
  pages/
    index.astro            # главная: план по неделям + быстрые ссылки
    weeks/[slug].astro     # страница недели (12 шт.) с prev/next
    grammar.astro          # рендер ../grammar-cheatsheet.md
    phrases.astro          # рендер ../phrases.md
    vocab.astro            # браузер словаря
  components/
    VocabBrowser.astro     # единственный JS-остров: поиск + фильтр по неделям
  lib/
    vocab.ts               # парсер CSV (build-time)
    remark-rewrite-links.mjs  # переписывает repo-ссылки в веб-маршруты при сборке
  styles/global.css        # ~130 строк, без CSS-фреймворка, светлая/тёмная тема
```

## Что сознательно НЕ делали (YAGNI)

Движок интервального повторения — это уже делает Anki. Аккаунтов, бэкенда и синхронизации между устройствами нет: контент статичен, состояние словаря живёт в Anki.

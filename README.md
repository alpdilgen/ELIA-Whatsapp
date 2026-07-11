# ELIA — WhatsApp Group Archive

A static site that displays the conversation history of ELIA WhatsApp groups.
Hosted on GitHub Pages — no server required. Once export files are uploaded,
the site parses them client-side, counts members and messages, and hides system
messages (joins, leaves, encryption notices).

## Folder structure

```
.
├── index.html              → Home page (all group cards)
├── group.html              → Single group page (opened with ?g=slug)
├── .nojekyll               → Prevents GitHub Pages from ignoring folders
├── css/
│   └── style.css
├── js/
│   ├── parser.js           → WhatsApp export parser
│   ├── home.js             → Home page logic
│   └── group.js            → Group page logic
└── data/
    ├── groups.json         → All groups configuration (single config file)
    ├── chats/              → Conversation export files (.txt)
    │   ├── members.txt
    │   ├── focus-pm-speakers.txt
    │   └── execs-2026.txt
    └── logos/              → Group logos (.png)
        └── <slug>.png
```

## How it works

Each group has a **slug** (e.g. `members`). The site looks for two files:

- Conversation history → `data/chats/<slug>.txt`
- Logo → `data/logos/<slug>.png`

If a file is missing the site doesn't break: cards show `—` for counts and
fall back to the emoji instead of a logo. Files are picked up automatically
on the next page load after uploading.

### Current groups and slugs

| Group | Slug → file name |
|---|---|
| ELIA Members Group (main) | `members` → `members.txt` |
| FOCUS PM 25 – Speakers | `focus-pm-speakers` → `focus-pm-speakers.txt` |
| ELIA Execs 2026 | `execs-2026` → `execs-2026.txt` |

## How to add or update conversation history (from your phone)

1. Open the group in WhatsApp → tap the group name → **Export chat**.
2. Choose **Without media** (smaller file, faster load). WhatsApp creates a `.txt` file.
3. Rename the file to match the slug (e.g. `members.txt`) and upload it to `data/chats/`.
4. Commit and push to GitHub. Done.

> Both iOS and Android export formats are supported, in English and other languages.
> System messages ("X joined", "X left", "Messages are end-to-end encrypted", etc.)
> are **not shown** in the chat view but are used to calculate member counts.

## How to add a group logo

Upload a **square PNG** named `<slug>.png` (e.g. `members.png`) to `data/logos/`.

## How to add or edit groups

Edit `data/groups.json`. Each group entry looks like this:

```json
{
  "slug": "new-group",
  "emoji": "💡",
  "name": "Displayed Group Name",
  "description": "Short description",
  "invite": "https://chat.whatsapp.com/XXXX"
}
```

The main community card (large hero card at the top) gets `"main": true`. Only
one group should have this flag.

## Updating WhatsApp invite links

Open `data/groups.json` and replace `WHATSAPP_INVITE_LINK_HERE` with the actual
invite links for each group.

## Publishing to GitHub Pages

1. Upload all files in this folder to the root of your GitHub repository.
2. In GitHub: **Settings → Pages → Source = Deploy from a branch**, branch `main`,
   folder `/ (root)`.
3. After a few minutes the site is live at
   `https://<your-username>.github.io/<repo-name>/`.
4. Add the URL to the group description on WhatsApp.

## Important note

The `.nojekyll` file in the root is required — do not delete it. Without it,
GitHub Pages' Jekyll processing can break the folder structure.

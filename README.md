# Workspace

Files (documents, spreadsheets and presentations), reminders and a calendar in one self-hosted web app. Each person has their own account, and notes can be shared with other accounts. Everything is stored in a small SQLite database on your server, so it's the same on every device you sign in from.

## Run with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000 (or `http://<server-ip>:3000` from another device). There's nothing to configure: no `.env` file is needed. The Docker build also runs `npm run build`, which bundles the editor and combines the app's code and stylesheet into compact files, so the first build takes a minute or two longer.

Your data lives in the Docker volume `notes-app_notes-data` (the name is fixed in `docker-compose.yml`, so it stays the same whatever the app's folder is called) and survives restarts, rebuilds and upgrades.

### Without Compose

```bash
docker build -t workspace .
docker run -d --name workspace -p 3000:3000 \
  -v notes-app_notes-data:/data --restart unless-stopped workspace
```

## How it's set up

- **Time zone:** dates and times are shown in the time zone of the computer or phone you're using, so there's nothing to set.
- **Accounts:** anyone who can reach the app can create an account. If you make it reachable from the internet, put it behind HTTPS (see below).
- **Starting empty:** a new install has no sample content.
- **File uploads:** files attached to documents can be up to 50 MB each.
- **Storage:** the database and uploaded files are kept in the Docker volume (`/data/app.db` and `/data/files/`).

## Accounts

- **Signing up:** open the app and choose **Sign Up**, then enter your name, a username and a password. Each person's notes, reminders, calendar and settings are private to them.
- **Account settings:** open **Settings** from your initials at the top right. In **Settings → Account** you can change your name, change your password (which signs out your other devices), sign out, or delete your account.
- **Staying signed in:** you stay signed in for 30 days on that device, until you sign out (on a shared computer, sign out when you're done). Sessions use a secure, HTTP-only cookie.
- **Usernames:** accounts sign in with a username (3–30 letters, numbers, dots, dashes or underscores; not case-sensitive) instead of an email. Accounts created before usernames existed get the part of their email before the @ (for example `alex@example.com` becomes `alex`; if two clash, a number is added). Each person's username is shown in **Settings → Account**, where they can also change it with **Change username** (it asks for their current password). After a change, they sign in with the new username; shared documents are unaffected.
- **Forgotten passwords:** there's no reset option, so keep passwords somewhere safe. Signed-in people can change theirs in **Settings → Account**.
- **Brute-force protection:** sign-in and sign-up are limited to 20 attempts per 15 minutes from one address.

## Sharing notes

- **Share a note:** open a note you own and click the **Share** button (person with a plus), or choose **Share…** from its ⋮ menu. Enter the username of someone who already has an account and pick **Can view** or **Can edit**.
- **What they see:** the note appears in their list marked with your name. View-only notes can't be edited, and their checkboxes can't be ticked.
- **Managing access:** the Share dialog lists everyone with access. Change their access or remove them at any time. Owners see "Shared with N people" on the note.
- **Leaving a shared note:** recipients can choose **Remove from my notes** to hide it, or **Make my own copy** to get a private copy.
- **Owners keep control:** only the owner can delete a note or share it further. Favourites are personal.
- **Simultaneous editing:** changes from other people appear within about 30 seconds. If two people edit the same note at the same moment, the last save wins.

## Backups

- In the app: **Settings → Download backup** saves your own notes, reminders, events and settings as JSON, and **Restore from backup** loads them back into your account.
- **Settings → Your data → Download everything** gives a zip with all your files, including uploads; the server also keeps daily backups (see *Backups and restore*). To copy the whole Docker volume: `docker run --rm -v notes-app_notes-data:/data -v "$PWD":/backup alpine tar czf /backup/workspace-data.tgz -C /data .`

## Using it on other devices

Any browser on your network can open `http://<server-ip>:3000`. Open tabs pick up changes from other devices every 30 seconds and whenever you return to the tab.

To use it outside your home network, put it behind a reverse proxy with HTTPS (Caddy, Traefik, Nginx Proxy Manager, or a Cloudflare Tunnel). Don't expose it over plain HTTP, because passwords would travel unencrypted. Remember that anyone who can reach it can create an account, so share the address only with people you trust.

## Layout

- **Side menu:** a flat sidebar on the left with labelled links to **Documents**, **Reminders** and **Calendar** (the current page is highlighted). The **⋮** button at its top right hides it completely so pages use the full window; a small **⋮** button at the top left brings it back. Your choice is remembered on each device. On phones the menu opens as a drawer over a dimmed page (tap outside it to close).
- **Colours:** a calm light theme (soft blue-white background, white surfaces, Google-style blue) and a warm dark theme (charcoal rather than black, warm off-white text) with white accents (white buttons with dark text, white highlights and focus outlines). Choose in **Settings → Appearance → Theme**.
- **Theme:** change between Device, Light and Dark in **Settings → Appearance**. Dark mode is black and grey, with white buttons and no blue.
- **Settings and signing out:** click your initials at the top right.

## Documents

- **The Documents page** lists all your documents, with search, a favourites filter and sorting.
- **Preview:** click a document once to see a preview card. It appears above or below the document, never covers it, and always fits on screen; longer previews scroll inside the card. On phones and tablets, tap it. The card's header has **Rename** (edit the title in place; Enter saves, Esc cancels), **Move to folder**, **Favourite** (owners), **Pin** and **Duplicate** ("Make my own copy" for shared documents); its bottom row has **Open**, **Edit**, **Share** (owners), **Window**, and **Delete** (or **Remove** for documents shared with you, which takes them off your list only).
- **Pinning:** pinned documents stay at the top of your list, whatever the sort order, marked with a pin. Pins are personal and sync across your devices; pinning a shared document doesn't affect anyone else's list.
- **Open:** double-click a document (or press Enter on it) to open it as a full page. Its title is a text box in the top bar (rename it any time, reading or editing; Enter saves, Esc undoes). **Details** beside it sets the description, icon, colour and tag; changes apply when you press **Save** (Cancel, Esc or clicking outside discards them). The top bar has, left to right: Version history, Comments, Full screen, Contents (when there are headings), Edit (or Done) and ⋮ (Share, Window, Favourite, Pin, reminders, templates, page setup, print and downloads, Duplicate, Delete). When you scroll down, the document's name appears beside **← Documents**. The sidebar and search bar are hidden so the document has the whole window. Press Esc or **Documents** at the top left to go back. The four-corners button also hides the browser's own toolbars.
- **Window menu** (the **Window** button in the preview card, **Window…** in the ⋮ menu, and the pane icon on each floating window's title bar): one place for every window option. **Open as** (full page, floating window or new browser window), **Open in** (this app or new browser windows) and **Layout**:
  - **Open as:** Full page, Floating window or New browser window (the current one is ticked).
  - **Open in:** *This app* (floating windows inside the browser window) or *New browser windows* (separate windows across your screen). Your choice is remembered.
  - **Layout:** Left half, Right half, Top half or Bottom half. Opens the document there, or moves it if it's already open.
  - **Layout** (several windows): Side by side, One left with two stacked on the right, or Grid of four. Uses the windows that are already open, with this document first.
  - Dragging or resizing a snapped window by hand frees it again. **Close all floating windows** clears the screen.
  - Inside a browser window opened this way, the button moves or resizes that window. On phones it simply opens a floating window.
- **Floating windows** can be dragged and resized, and stay open while you use Reminders or Calendar.
- **New browser window:** opens the document in its own browser window (the stacked-windows button on an open document, **Pop out** in the preview card, or **Pop out into its own window** in the ⋮ menu). It stays open when the main window is minimized and can be moved anywhere on your desktop or onto another screen. Edits sync instantly between the pop-out and the main window. The arrow button shows the document in the main window. Pop-outs aren't always on top, so another app you click comes in front. The next pop-out opens where you last left one. If nothing happens, allow pop-ups for the app's address in your browser. Not shown on phones.

## Writing documents

Click **Edit**. Documents are formatted as you type, the same way they look when reading.

- **Toolbar:** Undo, Redo, Text, H1 (heading), H2 (subheading), Font, Size, bulleted list, numbered list, checklist, callout, bold, italic, underline (Cmd+U), strikethrough (Cmd+Shift+X), superscript, subscript, text colour, highlighter, table, table of contents, divider, draw and attach (paperclip).
- **Fonts and sizes:** select text, then choose **Aa** (Default, Serif, Mono or Handwriting) or the size button (Small, Normal, Large, Extra large, Huge).
- **Highlighter:** select text and pick yellow, green, blue, pink or orange; **No highlight** removes it, including from part of a highlighted phrase. Colours adapt to dark mode.
- **Tables:** the table button inserts a table with a header row. **Tab** moves to the next cell (and adds a row at the end), **Shift+Tab** goes back, **Enter** moves down. While the cursor is in a table, a bar above it adds or deletes rows and columns, or deletes the table.
- **Table of contents:** the contents button inserts a list of the document's headings that stays up to date; clicking an entry jumps to that heading. Open documents with headings also have a **Contents** button in the top bar.
- **Align and indent:** the align button sets left, centre, right or justified for the paragraph(s) you're in. The indent buttons (or **Tab** / **Shift+Tab**) move paragraphs and list items in or out, up to four levels.
- **Line and paragraph spacing:** the spacing button sets line spacing (Single, 1.15, 1.5, Double) and the space after each paragraph (None, Small, Medium, Large) for the selected paragraphs.
- **Links:** select text and click the link button (or press **Cmd+K**). Enter a web or email address, or choose **Document** to link to another of your documents. While editing, click a link to **Open**, **Edit** or **Remove** it.
- **Drawing:** the pen button opens a drawing pad with eight colours, four thicknesses, an eraser, undo/redo and clear, and inserts the drawing as an image. Click any uploaded image while editing and choose **Draw** to draw on it (the eraser only removes your ink, not the photo).
- **Undo and redo:** reverse typing or the last formatting or image change. Typing is grouped into steps after a short pause or a new line. Shortcuts: **Cmd+Z** to undo, **Cmd+Shift+Z** to redo (Ctrl on Windows).
- **Find and replace:** while editing, press **Cmd+F** (or the magnifier in the toolbar). Enter / Shift+Enter move between matches; **Replace** and **Replace all** (undoable); **Aa** matches case.
- **Word count:** shown in the toolbar while editing ("x of y words" when text is selected) and in the document's details line with a reading time.
- **@mentions:** type **@** in a document or a comment to pick someone who can open it. They get a notification in the bell (once per new mention).
- **Slash commands:** type **/** at the start of a line or after a space for a menu of everything you can insert: text, headings, lists, checklist, callout, code block, table, table of contents, divider, drawing (pen), shapes, image or file, and link. Keep typing to filter, use the arrow keys, and press Enter (or Esc to close and keep the "/").
- **Code blocks:** **Insert → Code block**, **/code**, or type ``` then a space. Inside, Enter adds a line, Tab indents, and Enter on an empty last line leaves the block. The language is detected automatically (JavaScript, TypeScript, Python, HTML, CSS, JSON, SQL, Shell, Java, C/C++, Go, Rust, Swift, PHP, Ruby) and shown in the block's corner; pick a different one from that menu, or **Plain text** for no colours. Code is coloured like a code editor (keywords, strings, numbers, comments, functions, built-ins, types, properties, operators, HTML tags and attributes, CSS properties, JSON keys) in the editor, reading view, page view and print. The corner also has **Copy** and **Delete** (Undo brings a deleted block back).
- **Typing shortcuts** at the start of a line, followed by a space: `#` heading, `###` subheading, `-` bullet, `1.` numbered list, `[]` checklist, `>` callout.
- **Shift+Enter** in a bullet adds a grey detail line under it.
- **Attaching files:** use the paperclip, paste, or drag files into the document. Images appear inline; other files appear as a chip that downloads when clicked. Everyone who can open the document can open its files.
- **Resizing and cropping images:** while editing, click an image. Choose 25%, 50%, 75% or Full width, or drag the blue corner handle to any size. **Crop** opens a crop box you can drag and resize, with Free, Square, 4:3, 3:2 and 16:9 shapes; the cropped copy replaces the image and the original stays in Settings → Files. **Remove** (or Delete) takes the image out of the document.
- **Description, icon, colour and tag** sit in the collapsible section under the title.

## Live co-editing

- When several people open the same document, everyone's changes appear as they type, merged character by character, like Google Docs. Two people can type in the same sentence at once.
- While editing, each person's cursor and selection show in their own colour with their name, and their initials appear in the toolbar. The toolbar shows **Live** when connected, or **Reconnecting…** if the connection drops (changes catch up automatically).
- People who are just reading also see changes appear live.
- The editor is built on Tiptap/ProseMirror with Yjs. The live document is kept on the server (in the database) and its text is saved continuously, so reading, search, previews, version history, comments and backups all keep working. Changes made outside the editor (ticking a checkbox while reading, restoring a version) appear in open editors immediately.
- If you put the app behind a reverse proxy for HTTPS, make sure it passes WebSocket connections to `/collab` (Caddy and Nginx Proxy Manager do this by default; for plain Nginx add the `Upgrade`/`Connection` headers).

## The editing toolbar

Shortcut hints in tooltips and menus show **Ctrl** on Windows and Linux and **Cmd** on Mac, to suit the computer you're using.


Left to right: Undo, Redo, Find · **Normal text ▾** (Normal text, Heading 1, Heading 2) · Font · **− 12 +** · Bold, Italic, Underline, Text colour, Highlight, **More ▾** (Strikethrough, Superscript, Subscript, Clear formatting) · Link, Comment, **Insert ▾** · Align, Line spacing, Checklist, Bulleted list, Numbered list, Decrease / Increase indent · word count and Live status.

**Insert ▾** has everything else, in sections: *Media* (image or file, pen drawing, shapes), *Blocks* (table, chart, code block, callout, equation, inline equation), *Smart* (dropdown, signature, embedded app) and *Layout* (divider, page break, table of contents). Slash commands (type **/**) still work for all of them.

The open document's **⋮** menu is grouped: Share and Window · Favourite, Pin, Move to folder, Remind me · Page setup, Print, Download ▸ (PDF, Word, Markdown) · Save as template, Duplicate · Delete.

## Share links (no account needed)

- In **Share**, set **General access** to **Anyone with the link**, choose **Can view** or **Can edit**, and **Copy link**. The link looks like `http://your-server:3000/s/…` and contains a long random code.
- People who open it enter their name (remembered on their device) and go straight to the document: no sign-in, and no access to anything else in the app. With **Can edit** they get the full editor and live co-editing; everyone with the link can comment, print and download. They can't rename, share, delete, see version history or open other documents.
- Guests' names appear on their edits ("Jordan (guest)" in version history), comments ("Guest") and live cursors. They aren't listed under People with access or in @mentions.
- **Link settings:** an optional **expiry date** (the link stops working at the end of that day), an optional **password**, and **Reset link** (makes a new address; the old one stops working).
- Setting access back to **Restricted**, resetting the link, changing or removing its password, or the link expiring cuts off everyone using it straight away, including anyone editing at that moment. Their earlier comments and edits stay.
- Anyone the link is forwarded to can use it, so share it carefully, and use a password for anything sensitive. People can only open it if they can reach your server (your Wi-Fi at home, or HTTPS from outside; see below).

## Presentations

Presentations look and work like Google Slides.

- **New Presentation** (Documents page) makes a presentation file; **Insert → Presentation** (or **/presentation**) adds one inside any document.
- **Layout:** a menu bar (**File, Edit, View, Insert, Format, Slide, Arrange, Tools**), one toolbar that changes with what's selected (text, shapes, images, or slide options when nothing is selected), the slide filmstrip on the left, speaker notes below, and a side panel for **Format options** and **Themes**. **Slideshow** (with ▾ for *from beginning*, *from current slide* and *presenter view*) is at the top right.
- **Objects:** 8 resize handles and a rotation handle. **Shift** keeps proportions (and rotates in 15° steps, or moves in straight lines); **Alt/Option** resizes from the centre; **Alt-drag** duplicates; **Cmd/Ctrl** while dragging ignores the smart guides. Smart guides show alignment with the slide and other objects, and equal spacing. **Arrange:** order (front, forward, backward, back), align, distribute, centre on page, rotate 90°, flip, **group / ungroup** (click selects a group; double-click goes inside it). **Tab** moves between objects. Lock an object's position in Format options.
- **Drawing:** pick the Text box, a Shape or Line tool, then click or drag on the slide.
- **Text:** click a selected box (or press Enter) to type. Fonts, size (− / +), bold, italic, underline, **strikethrough**, **superscript/subscript**, text and **highlight** colours, **links** (to a web page, email or another slide), alignment (incl. justify and top/middle/bottom), **line and paragraph spacing**, **bullet and numbering styles**, list levels (**Tab / Shift+Tab**), clear formatting, **Paint format** (double-click to keep it on).
- **Format options:** size and rotation (in inches, with aspect-ratio lock and flips), position, **text fitting** (do not autofit / shrink text on overflow / resize shape to fit text), padding, spacing.
- **View:** zoom (Fit, 50–200%, Cmd+Alt+= / −), ruler, **snap to grid / guides**, show grid, speaker notes, and **grid view** of all slides (Cmd+Alt+1).
- **Slides:** new slide with a layout (Cmd+M), duplicate, delete, move; **select several slides** in the filmstrip or grid view (Shift / Cmd-click) to move, copy, duplicate or delete them together; drag to reorder.
- **Shapes:** about 50 in Google's groups: shapes (stars, hearts, clouds, cylinders, polygons…), arrows, callouts, flowchart symbols and equation shapes. Borders can be solid, dashed or dotted; any shape can have a drop shadow.
- **Lines:** straight lines, arrows, **elbow and curved connectors**. Drawn ends snap to the middle of a shape's sides and stay attached when the shape moves. Line colour, weight, dash, start and end (arrow, triangle, oval, diamond) and type are on the toolbar; drag either end to move it.
- **Tables:** Insert → Table (pick the size). Double-click a cell to type; **Tab / Shift+Tab** moves between cells (Tab in the last cell adds a row). Click and Shift-click to select cells, then **Table ▾**: insert/delete rows and columns, **merge / unmerge**, distribute rows/columns, header row. Cell fill, border colour and weight on the toolbar.
- **Images:** **double-click to crop** (drag the black handles; Enter or Escape when done), **mask** to a shape, **Reset image**, Replace image. Format options → Adjustments: transparency, brightness, contrast, recolour (greyscale, sepia, light, dark, negative), **alt text**, drop shadow.
- **Video:** Insert → Video with a YouTube link (and an optional start time); it plays during the slideshow (it needs an internet connection).
- **Word art:** stretched, coloured text with an outline (fill, outline colour and weight, font, bold, italic; double-click to change the text).
- **Colours:** every colour button opens a picker with the theme's colours, a standard palette, *Custom* and (for fills and borders) *Transparent*.
- **Slide design:** **Slide → Change background** (colour, gradient or image; for this slide or all slides), **Slide → Apply layout** (the slide's title and text move into the new layout), **Insert → Slide numbers** (optionally skipping title slides). **Themes** panel → *Customise*: background, text, accent and secondary colours and title/body fonts for the whole presentation. **Edit theme** opens the **theme builder**: the *master* holds objects shown on every slide (a logo, a footer), and each layout can be rearranged; new slides use the edited layouts.
- **Find and replace** across all slides and speaker notes (Cmd+F or Cmd+Shift+H). **Tools → Keyboard shortcuts** (Cmd+/) lists every shortcut.
- **Themes** panel with previews; **File → Page setup** for 16:9 or 4:3.
- **Motion** (View → Motion, the **Transition** button, or **Animate** with an object selected): **slide transitions** (dissolve, fade, slide from right/left, flip, cube, gallery) with a speed, for the slide or **all slides**; **object animations** (appear, fade in/out, fly in/out from any side, zoom in/out, spin, disappear) that start **on click, with previous or after previous**, with a duration. Reorder or delete them, and **Play** to preview. Slides with motion show ✦ in the filmstrip.
- **Skip slide** (Slide menu): it stays in the presentation but isn't shown in the slideshow (dimmed in the filmstrip).
- **Present:** full screen. Click, Space or → steps through the slide's animations, then moves on with its transition; ← goes back (previous slides appear fully built). **L** laser pointer, **B** / **.** black screen, **W** / **,** white screen, type a slide number and **Enter** to jump, **S** presenter view, **F** full screen, **Esc** exit. The **⋮** menu on the slideshow bar has **auto-play** (every 2 seconds to every minute), **loop**, laser, black/white screen and full screen. Presenter view (second window) shows the current and next slide (or the next animation), speaker notes and a timer. Links on slides work while presenting.
- **Import slides from another presentation** (File menu): pick the presentation and the slides; *Keep original theme* keeps their background and text colours.
- **Charts from a spreadsheet** (Insert menu): pick one of your spreadsheets, the sheet and the range. The chart stays linked: when the spreadsheet's data changes an **Update** button appears on it (toolbar: Update, Unlink, Open source).
- **Download this slide as PNG, JPEG or SVG**, or all the text as **.txt** (File menu). YouTube thumbnails show as a dark box in pictures.
- **Files:** **File → Import slides from PowerPoint (.pptx)** and **Download as PowerPoint**, keeping rotation, flips, text fitting, padding, spacing, list levels and styles, strikethrough, super/subscript, highlight, fonts and links (PowerPoint groups come in as groups), all the shapes, lines with arrowheads and dashes, tables (with merged cells and fills), YouTube videos, Word art, cropped and transparent images, image and colour backgrounds, the master and slide numbers. A few things stay app-only: connectors become free lines in PowerPoint, gradient backgrounds become their first colour, and image brightness/contrast/recolour and non-oval masks aren't written to the file (you're told when this happens); **Download as PDF / print** (one slide per page, optionally with speaker notes).
- People editing the same presentation see each other's changes live; edits to different slides or objects don't overwrite each other.

**How co-editing stays safe.** Inside the shared document, each spreadsheet and presentation is stored as many small entries (one per cell, slide object, sheet and slide), not as one value. Two people changing different cells or objects at the same moment change different entries, which merge automatically; changes to the *same* cell or object keep the later one. The server prepares these entries when a document is opened live and writes the merged result back to the saved document (so reading view, search, exports and backups always see it). After updating the app, reload open tabs (Cmd + Shift + R); a tab still running the previous version keeps working, and its changes are folded in.

## Security

- **In the browser:** a Content Security Policy lets pages run only the app's own scripts (no inline code), load frames only from YouTube's privacy-enhanced domain, and never be framed by other sites; plus `nosniff`, a limited referrer, `X-Frame-Options`, and HSTS when served over HTTPS. Uploaded files are shown inline only if they're ordinary pictures (PNG, JPEG, GIF, WebP, AVIF); everything else downloads under a sandboxing policy.
- **Accounts:** passwords are hashed with scrypt; session tokens are 32 random bytes, kept in cookies scripts can't read and that aren't sent with requests from other sites; changes need a header other sites can't add. Sign-in attempts are limited per address (`AUTH_ATTEMPTS_PER_15_MIN`, default 20), and sign-in timing doesn't reveal which usernames exist. Changing your password signs out your other devices.
- **Sharing:** when you remove someone, reduce them to viewing, turn off a link or delete a document, open live editors are checked again at once: people who lost access are disconnected and can't reconnect; people who can now only view become read-only.
- **Files from people:** Excel, PowerPoint and backup zips are unpacked under limits (a "zip bomb" is refused as soon as it gets too big), and XML entity tricks aren't expanded. Documents can hold up to 30 million characters; requests are limited to 40 MB for documents and restores, 2 MB otherwise.
- **Checked automatically:** `tests/e2e/security.spec.mjs` tries hostile content everywhere people can type, another person reaching your documents, files, exports and live sessions, forged requests, and a malformed live-connection request; every browser test also fails on any Content Security Policy violation.
- **Known and accepted (reviewed November 2026):** the editor framework (Tiptap 2) has a moderate advisory that needs attacker-chosen attribute names, which this app's editor never accepts; upgrading means moving to Tiptap 3, a larger change worth planning. The PowerPoint library lists an old `image-size` it never runs. An editor already open on another device keeps its live connection after a password change until it reloads. Run `npm audit --omit=dev` after updates.

## Phones and tablets

The app works by touch. On phones (up to 640px wide) the top bar keeps the essentials (back, title, comments, Done and ⋮; Details and Version history are in the ⋮ menu), toolbars scroll sideways with a swipe, and presentations show the slide full width with the filmstrip as a strip underneath; Format options, Motion and Themes open as a sheet from the bottom, and dialogs use the whole width. Touch targets are larger on touch screens. Tablets keep the desktop layout.

- **Presentations:** tap to select; drag with a finger to move, resize or rotate; double-tap a table cell or text to type.
- **Spreadsheets:** tap to select; swipe to scroll; double-tap a cell (or tap the formula bar) to type with the on-screen keyboard.
- **Documents:** tap and type as usual.

## Accessibility

- **Keyboard:** everything works without a mouse. Menus open with Enter or Space and take arrow keys, Home/End and the first letter of an item; Escape closes them and puts you back where you were. Dialogs keep focus inside until closed. In presentations, Tab selects each object on the slide, arrows move it, Enter edits its text, and after choosing a text box, shape or line, **Enter places it in the middle of the slide** (no dragging needed); the colour and shape pickers take arrow keys and Escape.
- **Screen readers:** the spreadsheet announces the active cell, its value and formula, and what's selected; the presentation editor announces the slide, the selected object (with its size) and an armed tool. Toolbars, ribbon tabs, the filmstrip and sheet tabs use proper roles and names.
- **Reduce motion:** with the system's "reduce motion" setting on, slideshows change slides without transitions, object animations finish at once, and animations elsewhere are skipped.
- **Checked automatically:** `tests/e2e/a11y.spec.mjs` runs axe-core (WCAG 2.1 A/AA) on the main screens (including every spreadsheet ribbon tab) and fails on serious or critical problems, plus keyboard-only and screen-reader checks.

## Embedding files from the app

**Insert → Existing file** (in documents, also in the Insert menu's Blocks list and the `/` commands; in presentations, under Insert) puts an existing document, spreadsheet or presentation into a document or onto a slide. You choose each time:

- **Link or copy.** A **link** always shows the latest version of the file (read-only, with Refresh and Open; it checks for changes every few seconds while visible). **Make a copy here** (on the link in a document; right-click it on a slide) turns a link into an editable copy of what it shows now. A **copy** becomes part of the file you're editing and won't change: a document becomes its text, a spreadsheet becomes an embedded spreadsheet (in documents) or a table (on slides), a presentation becomes an embedded presentation (in documents) or its slides are added to yours.
- **Whole file or a part.** For spreadsheets, a sheet and range (e.g. `Q1!A1:D20`, shown as values with their formatting); for presentations, one slide.
- **Privacy.** A linked file is only shown to people who can open it; everyone else sees "You don't have access", and its contents are never sent to them. Sharing a document doesn't share the files linked in it.
- **On slides,** a linked file is an object you can move and resize; in the slideshow, clicking it opens the file in a new tab.
- **Exports** (Word, PDF, print, Markdown, PowerPoint) include each linked file as a snapshot of how it looks at that moment (or a "not available" line for files the person exporting can't open). Previews never nest: inside an embedded document, further linked files appear as plain mentions, and a document can't embed itself.

## Performance

Spreadsheets calculate the way Excel does: formulas in dependency order, and after an edit only the cells that depend on what changed are recalculated (anything unusual, such as spill formulas, volatile functions like `NOW()` or `RAND()`, `INDIRECT`/`OFFSET` or structural changes, falls back to a full recalculation). Copies of a workbook share unchanged cells instead of copying them, and only the cells on screen are formatted for display.

Typical timings on an ordinary laptop, for a ledger with row totals, a running balance, `VLOOKUP`s and `SUMIF` summaries: 5,000 rows (15,000 formulas) open in about 2 seconds, an edit shows its effect on the totals in about 0.4 seconds, and jumping anywhere is instant; 20,000 rows (60,000 formulas) take about 0.6–0.8 seconds per edit. A document (including its spreadsheets and presentations) can hold up to 30 million characters, enough for a densely filled 100,000-row sheet.

`node tests/perf/bench.mjs` measures the calculation engine; the browser test `tests/e2e/perf.spec.mjs` measures opening, editing and jumping in a 5,000-row ledger.

## Backups and restore

**Automatic backups.** Every day at 3 am (server time) the app saves a checked copy of its database and every uploaded file to `/data/backups/<date-time>/` inside the data volume, and keeps the newest 14. It also makes one at start-up if the newest is more than a day old. Each backup is verified with SQLite's integrity check before it counts. Unchanged files are hard-linked, so extra backups take almost no space. Settings in `docker-compose.yml`: `BACKUP_KEEP` (how many; `0` turns them off), `BACKUP_HOUR`, and `BACKUP_DIR` (put backups somewhere else, such as another disk or a network share mounted into the container).

**Keep a copy off this machine.** Backups inside the volume protect against mistakes, bad updates and damaged files, not against losing the disk. Copy them elsewhere regularly, for example:
`docker run --rm -v notes-app_notes-data:/data -v "$PWD":/out busybox tar czf /out/notes-backups.tgz -C /data backups`
(`docker volume ls` lists your volumes), or set `BACKUP_DIR` to a mounted network share.

**Restore a backup** (the app must be stopped; your current data is moved aside to `/data/before-restore-<date-time>/` first, so a restore can be undone):

```
docker compose stop workspace
docker compose run --rm workspace node scripts/restore.mjs list
docker compose run --rm workspace node scripts/restore.mjs latest     # or a name from the list
docker compose start workspace
```

**Your own copy of your work.** *Settings → Your data → Download everything* gives a zip with a restorable backup of everything you own, **including your uploaded files**, plus readable copies: documents as Markdown (with embedded spreadsheets as tables), spreadsheets as Excel and presentations as PowerPoint, in your folders. *Restore from a backup* accepts that zip (or an older .json backup); it also works on a different server or account.

**Health.** `/api/health` reports whether the database and file storage work, and when the last backup was made; Docker uses it to mark the container unhealthy.

## Tests

`npm test` runs the whole suite: fast engine tests, then browser tests that start the app on a spare port with a throwaway database (your data is never touched).

- **One-time setup** (for the browser tests): `npm install`, then `npx playwright install chromium`.
- `npm run test:unit` runs only the engine tests (formulas and number formats, spreadsheet tools, the presentation model, co-editing merges, and the Excel/PowerPoint conversions). They take seconds and need no browser.
- `npm run test:e2e` runs only the browser tests (documents, spreadsheets, presentations, and several people editing at once). `npx playwright test -g "PivotTables"` runs the tests whose name matches; `TEST_WORKERS=1` runs them one at a time.
- Run the tests before every update you deploy; a failing test names the step that broke.

## Spreadsheets

**Toolbar.** Spreadsheets use one toolbar row, styled like the document toolbar: undo/redo, format painter, number format, font and size, bold/italic/underline/strikethrough, text and fill colour, borders, an **Align** drop-down (horizontal and vertical alignment, indent, wrap, text direction), merge and AutoSum. Everything else sits in drop-down cards: **Format** (clipboard, number buttons, cell styles, conditional formatting, insert/delete, Format Cells), **Insert**, **Formulas**, **Data** (including sheet protection and notes), **View** and **File** (including page setup and printing); **Table**, **Chart** and **PivotTable** appear when one is selected. A card closes when you pick a command, click elsewhere or press Escape. In narrower windows the drop-downs show icons, and the format painter, strikethrough and AutoSum move to their cards (their shortcuts still work). Spreadsheet and presentation files fill the window below the top bar.

Spreadsheets look and behave like Excel.

- **New Spreadsheet** (Documents page) makes a spreadsheet file that opens straight into the grid. **Insert → Spreadsheet** (or **/spreadsheet**) adds one inside any document.
- **The grid:** up to 100,000 rows and 702 columns (A–ZZ) per sheet; only what's on screen is drawn, so big sheets scroll smoothly. Excel's default sizes and look: gridlines, highlighted headings, a green selection with the fill handle, text that spills into empty neighbouring cells, and `####` when a number doesn't fit (columns you haven't resized widen themselves, as in Excel).
- **Ribbon:** **File** (import, export), **Home** (clipboard and Format Painter, font, alignment, number, conditional formatting, insert/delete/format cells, AutoSum, fill, clear, sort & filter, find & select), **Insert** (function), **Formulas** (Insert Function, AutoSum, the function library by category, Show Formulas, Calculate Now), **Data** (sort, filter), **View** (freeze panes, gridlines, headings, formula bar, zoom). The arrow at the right collapses it.
- **Typing (as in Excel):** start typing to enter a value ("Enter" mode: arrow keys finish the entry and move); press **F2** or double-click to edit inside the cell ("Edit" mode: arrow keys move the cursor). While writing a formula, arrow keys or clicks pick cells ("Point" mode). **Enter** moves down (within the selection if several cells are selected); after **Tab**s, Enter returns to the column you started in. **Ctrl+Enter** puts the entry in every selected cell; **Alt+Enter** adds a line break; Excel-style **AutoComplete** suggests text already in the column. `$1,200`, `50%`, dates and `1,000` are recognised.
- **Selecting:** click, drag, Shift-click; **Ctrl/Cmd-click** adds separate ranges; click column letters or row numbers (drag or Shift-click for several). Type a cell, range or `Sheet!A1` in the **Name Box** to go there.
- **Keyboard:** Ctrl+arrows (edge of data), Ctrl+Shift+arrows, Ctrl+Home, Ctrl+End, Ctrl+Shift+End, Ctrl+A (data block, then everything), Shift+Space, Ctrl+Space, Page Up/Down, Ctrl+Page Up/Down (sheets), Shift+F11 (new sheet), Ctrl+G or F5 (Go To), Ctrl+F / Ctrl+H, Ctrl+D / Ctrl+R, Ctrl+; (date), Ctrl+Shift+; (time), Ctrl+' (formula above), Ctrl+Shift+" (value above), Ctrl+B/I/U, Ctrl+Shift+$ % # ! ~ (number formats), Ctrl+Shift+& and Ctrl+Shift+_ (borders), Ctrl+9 / Ctrl+0 (hide rows/columns; add Shift to unhide), Ctrl+- / Ctrl++ (delete/insert), Alt+= (AutoSum), Ctrl+` (show formulas), F9 (recalculate), Ctrl+Shift+L (filter), Delete, Backspace, Esc.
- **Formulas:** start with `=`; references are outlined in colour; function names are suggested as you type with a tip showing the arguments; F4 cycles `$` references. Over 300 Excel-compatible functions, including references between sheets (`=Sales!B2`). **fx** opens **Insert Function** (search or browse by category).
- **Fill handle, copy and paste:** drag the corner square to continue a series or copy formulas (references adjust); double-click it to fill down. Copy/paste works with Excel and Google Sheets. **Paste** options: Values, Formulas, Formatting, Transpose; pasting into a larger selection repeats the copied block.
- **Formatting:** fonts, sizes (A+/A−), bold/italic/underline, fill and font colours, borders (including thick and double), merge (Merge & Center, Merge Across, Merge Cells, Unmerge), alignment and wrap, number formats with more/fewer decimals; formatting whole rows or columns works as in Excel. **Format Painter** copies formatting (double-click to keep it on).
- **Rows and columns:** insert, delete, hide and unhide; drag edges to resize (a tooltip shows the size); double-click an edge to fit; **Format → Row Height / Column Width**.
- **Freeze Panes** (at the selected cell, top row, or first column), **gridlines** and **headings** on/off, **zoom** (status bar slider, 50–200%, Zoom to Selection).
- **Status bar:** Ready/Enter/Edit/Point, and Average, Count, Min, Max and Sum of the selection.
- **Sheets:** tabs along the bottom with **+**; double-click to rename; right-click for insert, rename, duplicate, move and delete.
- **Sort and filter, conditional formatting, find and replace** (match case, entire cell).
- **Files:** **File → Import** an .xlsx (all worksheets with values, formulas, fonts, colours, borders, alignment, wrap, number formats, column widths, row heights, hidden rows/columns, merged cells, frozen panes, tab colours) or .csv; export .xlsx (all of that, with formulas and results) or .csv.
- **Format Cells** (Ctrl+1, or the small ↘ buttons on the ribbon groups): **Number** (General, Number, Currency, Accounting, Date, Time, Percentage, Fraction, Scientific, Text, and **Custom** format codes such as `#,##0.00;[Red](#,##0.00)`, `dddd, mmmm d, yyyy`, `0.0%`, `# ?/?`, `[h]:mm`), **Alignment** (indent, rotation, vertical text, wrap), **Font** (strikethrough, superscript, subscript), **Border** (thin, medium, thick, double, dashed, dotted; colour; outline/inside presets) and **Fill**. Typed times (`9:30 PM`) are recognised.
- **Cell Styles** (Good, Bad, Neutral, Title, Headings, Total, Input, Output, Note, Calculation, accents, Comma/Currency/Percent) and **sheet tab colours** (right-click a tab).
- **Insert / Delete cells** with *Shift cells down/right/up/left*, entire row or column (Ctrl++ / Ctrl+-); formulas and names follow the moved cells. Deleting part of a range shrinks the range, as in Excel.
- **Paste Special** (Ctrl+Alt+V): all, formulas, values, formats, notes, validation, all except borders, column widths, formulas/values with number formats; **Add, Subtract, Multiply, Divide**; Skip blanks; Transpose.
- **Data tools:** **Sort** with several levels (and "My data has headers"), **Remove Duplicates**, **Text to Columns**, **Data Validation** (list with an in-cell dropdown — Alt+↓ — or from a range; whole number, decimal, date, text length; input message; Stop/Warning/Information alerts) and **Circle Invalid Data**.
- **Dynamic arrays:** formulas that return several values spill into the cells beside/below (`UNIQUE`, `SORT`, `SORTBY`, `FILTER`, `SEQUENCE`, `RANDARRAY`, or simply `=A2:A10*2`); `#SPILL!` when something is in the way; refer to a whole spill with `A1#`. Array maths works element by element (`=SUM((B2:B9>5)*(C2:C9))`).
- **Notes** (Shift+F2, Review tab): a red corner marks a note; hover to read it; Show All Notes; previous/next.
- **Hyperlinks** (Ctrl+K): to a web address, email or a place in the workbook; a quick click opens the link, click and hold selects the cell.
- **Named ranges:** select cells and type a name in the Name Box, or Formulas → Define Name; use them in formulas (`=SUM(Sales)`), pick them with F3, edit them in the **Name Manager** (Ctrl+F3). Names follow inserted/deleted rows and renamed sheets.
- **Tables** (Insert → Table, Ctrl+T or Ctrl+L): banded rows, header and total rows, filter buttons and 18 styles (Light, Medium, Dark). The **Table Design** tab appears inside a table: rename it (formulas follow), resize it, turn options on or off, or convert it back to a range. Tables grow when you type in the row below or the column to the right; a formula typed in an empty table column fills the whole column. In the total row, pick Sum, Average, Count, Max or Min from each cell's dropdown. Formulas can use **structured references**: `Table1[Sales]`, `[@Sales]`, `Table1[#All]`, `Table1[#Data]`, `Table1[#Totals]`, `Table1[[Qty]:[Price]]`.
- **PivotTables** (Insert → PivotTable): on a new sheet or a chosen cell. The **PivotTable Fields** panel lists the source's columns; tick fields (text goes to Rows, numbers to Values) and move them between Filters, Columns, Rows and Values; summarise by Sum, Count, Average, Max or Min; filter by values; grand totals on or off. **PivotTable Analyze**: Refresh, Refresh All (also Data → Refresh All, Ctrl+Alt+F5), Change Data Source, Field List, Delete.
- **Charts** (Insert → Chart): column, bar, line or pie from the selected cells (or the data block around the selected cell). Charts float over the grid: drag to move, drag a corner to resize, Delete to remove. They update when the data changes. **Chart Design**: change type, switch row/column, data range, title, legend.
- **Formula auditing** (Formulas tab): Trace Precedents and Trace Dependents draw blue arrows; Remove Arrows; Error Checking goes to the next error and explains it. Green corner triangles mark formula errors and numbers stored as text; the **!** button beside the cell offers Convert to Number, Trace Precedents or Ignore Error.
- **Goal Seek** (Data → What-If Analysis): find the input value that makes a formula reach a target, then keep the result or cancel.
- **Protect Sheet** (Review tab, or right-click a sheet tab): an optional password, and what people may still do (select locked cells, format, insert/delete, sort, filter). Cells are locked by default; unlock some in Format Cells → Protection (or Format → Lock Cell) so they stay editable. Hidden formulas don't show in the formula bar on a protected sheet. Protection prevents accidental changes; it isn't a security feature.
- **Hide and unhide sheets** (right-click a tab, or Format → Hide Sheet / Unhide Sheet).
- **Page Layout** tab: Margins, Orientation and Size (for spreadsheet files these set the file's page setup), Print Area, Print Titles (rows repeated at the top of every printed page), Scale to Fit (all columns on one page, or the whole sheet on one page), and whether to print gridlines and headings.
- People editing the same spreadsheet see each other's changes live; edits to different cells or sheets don't overwrite each other; Undo only undoes your own changes.
- Reading view, page view, print and PDF show each sheet as a table of calculated values (with its print settings and charts); Word and Markdown downloads include every sheet. Excel export keeps tables' look (structured references become ordinary references), sheet protection, hidden sheets and print settings; charts stay in the app (the Excel library can't write charts) and PivotTables export as their values. Excel import/export keeps format codes, rotation, borders, notes, hyperlinks, data validation, named ranges and spill formulas. Spreadsheets made in earlier versions open normally.

## Spelling and grammar

- While editing, spelling mistakes get a red wavy underline and grammar issues a blue one. Click one for suggestions, **Ignore**, or **Add to dictionary** (spelling). The toolbar shows how many issues there are ("3 issues"); click it to step through them in the **Spelling & grammar** panel. **More ▾ → Check as I type** turns checking on or off.
- Checks follow your computer's language and region (for example Canadian, US or British English, French, Spanish or German). Code blocks, equations, links, web addresses and @mentions are skipped. Underlines only appear while editing, never when reading, printing or exporting.
- Your dictionary is saved to your account, so added words are accepted on all your devices.
- Checking is done by **LanguageTool**, an open-source checker that runs as a second container in `docker-compose.yml` (`notes-languagetool`), so your text never leaves your server. The first start downloads it (about 300 MB) and it uses about 1 GB of memory. While it's starting (or if it's stopped), the editor uses the browser's own spellcheck instead.

## Dropdowns, charts, shapes and signatures

- **Dropdowns** (toolbar or **/dropdown**): a coloured chip with options, like Google Docs. Start from Project status, Review status or Priority, or make your own options and colours. Click a chip to choose; people who can edit can change it while reading or editing; **Edit options…** changes the list.
- **Charts** (toolbar or **/chart**): Column, Bar, Line or Pie, with a title, legend and a data table (rows, series, colours) in the chart dialog, plus a live preview. Click a chart to edit it. Word export includes it as a picture.
- **Shapes** (**Insert → Shapes** or **/shapes**), like Google Docs' Insert → Drawing: rectangles, rounded rectangles, ovals, triangles, diamonds, stars, arrows, lines and text boxes, with fill, border, thickness, text, and bring-to-front / send-to-back. It's inserted as an image; select it and choose **Edit shapes** to change it later. (The pen **Drawing** is a separate feature for sketching freehand.)
- **Signatures** (toolbar or **/signature**): add a signature box for yourself (sign straight away), a specific person who can open the document (they're notified), or anyone. Sign by drawing, typing or uploading a picture, plus your full name. Once signed, the signature, name and date are locked on the server and can't be changed or re-signed by editing the document. This isn't a certified legal e-signature service.
- **Text colour** uses the Google Docs palette (greys, bright colours, and lighter/darker shades), plus **Custom** colours (remembered) and **Reset**.
- **Font size** works like Google Docs: **− [size] +**, type a size, or pick from 8–96 (points). Documents use 12 pt by default.
- **Formatting with nothing selected** (colour, highlight, font, size, bold, italic, underline and so on) applies to what you type next; the toolbar shows it as on, and the colour and highlight buttons show the colour that will be used. It never changes the word the cursor is in.

## Embedded apps

- **Embed** (toolbar or **/embed**), or paste a supported link and choose **Embed instead** / **Show as card** in the message that appears.
- **Live in the document:** YouTube videos (privacy-enhanced mode, keeps a start time like `&t=1m5s`).
- **Cards with an Open button:** Outlook mail, Microsoft Teams (meetings show as "Teams meeting", chats as "Teams chat"), VS Code (vscode.dev, github.dev and `vscode://` links that open the desktop app) and Claude (chats, shares and artifacts). These services don't allow being shown inside other websites, so they can't appear live.
- Click an embed's title strip to select it: change its height (automatic, small, medium, large, extra large), open it, change the link, or remove it. Embeds run sandboxed, so they can't read your documents or session.
- Print and PDF show embeds as cards with their links; Word and Markdown exports include the links.

## Equations

- **Inline:** type `$x^2$` (or use the Σ button or **/inline equation**) to put maths inside a sentence.
- **Block:** type `$$` then a space (or use the block Σ button or **/equation**) for an equation on its own line.
- You write LaTeX (e.g. `\frac{a}{b}`, `\sqrt{x}`, `\sum_{i=1}^{n} i`) with a live preview; click any equation while editing to change it. Typesetting is done by KaTeX, bundled with the app (works offline).

## Page view, printing and exporting

- **⋮ → Page setup…** (like Google Docs' File → Page setup): **Pages** or **Pageless** (the default), portrait or landscape, paper size (Letter, Legal, Tabloid, A4, A5), margins, how far the header and footer sit from the edge, a different first page, and page numbers (header or footer; left, centre or right; "3" or "Page 3 of 10"). Pages are white. The setting is saved with the document.
- **Pages** shows real, separate pages, like Google Docs: text that reaches a page's bottom margin continues on the next page (paragraphs split line by line), and the page-break button (or **/page break**) starts a new page. Tables, images, equations and code blocks that don't fit move to the next page whole (one taller than a full page runs past the margin). This works while reading and while editing, including live co-editing. Switching to Pages re-flows the document to the page's real text width; switching back to Pageless returns to the full-width layout. Pages stay paper-coloured with dark text in dark mode, and the big title is hidden (the title is in the top bar), as in Google Docs.
- **Headers and footers:** click the header or footer area on any page to write in it. Options: bold, italic, size, alignment, and placeholders for the page number, page count, title and date.
- **⋮ → Print…** prints only the document's content (no title, "Last edited" or word count). Every printout is laid out as real pages with the margins built in, so the browser doesn't add its date, title and web address (on some Safari versions, untick **Print headers and footers** once if they still appear). In Pages mode it prints exactly the pages you see (same breaks, headers, footers and page numbers, on the chosen paper and orientation); in Pageless mode it prints a clean continuous copy with automatic page breaks.
- **⋮ → Download as PDF** opens the same print view; choose **Save as PDF**.
- **⋮ → Download as Word (.docx)** uses the page setup (paper, orientation, margins, real Word headers and footers with automatic page numbers, different first page) and keeps headings, styles, colours, lists, checklists, tables, images, code, links, alignment and spacing; equations become Word equations.
- **⋮ → Download as Markdown (.md)** gives standard Markdown (content only; dropdowns become their value, charts a table, signatures who signed) (fonts and colours aren't part of Markdown, so they're left out).

## Reminders from documents

- While reading, hover over a checklist item and click the bell to turn it into a reminder.
- **⋮ → Remind me about this…** sets a reminder for the whole document (tomorrow at 9:00 by default).
- These reminders show the document's name in Reminders; click it to open the document.

## Folders

- **New folder** (next to the favourites star) creates a folder in the current folder. Folders show as cards above the list; click one to open it. Inside, the path at the top (All documents › Work › Reports) takes you back up.
- Put documents in a folder by dragging them onto a folder card (or onto a folder in the path), or with **Move to folder** in a document's preview. Drag a folder onto another to nest it.
- Each folder's ⋮ has Rename, New folder inside, Move to, and Delete. Deleting a folder moves its documents and subfolders up one level; nothing is deleted.
- **All documents** lists everything; inside a folder you see its own documents and subfolders.
- Folders are personal: each person organises their own, including documents shared with them. Folders are included in backups.

**Files.** The main section is called **Files** (it holds documents, spreadsheets and presentations), at `#/files`; old `#/documents` links still work and are redirected. Opening a folder or a tag shows its files straight away under a compact header (back, name, number of files) instead of the banner and New buttons.

**Search.** The search at the top (and the search box above the file list) looks inside files, not just their titles: document text, spreadsheet cells and sheet names, slide text and speaker notes, spreadsheets and presentations embedded in documents, and uploaded file names. Results say where the match is (for example `Detail!C7 · Blue widgets` or `Slide 2 · Quarterly results`), and choosing one opens the spreadsheet at that cell or the presentation at that slide.

**Recent and Shared with me.** The chips above the file list switch between **All files**, **Recent** (files you've opened lately, newest first; remembered on the server, so it's the same on every device) and **Shared with me** (files other people shared with you, with who shared them and when). Both open like a folder: a compact header with a back button, and the files straight away.

## Uploading files

**Upload** (beside New folder on the Files page) or drag files onto the page to add them to Files (into the open folder, if any). They work like everything else in Files: folders, tags, favourites, search, sharing, and backups (including **Download everything**, which includes the files themselves).

- **Kept as they are.** Pictures, PDFs, video, audio and text files are previewed in the app; anything else shows its name and size. Every file can be downloaded or opened in a new tab.
- **Word, Excel and PowerPoint** files also offer **Open as editable**, which makes an editable document, spreadsheet or presentation beside the original (the original stays as it is). Conversion is a best effort: headings, text styles, lists, links, tables and pictures come across; unusual layout may be simplified.
- **Convert automatically** (Settings → Files) converts Office files as they're uploaded instead; the original goes to Deleted, where it can be restored.
- Uploaded files are private unless shared, like any other file. Upload size is limited by `MAX_UPLOAD_MB`.

## Templates and tags

**New Document**, **New Spreadsheet** and **New Presentation** sit in one row. Click one for a blank file, or its **⌄** for templates of that kind:

- **Documents** (each shows off what documents can do): **Project plan** (contents, goal callout, status chips, milestones table, chart, checklist), **Meeting notes** (attendees, agenda checklist, decisions, action items with status), **Research report** (page view with page numbers, contents, chart, equations, code, an appendix after a page break), **Weekly planner** (priority chips, daily checklists, habit tracker), **Approval form** (page view with header and footer, review status, sign-off: add signers with Insert → Signature).
- **Spreadsheets** (with working formulas): Monthly budget, Expense tracker, Project tracker, Invoice.
- **Presentations** (built from the slide layouts, so they follow any theme): Pitch deck, Project update, Team meeting.
- **Previews:** each template has a short description, and hovering one shows a preview beside the menu.
- **Your templates:** save any file with ⋯ → **Save as template**; it appears in the ⌄ menu of the matching kind. **Manage templates…** (at the bottom of each menu) lists them all to use or delete.
- **Tags and folders:** the tag chips above the file list filter it by tag (clicking a tag on a file or in its preview does the same). Opening a folder or a tag shows its files straight away under a compact header with a back button, instead of the banner and New buttons.

**Comments on cells and slide objects.** In spreadsheets, right-click a cell → **Comment** (or **Ctrl+Alt+M**); in presentations, right-click an object (or the slide) → **Comment**, **Insert → Comment**, or **Ctrl+Alt+M**. Comments use the same panel, replies, resolving, mentions and notifications as documents. Commented cells show a small dot in their corner, commented objects a badge (click it to open the thread), and slides with comments a mark on their thumbnail. Clicking a comment's label (such as `Q1!B2` or `Slide 2 · Chart`) goes to that cell or object, switching sheet or slide if needed.

## Version history

- The app saves versions of each document as it's edited: a new one after 10 minutes of editing, or when someone else starts editing. Up to 100 versions are kept per document.
- Open a document and click the **clock button** (left of Comments in the top bar) to see versions by day, time and author. Click one to preview it, then **Restore this version**. Restoring keeps the version you replaced in the history, so you can always go back.
- Anyone who can open the document can browse its history; only people who can edit can restore.

**What changed.** With **Show changes** on (the default), each version is compared with the one before it (the current version with the latest saved one): documents show edited words inline (insertions underlined in green, deletions struck through in red) and added or removed paragraphs; spreadsheets list every changed cell with its value or formula before and after, plus sheets added, removed or renamed and cells whose formatting changed; presentations list slides added, removed, moved or changed, with before-and-after pictures and which objects were edited, added or removed. Turn **Show changes** off to see a version as it was.

## Deleted

- Deleting a document moves it to **Deleted** (the bin button beside the search on the Documents page) and it disappears for anyone it was shared with. **Undo** in the message after deleting brings it straight back.
- In **Deleted documents**, **Restore** a document or **Delete forever**; **Delete all permanently** clears everything. Documents are removed for good, with their files, 30 days after being deleted.

## Comments

- **Adding:** select text and click the **Comment** bubble that appears beside it (or the comment button in the editing toolbar), type, and press **Comment** (or Cmd+Enter).
- **Who can comment:** anyone who can open the document, including people with view-only access.
- **The Comments panel:** the speech-bubble button on an open document (with the number of open comments) shows every comment beside the document. Commented text is underlined in yellow; click it to jump to its comment, or click a comment to jump to its text.
- **Conversations:** reply in the box under any comment. Resolve with the tick (replying reopens it), and use **Show resolved** to see past ones. People can delete their own comments; the owner can delete any.
- **If text changes:** comments are tied to the text they quote, so they don't change the document. If that text is deleted, the comment is marked "Text no longer in document".
- **Notifications:** a new comment notifies the document's owner; a reply notifies the owner and everyone in that conversation. They appear in the bell; clicking one opens the document at that comment.
- **In the list:** documents with open comments show a speech-bubble count.

## Header image

In **Settings → Appearance → Header image**, upload a wide photo to replace the mountain illustration at the top of Documents, Reminders, Calendar and Settings. Choose whether to focus on the top, middle or bottom of the photo, or switch back to the mountains. Large photos are resized before upload. The header is personal to your account.

## Files

**Settings → Files** lists everything you've attached to documents, with download and delete buttons and your total storage. Deleting a document deletes its files too.

## Notifications

The bell shows reminders that are due and events about to start (the lead time is in Settings). Alerts also pop up while the app is open. They are in-app only, so nothing is sent when every tab is closed.

## Keyboard shortcuts

- `/` or `Ctrl+K` / `Cmd+K`: search everything
- `Esc`: close dialogs, menus and search

## Run without Docker

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

## Project layout

```
server.js         Express server, sign-in, sessions and API routes
build.mjs         Builds what the browser loads (npm run build): the editor engine + KaTeX (public/js/vendor),
                  and the app's code and stylesheet combined and compacted (public/dist). Edit public/js and
                  public/css, then rebuild (Docker does this automatically).
client-src/       Browser bundle entry point (editor engine, including KaTeX for maths)
shared/           Document schema and text converter, used by browser and server
src/collab.mjs    Live co-editing server (Hocuspocus/Yjs, WebSocket at /collab)
src/export-docx.mjs  Word export
src/db.js         SQLite schema, accounts, sharing, validation, import/export
public/           The web app (plain HTML, CSS and JavaScript; npm run build compacts it into public/dist)
  js/views/       Notes, reminders, calendar and settings screens
```

## API

All endpoints are JSON under `/api` and need a signed-in session, except `/auth/*` and `/health`. Requests that change data must send the header `X-Requested-With: workspace`. Endpoints: `POST /slides/import`, `POST /slides/export`, `POST /sheets/import`, `POST /sheets/export`, `GET`/`PUT /notes/:id/link`, `POST /notes/:id/link/reset`, `GET /share/:token`, `POST /share/:token/join`, `POST /check`, `GET /check/status`, `GET`/`POST /dictionary`, `DELETE /dictionary/:word`, `GET`/`POST /notes/:id/signatures`, `POST /signatures/:id/sign`, `GET`/`POST /folders`, `PUT`/`DELETE /folders/:id`, `PUT /notes/:id/folder`, `GET /notes/:id/export.docx`, WebSocket `/collab`, `GET /notes/:id/people`, `GET`/`POST /templates`, `DELETE /templates/:id`, `GET /trash`, `POST /trash/:id/restore`, `DELETE /trash/:id`, `DELETE /trash`, `GET /notes/:id/versions`, `GET /notes/:id/versions/:vid`, `POST /notes/:id/versions/:vid/restore`, `PUT /notes/:id/pin`, `GET`/`POST /notes/:id/comments`, `PUT`/`DELETE /comments/:id`, `POST /notifications/read`, `PUT /account/username`, `POST /files` (raw body with `X-File-Name`, `X-File-Type`, optional `X-Note-Id`), `GET /files`, `GET`/`DELETE /files/:id`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/config`, `GET /me`, `PUT /account`, `PUT /account/password`, `DELETE /account`, `GET`/`POST /notes/:id/shares`, `PUT`/`DELETE /notes/:id/shares/:userId`, `GET /bootstrap`, CRUD on `/notes`, `/reminders` and `/events` (`GET`, `POST`, `GET /:id`, `PUT /:id`, `DELETE /:id`), `GET`/`PUT /settings`, `GET /export`, `POST /import`, and `GET /health` (always open, used by the Docker health check).

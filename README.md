# ReaderBee World (3D)

A walkable 3D version of the ReaderBee map (`MAP_Newest (1).jpg`), built with Three.js. Pick a kid and explore the island. Word quests ask you to find places ("Can you find the BARN?"), and a bee buddy can fly ahead to show the way. Island friends talk with you, animals chat in speech bubbles, and every place has a word and a sentence to read. **R** reads any of them aloud.

## Run it

The browser has to load the files from a local web server; opening `index.html` directly won't work.

```bash
cd ~/3dmap
python3 serve.py
# then open http://localhost:8642
```

`serve.py` serves the game with caching turned off, so code changes show up when you refresh. It also runs the chat for the talking friends (see below).

To let the friends answer with Claude, add your Anthropic API key to the `.env` file in this folder (it's hidden in Finder; open it with `open -e .env` or your code editor):

```
ANTHROPIC_API_KEY=sk-ant-...
# optional: a faster, cheaper model than the default (claude-opus-5-5)
READERBEE_MODEL=claude-haiku-4-5-20251001
```

Save the file and reload the game page; the server picks up the change without a restart. (Setting `ANTHROPIC_API_KEY` as an environment variable when starting `serve.py` works too.)

Without a key, the game works the same, and friends answer with their built-in lines. The key stays on the server: the browser never sees it, `serve.py` never hands out `.env` (or any hidden file), and `.gitignore` keeps it out of git.

Three.js and the fonts load from a CDN, so you need an internet connection the first time.
Add `?touch=1` to the address to preview the tablet controls on a desktop.
The game needs a current browser (Chrome, Edge, Firefox, or Safari 16.4+ on Mac and iPad).

## Controls

| Keyboard / mouse | Touch | Action |
| --- | --- | --- |
| W A S D / arrows | joystick (bottom left) | walk. After a couple of seconds you speed up to a jog; you swim in deep water |
| click the ground | tap the ground | walk there (click a friend to walk up and talk) |
| Shift | 🏃 Run | run |
| Space | 🦘 Jump | jump |
| F | ✋ / 💬 button | talk to a friend, ride the zip line or the balloon, jump out of the balloon, swim back to land (the button shows what it will do) |
| T | ☀️ (top right) | skip ahead to the next time of day |
| Q / E, or drag | drag the screen | turn the camera |
| scroll, + / − | pinch | zoom |
| R / Enter | 🔊 Read | read the place card aloud (or the speech bubble of whoever is right next to you) |
| B | 🐝 Help | the bee flies to the quest place, or to the nearest golden letter |
| M | 🗺️ Map | big map with the alphabet you have found |
| click the big map (the little map opens it) | tap the big map (tapping the little map opens the big one) | zoom to that spot. Click a place's marker to land beside it, facing it (at the front door if it has one), or a friend's marker to visit them. During a quest, choosing a place you haven't found is your answer (see Reading questions) |
| 1, 2, 3 | tap a choice | answer a reading question (R hears it again, Esc closes it) |
| C | | switch to another kid |
| H | | hide the help box |

Hovering over a map shows where you will land, and the word for a place you have found (the others' words are what the reading questions ask). If you click the sea, you land on the nearest dry land.
The top-right buttons are ☀️/🌙 (time of day), 🏠 (go home), 🔊 (sound on/off) and ⚙️. Settings has picture quality, a time-of-day picker, a button to stop the clock, the talking-friends switches, the reading-questions switch, the class this device is in, and "start over" (it asks before it erases anything).
New places and letters are read aloud when you find them (unless the sound is off).

### Getting the most natural voice

Reading aloud uses the voices built into the browser and the device, so how natural it sounds depends on where you play. The game picks the best voice it can find. It never uses the robotic novelty voices, and it gives each friend a different voice when there are enough. A grown-up can choose a different voice in ⚙️ Settings → Reading voice (▶ Test plays a sample).
- **Microsoft Edge** (Mac or Windows) has free natural-sounding voices, the biggest improvement. Just open the game in Edge.
- **Safari on a Mac or iPad** can use Apple's Premium voices. On a Mac, go to System Settings → Accessibility → Spoken Content → System voice → Manage Voices…, then download an English voice marked Premium (for example Zoe or Ava). On an iPad, go to Settings → Accessibility → Spoken Content → Voices → English. Then choose it in the game's Reading voice list.
- **Chrome** uses Google's online voices when it has them, which are smoother than the Mac's basic ones. If a kid stands still for a few seconds, they take out a book and read.

## Things to do

- **Talking friends** – four island friends you can talk with. A speech bubble floats over them; walk up and press F (or click them).
  - 📚 **Ms. Paige**, the librarian outside the library, tells tiny stories and helps sound out words.
  - ⚓ **Captain Finn**, on the harbor, knows about boats, the whale and the lighthouse.
  - 🌻 **Farmer Rosa**, by the red barn, plays animal games.
  - 🐉 **Pip**, a little dragon at the dragon cliffs, loves riddles and rhymes.
- **Word quests** – find all 37 places, easiest words first ("Can you find the red BARN?"). Each new place gives a star. Once every place is found, the words a student hasn't yet read right first time come back as "...again?" quests.
- **Reading questions** – the game asks children to read, and keeps what they show for their teacher:
  - **On the map**: during a quest the map doesn't mark the answer. Find the word's picture and tap it. A wrong place says what it is (and shows its word), then spells the word to look for; after two wrong taps the map glows near the place, after three the red ring shows it.
  - **Arriving at a place**: before its star, tap its word out of three (the other two usually start with the same letter). Children still learning their letters (level 1 or 2 from their teacher's checks) hear the word and find it instead. 🔊 reads the word if a reader needs help. A wrong choice says what that word is; after two, the answer is shown, so nobody gets stuck.
  - **Golden letters**: which little letter goes with the big one? The other choices look alike (b, d, p).
  - Right first time, without help and within 8 seconds, counts as "knew it"; otherwise "slow"; shown the answer, "not yet". A grown-up can switch the questions off in ⚙️ Settings, for free play like before.
- **Alphabet hunt** – 26 golden letters are hidden around the island, each next to its word: A for APPLE by the apple trees, Q for QUACK by the duck pond, W by the waterfall, and X marks the treasure box. Each letter you find shows a card like "Q is for QUACK". A soft beam of light marks letters that are far away. The **M** letter only comes out at night (by day you see a faint ghost of it), **J** floats above the trampoline, and **Z** hangs over the zip line.
- **Day and night** – a full day lasts about 5 minutes, and nights go by faster than days. At sunset the sky turns orange. At night windows and street lamps light up, the lighthouse beam shines, stars and the moon come out, and the bee glows like a lantern. The owl wakes up and fireflies come out; walk into them to catch them.
- **Zip line** – from the tree house deck down through the redwoods.
- **Hot-air balloon** – climb into the basket at the balloon field and take a ride around the island (about 3 minutes). Press F to jump out with your umbrella.
- **Bouncing** – the park trampoline and the giant red toadstools in the woods send you flying.
- **Umbrella** – jump off something high and the kid opens an umbrella and floats down.
- **Balls** – kick the beach balls and soccer balls around.
- **Kite** – look for the kite flying by the seal beach.

Stars and letters are saved in the browser, and on a class's devices in the school account too, so they follow a child from one device to the next (see Class devices below).

## Talking friends: how they work, and keeping children safe

Each friend has a personality written in `src/friends.json`. When a child says something, the game sends the conversation to `serve.py`, and the server asks Claude for a reply. The server writes the instructions itself, so a web page can't change them. Every reply comes back in a fixed shape: what to say, 2–3 short replies the child can tap, a mood, and optionally "send the bee" to show the way.

Kid-friendly by design:
- Replies are 1–2 short sentences in easy words, read aloud with each word highlighted as it is spoken.
- The reply buttons each have a 🔊 to hear them, so children who can't read yet can still answer. Children can also type, or use 🎤 voice typing where the browser supports it.
- If anything goes wrong (no key, no internet, a slow answer after 20 seconds, too many messages in a minute), the friend answers with built-in lines, so a child never sees an error.

Safety and privacy:
- The friends' instructions tell Claude to keep everything gentle and G-rated, stay in the game world, and never ask for personal details. If a child says they are hurt, sad or unsafe, the friend tells them to talk to a grown-up they trust.
- Messages that look like a phone number, email address, street address or web link are **never sent**, not even to the server. The friend kindly says that is private.
- Replies are cleaned before they are shown: no links, emojis or odd symbols, and length is limited.
- The game doesn't save or log anything a child says; conversations are forgotten when the page is closed. With Smart talk on, each message (and the recent conversation) is sent to Anthropic's API to get a reply, under Anthropic's API data policies.
- In ⚙️ Settings a grown-up can turn **Smart talk** off (friends then use only their built-in lines) and turn **Voice typing** off.

Before real children use this outside your own home or classroom, check the rules that apply to children's data where you are (for example COPPA in the US or GDPR-K in Europe). That may mean asking for parental consent. Voice typing uses the browser's own speech recognition; in Chrome that sends audio to Google, and in Safari to Apple.

## For teachers: class list and reading checks

Open **👩‍🏫 For teachers** on the start screen (or go to `http://localhost:8642/teacher.html`). A multiplication question keeps young children out; it is asked once per visit.

- **Add your students**, one name per line. First names or nicknames are enough. In the game, each student then taps their name before playing and gets their own stars and golden letters on that device (on the class's devices, on all of them). **Just play** plays as a guest, with the stars and letters the device already had. ⚙️ Settings → Who's playing → Change goes back to the names.
- **Give a reading check** one-to-one: open a student and press **Start a reading check**. The child reads the big card aloud and you tap how it went: **✓ Knew it** (right within about 3 seconds), **🐢 Slow** (got it with effort) or **✗ Not yet**. On a keyboard: → knew it, ↓ slow, ← not yet, Backspace undo, Esc end. There are seven checks: capital letters, lowercase letters, letter sounds (with a hint of what to listen for), Fry sight words 1–100, 101–200 and 201–300, and the 37 island words. Letters come in a new random order each time and Fry words in list order. Re-checks skip what the child already knows, and word lists stop after 5 "not yet" answers in a row.
- **Levels** come from quick, correct answers only:

  | Level | Name | Reached with |
  | --- | --- | --- |
  | 1 | Starting letters | fewer than 20 capital letters |
  | 2 | Letter names | 20+ capital letters |
  | 3 | Letter sounds | 20+ letter sounds |
  | 4 | First words | 10+ Fry words |
  | 5 | Sight words 1 | 25+ Fry words |
  | 6 | Sight words 2 | 100+ Fry words |
  | 7 | Sight words 3 | 200+ Fry words |

  Change the numbers in `LEVELS` in `src/classroom.js`.
- **Reports**: the class page shows each student's level and counts, groups by level for small-group work, and the words the fewest students know. A student's page shows next steps (letters and sounds to learn, the next sight words to practise), every letter and word in colour, and their check history. **In the game** shows what the student showed while playing: each island word and little letter, right first time, with help or a second try, or not yet. Those are taps out of three choices (a lucky guess is possible), so they never change the level: a reading check confirms. It prints cleanly. You can download a summary or every answer as a spreadsheet.
- **Where results are kept**: in this browser on this device, and, once you sign in, in your school's account too (see below). Without an account, use **Save a backup file** now and then (clearing the browser's data would erase the results), and **Restore from a backup file** to move a class to another device. Students' names only ever go to your school's account: the talking friends only hear the name of the game character.
- **School account**: when this computer has a school account set up (below), the class page has a **School account** card. Sign in with Google, Microsoft or an emailed link, start your school or open it, then **Save** the class on this device to it or **Open** a class from it. After that every change is saved on the device first and sent when there's a connection, so checks keep working without Wi-Fi; the line at the top says whether everything is synced. Open the class on another device to see the same students and results, including checks given there. An aide sees the class and gives checks, but the class list belongs to its teacher. Signing out takes the class off the device (it stays in the account).
- **Class devices**: once the class is in the school account, its teacher (or a school admin) can let the class's iPads and computers play as the students. **Show a code for devices** on the class page gives an 8-character code, with a QR code, that works for two hours. On each device a grown-up opens the game, taps **🏫 Join a class** at the bottom of the start screen and types the code (or scans the QR code with the device's camera, which opens the game with the code filled in), then taps **Join**. From then on the game's start screen lists the class, each child taps their name, and what they answer in the game comes to their report's **In the game** card. Their stars and golden letters follow them from one device to another, and "start over" starts them over on every device. A device keeps a copy of the class list, so children can play without Wi-Fi; their answers are sent when the connection is back. The card lists the class's devices ("Device 3 · iPad", when it joined and was last used): **Remove** takes one out of the class, and its answers so far stay. On a device, ⚙️ Settings → Class (or the 🏫 link on the start screen) shows its class and whether everything was sent; taking it out of the class there asks a grown-up's sum first. A device sees only its class's nicknames, never results, other classes or staff.

The Fry list is in `src/wordlists.js`, from sightwords.com's "Fry Sight Words Listed by Frequency". Printed editions differ slightly ("animal" or "animals"), so change a word there to match your school's list.

## Backend: school accounts and shared results (Supabase)

Teachers sign in on the teacher pages and their classes sync with the school's account. It is plain Postgres on [Supabase](https://supabase.com), defined in `supabase/migrations/`:

- **Reading content**, the same for every school and readable by anyone: letters, the 44 sounds (plus x and qu), 66 spellings and the sounds each can make, chunks (word families like -at, blends like bl-, prefixes and suffixes), words with their syllables and sound-by-sound parts (the tables are ready; filling them in is a later step), the Fry lists 1–300, skills in teaching order, and the six checks. `decodable_words()` finds the words a child can sound out from the spellings they know.
- **School data**, private to each school: schools, staff, classes, which staff work in which class, students (a nickname only), every check and answer, the classroom devices in each class, and the stars and letters each student has found on them. Answers can only be items of the check (a letter or a list word), so no free text is ever stored.
- **Roles**, enforced inside the database (row-level security), so they hold whatever the client does:

  | Role | Can |
  | --- | --- |
  | School admin | see every class in the school, add staff, delete classes and results |
  | Teacher | manage their own classes: students, colleagues in the class, checks and results |
  | Aide | see their classes and give checks; can't change the class list or delete results |
  | Classroom device | see its class's nicknames; save game answers, stars and letters for them (through the device functions only) |
  | Not signed in | read the reading content only |

  Teachers sign in with their school Google or Microsoft account (or an emailed link). Students don't sign in: a classroom device signs in anonymously once a grown-up types its class's code.

The teacher pages find the project through two lines in `.env` (see `.env.example`), which `serve.py` hands to the browser at `/api/config`:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is meant to be public: the database's rules protect the data. Never put the secret key there; `serve.py` refuses to hand one out. Without these lines the teacher pages work as before, with everything on the device. `src/cloud.js` does the signing in and syncing: changes are saved on the device first and sent in order (the class name, removed students, students, then checks); then the account's copy of the class comes back, so checks given on other devices show up. Changes made on the device and not yet sent always win.

**Classroom devices** (`supabase/migrations/20261015120000_class_devices.sql`, `src/device.js`): a teacher's `make_join_code()` gives the class an 8-character code (no 0, O, 1, I or L) that works for two hours; making a new one stops the old one. A device signs in with Supabase Auth's anonymous sign-ins and calls `join_class()` with the code. A device gets 5 wrong tries in 10 minutes and 20 a day, a class at most 100 devices, and anonymous sign-ins are limited per internet address, so codes can't be guessed. After that the device can only call `device_class()` (the nicknames, whether the game reads words to each student, their stars and letters, and their latest game answer to each island word), `save_game()` (island words and little letters, for its own class's students), `save_progress()` and `leave_class()`. Restrictive rules on every school table keep a device's sign-in out of everything else, and grown-ups' sign-ins can't join as devices. A device that lost its sign-in (for example when its browser storage was cleared) joins again with a new code and takes back its old place in the list.

Run it locally (needs Docker):

```bash
supabase start      # the first time downloads the containers
supabase status     # the API URL and publishable key for .env
supabase db reset   # rebuild the database from the migrations
supabase test db    # who can see and change what (supabase/tests)
supabase stop
```

Studio, a web view of the tables, is at http://127.0.0.1:54323 while it runs. With the local project in `.env`, the School account card also offers a test sign-in with an email and password, only on this computer. The content migration was written by `node supabase/content/build-content.mjs` from `src/wordlists.js`; to change content later, add a new migration.

Going live, when you're ready:

1. Create a project at supabase.com (a US region), then `supabase link --project-ref <your project ref>` and `supabase db push`.
2. In Authentication → Providers, turn on Google and/or Azure (Microsoft), and in URL Configuration set the site URL and add `teacher.html`'s address as a redirect URL. For class devices, turn on anonymous sign-ins (Authentication → Sign In / Providers). A school's devices usually share one internet address, so raise the limit for anonymous sign-ins per hour (Authentication → Rate Limits, 30 by default) before a whole school sets up its devices at once. Put the project URL and publishable key in `.env`.
3. Before real students' results go in: sign Supabase's data processing agreement, publish a privacy notice with how long results are kept, and get each school's agreement (FERPA, COPPA's rules for schools, and state student-privacy laws). Many districts ask vendors to sign their data privacy agreement.

Not done yet: a page for admins to add staff (for now `add_school_member()`, or the Supabase dashboard), clearing out anonymous sign-ins of devices that have left their class, and filling in each word's syllables and sounds.

## Code layout

- `serve.py` – the local web server, the chat endpoint that talks to Claude (`/api/chat`, `/api/status`), and the school account settings for the teacher pages (`/api/config`).
- `src/friends.json` – the island friends: personality, where they stand, their look and voice, greetings, and built-in lines.
- `src/friends.js` – builds the friends in the world and animates them (turn to face you, wave, talk).
- `src/chat.js` – the chat panel: read-aloud with highlighting, reply buttons, voice typing, privacy check, and built-in replies.
- `src/mapdata.js` – every landmark, road, river, forest and plot, given in pixel positions on the original map image. Each place also has its word, sentence, how a quest asks for it, and a phonics level (1 short words to 5 long ones) for the quest order. Edit this file to move things.
- `src/terrain.js` – heightmap, chunked terrain meshes, and the ground shader. The shader blends grass, dirt, gravel, asphalt, paving, sand, cliff rock, mud, snow and forest floor. A high-resolution "splat" map keeps roads and paths crisp.
- `src/textures.js` – procedural textures: building and bark detail with normal maps, plus the ground textures (colour and height).
- `src/nature.js` – trees built from needle and leaf cards that sway in the wind. Far away they switch to camera-facing billboards rendered into an atlas.
- `src/grass.js` – wind-blown grass, tinted to match the ground and streamed around the player.
- `src/water.js` – ocean and river shader (waves, shoreline foam), the waterfall and the duck pond.
- `src/buildings.js` – houses, the tree house and zip line, the barn, the school, the town, the harbor, the bridges, the lighthouse, the city, the trampoline, the toadstools, the props next to the letters, and the signs.
- `src/creatures.js` – the animals, dragons, whale, boats, owl and kite.
- `src/character.js` – the kids (Leo, Ruby, Sam, Ava) and the grown-up friends. Each body is a skinned mesh on a skeleton, so elbows and knees bend smoothly. They have soft fabric and skin materials, eyes that blink, heads that look around, and a mouth that moves when they talk. They walk, run, jump, land, swim, wave, cheer, lean into turns, hang from the zip line, float with an umbrella and read. Grown-ups can wear glasses, hats and beards.
- `src/daynight.js` – the day/night cycle. It moves the sun and moon, colours the sky, fog, water and clouds, and turns on the stars, window lights, lamps and fireflies.
- `src/play.js` – the alphabet letters, the zip line ride, the balloon ride and the balls.
- `src/buddy.js` – the bee buddy and the word quests (easiest phonics level first, nearest first, then review of missed words).
- `src/quiz.js` – the reading questions: tap one of three words or letters, with feedback, help and the answer after two misses.
- `src/talk.js` – speech bubbles for the kids and animals.
- `src/fx.js` – footstep dust, water ripples, splashes, sparkles and confetti.
- `src/audio.js` – synthesised sound: wind, waves, river, birds by day, crickets and the owl at night, footsteps, boings, whooshes and chimes. There are no audio files. It goes quiet when the tab is in the background.
- `src/touch.js` – the on-screen joystick and buttons (they appear on tablets, or on a touch-screen laptop once you touch the screen).
- `src/ui.js` – the HUD: place cards, letter cards, the quest panel, read-aloud, stars and letters (saved in the browser), the firefly count, and the minimap.
- `teacher.html`, `src/teacher.js` – the teacher pages: class list, the one-to-one reading check, class and student reports, the class's devices and join code, spreadsheets and backups.
- `src/classroom.js` – the class data shared by the game and the teacher pages: students, checks and answers, levels, next steps, exports, and the bookkeeping for syncing (what hasn't been sent yet, and merging the account's copy).
- `src/cloud.js` – signing in to the school account and syncing the class with it (Supabase).
- `src/device.js` – classroom devices: joining a class with its code, the class list kept on the device, and sending game answers, stars and letters to the school account.
- `src/wordlists.js` – Fry words 1–300, the letters, and what each letter sound should sound like.
- `supabase/` – the backend: `migrations/` (tables, roles, functions, content), `tests/` (who can see and change what), `content/build-content.mjs` (writes the content migration), and `config.toml` for the local stack.

## Performance

Quality is picked from the graphics card (High / Medium / Low). The resolution then drops automatically if frames get slow. The world is split into tiles so only nearby parts are drawn, and far trees are billboards. To change the setting, use ⚙️.

# Build log

What I asked the AI for, what changed, and what I decided. Newest entries go at the bottom.

**AI used:** Claude Code (working in a Claude project chat).
**Stack:** plain HTML, CSS and JavaScript. No server, no database, no build step.

---

## 2026-10-12 · First version

### What I asked for

- A portfolio site with five artifact cards. Artifact 1 is the site itself; cards 2 to 5 hold my ideas.
- About section: I'm hardworking, not afraid to fail, attentive, and kind.
- A magical figure skating scene with a snow globe feeling, inspired by Lake Louise, Alberta.
  Illustration only, no real photos or real people. Stylized skaters that look realistic, not cartoony.
  Gradients, glow, and outlines.
- Fun little things to discover in the scene (like the Roku screensaver), but calm, not busy.
- Optional background music: off by default, and the play control hidden in the scene
  (for example the roof of a house) instead of a normal button.
- Colors: purple, blue, red, orange, white, gold, white gold, silver. Font with "ice princess" vibes.
- I shared a photo of Lake Louise as a mood reference only. It is not used on the site.

### My ideas for the placeholder cards

- **Artifact 2:** a figure skating tracker.
- **Artifact 3:** an AI coach that compares posture and technique to standard skating form.
- **Artifact 4:** an English learning app for my friend.
- **Artifact 5:** a skating hub with a calendar of public skate sessions, coaches and shops,
  or a better scheduling website for a skating rink.

### What the AI built

- `index.html`: the page. The hero has a large snow globe drawn in SVG: a frozen lake at twilight,
  mountains with alpenglow, northern lights, a moon, pine trees, a cabin with chimney smoke,
  lanterns, a red canoe, a snowman, an owl and a fox. The globe sits on a gold base with a plaque.
- Two skaters glide in a figure eight with a soft gold outline and a reflection on the ice.
  One does a spin now and then. They are silhouettes, so they don't look like any real person.
- Snow falls inside the globe. Clicking the glass shakes the globe and swirls the snow.
- Six hidden secrets (cabin roof, owl, snowman, canoe, moon, fox). Each reacts when clicked
  and a counter shows how many you've found.
- Music: the cabin roof is the switch. It's off until you click it. The tune is an original
  music box waltz generated in the browser (no audio files, no copyrighted song).
  The roof works with a keyboard too and has a label for screen readers.
- Fonts: Great Vibes (script, for the "ice princess" headings), Cinzel (titles), Mulish (body text).
- `cards.js`: all five cards live here, so I can fill in a card without touching the layout.
- `style.css` and `script.js`: the look and the animation.
- Animations stop for visitors who turn on "reduce motion" in their system settings.

### Decisions

- Plain HTML, CSS and JS, so GitHub Pages can host it as is.
- Music is off by default, because sound that starts on its own can feel rude when someone opens a site.
- The card text for Artifact 1 and the ideas is a first draft from my own words. I'll keep editing it in my own style.

### Next steps

- [ ] Read through the card text and the About section and rewrite anything that doesn't sound like me.
- [ ] Create the GitHub repository, upload these files, and turn on GitHub Pages.
- [ ] Submit the live link on Canvas.

---

## 2026-10-12 · Redesign after my first review

### What I asked for

- I wasn't a fan of the first design. I meant a magical *snow globe feeling*, not an actual snow globe on the page.
- Make it immersive: the scene should take up the whole screen and be beautiful enough that people can't look away, and still look great on a phone.
- The content felt stuck in the middle. Spread it around the scene.
- Use the vibe of the Fairmont at Lake Louise: a fairytale castle in the middle of the wilderness.
- Animated skate blade marks carving the ice, like the opening credits of *Ice Princess*.
- Keep all five cards on display, and let people click a card to see it. No separate pages yet.

### What changed

- Removed the snow globe. The whole page is now one full-screen scene: a twilight sky with the northern lights,
  big mountains on both sides, a glacier peak, forests, and a frozen lake. Snow and a few gold flecks fall over everything.
- A fairytale castle hotel (illustrated, inspired by the Fairmont, not a copy) sits on the far shore with
  glowing windows, blue spires, gold finials and waving red pennants. It reflects in the ice.
- Glowing blade marks carve loops, curves and figure eights across the ice and slowly fade. Two skaters make some of
  the marks (one spins now and then), and an invisible sparkling blade makes the rest. Little ice sprays fly off on sharp turns.
- My name is "carved" in when the page opens, with a glowing swoosh under it. The scene drifts slightly with the mouse on a computer.
- Layout: name and About in the sky at top left, links and the secrets counter at top right, the five ice cards across the bottom
  of the lake. On a phone the cards become a row you swipe through.
- Clicking a card opens it in a pop-up with the full reflection or idea and its link.
- Music moved to the castle: the tallest tower's roof is the switch. Still off by default, still an original tune.
- Secrets now: the castle tower, an owl on the castle roof, a snowman, a red canoe, the moon, and a fox walking the shore.
- Updated the Artifact 1 card to talk about this redesign.

### What I learned

- The AI took "snow globe" literally. Next time I'll describe the feeling I want and give a real place or scene as the example.

---

## 2026-10-12 · Name and readability

### What I asked for

- Change the name from "Lake Louise portfolio" to "My Portfolio".
- Use "My Portfolio" as the big heading instead of "nic".
- Some text was hard to read where it overlapped the scene.

### What changed

- The big heading, the browser tab title, and the Artifact 1 card title now say "My Portfolio".
- The name and About text sit on a dark frosted panel, and the links, music hint and "Five artifacts" label have dark backgrounds, so they stay readable over the mountains and sky.
- On tall phone screens the scene shows more sky, so the castle sits below the text instead of behind it.

---

## 2026-10-12 · Fixing a blank-looking site

### What happened

- My downloaded copy of script.js was empty and index.html had the page twice, so the cards, snow, skaters and blade marks didn't show.
- I got clean files as one zip instead of copying them one by one.

### What changed

- The page now starts each part of the scene separately, so if one part fails the cards still show.
- If script.js or cards.js is missing or empty, the cards area now says so instead of staying blank.

---

## 2026-10-14 · Starting over

### What I asked for

- I didn't like the castle design, so I asked to start the design over.
- I shared free-to-use reference pictures for the style I want (they are not used on the site):
  - full and vibrant, so the whole screen feels inviting and makes people curious to explore
  - still a lake and mountains like Lake Louise
  - cozy, warm shop fronts
  - cool, bold text placement
  - layered, paper-cut style art
  - glowing neon details
  - flat vector illustration

### What changed

- New full-screen scene: a pink and purple sky, flat vector mountains with snow streaks, a glacier peak, and a frozen turquoise lake. Snowy pine boughs and spruce trees frame the edges.
- A huge "my PORTFOLIO" title sits between the mountains, with its bottom tucked behind the treeline.
- Glowing skate marks still carve the ice, and a skater glides and spins on the lake.
- The About text is on a frosted card in the lower right (below the scene on a phone).
- The five artifact cards are now **five cozy shops in a village** under the stars: string lights, striped awnings, glowing windows with a little picture of each project, and a neon sign. Clicking a shop opens its card.
- Hidden secrets: a golden bell (it plays the music box tune, off until you ring it), an owl, a fox, a deer, and the skater.
- New fonts: Unbounded for titles and Nunito for text.
- The Artifact 1 card now talks about starting over.
- Cards are still edited only in `cards.js`. The picture names changed: `"castle"` is now `"mountain"`.

### What I learned

- Showing reference pictures of a style worked much better than describing it in words.

---

## 2026-10-14 · Walking into the shops

### What I asked for

- I liked the shops as the artifact cards. Instead of a pop-up card, I wanted to go **through the door into the shop** and read the card on a big menu board on the back wall, behind the counter with a shopkeeper. I shared a photo of a letter-board café menu as a style reference (not used on the site).
- The About box was covering the scenery, the title and the skaters.
- The main lake scene still feels too close to the old design, and the top still doesn't feel filled.

### What changed

- Clicking a shop opens its door, the village zooms toward it, and you step inside. The pop-up card is gone.
- Each shop has its own interior: a dark wall in the shop's color, warm hanging lamps, a window looking out at the snowy mountains, a shelf, plants, and a counter with a service bell and a mug.
- Each shop has its own friendly shopkeeper behind the counter (an original drawing, not a real person). They wear an apron in the shop's color with the project's neon icon.
- The card is on a letter-board menu with wooden ledges: artifact number, Open or Idea, the title, and the reflection, with each line of text resting on its own ledge. The link sits on the last ledge.
- "Back to the village" button (or the Esc key or the browser's back button) walks you back out.
- Every shop has its own link, like `#artifact-2`, so I can share one shop directly.
- The About card moved into the village, next to "The village" heading, so nothing covers the lake scene now. A small glowing arrow at the bottom of the lake points down to the village.
- The new hero is not built yet. First I'm looking at three different hero ideas side by side to pick a direction.

---

## 2026-10-14 · The new lake: Lantern Cove

### What I asked for

- From the three hero ideas, I loved A (paper-cut wilderness) and B (lakeside village at dusk) the most. C looked too much like a video game level.
- Keep A's magical wilderness feeling and its title cut out of a paper banner, but bring the lake much closer, like B's skating surface.
- Keep B's lights, glow and reflections on the ice.
- Make the skaters real figure skaters practicing their axel jumps, and have them look like they're learning: some stay on one leg longer before the jump, and sometimes they fall and get back up.

### What changed

- New main screen: a paper-cut frozen lake at pink and purple dusk, surrounded by snowy paper pines, berry bushes and the mountains, with a glacier in the middle.
- "my portfolio" is cut into a cream paper banner cloud at the top, with paper snowflakes hanging from it.
- The ice comes right up to you. Paper lanterns on a string, lamp posts, two fire bowls and a little red warming hut glow, and their light reflects on the ice.
- Five figure skaters practice axels. They step forward onto one leg, jump, turn one and a half times in the air, and land backwards. Like real learners, some hold the one-leg glide a long time, some back out, some only do a half turn, some land on two feet, and some fall, sit for a moment, and get back up. Their blades leave soft white tracings on the ice.
- Clicking (or pressing Enter on) a skater makes them try an axel.
- Five secrets: the golden bell (music, still off until you ring it), the owl, the fox, the deer, and the skaters.
- On a phone the banner stacks "my portfolio" and the scene is rearranged so the lake, the skaters and the secrets all fit.
- To pick the scene, two versions were painted (Lantern Cove and a twilight pond with an aurora) and compared against my notes. Lantern Cove won, and a few ideas from the other one were added (the fire bowls and bigger mountains on phones).

---

## 2026-10-15 · Polishing Lantern Cove

### What I asked for

- Same request as the entry above. This is the clean-up pass after checking the new lake scene on desktops, tablets and phones.

### What changed

- On phones the title reads as a small tilted "my" above a big "portfolio".
- The warm light from the hut windows, fire bowls, lamps and lanterns reflects more strongly on the ice.
- On wide screens the mountains are taller and peek out under the banner, and the menu buttons are solid so nothing shows through them.
- Secret messages pick a spot that never covers the title, the menu, the bell, the animal you just found, or the skaters. Snow no longer falls over the title, the menu or the village text.
- The skaters spread across the whole ice on phones instead of bunching at the back, leave more room for each other, and a jumper no longer rises over the skater behind. The first clean axel, fall, popped jump and backed-out jump all happen within the first minute. Clicking a skater always leads to a real jump attempt, and the first try starts within a few seconds of opening the page with a long one-leg glide.
- Blades stay on top of the ice, and getting up after a fall is smoother.
- A scalloped paper edge now joins the lake to the village. Keyboard focus on the secrets is easier to see, the page has a small snowflake tab icon, and the lake stops animating while you're in the village so phones save battery.
- Shops: the browser's Back and Forward buttons work cleanly, double-clicking "Back to the village" no longer jumps off the site, and closing a shop you opened from a direct link (like `#artifact-3`) brings you back to that shop in the village. Snowflakes no longer fall across the shop signs.

---

## 2026-10-16 · The skate fitting shop

### What I asked for

- Make one of the shops a figure skate fitting shop that holds my About me and my resume.
- In the background, a skater being fitted with new skates by the shopkeeper.
- On the wall: figure skate boots, figure skate blades, and soft guards with animal and fruit themes.
- Keep the window that looks out at falling snow.
- I picked Artifact 1's shop to become the fitting shop. The other four shops stay as artifact shops for now; I'll change them later.
- After the first look I sent three photos of real skate shops (layout ideas only). The skates were too high up on the wall, and stacked boot boxes are just as important.

### What changed

- The first shop in the village is now the skate fitting shop. Its board has three tabs: About me, Resume and Artifact 1. The "About" link at the top of the page (or `#about` at the end of the address) goes straight there.
- My About me and resume now live in `cards.js` in the `window.ABOUT` block. The resume has blanks in [square brackets] for me to fill in; nothing in it is made up. The separate About panel in the village is gone.
- The room looks like a real skate shop: a pale slatwall from floor to ceiling, rows of figure skates at eye level with size tags, blades, animal and fruit soft guards and gloves on hooks, and a tall shelf of stacked boot boxes with more boxes on the floor. No brand names anywhere.
- In front, a skater sits on the fitting bench while the shopkeeper laces up her new skates and says "Welcome in! Let's find you the perfect fit." The snowy window, the lamps and the board are still there.
- Clean-up after checking it on desktops, tablets and phones: the box shelf no longer covers the boots on smaller laptops and iPads, the boot shadows are soft, the speech bubble has a tail pointing at the shopkeeper, the board doesn't look half empty on big monitors, all of About me fits on an iPad held upright, and the tabs fit on one row on small phones. On phones the shopkeeper's speech bubble sits lower so more of the boot boxes show, and the lamp and the guards behind the skater's head were nudged so nothing crowds them.

---

## 2026-10-16 · Malamutes, an eagle, a parrot and a ski resort

### What I asked for

- Replace the deer and the fox with malamutes wearing purple scarves, an eagle and an African grey parrot, all drawn to the right size for where they are. The deer, fox and owl were far too big.
- Three visible ski lifts on the background mountains, with a ski resort and village under distant floodlights, and tiny dots for the far-away skiers and snowboarders going down the slopes and riding the chairlifts.

### What changed

- The deer and fox are gone. Two malamutes in purple scarves walk together along the far edge of the ice and stop now and then to sniff. A bald eagle perches on top of a far pine (on the hut roof on phones), an African grey parrot sits on the right lamp post by the ice, and the owl is now about a quarter of its old size.
- Each animal is sized against things at the same distance (the hut door, the lamp posts and the skaters). The drawings are small, but each one still has a finger-sized tap area.
- There are now six secrets: the bell, the owl, the malamutes, the eagle, the parrot and the skaters. Tapping the malamutes makes them stop and wag, the eagle lifts off, circles once and lands, and the parrot bobs and chirps "Nice axel!".
- The mountains have three chairlifts with towers, cables and moving chairs carrying tiny riders, a little resort village with lit windows at the base, and floodlit runs that glow, with tiny skiers and snowboarders curving down them. All three lifts show on phones too.
- The animals, chairs and skiers stop moving while you're in the village or a shop, and stay still for people who turn on reduced motion.
- I asked for this version to go into my site files before the last review round. Any fixes from that round get their own entry below.

---

## 2026-10-17 · Artifact 2 is live: MySkate

### What I asked for

- Build the figure skating tracker from my idea, as its own project, and connect it to the Artifact 2 card so it opens from this site.

### What changed

- Artifact 2 is now a finished card: title MySkate, an "Open MySkate" button that goes to https://iisurf.github.io/MySkate/, and a short reflection. The card's picture is still the tracker.
- MySkate lives in its own repository (github.com/iiSurf/MySkate) with its own log, roadmap and tests. Nothing in this site's design or scenes changed.


---

## 2026-10-17 · A finished window and a board that keeps the link in view

### What I asked for

- Artifact 2's shop window still looked closed off, with window bars across a dim picture, like the idea shops. It should look finished and lit like the fitting shop's window.
- The link to MySkate was hidden: you had to scroll to the bottom of the text to see it.
- The text on the board was not placed like it is on the fitting shop's board.

### What changed

- A finished card's shop (status "done") now gets a lit, open window like the fitting shop's: one big pane, no bars, and a display on a shelf. MySkate's window shows the white skate, a gold medal and a little bar chart hanging from a brass rail. Any other finished card gets its picture in a frame on the shelf. The idea shops keep the barred window and the dim picture.
- The window's skate drawing is now shared with the fitting shop (`windowSkate`), and the pane and shelf are small helpers (`windowPane`, `SHELF`).
- An artifact's board is now the same board as the fitting shop's: a felt board in a wooden frame. The number, the title and the link stay at the top and only the reflection scrolls under them. The link is a cream tab under the title, so it is always in view.
- The shopkeeper's speech bubble now sits over their head instead of to the left, where it covered the board.
- On phones held sideways the board moves to the left with the shopkeeper beside it and drops the number row, so the words get room. I checked a big desktop, a laptop, a tablet, a phone and a small phone, and the fitting shop and the idea shops look the same as before.

---

## 2026-10-17 · MySkate's name on its sign

### What I asked for

- Shop 2's sign said "Artifact 2" when it should say MySkate, and "Artifact 2" was missing under the MySkate name below the shop.

### What changed

- A finished card's shop now shows its name on the sign (MYSKATE). A card can set its own sign words with a `shopName` field in `cards.js`; without one the sign uses the card's title. The idea shops still say "Artifact 3", "Artifact 4" and "Artifact 5".
- Under the shop, "Artifact 2" now sits under the title (like "+ Artifact 1: My Portfolio" under the fitting shop). The small line above the title, which used to say "Artifact 2", now says "Try it", next to the Open badge.

---

## 2026-10-17 · MySkate card: the competition planner and the new look

### What I asked for

- New words for the MySkate card that mention the competition planner and the new look, shown to me before anything changed. I picked the version that is the same length as the old one.

### What changed

- The MySkate card's reflection in `cards.js` now mentions the competition planner (a program laid out on a diagram of the rink, set to the music, with the day planned and a scoreboard for how it went) and what I learned from the redesign: after one redesign did not fit, I asked for ten rough drafts first and chose the look from those. It is 165 words, the same as before, so the board fits the way it did. The title, the link, and the button words are unchanged.

### Checked

- The board at 320, 390, and 1280 wide and on a phone held sideways (844 by 390): the link stays in view at the top, the words scroll under it, and the last sentence can be reached by scrolling. Nothing scrolls sideways.

---

## 2026-10-17 · Final polish: animals, lifts, a man on the ice, a lighter page, and the shopkeeper lacing again

### What I asked for

- The eagle sat on the left chairlift's bottom station, so it looked giant. It should look like a far-off bird.
- The eagle flipped back and forth for a moment after a tap.
- On phones the three lifts and the glowing runs stood out too much for a distant resort.
- The page ran slowly on weak phones.
- The skiers stopped and froze halfway down the mountain, and the lift did not run as far up the hill as the chairs.
- The two malamutes looked stuck together.
- One of the skaters should be a man with black boots.
- The shopkeeper in the skate fitting shop (Artifact 1) no longer laced up the skate on the skater.
- Anything else that needed fixing or polishing.

### What changed

- **Eagle:** it now perches on the tip of a far pine right of the hut (away from the lifts) and is smaller (15 units to the metre instead of 25). Its tap flight is one smooth lap round a small ellipse that stands on the perch. It used to take off one way and loop the other, so it mirrored left, right, left within a second and a half. Now it turns round once at each end of the lap, with a quick swing through edge-on. On phones it still sits on the hut roof. The Tab order follows the new perch (owl, malamutes, bell, eagle, parrot).
- **Malamutes:** the second dog walks about a dog-length behind the first (it was 13 units away, so the bodies overlapped), and their tap area is wider to match.
- **Ski resort:**
  - The skiers and chairs freezing was lite mode. Lite mode turns on by itself when the lake runs slower than 25 frames a second, and it used to stop the resort completely. In lite mode the resort now moves 5 times a second, and only reduced motion keeps it still.
  - Every chair now rides the whole loop: up the right-hand cable to the top station, round the wheel, down the left-hand cable and round the bottom wheel, where a new rider may sit down. Before, a chair that reached the top simply reappeared at the bottom.
  - Skiers fade out only in the last few units of their run, so they reach the base.
- **Phones:** the resort is quieter on the tall crop (runs, floodlights, glow strokes, cables and haze are dimmer). Wide screens look the same as before.
- **A man on the ice:** the third skater has short hair, a teal jacket, black trousers, broader shoulders and black boots (the others keep white ones). His reflection matches.
- **Lighter page:**
  - The lanterns, stars, string lights and smoke move in small steps (5 to 8 a second) instead of 60, and stop while the lake or the village is off screen or a shop is open.
  - The skate-marks canvas covers only the ice and is drawn at most 1.5x. The snow canvas is 1x and drawn about 30 times a second.
  - Each village shop is its own layer, so its blurred shadow is not redrawn on every flicker of the string lights.
  - Measured in headless Chrome with the processor slowed 8 times: the desktop crop went from about 30 to about 60 frames a second, the phone crop from about 47 to 60. Lite mode now needs about 16x slowdown instead of 12x to switch on.
  - Reduced motion still stops everything.
- **Shopkeeper:** the lacing is back and easier to see. The far hand lifts the lace ends and pulls them snug, the near hand works the laces, and the head dips with each pull (one big pull, one small one, then a rest). It was a 4 degree wobble for a second of every 3, and lite mode paused it. Lite mode can stay on inside a shop, because the lake only re-checks its speed while it is on screen. The shop's moving parts no longer pause for lite mode. The arms and head turn round their shoulder, elbow and neck through small groups, so this does not depend on `transform-box`.
- **Small fixes:** "Team.This" in the About text now has its space, a stray `]` after "Present" in the resume is gone, and the "Build log" links open `LOG.md` on GitHub (the copy on the live site is served as raw markdown, which some browsers download instead of showing).

### Checked

- Headless Chrome at 390, 768, 844 by 390 (sideways), 1280, 1440, 1920 and 2560 wide: no console errors, no sideways scrolling, all six secrets found with real clicks at 390 and 1280, keyboard Tab and Enter on the eagle, reduced motion (nothing moves, the eagle does not fly).
- Not checked: a real phone, Safari or Firefox.

---

## 2026-10-18 · MySkate card: the new look

### What I asked for

- Two changes to the MySkate card so it matches the app after its last redesign.

### What changed

- The reflection in `cards.js` now says "a one to five star rating" (the app rates with stars now) and "I asked for rough drafts first, and after testing it at the rink I chose a calmer, easier-to-read look from a second round" (instead of the theater-program look). The title, link, and button words are unchanged.
- The stylesheet and scripts are at `?v=20261018`, so a visitor's cached copy of the old card text is not used.

### Checked

- On a local server at 390 wide: the card opens, shows the new wording, the old wording is gone, and there are no console errors.

---

## 2026-10-23 · Artifact 3 card: MySkate Coach

### What I asked for

- Replace the Artifact 3 placeholder with the finished artifact: its title, a link, and a short reflection.

### What changed

- The Artifact 3 entry in `cards.js` is now done: "MySkate Coach", linking to the repository (`https://github.com/iiSurf/MySkate-Coach`, button "Open the repo"), with a reflection on how it works (Claude plans the next session from a MySkate backup, plain code checks every part, one retry, then MySkate's own suggestion), that it runs on Claude Code with my school sign-in and only inside my workspace folder, and what I learned. The picture is still the coach.
- The stylesheet and scripts are at `?v=20261023`, so a visitor's cached copy of the old card is not used.

### Checked

- On a local server at 390 and 1280 wide: the Artifact 3 shop opens, the card shows the title, the button, and the whole reflection (it scrolls in its box, like the other cards), the button opens the repository in a new tab, nothing scrolls sideways, and there are no console errors. At 1280 the shop matches the Artifact 2 shop.
- The repository went up first, then this card, so the button never led to a missing page.
- Live, after GitHub Pages published it: https://iisurf.github.io/Portfolio/ loads the `?v=20261023` files, and at 390 and 1280 wide the Artifact 3 shop shows the card and the whole reflection, the button opens https://github.com/iiSurf/MySkate-Coach (public, its README rendered) in a new tab, nothing scrolls sideways, and there are no console errors. The Artifact 2 shop looks the same at both sizes.
- Not checked: a real phone, Safari, or Firefox.

---

## 2026-10-23 · Artifact 3's shop: a coaches' room

### What I asked for

- A room of its own inside the Artifact 3 shop, more like a coaches' room, so Artifact 3 has its own theme. Keep the shop's outside as it is. Reference photos: a ballet room, a warm locker room, an arena with seats, a rink with tall windows, a studio with backlit arches, and a gym; or a coaches' room overlooking the rink through glass.
- After the first drafts: no wall in front of the coach. Then I asked Claude to choose between the two drafts.

### What changed

- Two drafts were drawn in the real page (a warm studio by day, and a coaches' box over the arena at night) and shown side by side. The first round's rink showed too little ice, so it was redrawn as seen from above, with the ice filling the glass. The counter in front of the coach was taken out.
- Chosen: the warm studio by day. The shop whose card has the coach picture now opens into its own room (`coachInteriorHTML` in `script.js`, the coaches' room section of `style.css`): warm plaster walls with three wide arches, softly lit round their edges, looking down on a sunlit rink (tall windows and trees on the far side, the ice with its markings in perspective) where three skaters glide past; dome lamps, a little olive tree, a purple skate bag, and a wooden floor with the sun on it.
- The coach is the shop's shopkeeper (same face and hair) in a navy team jacket with the shop's star, a stopwatch on a lanyard, and a clipboard. There is no counter: the coach stands at the window, cut off at the waist by the bottom of the screen. The bubble says "Welcome to the coaches' room! Everything about this one is on the board."
- The board (the card) is the same as in every shop, now built by one shared function (`cardBoardHTML`). The other shops are unchanged. The reference photos are not in the site: everything is drawn.
- The skaters glide with CSS animations; with reduced motion they stand still, each one in view.
- The stylesheet and scripts are at `?v=20261023b`.

### Checked

- On a local server (MySkate's no-cache server) at 320 by 568, 390 by 844, 768 by 1024, 844 by 390 (a phone held sideways), 1280 by 800, and 1920 by 1080: the room opens, nothing scrolls sideways, the coach is in view and clear of the board, and on a desktop the bubble does not cover the board. No console errors.
- With every animation stopped (as reduced motion does): all three skaters are in view.
- The way back to the village works, Artifact 4's shop still has its counter and shopkeeper, and the About shop still has the fitting room. At 320 by 568 the board hides its top line, the same as every other shop already does on short screens.
- Live, after the push and GitHub Pages publishing it: https://iisurf.github.io/Portfolio/ loads the `?v=20261023b` files, and at 390 and 1280 wide the Artifact 3 shop opens into the coaches' room with all three skaters, the coach in view (below the board on the phone, at the window with the bubble clear of the board on the desktop), "Open the repo" going to the MySkate Coach repository in a new tab, nothing scrolling sideways, and no console errors.
- Not checked: a real phone, Safari, or Firefox.

---

## 2026-10-24 · Artifact 3 card: open the app

### What I asked for

- The card's button opened the GitHub repository. Artifact 3 has to be an app that can be shown and demoed, so the button should open the app's demo.

### What changed

- MySkate Coach now has an app: `npm run app` runs it live on my Mac, and the same page on GitHub Pages plays back real recorded runs, labelled as a recording. The card's link is https://iisurf.github.io/MySkate-Coach/ ("Open the app"), and the reflection says how the app works and why the public link is a demo (Claude runs on my Mac through Claude Code, never a paid API key).
- The stylesheet and scripts are at `?v=20261024`.

### Checked

- `cards.js` loads, and the card reads as above. Not checked yet: the link, which works once GitHub Pages is on for the MySkate-Coach repository and it is pushed.

---

## 2026-10-30 · Artifact 4 card: the Sunday checkpoint

### What I asked for

- Artifact 4 is due Sunday, November 8. By Sunday, November 1, the card has to show where it is.

### What changed

- The card is now "Articulate". It stays an idea card, because the app is in progress. Its button, "See the plan and drafts", opens the articulate repository on `nicks-branch`, where the team plan, my friend's needs, the theme drafts, and the log are.
- The text says what the app is, how my teammate and I share one repository, what is done, and what is next.
- The stylesheet and scripts are at `?v=20261030`.

### Checked

- `cards.js` loads. Opened straight from `#artifact-4` at 390 by 844 and 1280 by 800, the Artifact 4 shop shows the new title, the button, and the text scrolling under them. Nothing scrolls sideways.
- Not checked: live on GitHub Pages (after the push), a real phone, Safari, or Firefox.
- The link points at `nicks-branch` because the plan is not merged into `main` yet. Once it is merged, the link can point at the repository itself.

---

## 2026-10-31 · Artifact 4 card: the link goes to the repository

### What I asked for

- The plan is merged into `main` in the articulate repository now, so the card's button can open the repository itself instead of a branch.

### What changed

- The button, "See the plan and drafts", now opens https://github.com/iiSurf/articulate.
- The text's progress line now includes the scoring test, which passed: a free speech model running in the browser can grade each sound well enough. Next is building the app.
- The stylesheet and scripts are at `?v=20261031`.

### Checked

- The previous change, live: after GitHub Pages published it, https://iisurf.github.io/Portfolio/#artifact-4 showed the new card at 390 and 1280 wide, with nothing scrolling sideways.
- This change: `cards.js` loads, the repository page answers, and the Artifact 4 shop shows the card at 390 by 844 and 1280 by 800, opened straight from `#artifact-4`.
- Not checked yet: this change live (after the push), a real phone, Safari, or Firefox.

---

## 2026-11-08 · Artifact 4 card: done

### What I asked for

- Artifact 4 is due tonight (November 8). Finish its card: done, with a link that opens something to demo.

### What changed

- The card is now "done". Its button, "Open the app", opens the live app at https://iisurf.github.io/articulate/.
- The reflection says what the app does, how two people and two Claude Code agents shared one repo, what I tested before building the colors (61 word pairs, 89% of swapped sounds caught), what I learned, and what is still to do (the first-visit tour, the Ukrainian tips, and testing with real voices).
- The stylesheet and scripts are at `?v=20261108`.

### Checked

- `cards.js` loads, and the app link answers.
- Opened straight from `#artifact-4` at 390 by 844 and 1280 by 800: the shop shows "Open" with the new title, button, and text scrolling under them.
- Not checked yet: live on GitHub Pages (after the push), a real phone, Safari, or Firefox.

---

## 2026-11-08 · Artifact 4's shop: a snowboard shop

### What I asked for

- Artifact 4's shop inside looked like the standard coffee shop. I asked for a theme of its own, a snowboard shop with a shopkeeper and a customer, like the skate fitting shop in Artifact 1.

### What changed

- Artifact 4 now opens into a snowboard shop (`snowInteriorHTML` in `script.js`, `.snow-room` in `style.css`), built the way the coaches' room was:
  - pine walls and ceiling beams, with two lamps;
  - a window onto snowy peaks and pines, with snow falling;
  - three snowboards on a wall rack, and a shelf of helmets and goggles;
  - the walls filled in, like the skate shop: a garland of pennants, a wall clock, a rail of three puffy jackets, a shelf of beanies, a pegboard of goggles and mittens on each side, a shelf of bindings, a long shelf of snowboard boots, and a framed mountain poster;
  - the floor filled in: a rack of six boards standing in slots, a barrel of boards, stacked boot boxes, and a try-on bench with boots, plus a pair of boots on the floor;
  - a wooden floor with a red rug;
  - the letter board with the card, as in every shop;
  - the shopkeeper, in an orange fleece vest with a snowflake badge, next to a customer in a red puffy jacket and earmuffs, holding up a new board.
- Everything is drawn in code. The snow animation stops with reduced motion, like the other rooms.
- The shop's front in the village is unchanged.
- The stylesheet and scripts are at `?v=20261108b`.

### Checked

- At 390 by 844, 768 by 1024, 844 by 390 (a phone held sideways), 1280 by 800, and 1920 by 1000, opened straight from `#artifact-4`: the room shows, nothing scrolls sideways, and the way back is in place.
- On a computer the speech bubble covers part of the right pegboard. On a phone it's hidden, like in the other rooms.
- The wall and floor are laid out for a wide screen. On a very wide or very tall screen the picture is cropped a little, like the other rooms, so some items at the edges are cut off.
- Not checked yet: live on GitHub Pages (after the push), a real phone, Safari, or Firefox.

### Second round: full-size boards and a floor-to-ceiling window

- **The boards are full size next to the people.** They looked like fingerboards beside the people, because each was about 120 units long and a person's head is about 160. Floor boards are now about 300 units (2.5 times bigger), the barrel's boards about 285, and the two boards on the wall about 330. The customer holds a board that stands taller than their head. The people are only drawn from the waist up, so none of this can be fully to scale, but a board now reads as a board.
- **The window is floor to ceiling** on the right, with a view of a snowy mountain:
  - a chairlift climbing the slope, with its station, two pylons, and chairs with riders going up and empty chairs coming down;
  - a line of people waiting to get on, in colored jackets, some with snowboards, along a rope that switches back;
  - snow falling in front of it all (56 flakes, drifting down);
  - pine trees in the foreground, and a wide wooden frame with a cross bar.
- The old small window, the helmet shelf, and the right pegboard are gone to make room for it. Two full-size boards hang on the wall beside it, and the left pegboard is now just a row of goggles, so the standing boards fit under it.
- **The people changed places:** the shopkeeper is on the left and the customer on the right, so the customer's tall board stands clear of the letter board's text. The speech bubble sits to the left of the shopkeeper, over the open floor.
- Bug found by looking: my new window function had the same name as the skate shop's window function, so the old one replaced it and the window didn't show. Mine is now `snowShopWindowSVG`.
- Checked again at 390, 768, 844 by 390, 1280, and 1920: nothing scrolls sideways, and the snow animation stops with reduced motion (the Portfolio's own rule).
- Not checked: a real phone, Safari, or Firefox. On a phone the letter board hides the window, as in the other rooms.

### Third round: thicker, bigger boards, and muted colors

- **The boards are thicker and bigger.** They looked thin because they had been stretched more in length than in width. Now they are about 75 wide and 330 to 360 long, which is a chunkier, more real board shape.
  - The floor rack holds five boards (about 410 wide), and the barrel holds three.
  - Two big boards hang on the wall by the window, and the customer holds a thick one taller than their head.
  - The floor rack, barrel, and boxes were moved over to make room, and the bench is gone: a pair of boots stands on the boxes instead.
- **The colors are muted,** with bright highlights only where they help:
  - Muted base tones: slate blue, sage, stone, clay, charcoal, and cream.
  - Bright accents: red, blue, orange, and pink, used for stripes on the boards, panels on the jackets, the goggle lenses, the beanie pom-poms, a few bindings and boots, and a few people in the line for the lift.
  - The pennants, lamp shades, and rug are muted too. The people at the front keep their orange vest and red jacket.
- The window moved a little right to make room for the wider boards beside it.
- Checked at 390, 768, 844 by 390, 1280, and 1920: nothing scrolls sideways.

### Fourth round: eleven different snowboard designs

- The shop has 11 snowboards (5 in the floor rack, 3 in the barrel, 2 on the wall, and the one the customer holds), and each now has its own original design, inspired by the pictures iiSurf shared. There are no brand names or logos on any of them.
  - **Rack:** colored bands with a ring mark, a pale grey board with a dark mountain, a winter forest at sunset, a white board with a panda, and a moon over a red peak with layers of rock.
  - **Barrel:** a city skyline burst in teal and black, a white board covered in grey doodles, and a jungle with a bird and flowers.
  - **Wall:** a dark wood-grain board with a swallowtail and an orange line, and a white board with a black-to-red-to-orange spear and a gold arch.
  - **Customer:** a blue-to-violet gradient with a thin red edge and small orange, pink, and cream marks.
- Each design is drawn in code (`snowDesign` in `script.js`, replacing the old one-design board). Its colors are muted, with small bright highlights, as asked. One board has a different shape, the swallowtail.
- The barrel's boards were spread apart so all three designs show.
- Checked: all 11 boards are on the page at 390, 768, 844 by 390, 1280, and 1920, and nothing scrolls sideways.

### Fifth round: technical outerwear, goggles, helmets, and bindings

- **Jackets and pants match the references** (modern hooded shells, no brands or logos):
  - a jacket with a blurred black, grey, cream, and orange print, a cream hood, and a black sleeve;
  - a white jacket with charcoal sleeves, white cuffs, and black corners at the hem;
  - a black and cream jacket with tan side panels, chest pockets, and red zip pulls;
  - an all-red jacket;
  - white cargo pants with a side pocket, and charcoal pants with an orange zip.
  They hang on two rails on the left wall.
- **Goggles:** a cylinder-lens style, in three versions on a pegboard on the right wall: a mirror lens fading from red to orange, a dark smoke lens with a red strap and red inner trim, and a white frame with a black lens.
- **Helmets:** three on a shelf on the left wall, with vents, a visor, and ear pads (cream with a black band, charcoal with orange, and sage with pink).
- **Bindings:** drawn properly now, from the side, with a highback, an ankle strap, and a toe strap. Three hang on a pegboard on the left wall, and a row of seven stands on the long shelf in the middle (the letter board hides it on narrower screens).
- The beanies moved to a small shelf under the goggles. The wall clock was removed: it only showed as a sliver over the letter board.
- Checked at 390, 768, 844 by 390, 1280, and 1920: nothing scrolls sideways.

---

## 2026-11-08 · Artifact 4 card: the tour, the download window, and the tips are live

### What I asked for

- The articulate repository got the download window, the resumable download, and the Ukrainian tips (merged into `main`), so the card's last lines were out of date: they said the tour and the tips were still to do.

### What changed

- The reflection now says what is true:
  - three ways to practice, with the tips that start from a Ukrainian sound;
  - the speech model runs in the browser, and a window explains its 355 MB download first, which resumes if the connection breaks;
  - the plan, the scoring test, and what I learned (all kept).
- It also says what is still to do: my friend hasn't tried the app yet, so a Ukrainian speaker needs to check the tips, and it needs testing on a real phone.
- It is about 230 words (it also mentions the Progress boards and Say it round, added after the app got them), about as long as before (a first draft with every new detail ran to 315, which was too long for the board).
- The stylesheet and scripts are at `?v=20261108c`.

### Checked

- The live app first, in a fresh browser at 390 wide: a new visitor sees the welcome, Speak without the model opens the download window with its explanation, Read, Listen, the word page, and Your colors open with no window and no errors, and the tips file loads.
- The card opened straight from `#artifact-4` at 390 by 844 and 1280 by 800: "★ Open", the new text, and nothing scrolling sideways.
- Not checked yet: the card live (after the push), a real phone, Safari, or Firefox.

---

## 2026-11-09 · The mountains run better on a phone

### What I asked for

- The mountains' frame rate is slow on my phone. Look for anything that can make it run better.

### What I found

- I measured the page in headless Chrome at 390 by 844 on a 3x screen, with tracing on. The big drawing behind the skaters (mountains, ski resort, lanterns, shore, animals) was being repainted **60 times a second** even when nothing seemed to move. About 30 lantern, star, flame, smoke and snowflake animations each changed it on a different frame, and the skaters' reflections, the animals and the ski resort changed it on their own beats too. Every repaint redraws all of it (it has a blur, masks and over 1,200 shapes), and on a phone that is the part that runs out of time first.
- The village had the same problem, and a mistake of mine: last time I gave each shop a layer of its own, which made the phone's graphics chip recompute each shop's blurred shadow every time the snow updated (about three times the graphics time).

### What changed

- The lanterns' glow, the twinkling stars, the campfires, the chimney smoke and the swinging snowflakes are now moved by the script instead of by CSS, all together on one beat (10 times a second, 5 in lite mode). Each keeps its own speed and start offset, and the same easing, so the look is the same. The village's stars, string lights and chimney smoke move together too (5 times a second, only while the village is on screen). If the script cannot take them over, the CSS animations still run as before.
- The ski resort and the animals use the same beat (the dogs get more steps only while they walk or wag, and the eagle keeps every frame while it flies).
- The skaters' reflections have a layer of their own (`#heroRefl`, between the back drawing and the skate marks), so their 60 moves a second no longer repaint the mountains. Nothing looks different (I compared the still, reduced-motion picture before and after at 390 and 1280: only the falling snow differs).
- The shops no longer have `will-change: transform` (the mistake above).
- The stylesheet and scripts are at `?v=20261109`.

### Measured (before, after)

- The big drawing: 60 repaints a second, then about 15 (it still changes on every beat, and when the dogs walk).
- Graphics and compositing time on the lake: 180 ms a second, then 48 (a quarter). In the village: 270, then 93.
- Frame rate with the processor slowed 12 times (a stand-in for a weak phone): 39 frames a second, then 53 at 390 wide; 26, then 31 at 1280 wide. Slowed 16 times: 27, then 36 at 390 wide.
- The skaters themselves still take the most main-thread time (they are the point of the page).

### Checked

- 390, 768, 844 by 390, 1280, 1440, 1920 and 2560 wide: no console errors, nothing scrolls sideways, every shop opens, all six secrets can be found with real clicks (390 and 1280), the eagle still takes off and lands with two smooth turns, the chairs, skiers and dogs keep moving (also in lite mode), and reduced motion still holds everything still.
- Not checked: a real phone, Safari, or Firefox. The numbers come from a laptop's Chrome, so they show how much work was cut, not what a phone will feel.

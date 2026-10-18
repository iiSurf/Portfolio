/*
  ============================================================
  YOUR CARDS  (this is the only file you need to edit)
  ============================================================

  Two things live in this file:
    - ABOUT: your About me and your resume. They hang in the
      skate fitting shop (fittingShop below picks which shop).
    - ARTIFACTS: your five artifact cards, one shop each.

  To hand in an artifact:

    1. Find its block in ARTIFACTS (number: 2, number: 3, ...).
    2. Change  status: "idea"  to  status: "done".
    3. Fill in  title,  link,  and  reflection.
    4. Save, push to GitHub, and submit the same site link on Canvas.

  Tip: keep the quote marks and the comma at the end of each line.
  If the page goes blank after an edit, a missing quote or comma is
  almost always the reason.
*/

/*
  ------------------------------------------------------------
  ABOUT ME AND RESUME  (the skate fitting shop)
  ------------------------------------------------------------

  Fields:
    fittingShop      Which shop becomes the skate fitting shop.
                       1 to 5   = that artifact's shop. Its artifact card
                                  stays inside too, on its own tab.
                       "extra"  = a sixth shop of its own at the start of
                                  the street (0 does the same). All five
                                  artifact shops then stay as they are.
    shopName         The words on the shop's sign. Short is best.
    greeting         The big hello at the top of the board.
    about            A few sentences about you.
    traits           The little tiles under your About text.
    keeperSays       What the shopkeeper says in the speech bubble.
    resume           Your resume, in sections. Each section has a heading
                     and a list of items. Add or delete items and whole
                     sections as you like.
                     Anything in [square brackets] shows up as "still to
                     fill in", so replace it, brackets and all, with your
                     real details.
    resumeLink       A link to your resume file, for example a PDF.
                     Leave "" and the button stays hidden.
    resumeLinkLabel  The words on that button.
*/

window.ABOUT = {
  fittingShop: 1,
  shopName: "Skate Fitting",
  greeting: "Hi, I'm nick",
  about:
    "I love figure skating, ask me about how to join the UW Figure Skating Team. " +
    "This quarter I'm making five projects, and each one gets its own little shop in the village by the lake.",
  traits: ["Hardworking", "Not afraid to fail", "Attentive"],
  keeperSays: "Welcome in! Let's find you the perfect fit.",
  resume: [
    {
      heading: "Education",
      items: [
        "University of Washington Tacoma",
        "TCSS 490: Special Topics in Computing and Software Systems",
      ],
    },
    {
      heading: "Experience",
      items: [
        "Software Engineer Intern at Outpave, LLC: August 2026 - Present",
        "[One thing you did or learned there]",
      ],
    },
    {
      heading: "Skills & Certificates",
      items: [
        "AWS Certified Cloud Practitioner",
        "Microsoft Certified: Azure Fundamentals",
        "Java, Javascript, AWS, Azure, React",
      ],
    },
    {
      heading: "Figure skating",
      items: [
        "Pre Free Skate",
        "UW Figure Skating Team",
        "[One thing you did or learned there]",
      ],
    },
  ],
  resumeLink: "",
  resumeLinkLabel: "Download my resume (PDF)",
};

/*
  ------------------------------------------------------------
  ARTIFACT CARDS
  ------------------------------------------------------------

  Fields:
    number      Artifact number (1 to 5). Don't change these.
    status      "done" for a finished artifact, "idea" for a placeholder.
    title       The card's heading.
    link        Where the artifact lives (a URL). Leave "" if there isn't one yet.
    linkLabel   The words on the link button.
    reflection  A few sentences on how it went and what you learned.
                For an idea card, this is where your idea goes.
    art         Which little concept picture to show:
                "mountain", "tracker", "coach", "language", or "calendar".
*/

window.ARTIFACTS = [
  {
    number: 1,
    status: "done",
    title: "My Portfolio",
    link: "./",
    linkLabel: "You're looking at it",
    reflection:
      "This website, built with Claude Code as a static page (HTML, CSS and JavaScript, no server). " +
      "I went through a snow globe version and a castle version before deciding to start over completely. " +
      "This time I gathered reference pictures for the feeling I wanted: full and vibrant, layered like paper art, " +
      "with glowing details and cozy shops, set by a mountain lake like Lake Louise. " +
      "I learned that showing examples of a style works much better than describing it in words. " +
      "Every change is in LOG.md.",
    art: "mountain",
  },
  {
    number: 2,
    status: "done",
    title: "MySkate",
    link: "https://iisurf.github.io/MySkate/",
    linkLabel: "Open MySkate",
    reflection:
      "A figure skating practice tracker I will actually use. I plan a session before I skate, log it from my phone at the rink " +
      "(a clock that only counts my time on ice, a one to five skate rating, and a landed or missed counter for jumps), " +
      "and watch my level, my streak and my blade life build. The newest part is a competition planner: I lay a program out on a diagram of the rink, " +
      "set each element to the music, plan the day, and record how it went on a scoreboard. " +
      "Everything stays on my own device, so there is no server and no account. " +
      "I built it with Claude Code in small steps, and the look took the most tries: after one redesign did not fit, " +
      "I asked for ten rough drafts first and chose a theater-program look from those. " +
      "I learned that drafts beat descriptions, and that tests catch bugs I would never spot. " +
      "Every change is in the repo's LOG.md.",
    art: "tracker",
  },
  {
    number: 3,
    status: "idea",
    title: "AI skating coach",
    link: "",
    linkLabel: "",
    reflection:
      "Something with AI inside it. It would compare a skater's posture and technique to standard figure skating form " +
      "and point out what to fix, like a coach that is there every time you practice, not only during lessons.",
    art: "coach",
  },
  {
    number: 4,
    status: "idea",
    title: "English practice app",
    link: "",
    linkLabel: "",
    reflection:
      "An English learning app for my friend, so they can practice a little every day in a way that feels friendly and not like homework. " +
      "I want to build it around what they actually need to say in real life.",
    art: "language",
  },
  {
    number: 5,
    status: "idea",
    title: "Skating hub and rink schedules",
    link: "",
    linkLabel: "",
    reflection:
      "A figure skating headquarters with a calendar, so skaters can see which rinks have public skate sessions open, " +
      "find coaches to contact, and find shops. Another option is a new website for one skating rink, " +
      "because most rink scheduling sites are really hard to use and I think they could be so much better.",
    art: "calendar",
  },
];

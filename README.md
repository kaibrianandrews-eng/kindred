# Kindred

A friendly social network with a built-in anti-bullying **Shield**.

- **Tone check** while you type, and a "Pause before posting" screen for hurtful messages
- **Threats and telling someone to hurt themselves are blocked**
- **Mean comments are hidden** from other people, based on each person's filter level
- **Report, block and mute words**, plus a moderation panel for admins (remove posts, ban accounts)
- **Log in** with email or Google, or **browse as a guest**

The website files live in `docs/` and are hosted by **GitHub Pages**.
Logins and posts are stored with **Firebase** (free from Google), because GitHub Pages can only host files.

---

## Setup

### 1. Turn on GitHub Pages
In this repository: **Settings → Pages → Build and deployment**.
Set **Source** to *Deploy from a branch*, **Branch** to `main`, folder `/docs`, and press **Save**.
After a minute your site is at `https://YOUR-NAME.github.io/kindred/`.
It will say "Almost ready" until you finish the Firebase steps.

### 2. Make a Firebase project
1. Go to https://console.firebase.google.com and press **Create a project**. Name it `kindred`.
2. You can turn Google Analytics off.

### 3. Turn on logins
In Firebase: **Build → Authentication → Get started → Sign-in method**. Enable:
- **Email/Password**
- **Google**
- **Anonymous** (this is what "Continue as guest" uses)

Then go to **Authentication → Settings → Authorized domains → Add domain** and add `YOUR-NAME.github.io`.

### 4. Connect the website to Firebase
1. In Firebase, open **Project settings** (the gear) → **Your apps** → the **</>** (Web) button. Name it `kindred` and register it.
2. Firebase shows a block of code with `const firebaseConfig = { ... }`.
3. In this repository, open `docs/firebase-config.js`, press the pencil to edit, and replace the placeholder values with yours. Commit the change.

These values are safe to have in a public repository. The security rules in the next step are what protect the data.

### 5. Make the database and add the security rules
1. In Firebase: **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**.
2. Open the **Rules** tab, delete what's there, paste everything from `firestore.rules` in this repository, and press **Publish**.

The rules run on Google's servers. They make sure people can only change their own posts, can't steal usernames, can't un-ban themselves, and that only admins can read reports or remove other people's posts.

### 6. Make yourself an admin
1. Open your Kindred site, sign up, and pick a username.
2. Tap your @username at the top. Copy **Your user ID**.
3. In Firebase: **Firestore Database → Data → Start collection**. Collection ID: `admins`. Document ID: paste your user ID. Add any field (for example `role` = `owner`) and save.
4. Reload Kindred. The **Moderation** panel appears for you.

Do the same for anyone else you trust to moderate.

---

## Good to know

- **The Shield runs in each person's browser.** It catches common bullying, including tricks like `stup1d` or `stuuupid`, but someone determined can find wording it misses. Reports, blocks and admin tools are the backup. Keep an eye on the Moderation panel.
- **People must be 13 or older to sign up.** Kindred asks at sign-up. If the site's owner is under 18, a parent or guardian should own the GitHub and Firebase accounts.
- **Firebase's free plan** covers a small community easily. If Kindred gets big, Firebase will tell you before anything costs money.
- **Help for people being bullied:** StopBullying.gov. In the US, text HOME to 741741 or call or text 988, any time.

## Files

| File | What it is |
| --- | --- |
| `docs/index.html` | The page and its design |
| `docs/app.js` | Everything Kindred does: logins, feed, Shield, moderation |
| `docs/firebase-config.js` | Your Firebase settings (step 4) |
| `firestore.rules` | Database security rules (step 5) |
| `firebase.json` | Only needed if you use the Firebase command-line tools |

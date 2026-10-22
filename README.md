# Full Focus Planner — setup guide

Two apps, one website:

| App | Who | Link (after setup) | Sign-in |
|---|---|---|---|
| **Planner** | Jared | `https://YOUR-GITHUB-NAME.github.io/focus-planner/` | No |
| **Owners' page** | Company owners | `https://YOUR-GITHUB-NAME.github.io/focus-planner/dashboard/` | No |

Nobody signs in; each app opens straight from its link. Owners see only Daily Big 3, Weekly Big 3, the week at a glance and quarterly goal progress. It updates live as you plan. Tasks, schedule, notes, rituals and anything marked Private don't appear on the owners' page. They aren't locked, though: anyone who has the planner link can open and edit the planner.

Setup takes about 15 minutes. You need a Google account (for Firebase) and a GitHub account. Both are free.

---

## Part 1 — Firebase (the database)

1. Go to **console.firebase.google.com** and click **Create a project**. Name it `focus-planner`. You can turn off Google Analytics.
2. **Create the database:** **Databases & Storage → Firestore → Create database**. Pick a US location (for example `us-east1`), then choose **Start in production mode**.
3. **Paste the security rules:** on the Firestore page, open the **Rules** tab. Delete what's there, paste everything from `firestore.rules` in this folder, and click **Publish**.
4. **Register the website:** click the gear icon → **Project settings**. Under *Your apps*, click the **</>** (Web) icon, name it `Focus Planner`, and click **Register app** (leave Firebase Hosting unchecked). Firebase shows a block of code with `const firebaseConfig = { ... }`. Keep that page open; you need those values in Part 2.

## Part 2 — GitHub (the website)

1. Go to **github.com → New repository**. Name it `focus-planner`, set it to **Public**, and click **Create repository**.
   Public is fine: the code holds no planner data. Your data lives in Firebase behind the security rules.
2. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder**, including the `owners` and `icons` folders and the `.nojekyll` file. Click **Commit changes**.
   On a Mac, press Cmd+Shift+. in Finder to show `.nojekyll` if you can't see it.
3. **Add your Firebase settings:** in the repository, open `config.js`, click the pencil icon, and replace each `PASTE_...` value with the matching value from the Firebase page in Part 1, step 4. Click **Commit changes**.
4. **Turn on the website:** **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**, then click **Save**. After a minute or two the page shows your site's address.

## Part 3 — Start using it

1. Open your **planner link** on your computer and bookmark it.
2. **On your phone**, open the same link.
   - iPhone (Safari): tap **Share → Add to Home Screen**.
   - Android (Chrome): tap **⋮ → Install app** or **Add to Home screen**.
   It keeps working on a weak signal and syncs when you're back online.
3. **Send the dashboard link** (`.../dashboard/`) to the company owners. They can add it to their home screen the same way.

---

## Good to know

- **Private items:** each Big 3 item and quarterly goal has a Shared / Private switch. Private ones never reach the owners' page.
- **Keep the planner link to yourself.** Anyone who has it can open and edit your planner.
- **Owners' page** can be opened by anyone with that link, so share it only with the owners.
- **Cost:** a single person's planner stays well inside Firebase's free tier.
- **Files:**
  - `index.html`, `planner.js`: your planner
  - `dashboard/index.html`: the owners' page
  - `common.js`: shared date helpers and the owners' page layout
  - `firebase.js`, `config.js`: database connection
  - `app.css`: styles
  - `firestore.rules`: database rules to paste into Firebase
  - `manifest.webmanifest`, `icons/`: home-screen app settings

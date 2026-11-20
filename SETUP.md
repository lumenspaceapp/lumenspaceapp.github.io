# Turning on shared workspaces

Lumen works without any setup: each browser keeps a private workspace. To let friends sign in with Google and edit the same pages live, connect a free Firebase project once. It takes about 10 minutes.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project**, name it (for example `lumen-notes`) and finish the wizard. Google Analytics is not needed.

## 2. Turn on Google sign-in

1. In the left menu open **Build → Authentication → Get started**.
2. Under **Sign-in method**, choose **Google**, switch it on, pick a support email and **Save**.
3. Open the **Settings** tab → **Authorized domains** → **Add domain** and add `lumenspaceapp.github.io` (your GitHub Pages domain).

## 3. Create the database

1. Open **Build → Firestore Database → Create database**.
2. Choose a location near you and start in **production mode**.
3. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.

## 4. Connect the website

1. Click the gear icon → **Project settings** → **Your apps** → the **</>** (Web) button. Register an app (no hosting needed).
2. Copy the `firebaseConfig` object it shows.
3. In `js/firebase-config.js`, replace `null` with that object, for example:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "…",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

   These values identify the project; they are meant to be public. The security rules decide who can read and write.
4. Commit and push. GitHub Pages updates in about a minute.

## 5. Share with friends

1. On the site, click **Share → Share with friends…** (or the workspace menu → **New shared workspace…**) and sign in with Google.
2. Choose whether to copy your private pages into it, then create it.
3. In **Share**, type each friend's Gmail address and press Enter.
4. Send them the invite link (**Share → Copy invite link**). They sign in with the invited account and the workspace opens.

Everyone sees edits within a second or two, avatars show who is online (a coloured ring means they're on the same page), and edits to different blocks of the same page are merged. If two people edit the very same block at the same moment, the last save wins.

## Limits on the free plan

- Firestore's free tier allows 50,000 reads and 20,000 writes per day, plenty for a group of friends.
- Each page can hold about 900 KB. Uploaded images are stored inside the page, so prefer image links for big pictures in shared workspaces.

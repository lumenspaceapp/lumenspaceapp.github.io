/* Firebase settings for shared workspaces (Firebase console → Project settings → Your apps → Web app).
   These values are public identifiers, not secrets; who can read and write is enforced by firestore.rules.
   Set to null to run without sharing (each browser keeps its own private workspace). */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvK47dK1PbBRmnvxHji7tBlluiraxaeWE",
  authDomain: "lumen-notes-cde2c.firebaseapp.com",
  projectId: "lumen-notes-cde2c",
  storageBucket: "lumen-notes-cde2c.firebasestorage.app",
  messagingSenderId: "152931493861",
  appId: "1:152931493861:web:aa1f92a0c89fc99e3fb10c",
};

/* Lumi AI: address of the Cloudflare Worker in worker/ (e.g. "https://lumi-ai.<you>.workers.dev").
   Leave empty to use the built-in help guide only. */
window.LUMI_AI_URL = "";

/* Lumen worker (worker/): branded invite emails (/invite) and the public API (/v1). Lumi AI uses it too once LUMI_AI_URL is set
   (after the ANTHROPIC_API_KEY secret is added to the worker). */
window.LUMEN_API_URL = "https://lumi-ai.gamerslife1183.workers.dev";

/* Google Drive live folders: the OAuth "Web application" client ID (Google Cloud console → APIs & Services → Credentials),
   e.g. "1234-abc.apps.googleusercontent.com". Leave empty to fall back to a Firebase Google pop-up for Drive access. */
window.GOOGLE_CLIENT_ID = "152931493861-oq06c3ijigqbam4tvt1rajke9bnldcek.apps.googleusercontent.com"; // public OAuth web client id (not a secret)

/* Microsoft sign-in (Microsoft 365 / Entra ID, formerly Azure Active Directory work accounts). Turn it on in the Firebase console
   (Authentication → Sign-in method → Microsoft, with an app registered in Microsoft Entra), then set this to true.
   MICROSOFT_TENANT: "" lets any Microsoft account in; a tenant ID or domain (e.g. "yourcompany.onmicrosoft.com") limits it to one organization. */
window.MICROSOFT_SIGNIN = false;
window.MICROSOFT_TENANT = "";

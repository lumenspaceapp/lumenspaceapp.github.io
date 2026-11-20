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

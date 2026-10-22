import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
export const app = configured ? initializeApp(firebaseConfig) : null;

let _db = null;
if (app) {
  try {
    // Offline cache: the planner opens and saves on a phone with a weak signal, and syncs when back online.
    _db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    _db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
export const db = _db;

export const setupScreen = () => `<section class="sheet auth">
  <div class="eyebrow">Setup needed</div>
  <h1>Connect <em>Firebase</em></h1>
  <p class="sub">This site isn't connected to a database yet. Open <code>config.js</code> in the GitHub repository and paste in your Firebase web app settings. The setup guide in <code>README.md</code> walks through it.</p>
</section>`;

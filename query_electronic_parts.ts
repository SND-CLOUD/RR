
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";

const firebaseConfig = {
  projectId: "nsd-1-a8b8d",
  appId: "1:960788941720:web:2624067fdbea434c21f9ed",
  apiKey: "AIzaSyCKes3LpRiNH1Ag2JE-aUjDpQ9ERhxJBxQ",
  authDomain: "nsd-1-a8b8d.firebaseapp.com",
  firestoreDatabaseId: "default",
  storageBucket: "nsd-1-a8b8d.firebasestorage.app",
  messagingSenderId: "960788941720"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const q = query(collection(db, "shop_parts_inventory"), where("itemType", "==", "electronic_part"));
  const snapshot = await getDocs(q);
  let total = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    total += (Number(data.quantity) || 0) + (Number(data.usedQuantity) || 0);
  });
  console.log("RESULT_TOTAL_ELECTRONIC_PARTS:" + total);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

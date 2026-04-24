const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

async function deleteAllUsers() {
  let deleted = 0;
  let pageToken = undefined;

  while (true) {
    const result = await admin.auth().listUsers(1000, pageToken);
    const uids = result.users.map((user) => user.uid);
    if (uids.length) {
      await admin.auth().deleteUsers(uids);
      deleted += uids.length;
      console.log(`Deleted ${deleted} users...`);
    }
    if (!result.pageToken) break;
    pageToken = result.pageToken;
  }

  console.log(`Done. Total users deleted: ${deleted}`);
}

deleteAllUsers().catch((err) => {
  console.error('Failed to delete users:', err);
  process.exit(1);
});

// Verify the fixed spin rotation math always lands on the correct slice
const rewards = [100, 250, 100, 50, 100, 500, 250];
const slice = 360 / rewards.length; // 51.4286

function simulateSpin(currentRotation, serverReward, useJitter) {
  const matching = rewards.map((v, i) => v === serverReward ? i : -1).filter(i => i >= 0);
  const pickIndex = matching[0]; // pick first matching for predictability
  const centerAngle = (pickIndex * slice) + (slice / 2);

  const desiredFinalAngle = (360 - centerAngle + 360) % 360;
  const currentAngle = ((currentRotation % 360) + 360) % 360;
  let delta = desiredFinalAngle - currentAngle;
  if (delta <= 0) delta += 360;
  const jitter = useJitter ? (Math.random() - 0.5) * 36 : 0;
  const extraSpins = 5;
  const targetRotation = currentRotation + (extraSpins * 360) + delta + jitter;
  const newRot = ((targetRotation % 360) + 360) % 360;
  const pointerSees = (360 - newRot) % 360;
  const sliceIdx = Math.floor(pointerSees / slice);
  const sliceValue = rewards[sliceIdx];
  const ok = sliceValue === serverReward;
  return { newRot, ok, sliceValue, serverReward, jitter, pointerSees, sliceIdx };
}

console.log("=== No-jitter sequential spins ===");
let rot = 0;
const sequence = [100, 250, 500, 50, 100, 250, 100, 500, 50, 250];
let allOk = true;
for (const reward of sequence) {
  const r = simulateSpin(rot, reward, false);
  console.log(`Server: ${reward} | landed: ${r.sliceValue} (slice ${r.sliceIdx}) | pointer: ${r.pointerSees.toFixed(2)} | ${r.ok ? "OK" : "*** WRONG ***"}`);
  if (!r.ok) allOk = false;
  rot = r.newRot;
}

console.log("\n=== With jitter: 200 random spins ===");
let jitterFails = 0;
for (let i = 0; i < 200; i++) {
  const reward = rewards[Math.floor(Math.random() * rewards.length)];
  const r = simulateSpin(rot, reward, true);
  if (!r.ok) {
    jitterFails++;
    console.log(`FAIL spin ${i}: server=${reward} landed=${r.sliceValue} jitter=${r.jitter.toFixed(2)} pointer=${r.pointerSees.toFixed(2)}`);
  }
  rot = r.newRot;
}
console.log(`Jitter test: ${200 - jitterFails}/200 correct${jitterFails ? " (" + jitterFails + " FAILURES)" : " (all passed!)"}`);

console.log("\n" + (allOk && jitterFails === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"));

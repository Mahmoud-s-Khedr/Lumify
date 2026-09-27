import {
  approveFakeStudents,
  enrollFakeStudents,
  exerciseLiveCommunity,
  setUpAdminScenario,
  simulation,
} from './community-simulation-lib.mjs';

try {
  const context = await setUpAdminScenario();
  console.log(`Created course ${context.courseId} and round ${context.roundId}.`);
  await enrollFakeStudents();
  console.log('Registered two fake students and submitted their payment evidence.');
  await approveFakeStudents();
  console.log('Approved both bookings as the system administrator.');
  const result = await exerciseLiveCommunity();
  console.log(
    `PASS: live REST, R2 upload/download, and Socket.IO community flow passed for course ${result.courseId}.`,
  );
  console.log(`State retained for inspection in ${simulation.contextPath}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

import {
  approveFakeStudents,
  setUpAdminScenario,
  simulation,
} from './community-simulation-lib.mjs';

const command = process.argv[2];

try {
  if (command === 'setup') {
    const context = await setUpAdminScenario();
    console.log(`Admin setup complete. Course ${context.courseId}, round ${context.roundId}.`);
    console.log(`Shared simulation state: ${simulation.contextPath}`);
  } else if (command === 'approve') {
    const context = await approveFakeStudents();
    console.log(
      `Approved ${context.students.length} simulated students for course ${context.courseId}.`,
    );
  } else {
    console.error('Usage: node scripts/community-simulate-admin.mjs <setup|approve>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

import { enrollFakeStudents, exerciseLiveCommunity } from './community-simulation-lib.mjs';

const command = process.argv[2];

try {
  if (command === 'enroll') {
    const context = await enrollFakeStudents();
    console.log(`Created and submitted payments for ${context.students.length} fake students.`);
  } else if (command === 'chat') {
    const result = await exerciseLiveCommunity();
    console.log(
      `Live community simulation passed for course ${result.courseId} (${result.historyMessageCount} visible messages).`,
    );
  } else {
    console.error('Usage: node scripts/community-simulate-students.mjs <enroll|chat>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

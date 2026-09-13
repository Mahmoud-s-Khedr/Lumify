import { publicUser } from '../users/presenter.js';

type StudentWithAvatar = Parameters<typeof publicUser>[0];

export function publicAdminStudent(
  student: StudentWithAvatar,
  enrollmentCount: number,
  confirmedEnrollmentCount: number,
) {
  return {
    ...publicUser(student),
    enrollmentCount,
    confirmedEnrollmentCount,
  };
}

import type { CommunityMessageWithDetails, CommunityWithLatestMessage } from './service.js';
import { publicFile } from '../files/presenter.js';

export function publicCommunityMessage(message: CommunityMessageWithDetails) {
  return {
    id: message.id.toString(),
    courseId: message.courseId.toString(),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    sender: {
      id: message.sender.id.toString(),
      name: message.sender.name,
      avatar: message.sender.avatarFile ? publicFile(message.sender.avatarFile) : null,
    },
    attachments: message.attachments.map((attachment) => publicFile(attachment.file)),
  };
}

export function publicCommunity(course: CommunityWithLatestMessage) {
  return {
    course: {
      id: course.id.toString(),
      title: course.title,
      description: course.description,
      archived: course.archived,
    },
    readOnly: course.archived,
    latestMessage: course.communityMessages[0]
      ? publicCommunityMessage(course.communityMessages[0])
      : null,
  };
}

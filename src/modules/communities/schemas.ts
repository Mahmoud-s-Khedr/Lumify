import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const courseParamsSchema = z.object({ courseId: idSchema });
export const messageQuerySchema = z.object({
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const communityCourseEventSchema = z.object({ courseId: idSchema });
export const sendCommunityMessageSchema = communityCourseEventSchema.extend({
  content: z.string().max(5_000).optional(),
  attachmentIds: z.array(idSchema).max(10).default([]),
});
export const deleteCommunityMessageSchema = z.object({ messageId: idSchema });
export const communityReauthenticateSchema = z.object({ token: z.string().min(1) });

export type MessageHistoryQuery = z.infer<typeof messageQuerySchema>;
export type CommunityCourseEvent = z.infer<typeof communityCourseEventSchema>;
export type SendCommunityMessageInput = z.infer<typeof sendCommunityMessageSchema>;
export type DeleteCommunityMessageInput = z.infer<typeof deleteCommunityMessageSchema>;
export type CommunityReauthenticateInput = z.infer<typeof communityReauthenticateSchema>;

/**
 * Database Layer Index
 *
 * This file provides a centralized interface to all database operations.
 */

export { getUserRecordsByApiKey, getUserIdForApiKey, createApiKey, deleteApiKey } from './apiKeys.js';

export { storePasswordHash, getPasswordHash, updatePasswordHash } from './auth.js';

export { isModerator, isPolisDev } from './authorization.js';

export {
  addNoMoreCommentsRecord,
  commentExists,
  createComment,
  getAuthorUidsForComments,
  getCommentByIdFromDb,
  getCommentsForModerationFromDb,
  getCommentsListFromDb,
  getCommentsWithoutLanguage,
  getCommentTranslationsFromDb,
  getNumberOfCommentsRemainingFromDb,
  getNumberOfCommentsWithModerationStatus,
  storeCommentTranslationInDb,
  updateCommentLanguage,
  updateCommentModeration
} from './comments.js';

export { createContext, getContextByName, getPublicContexts } from './contexts.js';

export { createContributorAgreementRecord } from './contributors.js';

export {
  conversationIdToZidCache,
  createConversation,
  getCommentsForStats,
  getConversationByConversationId,
  getConversationByZid,
  getConversationForOwner,
  getConversationInfo,
  getConversationMetadataQuestions,
  getConversations,
  getConversationsWithFieldGreaterThan,
  getConversationTranslationsByLang,
  getConversationWithOwner,
  getCourseByInvite,
  getPageId,
  getParticipantInfo,
  getSiteOwner,
  getVotesForStats,
  getZidFromConversationId,
  isUserDeveloper,
  registerPageId,
  registerZinvite,
  updateConversation,
  updateConversationActive,
  verifyMetadataAnswersExistForEachQuestion
} from './conversations.js';

export {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from './conversationUpdates.js';

export { createCrowdModerationRecord } from './crowdModeration.js';

export {
  createDemographicAnswer,
  createDemographicQuestion,
  getDemographicAnswers,
  getDemographicQuestions,
  getParticipantDemographicsForConversation,
  getParticipantVotesForCommentsFlaggedWith_is_meta,
  getVotesAndDemographics
} from './demographics.js';

export {
  checkDomainPattern,
  createDomainWhitelistRecord,
  getDomainWhitelist,
  getDomainWhitelistForSite,
  getDomainWhitelistRecord,
  updateDomainWhitelistRecord
} from './domains.js';

export { getEinviteInfo, createEinvite, deleteEinvite, isEmailValidated, addEmailValidation } from './einvites.js';

export {
  addNotificationTask,
  claimNextNotificationTask,
  getDbTime,
  getNotificationCandidates,
  getNotificationEmails,
  maybeAddNotificationTask,
  subscribeToNotifications,
  unsubscribeFromNotifications,
  updateLastNotificationTime
} from './email.js';

export { getPidPromise } from './getPidPromise.js';

export { testConnection } from './health.js';

export {
  createInviterRecord,
  createSuzInvites,
  deleteSuzInviteRecord,
  getSuzinviteInfo,
  getSUZinviteRecord
} from './invites.js';

export { getParticipantLocations, createParticipantLocation } from './locations.js';

export {
  addXidWhitelist,
  checkMathTaskExists,
  createMathUpdateTask,
  createReportDataTask,
  getCorrelationMatrix,
  getXids,
  hasCommentSelections
} from './math.js';

export {
  createMetadataQuestion,
  createOrUpdateMetadataAnswer,
  deleteMetadataAnswer,
  deleteMetadataQuestionAndAnswers,
  getAllMetadata,
  getChoicesForConversation,
  getMetadataAnswers,
  getMetadataQuestions,
  getZidForAnswer,
  getZidForQuestion
} from './metadata.js';

export { recordMetricsData } from './metrics.js';

export { createNotificationTask, updateSubscription } from './notifications.js';

export { getSocialParticipantsForMod, updateParticipantModerationStatus } from './participantModeration.js';

export {
  addParticipant,
  createParticipant,
  getAnswersForConversation,
  getBidIndexToPidMapping,
  getParticipantByPid,
  getParticipantByUid,
  getParticipantByXid,
  getParticipantId,
  getSocialParticipants,
  pidCache,
  queryParticipantsByMetadata,
  saveParticipantMetadataChoices,
  socialParticipantsCache,
  updateExtendedParticipantInfo,
  updateParticipantMetadata
} from './participants.js';

export { getVoteCounts, getCommentCounts } from './participation.js';

export { getPcaData, getLatestCachedPcaData } from './pca.js';

export { recordPermanentCookieZidJoin } from './permanentCookies.js';

export { createOrUpdateSelection, deleteCorrelationMatrix } from './reportCommentSelections.js';

export {
  createReport,
  getReportById,
  getReportCommentSelections,
  getReportsByConversationId,
  getReportsByUserId,
  getRidFromReportId,
  getZidForRid,
  updateReport
} from './reports.js';

export { addStar } from './stars.js';

export {
  clearPasswordResetToken,
  clearVerificationToken,
  createPasswordResetToken,
  createSessionToken,
  createVerificationToken,
  deleteToken,
  getUserIdForPasswordResetToken,
  getUserIdForToken,
  getUserIdForVerificationToken
} from './tokens.js';

export { createTrashRecord } from './trash.js';

export { updateTutorialStep } from './tutorial.js';

export {
  getUpvoteByUserAndConversation,
  createUpvote,
  updateConversationUpvoteCount,
  getUpvotesByUser
} from './upvotes.js';

export { replaceZinvite, createSuzinvite } from './urls.js';

export {
  createDummyUser,
  createUser,
  getSiteUserEmails,
  getUserByEmail,
  getUserById,
  getUsersForModerationEmails,
  updateUser
} from './users.js';

export {
  aggregateVotesToPidVotesObj,
  cacheVotesForZidPidWithTimestamp,
  createEmptyVoteVector,
  getVotesForPids,
  getVotesForZidPidsWithTimestampCheck,
  getVotesForZidPidWithTimestampCheck
} from './votes-queries.js';

export { getVotesForParticipant, getFilteredVotesForParticipant, votesPost } from './votes.js';

export { getWorkerTasksByTypeAndBucket } from './workerTasks.js';

export { getXidStuff } from './xid.js';

export {
  createXidEntry,
  createXidRecord,
  createXidRecordByZid,
  getUserByXid,
  getXidRecord,
  getXidRecordByXidOwnerId,
  isXidWhitelisted,
  xidExists
} from './xids.js';

export {
  checkSuzinviteValidity,
  checkZinviteValidity,
  createZinvite,
  getConversationOwner,
  getZinvite,
  getZinvites,
  getZinvitesForConversation,
  updateZinvite,
  zidToZinviteCache
} from './zinvites.js';

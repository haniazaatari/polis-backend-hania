import express from 'express';

import authRoutes from './authRoutes.js';
import commentRoutes from './commentRoutes.js';
import contextRoutes from './contextRoutes.js';
import contributorRoutes from './contributorRoutes.js';
import conversationRoutes from './conversationRoutes.js';
import cookieRoutes from './cookieRoutes.js';
import dataExportRoutes from './dataExportRoutes.js';
import demographicsRoutes from './demographicsRoutes.js';
import domainRoutes from './domainRoutes.js';
import emailRoutes from './emailRoutes.js';
import exportRoutes from './exportRoutes.js';
import featureRequestRoutes from './featureRequestRoutes.js';
import healthRoutes from './healthRoutes.js';
import launchPrepRoutes from './launchPrepRoutes.js';
import locationRoutes from './locationRoutes.js';
import mathRoutes from './mathRoutes.js';
import metadataRoutes from './metadataRoutes.js';
import metricsRoutes from './metricsRoutes.js';
import participantModerationRoutes from './participantModerationRoutes.js';
import participantRoutes from './participantRoutes.js';
import participationRoutes from './participationRoutes.js';
import passwordRoutes from './passwordRoutes.js';
import reportRoutes from './reportRoutes.js';
import snapshotRoutes from './snapshotRoutes.js';
import starRoutes from './starRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import trashRoutes from './trashRoutes.js';
import tutorialRoutes from './tutorialRoutes.js';
import upvoteRoutes from './upvoteRoutes.js';
import userRoutes from './userRoutes.js';
import voteRoutes from './voteRoutes.js';
import zinviteRoutes from './zinviteRoutes.js';

const router = express();

// Namespaced routes
router.use('/auth', authRoutes);
router.use('/auth', passwordRoutes);
router.use('/contexts', contextRoutes);
router.use('/contributors', contributorRoutes);
router.use('/convSubscriptions', subscriptionRoutes);
router.use('/dataExport', dataExportRoutes);
router.use('/domainWhitelist', domainRoutes);
router.use('/dummyButton', featureRequestRoutes);
router.use('/group_demographics', demographicsRoutes);
router.use('/launchPrep', launchPrepRoutes);
router.use('/locations', locationRoutes);
router.use('/metadata', metadataRoutes);
router.use('/metrics', metricsRoutes);
router.use('/ptptois', participantModerationRoutes);
router.use('/reportExport', exportRoutes);
router.use('/snapshot', snapshotRoutes);
router.use('/stars', starRoutes);
router.use('/trashes', trashRoutes);
router.use('/tryCookie', cookieRoutes);
router.use('/tutorial', tutorialRoutes);
router.use('/upvotes', upvoteRoutes);
router.use('/users', userRoutes);
router.use('/votes', voteRoutes);
router.use('/zinvites', zinviteRoutes);

// Routes at the root level
router.use('/', commentRoutes);
router.use('/', conversationRoutes);
router.use('/', emailRoutes);
router.use('/', healthRoutes);
router.use('/', mathRoutes);
router.use('/', participantRoutes);
router.use('/', participationRoutes);
router.use('/', reportRoutes);

// Routes at the root level (non-API) are mounted from rootRoutes.js directly in app.js

export default router;
